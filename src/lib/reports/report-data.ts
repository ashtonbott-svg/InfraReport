"use client";

/**
 * Report workspace data: per-inspection report settings, draft and approved report versions, and
 * the photographs a report uses (private cloud storage, short-lived links). Administrators only
 * (enforced by the database).
 */
import { supabase } from "@/lib/cloud/client";
import type { ExportDataset } from "@/lib/domain/csv";
import { signedPhotoUrl } from "@/lib/photos/cloud-upload";
import { listPhotoFiles, matchInspectionPhotos, type PhotoFile } from "@/lib/photos/photo-files";
import { buildInspectionReport, type InspectionReportModel, type ReportEntry, type ReportMeta } from "./inspection-report";
import { renderEquipmentListHtml, renderInspectionReportHtml, type ReportAssets } from "./render-inspection-report";

export interface ReportSettings {
  scopeNotes?: string[];
  annotations?: Record<string, { x: number; y: number; w: number; h: number }[]>;
  /** Exterior photo_files ids for the cover (default: all verified exterior photographs). */
  coverPhotoIds?: string[];
}

export interface ReportVersion {
  id: string; inspection_id: string; number: number; status: "draft" | "approved" | "superseded";
  model: InspectionReportModel; photo_ids: string[]; review: InspectionReportModel["review"];
  created_at: string; created_by: string | null; approved_at: string | null; approved_by: string | null;
}

const sb = () => { const c = supabase(); if (!c) throw new Error("Reports need the cloud connection."); return c; };

export async function loadSettings(inspectionId: string): Promise<ReportSettings> {
  const { data } = await sb().from("inspection_reports").select("settings").eq("inspection_id", inspectionId).maybeSingle();
  return (data?.settings as ReportSettings) ?? {};
}
export async function saveSettings(inspectionId: string, organizationId: string, settings: ReportSettings) {
  const { error } = await sb().from("inspection_reports").upsert({ inspection_id: inspectionId, organization_id: organizationId, settings });
  if (error) throw new Error(error.message);
}
export async function listVersions(inspectionId: string): Promise<ReportVersion[]> {
  const { data, error } = await sb().from("report_versions").select("*").eq("inspection_id", inspectionId).order("number", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportVersion[];
}

/** Which stored photographs the report shows for each thermal image entry, and on the cover. */
export function reportPhotoMap(ds: ExportDataset, files: PhotoFile[], settings: ReportSettings) {
  const usable = files.filter((f) => f.verified_at);
  const m = matchInspectionPhotos(ds, usable);
  const byImage: Record<string, { ir?: string; visual?: string }> = {};
  for (const a of m.assignments) (byImage[a.imageId] ??= {})[a.role] = a.photoId;
  const exterior = usable.filter((f) => f.kind === "exterior");
  const cover = settings.coverPhotoIds?.length ? exterior.filter((f) => settings.coverPhotoIds!.includes(f.id)) : exterior;
  return { byImage, cover: cover.map((f) => ({ id: f.id, building: f.building })), match: m };
}

export async function createDraft(ds: ExportDataset, meta: ReportMeta, settings: ReportSettings): Promise<ReportVersion> {
  const files = await listPhotoFiles(ds.inspection.id);
  const model = buildInspectionReport(ds, { ...meta, scopeNotes: settings.scopeNotes ?? meta.scopeNotes, annotations: settings.annotations ?? {} });
  const photos = reportPhotoMap(ds, files, settings);
  (model as InspectionReportModel & { photos?: unknown }).photos = { byImage: photos.byImage, cover: photos.cover };
  const used = [...new Set([...Object.values(photos.byImage).flatMap((p) => [p.ir, p.visual]).filter(Boolean) as string[], ...photos.cover.map((c) => c.id)])];
  const missing = model.entries.filter((e) => !photos.byImage[e.imageId]?.ir || !photos.byImage[e.imageId]?.visual).length;
  const review = [...model.review, ...(missing ? [{ level: "check" as const, message: `${missing} report page${missing === 1 ? " is" : "s are"} missing a verified thermal or visual photograph (Photographs tab).` }] : []),
    ...(photos.cover.length ? [] : [{ level: "check" as const, message: "No verified building photograph for the cover." }])];
  const versions = await listVersions(ds.inspection.id);
  const { data, error } = await sb().from("report_versions").insert({
    organization_id: ds.inspection.organizationId, inspection_id: ds.inspection.id, number: (versions[0]?.number ?? 0) + 1,
    status: "draft", model, photo_ids: used, review,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as ReportVersion;
}

export async function approveVersion(v: ReportVersion) {
  if (v.review.some((r) => r.level === "blocker")) throw new Error("Resolve the items marked Must fix before approving.");
  const c = sb();
  const { error: e1 } = await c.from("report_versions").update({ status: "superseded" }).eq("inspection_id", v.inspection_id).eq("status", "approved");
  if (e1) throw new Error(e1.message);
  const { error } = await c.from("report_versions").update({ status: "approved" }).eq("id", v.id);
  if (error) throw new Error(error.message);
}

/** Render a stored version with fresh private links to its photographs. */
export async function renderVersion(v: ReportVersion, kind: "report" | "equipment-list" = "report"): Promise<string> {
  const files = await listPhotoFiles(v.inspection_id);
  const byId = new Map(files.map((f) => [f.id, f]));
  const urls: Record<string, string> = {};
  await Promise.all(v.photo_ids.map(async (id) => { const f = byId.get(id); const u = f ? await signedPhotoUrl(f.storage_path, 3 * 3600) : null; if (u) urls[id] = u; }));
  const pm = (v.model as InspectionReportModel & { photos?: { byImage: Record<string, { ir?: string; visual?: string }>; cover: { id: string; building: string }[] } }).photos ?? { byImage: {}, cover: [] };
  const assets: ReportAssets = {
    logo: `${location.origin}/report/infinite-infrared-logo.png`,
    fronts: pm.cover.filter((c) => urls[c.id]).map((c) => ({ building: c.building, src: urls[c.id] })),
    photos: (e: ReportEntry) => ({ ir: pm.byImage[e.imageId]?.ir ? urls[pm.byImage[e.imageId].ir!] : undefined, visual: pm.byImage[e.imageId]?.visual ? urls[pm.byImage[e.imageId].visual!] : undefined }),
    draft: v.status !== "approved",
  };
  return kind === "report" ? renderInspectionReportHtml(v.model, assets) : renderEquipmentListHtml(v.model, assets);
}

/** Print a rendered report to PDF (the browser's Save as PDF), after every image has loaded. */
export function printHtml(win: Window, html: string, title: string) {
  win.document.open();
  win.document.write(html.replace("</head>", `<script>document.title=${JSON.stringify(title)};window.addEventListener("load",()=>{Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>document.fonts.ready).then(()=>setTimeout(()=>window.print(),300));});</script></head>`));
  win.document.close();
}
