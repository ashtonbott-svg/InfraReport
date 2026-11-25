import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { errorResponse } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;
const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const BUCKET = "inspection-photos";

/**
 * Confirm a photograph is safely stored: re-read the stored object and compare its SHA-256 and size
 * with what the uploading device computed from the original file. Only then is the photograph
 * marked verified. The caller must be allowed to see the photograph (checked as that user).
 */
export async function POST(req: Request) {
  try {
    const env = serverEnv();
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (!id) return NextResponse.json({ error: "Missing photograph id." }, { status: 400 });
    const asUser = createClient(env.url, env.publishable, { ...noPersist, global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: row, error } = await asUser.from("photo_files").select("id, storage_path, sha256, size_bytes, verified_at").eq("id", id).maybeSingle();
    if (error || !row) return NextResponse.json({ error: "Photograph not found or not allowed." }, { status: 404 });
    if (row.verified_at) return NextResponse.json({ verified: true, verifiedAt: row.verified_at });
    const admin = createClient(env.url, env.secret, noPersist);
    const file = await admin.storage.from(BUCKET).download(row.storage_path);
    let verifyError: string | null = null;
    if (file.error || !file.data) verifyError = "The file is not in storage yet.";
    else {
      const buf = Buffer.from(await file.data.arrayBuffer());
      const sha = createHash("sha256").update(buf).digest("hex");
      if (buf.length !== Number(row.size_bytes)) verifyError = `Stored size ${buf.length} bytes differs from the original ${row.size_bytes} bytes.`;
      else if (sha !== row.sha256) verifyError = "Stored file content differs from the original.";
    }
    const now = new Date().toISOString();
    await admin.from("photo_files").update(verifyError ? { verify_error: verifyError } : { verified_at: now, verify_error: null }).eq("id", id);
    return NextResponse.json(verifyError ? { verified: false, error: verifyError } : { verified: true, verifiedAt: now }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
