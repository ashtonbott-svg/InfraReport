/**
 * Electrical Infrared Inspection Report: the report model.
 *
 * Built only from InfraReport records (inspection, rooms, room conditions, equipment, equipment
 * lines and their thermal image entries), never from photo file names. Read only: building a
 * report never changes any record. Every value shown comes from a field an inspector or reviewer
 * entered; nothing is estimated.
 */
import { DEFAULT_OPENED, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import { formatImageDate, locationLabel, orderResults, type ExportDataset } from "@/lib/domain/csv";
import { isNumericText, resolveEffective } from "@/lib/domain/rules";
import { imageHasNumber } from "@/lib/domain/thermal";
import type { Equipment, InspectionResult, Location, ThermalImage } from "@/lib/domain/types";
import { band, deEnergizedReason, notEvaluatedReason, recommendationFor, severityForDeltaT, SEVERITY_BANDS, type Severity } from "./severity";

export interface ReportMeta {
  clientName: string;
  facilityName: string;
  address: string;
  inspectionDates: string[];
  thermographers: string[];
  company: { name: string; phone: string; website: string };
  /** Scope exclusions and other statements the reviewer wrote for this report. */
  scopeNotes: string[];
  /** The inspection's own notes (kept verbatim). */
  inspectionNotes?: string;
  /** Areas marked on visual photographs, per thermal image entry: fractions of width/height. */
  annotations?: Record<string, { x: number; y: number; w: number; h: number }[]>;
}

export type Assessment =
  | { kind: "severity"; severity: Severity; deltaT: number | null }
  /** A cause was recorded without a Max Temp: the reviewer must set the severity. */
  | { kind: "visual-finding" }
  /** Imaged while de-energized (Off, Locked Out): documented, never rated. */
  | { kind: "not-evaluated"; reason: string };

/** One illustrated page: one thermal image entry of one equipment line. */
export interface ReportEntry {
  key: string;
  resultId: string;
  imageId: string;
  roomId: string;
  room: string;
  equipment: string;
  component: string;
  imageDate: string;
  humidity: string;
  backgroundTemp: string;
  ambientTemp: string;
  emissivity: string;
  distance: string;
  cause: string;
  irNumber: string;
  visualNumber: string;
  maxTemp: string;
  assessment: Assessment;
  recommendation: string;
  notes: string;
  opened: string;
  page: number;
  annotations: { x: number; y: number; w: number; h: number }[];
}

export type InventoryStatus =
  | { kind: "severity"; severity: Severity }
  | { kind: "visual-finding" }
  | { kind: "not-evaluated"; reason: string }
  | { kind: "not-documented" };

export interface InventoryLine {
  resultId: string;
  equipment: string;
  components: string[];
  imageNumbers: string[];
  opened: string;
  status: InventoryStatus;
  notes: string;
  /** Pages of this item's illustrated entries. */
  pages: number[];
}

export interface InventoryRoom { roomId: string; room: string; lines: InventoryLine[] }

export interface ReviewItem { level: "blocker" | "check"; message: string; resultId?: string }

export interface InspectionReportModel {
  meta: ReportMeta;
  entries: ReportEntry[];
  inventory: InventoryRoom[];
  counts: Record<Severity, number> & { visualFindings: number };
  /** Illustrated pages per severity (real PDF page numbers). */
  pagesBySeverity: Record<Severity, number[]>;
  totals: { equipment: number; evaluated: number; notEvaluated: number; notDocumented: number; images: number; rooms: number };
  /** Items the administrator must look at before approving the report. */
  review: ReviewItem[];
  /** Page layout: how many pages come before the finding pages. */
  layout: { frontPages: number; inventoryStart: number; inventoryPages: number; totalPages: number };
}

const S = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const lookup = <T,>(src: Map<string, T> | Record<string, T>, id: string): T | undefined => (src instanceof Map ? src.get(id) : src[id]);
const num = (v: string) => (isNumericText(v) ? Number(v) : null);

/** Text lines that fit on one inventory page; a room heading takes two. */
export const INVENTORY_LINES_PER_PAGE = 27;
/** Lines one inventory row needs, from the widest wrapped cell (characters per line by column width). */
const lineUnits = (l: InventoryLine) => Math.max(1,
  Math.ceil(l.equipment.length / 30), Math.ceil(l.components.join(", ").length / 28), Math.ceil(l.imageNumbers.join(", ").length / 12),
  Math.ceil(l.opened.length / 24), Math.ceil(l.notes.length / 18), l.status.kind === "not-evaluated" ? Math.ceil((l.status.reason.length + 16) / 30) : 1);

/** Rows (discrepancies and equipment not evaluated) on one summary page. */
export const SUMMARY_ROWS_PER_PAGE = 22;

export function assessImage(img: ThermalImage, ambientTemp: string, opened: string = DEFAULT_OPENED): Assessment {
  const cause = img.possibleCause || POSSIBLE_CAUSE_NONE;
  const off = deEnergizedReason(opened);
  if (off && !num(img.maxTemp) && cause === POSSIBLE_CAUSE_NONE) return { kind: "not-evaluated", reason: off };
  const max = num(img.maxTemp), amb = num(ambientTemp);
  if (max !== null && amb !== null) {
    const deltaT = Math.round((max - amb) * 10) / 10;
    return { kind: "severity", severity: severityForDeltaT(deltaT), deltaT };
  }
  if (cause !== POSSIBLE_CAUSE_NONE) return { kind: "visual-finding" };
  return { kind: "severity", severity: "normal", deltaT: null };
}

const rank = (a: Assessment) => (a.kind === "visual-finding" ? 2.5 : a.kind === "not-evaluated" ? 0 : band(a.severity).rank);

export function buildInspectionReport(ds: ExportDataset, meta: ReportMeta): InspectionReportModel {
  const review: ReviewItem[] = [];
  const results = orderResults(ds);
  const eqOf = (r: InspectionResult) => lookup(ds.equipment, r.equipmentId) as Equipment | undefined;
  const locOf = (id: string) => lookup(ds.locations, id) as Location | undefined;
  const entries: ReportEntry[] = [];
  const lines = new Map<string, InventoryLine>();

  for (const r of results) {
    const eq = eqOf(r);
    const name = S(eq?.name);
    const loc = locOf(r.locationId);
    const roomName = locationLabel(loc) || "Unspecified Location";
    if (!name) { review.push({ level: "blocker", message: `An equipment line in ${roomName} has no equipment name. It is left out of the report until it is named or removed.`, resultId: r.id }); continue; }
    const room = ds.rooms.find((x) => x.inspectionId === r.inspectionId && x.locationId === r.locationId);
    const notes = [r.reviewNotes, r.exception?.note, ...(r.photoNotes ?? []).map((p) => p.note)].map(S).filter(Boolean).join("; ");
    const opened = S(r.opened) || DEFAULT_OPENED;
    const scanned = r.images.filter(imageHasNumber);
    const line: InventoryLine = {
      resultId: r.id, equipment: name, components: [...new Set(r.images.map((i) => S(i.component)).filter(Boolean))],
      imageNumbers: scanned.map((i) => S(i.irImageNumber) || S(i.visualImageNumber)), opened, status: { kind: "not-documented" }, notes, pages: [],
    };
    for (const img of scanned) {
      const eff = resolveEffective(r, room, ds.inspection, img);
      const assessment = assessImage(img, eff.ambientTemp, opened);
      const cause = S(img.possibleCause) || POSSIBLE_CAUSE_NONE;
      const recommendation = assessment.kind === "not-evaluated" ? `No thermal assessment: the equipment was de-energized (${assessment.reason.toLowerCase()}) at the time of the scan.` : recommendationFor(cause);
      const label = `${name}${img.component ? `, ${img.component}` : ""}`;
      if (recommendation === null) review.push({ level: "check", message: `${label}: no recommendation is defined for the cause "${cause}". Add one before the report is approved.`, resultId: r.id });
      if (assessment.kind === "visual-finding") review.push({ level: "blocker", message: `${label}: "${cause}" was recorded without a Max Temp. Set the severity for this visual finding.`, resultId: r.id });
      if (assessment.kind === "severity" && assessment.severity !== "normal" && cause === POSSIBLE_CAUSE_NONE) review.push({ level: "blocker", message: `${label}: Delta T ${assessment.deltaT} °F is ${band(assessment.severity).label} but no Possible Cause was chosen.`, resultId: r.id });
      if (!eff.humidity || !eff.ambientTemp || !eff.backgroundTemp) review.push({ level: "check", message: `${label}: room conditions incomplete (${[!eff.humidity && "humidity", !eff.ambientTemp && "ambient", !eff.backgroundTemp && "background"].filter(Boolean).join(", ")}).`, resultId: r.id });
      entries.push({
        key: `${r.id}:${img.id}`, resultId: r.id, imageId: img.id, roomId: r.locationId, room: roomName, equipment: name, component: S(img.component),
        imageDate: formatImageDate(eff.imageDate), humidity: eff.humidity, backgroundTemp: eff.backgroundTemp, ambientTemp: eff.ambientTemp,
        emissivity: eff.emissivity, distance: eff.distance, cause, irNumber: S(img.irImageNumber), visualNumber: S(img.visualImageNumber) || S(img.irImageNumber),
        maxTemp: S(img.maxTemp), assessment, recommendation: recommendation ?? "", notes: [S(img.notes), notes].filter(Boolean).join("; "), opened, page: 0,
        annotations: meta.annotations?.[img.id] ?? [],
      });
    }
    const mine = entries.filter((e) => e.resultId === r.id);
    if (mine.length) {
      const worst = mine.reduce((a, b) => (rank(b.assessment) > rank(a.assessment) ? b : a));
      const w = worst.assessment;
      line.status = w.kind === "visual-finding" ? { kind: "visual-finding" } : w.kind === "not-evaluated" ? { kind: "not-evaluated", reason: w.reason } : { kind: "severity", severity: w.severity };
    } else {
      const reason = notEvaluatedReason(opened) ?? (r.exception?.kind === "not-scanned" ? "Not Scanned" : r.exception?.kind === "deferred" ? "Deferred" : null);
      if (reason) line.status = { kind: "not-evaluated", reason };
      else review.push({ level: "blocker", message: `${name} (${roomName}) has no image number and no reason it was not scanned. Record the image or why it was not evaluated.`, resultId: r.id });
      if (r.exception?.kind === "deferred") review.push({ level: "check", message: `${name} (${roomName}) was deferred and never scanned.`, resultId: r.id });
    }
    lines.set(r.id, line);
  }

  // Worst first (severity, then Delta T), then everything else in room and entry order (Generator order).
  const findings = entries.filter((e) => rank(e.assessment) >= 2)
    .sort((a, b) => rank(b.assessment) - rank(a.assessment) || dt(b) - dt(a));
  // Equipment not evaluated (de-energized when imaged) gets no finding page: it is listed once, with
  // its reason, in the summary and the inventory; its photograph stays in the archive.
  const ordered = [...findings, ...entries.filter((e) => rank(e.assessment) < 2 && e.assessment.kind !== "not-evaluated")];

  const inventory: InventoryRoom[] = [];
  for (const r of results) {
    const line = lines.get(r.id);
    if (!line) continue;
    const room = locationLabel(locOf(r.locationId)) || "Unspecified Location";
    let group = inventory.find((g) => g.roomId === r.locationId);
    if (!group) inventory.push((group = { roomId: r.locationId, room, lines: [] }));
    group.lines.push(line);
  }

  // Layout: cover, how to read + summary, findings overview, entries, inventory.
  const notEvaluatedCount = [...lines.values()].filter((l) => l.status.kind === "not-evaluated" || l.status.kind === "not-documented").length;
  const summaryRows = findings.length + notEvaluatedCount;
  const frontPages = 2 + Math.max(1, Math.ceil(summaryRows / SUMMARY_ROWS_PER_PAGE));
  ordered.forEach((e, i) => { e.page = frontPages + i + 1; lines.get(e.resultId)?.pages.push(e.page); });
  const inventoryPages = paginateInventory(inventory, meta.scopeNotes.length > 0).length;
  const inventoryStart = frontPages + ordered.length + 1;

  const counts = { normal: 0, potential: 0, serious: 0, critical: 0, visualFindings: 0 };
  const pagesBySeverity: Record<Severity, number[]> = { normal: [], potential: [], serious: [], critical: [] };
  for (const e of ordered) {
    if (e.assessment.kind === "visual-finding") { counts.visualFindings++; continue; }
    if (e.assessment.kind === "not-evaluated") continue;
    counts[e.assessment.severity]++;
    pagesBySeverity[e.assessment.severity].push(e.page);
  }
  const all = [...lines.values()];
  return {
    meta, entries: ordered, inventory, counts, pagesBySeverity,
    totals: {
      equipment: all.length, evaluated: all.filter((l) => l.status.kind === "severity" || l.status.kind === "visual-finding").length,
      notEvaluated: all.filter((l) => l.status.kind === "not-evaluated").length, notDocumented: all.filter((l) => l.status.kind === "not-documented").length,
      images: ordered.length, rooms: inventory.length,
    },
    review,
    layout: { frontPages, inventoryStart, inventoryPages, totalPages: inventoryStart + inventoryPages - 1 },
  };
}

const dt = (e: ReportEntry) => (e.assessment.kind === "severity" ? e.assessment.deltaT ?? -Infinity : -Infinity);

/** Split the inventory into pages; a room continues on the next page with its heading repeated. */
export function paginateInventory(rooms: InventoryRoom[], withScope: boolean): { room: string; lines: InventoryLine[]; continued: boolean }[][] {
  const pages: { room: string; lines: InventoryLine[]; continued: boolean }[][] = [];
  let page: { room: string; lines: InventoryLine[]; continued: boolean }[] = [];
  let used = 0;
  const flush = () => { if (page.length) pages.push(page); page = []; used = 0; };
  for (const g of rooms) {
    let block: { room: string; lines: InventoryLine[]; continued: boolean } | null = null;
    for (const l of g.lines) {
      const u = lineUnits(l);
      const header = block ? 0 : 2;
      if (used + header + u > INVENTORY_LINES_PER_PAGE) { flush(); block = null; }
      if (!block) { block = { room: g.room, lines: [], continued: pages.some((p) => p.some((b) => b.room === g.room)) }; page.push(block); used += 2; }
      block.lines.push(l); used += u;
    }
  }
  if (withScope && used + 4 > INVENTORY_LINES_PER_PAGE) flush();
  flush();
  return pages.length ? pages : [[]];
}

/** "4 to 9" style page list, compacting runs: 4 to 9, 12, 15 to 16. */
export function pageList(pages: number[]): string {
  if (!pages.length) return "None";
  const out: string[] = [];
  let start = pages[0], prev = pages[0];
  for (const p of [...pages.slice(1), NaN]) {
    if (p === prev + 1) { prev = p; continue; }
    out.push(start === prev ? `${start}` : `${start} to ${prev}`);
    start = prev = p;
  }
  return out.join(", ");
}

export const severityOrder = SEVERITY_BANDS.map((b) => b.key);
