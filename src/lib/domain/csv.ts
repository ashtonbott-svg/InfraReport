import type {
  Equipment,
  Inspection,
  InspectionResult,
  InspectionRoomConditions,
  Location,
  ThermalImage,
} from "./types";
import { resolveEffective } from "./rules";
import { newThermalImage } from "./thermal";
import { POSSIBLE_CAUSE_NONE } from "./constants";

/**
 * Infinite Infrared Generator layout: 15 columns, in order. `excelColumn`
 * documents where the existing Excel Generator writes each field. Columns O,
 * P and Q are Generator formula columns and are never written by InfraReport.
 * (Confidence was removed from exports; it is still kept in the data.)
 */
export const GENERATOR_COLUMNS = [
  { header: "Image Date", excelColumn: "B" },
  { header: "Location", excelColumn: "C" },
  { header: "Humidity", excelColumn: "D" },
  { header: "Background Temp", excelColumn: "E" },
  { header: "Equipment", excelColumn: "F" },
  { header: "Component", excelColumn: "G" },
  { header: "Distance", excelColumn: "H" },
  { header: "Possible Cause", excelColumn: "I" },
  { header: "IR Image Number", excelColumn: "J" },
  { header: "Visual Image Number", excelColumn: "K" },
  { header: "Emissivity", excelColumn: "L" },
  { header: "Max Temp", excelColumn: "M" },
  { header: "Ambient Temp", excelColumn: "N" },
  { header: "Opened", excelColumn: "R" },
  { header: "Review Notes", excelColumn: null },
] as const;

export const GENERATOR_HEADERS: string[] = GENERATOR_COLUMNS.map((c) => c.header);
export const GENERATOR_PROTECTED_COLUMNS = ["O", "P", "Q"] as const;
export const GENERATOR_COLUMN_COUNT = 15;

export type GeneratorRow = [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string,
];

/**
 * IRT (Infrared Team) layout: the same data without Max Temp and without Visual
 * Image Number. 13 columns. (Visual numbers are still recorded and still in the
 * Infinite Infrared export.)
 */
const IRT_EXCLUDED = new Set(["Max Temp", "Visual Image Number"]);
export const IRT_HEADERS: string[] = GENERATOR_HEADERS.filter((h) => !IRT_EXCLUDED.has(h));
export const IRT_COLUMN_COUNT = 13;
const IRT_KEEP = GENERATOR_HEADERS.map((h) => !IRT_EXCLUDED.has(h));
export const toIrtRow = (row: GeneratorRow): string[] => row.filter((_, i) => IRT_KEEP[i]);

/**
 * Combine notes for one export row. Order: the thermal image's own note, then
 * equipment-level notes (review notes, the not scanned / deferred explanation,
 * photo notes). Identical text (ignoring case and spacing) appears once; nothing
 * is shortened, replaced or invented.
 */
export function combineNotes(...parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    const key = v.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.join("; ");
}

/** Equipment-level notes that apply to every row of the item. */
export function equipmentNotes(r: InspectionResult): string[] {
  return [r.reviewNotes, r.exception?.note, ...(r.photoNotes ?? []).map((p) => p.note)].filter((x): x is string => !!x && !!x.trim());
}

/** The Review Notes value for one thermal image row. */
export function rowNotes(r: InspectionResult, image: ThermalImage | undefined): string {
  return combineNotes(image?.notes, ...equipmentNotes(r));
}

/** YYYY-MM-DD -> MM/DD/YYYY. Anything else is passed through untouched. */
export function formatImageDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export function locationLabel(loc: Pick<Location, "building" | "name"> | undefined): string {
  if (!loc) return "";
  return loc.building.trim() ? `${loc.building.trim()} - ${loc.name.trim()}` : loc.name.trim();
}

export interface ExportDataset {
  inspection: Inspection;
  results: InspectionResult[];
  equipment: Map<string, Equipment> | Record<string, Equipment>;
  locations: Map<string, Location> | Record<string, Location>;
  rooms: InspectionRoomConditions[];
}

function lookup<T>(src: Map<string, T> | Record<string, T>, id: string): T | undefined {
  return src instanceof Map ? src.get(id) : src[id];
}

const LOCKED = ["Approved", "Report Generated", "Delivered"];

/**
 * Approved inspections report the equipment names, room names and room order
 * they were approved with, even if the facility inventory was renamed or
 * reordered later. Records missing from the snapshot keep their current values
 * (nothing is invented). Inspections that are not approved use current data.
 */
export function withApprovalSnapshot(ds: ExportDataset): ExportDataset {
  const snap = ds.inspection.approvalSnapshot;
  if (!snap || !LOCKED.includes(ds.inspection.status)) return ds;
  const all = <T,>(src: Map<string, T> | Record<string, T>) => new Map<string, T>(src instanceof Map ? src : Object.entries(src));
  const equipment = all(ds.equipment);
  const locations = all(ds.locations);
  for (const [id, v] of Object.entries(snap.equipment ?? {})) {
    const e = equipment.get(id);
    if (e) equipment.set(id, { ...e, name: v.name });
  }
  for (const [id, v] of Object.entries(snap.locations ?? {})) {
    const l = locations.get(id);
    if (l) locations.set(id, { ...l, building: v.building, name: v.name, sortOrder: Number(v.sort_order) });
  }
  return { ...ds, equipment, locations };
}

/** Order rows by room order, then entry order. Every result is kept. */
export function orderResults(ds: ExportDataset): InspectionResult[] {
  return [...ds.results].sort((a, b) => {
    const la = lookup(ds.locations, a.locationId)?.sortOrder ?? 0;
    const lb = lookup(ds.locations, b.locationId)?.sortOrder ?? 0;
    if (la !== lb) return la - lb;
    // Rooms created on two phones can share a sort position: keep each room's rows together.
    if (a.locationId !== b.locationId) return a.locationId < b.locationId ? -1 : 1;
    return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** One Generator row for one thermal image of one equipment result. */
export function buildGeneratorRow(r: InspectionResult, ds: ExportDataset, image: ThermalImage = r.images[0]): GeneratorRow {
  const loc = lookup(ds.locations, r.locationId);
  const eq = lookup(ds.equipment, r.equipmentId);
  const room = ds.rooms.find((x) => x.locationId === r.locationId && x.inspectionId === r.inspectionId);
  const img = image ?? newThermalImage();
  const eff = resolveEffective(r, room, ds.inspection, img);
  return [
    formatImageDate(eff.imageDate),
    locationLabel(loc),
    eff.humidity,
    eff.backgroundTemp,
    eq?.name ?? "",
    img.component,
    eff.distance,
    img.possibleCause || POSSIBLE_CAUSE_NONE,
    img.irImageNumber,
    img.visualImageNumber,
    eff.emissivity,
    img.maxTemp, // never invented: blank when not measured
    eff.ambientTemp,
    r.opened,
    rowNotes(r, img),
  ].map((v) => (v ?? "").toString()) as GeneratorRow;
}

export interface GeneratorRowRef { result: InspectionResult; image: ThermalImage; imageIndex: number }

/** Every thermal image of every result, in room / entry / image order. Results with no images still get one row. */
export function flattenImages(ds: ExportDataset): GeneratorRowRef[] {
  return orderResults(ds).flatMap((r) => (r.images.length ? r.images : [newThermalImage()]).map((image, imageIndex) => ({ result: r, image, imageIndex })));
}

export function buildGeneratorRows(ds: ExportDataset): GeneratorRow[] {
  return flattenImages(ds).map(({ result, image }) => buildGeneratorRow(result, ds, image));
}

/** RFC 4180 field escaping. Empty values stay empty, so columns never shift. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface CsvOptions {
  /** UTF-8 byte order mark so Excel reads “Can’t” correctly. */
  includeBom?: boolean;
  lineEnding?: "\r\n" | "\n";
}

export function toCsv(rows: string[][], opts: CsvOptions = {}): string {
  const eol = opts.lineEnding ?? "\r\n";
  const lines = [GENERATOR_HEADERS, ...rows].map((row) => {
    if (row.length !== GENERATOR_COLUMN_COUNT) {
      throw new Error(`Generator row must have exactly ${GENERATOR_COLUMN_COUNT} fields, got ${row.length}`);
    }
    return row.map(escapeCsvField).join(",");
  });
  return (opts.includeBom ? "﻿" : "") + lines.join(eol) + eol;
}

/** Minimal RFC 4180 parser used by tests and the export self-check. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      if (ch === "\r" && src[i + 1] === "\n") i++;
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Letters and digits only, words joined by "_" (the established InfraReport file naming). */
export function cleanFilePart(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** "Customer_Facility", without repeating a name that is already part of the other. */
export function customerFacilityPart(customer: string, facility: string): string {
  const c = cleanFilePart(customer), f = cleanFilePart(facility);
  if (!c) return f || "Inspection";
  if (!f) return c;
  const lc = c.toLowerCase(), lf = f.toLowerCase();
  if (lc === lf) return c;
  if (lf.startsWith(`${lc}_`)) return f;      // "AMNT" + "AMNT Burleson"
  if (lc.endsWith(`_${lf}`)) return c;        // "AMNT Burleson" + "Burleson"
  return `${c}_${f}`;
}

/** The inspection's start date: the inspection date, or an earlier image date if one was recorded. */
export function inspectionStartDate(ds: Pick<ExportDataset, "inspection" | "rooms">): string {
  const dates = [ds.inspection.date, ...ds.rooms.map((r) => r.imageDate)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""));
  return dates.sort()[0] ?? ds.inspection.date;
}

export type ExportFormat = "infinite" | "irt";

/**
 * Infinite Infrared: InfraReport_Customer_Facility_YYYY-MM-DD.xlsx
 * IRT:               Customer_Facility_YYYY-MM-DD.xlsx (no InfraReport / Infinite Infrared / IRT)
 */
export function exportFileName(customer: string, facility: string, date: string, format: ExportFormat = "infinite", ext: "xlsx" | "csv" = "csv"): string {
  const base = `${customerFacilityPart(customer, facility)}_${date}`;
  return `${format === "irt" ? base : `InfraReport_${base}`}.${ext}`;
}
