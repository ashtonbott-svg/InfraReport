"use client";

/**
 * Session-only file cache. Uploaded binaries are kept in memory for preview
 * during this browser session and are never written to localStorage or sent
 * to a server. Production storage will use private, access-controlled object
 * storage (e.g. Supabase Storage or Vercel Blob with signed URLs).
 */
const files = new Map<string, { file: File; url: string }>();

export function putSessionFile(id: string, file: File) {
  const url = URL.createObjectURL(file);
  files.set(id, { file, url });
  return url;
}
export function getSessionFile(id: string) {
  return files.get(id);
}
export function dropSessionFile(id: string) {
  const f = files.get(id);
  if (f) URL.revokeObjectURL(f.url);
  files.delete(id);
}
