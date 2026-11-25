"use client";

/**
 * Browser side of the photograph upload queue: originals wait in IndexedDB until the server has
 * verified the stored copy; uploads use XHR for progress; the queue resumes after a refresh, when
 * the connection returns, and every 15 seconds while items are waiting.
 */
import { create } from "zustand";
import { accessToken, api, supabase } from "@/lib/cloud/client";
import { readPhotoMeta } from "./jpeg-meta";
import { parsePhotoName } from "./match";
import { sha256Hex, storagePathFor, UploadEngine, type QueueStore, type UploadItem, type UploadKind } from "./upload-engine";

const DB = "infrareport-uploads", STORE = "queue", FILES = "files", BUCKET = "inspection-photos";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "id" }); r.result.createObjectStore(FILES); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error ?? new Error("Upload storage unavailable")); };
  });
  return dbp;
}
function req<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const t = d.transaction(stores, mode);
    const r = fn(t);
    let out: T;
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error ?? new Error("Upload storage error"));
    t.onabort = () => rej(t.error ?? new Error("Upload storage is full"));
  }));
}
const idbStore: QueueStore = {
  list: () => req<UploadItem[]>([STORE], "readonly", (t) => t.objectStore(STORE).getAll()),
  put: (item, file) => req([STORE, FILES], "readwrite", (t) => { t.objectStore(STORE).put(item); if (file) t.objectStore(FILES).put(file, item.id); }),
  file: (id) => req<Blob | undefined>([FILES], "readonly", (t) => t.objectStore(FILES).get(id)),
  release: (id) => req([FILES], "readwrite", (t) => { t.objectStore(FILES).delete(id); }),
  remove: (id) => req([STORE, FILES], "readwrite", (t) => { t.objectStore(STORE).delete(id); t.objectStore(FILES).delete(id); }),
};

export const useUploads = create<{ items: UploadItem[] }>(() => ({ items: [] }));

function putObject(item: UploadItem, file: Blob, onProgress: (p: number) => void): Promise<"ok" | "exists"> {
  return accessToken().then((token) => new Promise((resolve, reject) => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
    const x = new XMLHttpRequest();
    x.open("POST", `${base}/storage/v1/object/${BUCKET}/${item.storagePath.split("/").map(encodeURIComponent).join("/")}`);
    x.setRequestHeader("authorization", `Bearer ${token}`);
    x.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    x.setRequestHeader("x-upsert", "false");
    x.setRequestHeader("content-type", item.mime || "application/octet-stream");
    x.setRequestHeader("cache-control", "max-age=31536000");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) resolve("ok");
      else if (x.status === 409 || /already exists|Duplicate/i.test(x.responseText)) resolve("exists");
      else reject(new Error(x.status === 401 || x.status === 403 ? "Not allowed to upload to this inspection." : `Upload failed (${x.status}).`));
    };
    x.onerror = () => reject(new Error("Connection lost during upload. It will resume automatically."));
    x.ontimeout = () => reject(new Error("Upload timed out. It will resume automatically."));
    x.timeout = 10 * 60_000;
    x.send(file);
  }));
}

let engine: UploadEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function uploadEngine(): UploadEngine | null {
  if (typeof window === "undefined" || !supabase()) return null;
  if (engine) return engine;
  const sb = supabase()!;
  engine = new UploadEngine({
    store: idbStore,
    onChange: (items) => useUploads.setState({ items }),
    insertRow: async (i) => {
      const { error } = await sb.from("photo_files").insert({
        id: i.id, organization_id: i.organizationId, inspection_id: i.inspectionId, facility_id: i.facilityId, kind: i.kind, building: i.building,
        result_id: i.resultId ?? null, image_number: i.imageNumber, original_name: i.name, mime_type: i.mime, size_bytes: i.size, sha256: i.sha256,
        storage_path: i.storagePath, metadata: i.meta ?? {}, captured_at: i.capturedAt,
      });
      if (!error) return "ok";
      if (error.code === "23505") return "exists";
      if (error.code === "42501") throw Object.assign(new Error("Not allowed to upload to this inspection."), { permanent: true });
      throw new Error(error.message || "Could not record the photograph.");
    },
    putObject,
    markUploaded: async (i) => { await sb.from("photo_files").update({ uploaded_at: new Date().toISOString() }).eq("id", i.id); },
    verify: (i) => api<{ verified: boolean; error?: string }>("/api/photos/verify", { method: "POST", json: { id: i.id } }),
  });
  const kick = () => { void engine?.run(); };
  window.addEventListener("online", kick);
  timer = setInterval(() => { if (useUploads.getState().items.some((i) => i.state !== "done" && i.state !== "failed")) kick(); }, 15_000);
  void idbStore.list().then((items) => { useUploads.setState({ items }); kick(); });
  return engine;
}

export function stopUploads() { if (timer) clearInterval(timer); timer = null; engine = null; }

const uid = () => `pf-${crypto.randomUUID()}`;

/** Queue original files for an inspection. Roles come from the file names / metadata, never re-encoding. */
export async function queuePhotos(files: File[], ctx: { organizationId: string; inspectionId: string; facilityId: string; kind?: UploadKind; building?: string; resultId?: string | null }) {
  const e = uploadEngine();
  if (!e) throw new Error("Photographs can be uploaded when signed in to the cloud.");
  const added: string[] = [];
  for (const file of files) {
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    const meta = readPhotoMeta(head);
    const parsed = parsePhotoName(file.name, meta);
    const kind: UploadKind = ctx.kind ?? (parsed.role ?? "other");
    const id = uid();
    await e.add({
      id, organizationId: ctx.organizationId, inspectionId: ctx.inspectionId, facilityId: ctx.facilityId, kind, building: ctx.building ?? "",
      name: file.name || "photo.jpg", mime: file.type || "image/jpeg", size: file.size, sha256: await sha256Hex(file), imageNumber: parsed.number ?? "",
      meta, capturedAt: meta.takenAt ? new Date(meta.takenAt).toISOString() : file.lastModified ? new Date(file.lastModified).toISOString() : null,
      resultId: ctx.resultId ?? null, storagePath: storagePathFor(ctx.organizationId, ctx.inspectionId, id, file.name || "photo.jpg"),
    }, file);
    added.push(id);
  }
  void e.run();
  return added;
}

export const retryUploads = () => uploadEngine()?.retryAll();
/** Remove finished entries from the progress list (stored photographs are not affected). */
export async function clearFinishedUploads() {
  for (const i of await idbStore.list()) if (i.state === "done") await idbStore.remove(i.id);
  useUploads.setState({ items: await idbStore.list() });
}

/** A short-lived private link to a stored photograph. */
export async function signedPhotoUrl(path: string, seconds = 3600): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
