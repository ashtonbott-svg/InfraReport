/**
 * Match uploaded photographs to thermal image entries by the IR and visual image numbers the
 * technician recorded. File names are read with several known conventions; when a file's role
 * (infrared or visual) or number cannot be determined it is left for the reviewer, never guessed.
 *
 * Conventions recognised (case-insensitive, any extension):
 *   HIKMICRO (owner's Generator):  HM_00051_DAR = visual 51,  HM_00051_IR or HM_00051 = infrared 51
 *   IR_0051, IR0051, FLIR0051, TH_0051 = infrared;  VIS_0051, VI_0051, DC_0051, DAR_0051 = visual
 *   Anything else: the last group of digits is the number; the role comes from the file's metadata
 *   (a radiometric thermal file is infrared) or is left unknown.
 */
import type { PhotoMeta } from "./jpeg-meta";

export type PhotoRole = "ir" | "visual";

export interface ParsedPhotoName {
  number: string | null;
  role: PhotoRole | null;
  convention: "hikmicro" | "prefix" | "digits" | "none";
}

/** "00051" and "51" are the same image number. */
export const normNumber = (n: string | null | undefined) => {
  const s = (n ?? "").trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? String(Number(s)) : s.toUpperCase();
};

export function parsePhotoName(fileName: string, meta?: Pick<PhotoMeta, "radiometric" | "format"> | null): ParsedPhotoName {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
  let m = base.match(/^HM[_-]?(\d+)(?:[_-](DAR|IR|VIS|V))?$/i);
  if (m) return { number: normNumber(m[1]), role: m[2] && /^(DAR|VIS|V)$/i.test(m[2]) ? "visual" : "ir", convention: "hikmicro" };
  m = base.match(/^(FLIR|IR|TH|THERMAL)[_-]?(\d+)/i);
  if (m) return { number: normNumber(m[2]), role: "ir", convention: "prefix" };
  m = base.match(/^(VIS|VI|DC|DAR|VISUAL)[_-]?(\d+)/i);
  if (m) return { number: normNumber(m[2]), role: "visual", convention: "prefix" };
  m = base.match(/(\d+)(?!.*\d)/);
  if (m) {
    const role: PhotoRole | null = /(^|[_-])(DAR|VIS|VISUAL)([_-]|$)/i.test(base) ? "visual" : /(^|[_-])(IR|THERMAL)([_-]|$)/i.test(base) ? "ir" : meta?.radiometric ? "ir" : null;
    return { number: normNumber(m[1]), role, convention: "digits" };
  }
  return { number: null, role: null, convention: "none" };
}

export interface MatchEntry {
  resultId: string;
  imageId: string;
  label: string;
  irNumber: string;
  visualNumber: string;
}

export interface MatchPhoto {
  id: string;
  name: string;
  sha256: string;
  role: PhotoRole | null;
  number: string | null;
  /** A reviewer's decision is kept as is. */
  manual?: { resultId: string; imageId: string; role: PhotoRole } | null;
  /** The reviewer decided this file belongs to no entry. */
  excluded?: boolean;
}

export interface MatchAssignment { photoId: string; resultId: string; imageId: string; role: PhotoRole; source: "auto" | "manual" }

export interface MatchReport {
  assignments: MatchAssignment[];
  /** Files with no usable number or role, or a number no entry recorded. */
  unmatched: { photoId: string; reason: string }[];
  /** Same file content uploaded more than once (only the first is used). */
  duplicates: { photoId: string; sameAs: string }[];
  /** Different files claiming the same role and number: the reviewer chooses. */
  conflicts: { role: PhotoRole; number: string; photoIds: string[] }[];
  /** An image number recorded on more than one entry: the reviewer chooses. */
  ambiguous: { role: PhotoRole; number: string; imageIds: string[]; photoIds: string[] }[];
  /** Entries with a recorded number but no photograph for that role. */
  missing: { resultId: string; imageId: string; role: PhotoRole; number: string; label: string }[];
}

export function matchPhotos(entries: MatchEntry[], photos: MatchPhoto[]): MatchReport {
  const out: MatchReport = { assignments: [], unmatched: [], duplicates: [], conflicts: [], ambiguous: [], missing: [] };
  const firstBySha = new Map<string, string>();
  const live: MatchPhoto[] = [];
  for (const p of photos) {
    if (p.excluded) continue;
    const prior = firstBySha.get(p.sha256);
    if (prior && !p.manual) { out.duplicates.push({ photoId: p.id, sameAs: prior }); continue; }
    if (!prior) firstBySha.set(p.sha256, p.id);
    live.push(p);
  }
  const taken = new Set<string>(); // imageId:role
  for (const p of live) {
    if (!p.manual) continue;
    out.assignments.push({ photoId: p.id, ...p.manual, source: "manual" });
    taken.add(`${p.manual.imageId}:${p.manual.role}`);
  }
  const index = (role: PhotoRole) => {
    const m = new Map<string, MatchEntry[]>();
    for (const e of entries) {
      const n = normNumber(role === "ir" ? e.irNumber : e.visualNumber || e.irNumber);
      if (!n) continue;
      m.set(n, [...(m.get(n) ?? []), e]);
    }
    return m;
  };
  const byRole = { ir: index("ir"), visual: index("visual") };
  const groups = new Map<string, MatchPhoto[]>();
  for (const p of live) {
    if (p.manual) continue;
    if (!p.number) { out.unmatched.push({ photoId: p.id, reason: "No image number in the file name" }); continue; }
    if (!p.role) { out.unmatched.push({ photoId: p.id, reason: "Cannot tell if this is the infrared or the visual image" }); continue; }
    const k = `${p.role}:${p.number}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [k, list] of groups) {
    const [role, number] = k.split(":") as [PhotoRole, string];
    const targets = (byRole[role].get(number) ?? []).filter((e) => !taken.has(`${e.imageId}:${role}`));
    if (list.length > 1) { out.conflicts.push({ role, number, photoIds: list.map((p) => p.id) }); continue; }
    if (!(byRole[role].get(number) ?? []).length) { out.unmatched.push({ photoId: list[0].id, reason: `No entry recorded ${role === "ir" ? "IR" : "visual"} image number ${number}` }); continue; }
    if (targets.length > 1) { out.ambiguous.push({ role, number, imageIds: targets.map((e) => e.imageId), photoIds: [list[0].id] }); continue; }
    if (!targets.length) { out.unmatched.push({ photoId: list[0].id, reason: "That entry already has a photograph chosen by the reviewer" }); continue; }
    out.assignments.push({ photoId: list[0].id, resultId: targets[0].resultId, imageId: targets[0].imageId, role, source: "auto" });
    taken.add(`${targets[0].imageId}:${role}`);
  }
  for (const e of entries) {
    for (const role of ["ir", "visual"] as const) {
      const n = normNumber(role === "ir" ? e.irNumber : e.visualNumber || e.irNumber);
      if (n && !taken.has(`${e.imageId}:${role}`)) out.missing.push({ resultId: e.resultId, imageId: e.imageId, role, number: n, label: e.label });
    }
  }
  return out;
}
