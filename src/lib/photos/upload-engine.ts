/**
 * Upload queue for original photographs. Platform-neutral: the browser supplies IndexedDB storage
 * and an XHR uploader (src/lib/photos/cloud-upload.ts); tests supply in-memory storage.
 *
 * Each queued item keeps the ORIGINAL file (never resized or re-encoded) until the server has
 * verified the stored copy (SHA-256 and size). Steps, each safe to repeat after an interruption:
 *   1. record the photograph (photo_files row; an existing row from an earlier attempt is reused)
 *   2. upload the object (an object already stored by an earlier attempt counts as uploaded)
 *   3. ask the server to verify it; only then is the local copy released.
 * Failures are retried with increasing waits; nothing is ever dropped silently.
 */
import type { PhotoMeta } from "./jpeg-meta";

export type UploadKind = "exterior" | "ir" | "visual" | "equipment" | "before-opening" | "other";
export type UploadState = "queued" | "uploading" | "verifying" | "done" | "failed";

export interface UploadItem {
  id: string;                 // photo_files id
  organizationId: string;
  inspectionId: string;
  facilityId: string;
  kind: UploadKind;
  building: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  imageNumber: string;
  meta: PhotoMeta | null;
  capturedAt: string | null;
  /** Optional match decided when the photo was taken (equipment photos from an entry). */
  resultId?: string | null;
  storagePath: string;
  state: UploadState;
  attempts: number;
  nextAttemptAt: number;
  error: string | null;
  progress: number;           // 0..1
  createdAt: number;
}

export interface QueueStore {
  list(): Promise<UploadItem[]>;
  put(item: UploadItem, file?: Blob): Promise<void>;
  file(id: string): Promise<Blob | undefined>;
  /** Drop the file (kept: the small record, for the session's progress list). */
  release(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface UploadDeps {
  store: QueueStore;
  /** Insert the photo_files row; resolve "exists" when an earlier attempt already created it. */
  insertRow(item: UploadItem): Promise<"ok" | "exists">;
  /** Upload the object; resolve "exists" when it is already stored. Report progress 0..1. */
  putObject(item: UploadItem, file: Blob, onProgress: (p: number) => void): Promise<"ok" | "exists">;
  markUploaded(item: UploadItem): Promise<void>;
  verify(item: UploadItem): Promise<{ verified: boolean; error?: string }>;
  now?: () => number;
  onChange?: (items: UploadItem[]) => void;
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const BACKOFF = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000];

export function storagePathFor(orgId: string, inspectionId: string, id: string, name: string) {
  const safe = name.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim() || "photo.jpg";
  return `${orgId}/${inspectionId}/${id}/${safe}`;
}

export class UploadEngine {
  private running: Promise<void> | null = null;
  private items: UploadItem[] = [];
  constructor(private d: UploadDeps) {}

  private now() { return this.d.now ? this.d.now() : Date.now(); }
  private async publish() { this.items = await this.d.store.list(); this.d.onChange?.(this.items); }
  private async save(item: UploadItem, file?: Blob) { await this.d.store.put(item, file); await this.publish(); }

  async add(item: Omit<UploadItem, "state" | "attempts" | "nextAttemptAt" | "error" | "progress" | "createdAt">, file: Blob) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${item.name} is larger than 100 MB.`);
    await this.save({ ...item, state: "queued", attempts: 0, nextAttemptAt: 0, error: null, progress: 0, createdAt: this.now() }, file);
  }

  /** Retry everything that failed, now. */
  async retryAll() {
    for (const it of await this.d.store.list()) if (it.state === "failed" || it.state === "queued") await this.d.store.put({ ...it, state: "queued", nextAttemptAt: 0, error: null });
    await this.publish();
    return this.run();
  }

  /** Process due items one by one. Safe to call repeatedly (one run at a time). */
  run(): Promise<void> {
    if (!this.running) this.running = this.loop().finally(() => { this.running = null; });
    return this.running;
  }

  private async loop() {
    for (;;) {
      const due = (await this.d.store.list()).filter((i) => (i.state === "queued" || i.state === "uploading" || i.state === "verifying") && i.nextAttemptAt <= this.now())
        .sort((a, b) => a.createdAt - b.createdAt);
      if (!due.length) { await this.publish(); return; }
      for (const item of due) await this.process(item);
    }
  }

  private async process(item: UploadItem) {
    let cur: UploadItem = { ...item, state: "uploading", error: null };
    await this.save(cur);
    try {
      const file = await this.d.store.file(cur.id);
      if (!file && cur.progress < 1) throw Object.assign(new Error("The original file is no longer on this device."), { permanent: true });
      await this.d.insertRow(cur);
      if (file && cur.progress < 1) {
        await this.d.putObject(cur, file, (p) => { cur = { ...cur, progress: Math.min(0.99, p) }; this.d.onChange?.(this.items.map((x) => (x.id === cur.id ? cur : x))); });
        await this.d.markUploaded(cur);
        cur = { ...cur, progress: 1 };
      }
      cur = { ...cur, state: "verifying" };
      await this.save(cur);
      const v = await this.d.verify(cur);
      if (!v.verified) throw new Error(v.error ?? "The stored copy could not be verified.");
      cur = { ...cur, state: "done", error: null };
      await this.d.store.put(cur);
      await this.d.store.release(cur.id);
      await this.publish();
    } catch (e) {
      const permanent = (e as { permanent?: boolean }).permanent === true;
      const attempts = cur.attempts + 1;
      const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
      // Integrity failure: upload the original again from scratch.
      const progress = /differs|not in storage/i.test((e as Error).message) ? 0 : cur.progress;
      await this.save({ ...cur, progress, attempts, state: permanent ? "failed" : "queued", nextAttemptAt: this.now() + wait, error: (e as Error).message || "Upload failed" });
      if (!permanent && attempts >= 8) await this.save({ ...cur, progress, attempts, state: "failed", error: `${(e as Error).message || "Upload failed"} (stopped after ${attempts} attempts; tap Retry)` });
    }
  }
}

/** SHA-256 of a file, hex (Web Crypto; works in browsers and Node 20+). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
