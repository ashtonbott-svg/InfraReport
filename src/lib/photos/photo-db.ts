/**
 * Photo binary storage in IndexedDB.
 *
 * Photos are far too large for localStorage, so binaries go into an IndexedDB
 * object store keyed by photo id. A write only counts as saved after it has
 * been read back and its size matches. Storage is per browser, per device:
 * nothing here is uploaded or synchronized anywhere.
 */
const DB_NAME = "infrareport-photos";
const STORE = "blobs";
const VERSION = 1;

export interface StoredPhoto {
  id: string;
  blob: Blob;
  thumb: Blob | null;
  savedAt: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser does not support IndexedDB, so photos cannot be saved."));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error ?? new Error("Could not open photo storage")); };
      req.onblocked = () => reject(new Error("Photo storage is blocked by another open tab"));
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        let result: T;
        req.onsuccess = () => { result = req.result; };
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error ?? req.error ?? new Error("Photo storage error"));
        t.onabort = () => reject(t.error ?? new Error("Photo storage write was aborted (storage may be full)"));
      }),
  );
}

export async function savePhotoBlob(id: string, blob: Blob, thumb: Blob | null): Promise<StoredPhoto> {
  const rec: StoredPhoto = { id, blob, thumb, savedAt: new Date().toISOString() };
  await tx("readwrite", (s) => s.put(rec));
  const back = await getPhotoBlob(id);
  if (!back || back.blob.size !== blob.size) throw new Error("Photo could not be verified after saving");
  return back;
}

export function getPhotoBlob(id: string): Promise<StoredPhoto | undefined> {
  return tx<StoredPhoto | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredPhoto | undefined>);
}

export function deletePhotoBlob(id: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

export async function listPhotoIds(): Promise<string[]> {
  return (await tx("readonly", (s) => s.getAllKeys())).map(String);
}

/** Ask the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Reduce very large camera images (e.g. 12 MP, 4-8 MB) to at most `max` pixels
 * on the long side as JPEG. Plenty for equipment identification and reports,
 * and about a tenth of the storage. Returns the original when it is already
 * small or the browser cannot decode it.
 */
export async function resizeForStorage(file: Blob, max = 2400, quality = 0.85): Promise<Blob> {
  try {
    if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale >= 1 && file.size < 2.5 * 1024 * 1024) { bmp.close?.(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

/** Fraction of this site's storage quota in use, when the browser reports it. */
export async function storageUsage(): Promise<{ usage: number; quota: number; ratio: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return quota ? { usage, quota, ratio: usage / quota } : null;
  } catch {
    return null;
  }
}

/** Downscaled JPEG preview for lists. Returns null when the browser cannot decode the image (e.g. HEIC outside Safari). */
export async function makeThumbnail(file: Blob, max = 480): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.8));
  } catch {
    return null;
  }
}
