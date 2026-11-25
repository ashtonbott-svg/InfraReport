"use client";

/**
 * Stored photographs of an inspection (photo_files) and their matches to thermal image entries.
 * Automatic matches are computed from the recorded image numbers every time (so they follow
 * corrections to the entries); only a reviewer's decisions are saved: a manual match, or
 * "not used for this inspection".
 */
import { Zip, ZipPassThrough } from "fflate";
import { supabase } from "@/lib/cloud/client";
import { locationLabel, type ExportDataset } from "@/lib/domain/csv";
import type { Equipment, Location } from "@/lib/domain/types";
import { matchPhotos, parsePhotoName, type MatchEntry, type MatchPhoto, type MatchReport, type PhotoRole } from "./match";
import { signedPhotoUrl } from "./cloud-upload";

export interface PhotoFile {
  id: string; inspection_id: string; organization_id: string; kind: "exterior" | "ir" | "visual" | "equipment" | "before-opening" | "other";
  building: string; result_id: string | null; image_id: string | null; match_source: "auto" | "manual" | null; image_number: string;
  original_name: string; mime_type: string; size_bytes: number; sha256: string; storage_path: string; metadata: Record<string, unknown>;
  captured_at: string | null; uploaded_at: string | null; verified_at: string | null; verify_error: string | null; created_by: string | null; created_at: string;
}

export async function listPhotoFiles(inspectionId: string): Promise<PhotoFile[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb.from("photo_files").select("*").eq("inspection_id", inspectionId).is("deleted_at", null).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as PhotoFile[];
}

/** Reviewer: this file is the given role of that entry (null = back to automatic matching). */
export async function setManualMatch(id: string, m: { resultId: string; imageId: string; role: PhotoRole } | null) {
  const sb = supabase()!;
  const patch = m ? { result_id: m.resultId, image_id: m.imageId, kind: m.role, match_source: "manual" } : { result_id: null, image_id: null, match_source: null };
  const { error } = await sb.from("photo_files").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setExcluded(f: PhotoFile, excluded: boolean) {
  const sb = supabase()!;
  const { error } = await sb.from("photo_files").update({ metadata: { ...f.metadata, excluded } }).eq("id", f.id);
  if (error) throw new Error(error.message);
}

const lookup = <T,>(src: Map<string, T> | Record<string, T>, id: string) => (src instanceof Map ? src.get(id) : src[id]);

/** Thermal image entries of an inspection, labelled for people. */
export function matchEntries(ds: ExportDataset): (MatchEntry & { room: string; equipment: string; component: string })[] {
  return ds.results.flatMap((r) => r.images.map((img) => {
    const eq = lookup(ds.equipment, r.equipmentId) as Equipment | undefined;
    const room = locationLabel(lookup(ds.locations, r.locationId) as Location | undefined);
    return {
      resultId: r.id, imageId: img.id, irNumber: img.irImageNumber, visualNumber: img.visualImageNumber || img.irImageNumber,
      label: `${eq?.name ?? "Equipment"}${img.component ? `, ${img.component}` : ""} (${room || "no room"})`, room, equipment: eq?.name ?? "", component: img.component,
    };
  }));
}

export function toMatchPhoto(f: PhotoFile): MatchPhoto {
  const parsed = parsePhotoName(f.original_name, { radiometric: (f.metadata as { radiometric?: boolean }).radiometric, format: "jpeg" });
  const role: PhotoRole | null = f.kind === "ir" || f.kind === "visual" ? f.kind : parsed.role;
  return {
    id: f.id, name: f.original_name, sha256: f.sha256, role, number: parsed.number,
    manual: f.match_source === "manual" && f.result_id && f.image_id ? { resultId: f.result_id, imageId: f.image_id, role: (f.kind === "visual" ? "visual" : "ir") } : null,
    excluded: (f.metadata as { excluded?: boolean })?.excluded === true,
  };
}

/** Infrared and visual photographs only (exterior and equipment photos are matched by how they were taken). */
export function matchInspectionPhotos(ds: ExportDataset, files: PhotoFile[]): MatchReport {
  return matchPhotos(matchEntries(ds), files.filter((f) => f.kind === "ir" || f.kind === "visual" || f.kind === "other").map(toMatchPhoto));
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "_";

/**
 * Download All Photographs: original files (verified only) in one ZIP, organised by building exterior,
 * room / equipment for matched infrared and visual images, equipment photos, and unmatched files,
 * with manifest.csv and manifest.json describing every file and its inspection association.
 */
export async function buildPhotoZip(ds: ExportDataset, files: PhotoFile[], names: { customer: string; facility: string }, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; fileName: string; included: number; skipped: number }> {
  const report = matchInspectionPhotos(ds, files);
  const byPhoto = new Map(report.assignments.map((a) => [a.photoId, a]));
  const entries = new Map(matchEntries(ds).map((e) => [e.imageId, e]));
  const rootName = safe(`${names.customer}_${names.facility}_${ds.inspection.date}`).replace(/ /g, "_");
  const used = new Set<string>();
  const unique = (p: string) => { let q = p, n = 2; while (used.has(q)) q = p.replace(/(\.[^.]*)?$/, ` (${n++})$1`); used.add(q); return q; };
  const manifest: Record<string, string | number | null>[] = [];
  const chunks: Uint8Array[] = [];
  let resolveDone!: () => void, rejectDone!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => { resolveDone = res; rejectDone = rej; });
  const zip = new Zip((err, chunk, final) => { if (err) rejectDone(err); else { chunks.push(chunk); if (final) resolveDone(); } });
  const add = (path: string, data: Uint8Array) => { const f = new ZipPassThrough(path); zip.add(f); f.push(data, true); };
  let included = 0, skipped = 0, i = 0;
  for (const f of files) {
    i++; onProgress?.(i, files.length);
    const a = byPhoto.get(f.id);
    const e = a ? entries.get(a.imageId) : undefined;
    const folder = f.kind === "exterior" ? `01 Building Exterior/${safe(f.building || "Main building")}`
      : e ? `02 Infrared and Visual/${safe(e.room || "No room")}/${safe(e.equipment)}`
      : f.kind === "equipment" || f.kind === "before-opening" ? `03 Equipment Photos`
      : `04 Not Matched`;
    const prefix = e ? `${safe(e.component || "Image")} - ${a!.role === "ir" ? "IR" : "Visual"} - ` : "";
    const path = unique(`${rootName}/${folder}/${prefix}${safe(f.original_name)}`);
    const row = {
      zip_path: f.verified_at ? path : null, original_name: f.original_name, kind: f.kind, role: a?.role ?? null, building: f.building || null,
      room: e?.room ?? null, equipment: e?.equipment ?? null, component: e?.component ?? null, ir_image_number: e?.irNumber ?? null, visual_image_number: e?.visualNumber ?? null,
      match: a ? a.source : null, size_bytes: f.size_bytes, sha256: f.sha256, uploaded_at: f.uploaded_at, verified_at: f.verified_at,
      included: f.verified_at ? "yes" : "no (not verified as stored)", photo_id: f.id, inspection_id: f.inspection_id,
    };
    if (!f.verified_at) { skipped++; manifest.push(row); continue; }
    const url = await signedPhotoUrl(f.storage_path, 600);
    const res = url ? await fetch(url) : null;
    if (!res?.ok) { skipped++; manifest.push({ ...row, zip_path: null, included: "no (download failed)" }); continue; }
    add(path, new Uint8Array(await res.arrayBuffer()));
    included++;
    manifest.push(row);
  }
  const cols = Object.keys(manifest[0] ?? { zip_path: "" });
  const csv = [cols.join(","), ...manifest.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\r\n");
  const enc = new TextEncoder();
  add(`${rootName}/manifest.csv`, enc.encode(csv));
  add(`${rootName}/manifest.json`, enc.encode(JSON.stringify({ inspection: { id: ds.inspection.id, date: ds.inspection.date, customer: names.customer, facility: names.facility }, generatedAt: new Date().toISOString(), included, skipped, files: manifest }, null, 2)));
  zip.end();
  await done;
  return { blob: new Blob(chunks as BlobPart[], { type: "application/zip" }), fileName: `${rootName}_Photographs.zip`, included, skipped };
}
