import type {
  Equipment,
  Inspection,
  InspectionResult,
  InspectionRoomConditions,
  Location,
} from "./types";
import { resolveEffective } from "./rules";
import { POSSIBLE_CAUSE_NONE } from "./constants";

/**
 * Exact 16-column Generator layout, in order. `excelColumn` documents where
 * the existing Excel Generator writes each field. Columns O, P and Q are
 * Generator formula columns and are never written by InfraReport.
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
  { header: "Confidence", excelColumn: null },
  { header: "Review Notes", excelColumn: null },
] as const;

export const GENERATOR_HEADERS: string[] = GENERATOR_COLUMNS.map((c) => c.header);
export const GENERATOR_PROTECTED_COLUMNS = ["O", "P", "Q"] as const;
export const GENERATOR_COLUMN_COUNT = 16;

export type GeneratorRow = [
  string, string, string, string, string, string, string, string,
  string, string, string, string, string, string, string, string,
];

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

/** Order rows by room order, then entry order. Every result is kept. */
export function orderResults(ds: ExportDataset): InspectionResult[] {
  return [...ds.results].sort((a, b) => {
    const la = lookup(ds.locations, a.locationId)?.sortOrder ?? 0;
    const lb = lookup(ds.locations, b.locationId)?.sortOrder ?? 0;
    if (la !== lb) return la - lb;
    return a.sortOrder - b.sortOrder;
  });
}

export function buildGeneratorRow(r: InspectionResult, ds: ExportDataset): GeneratorRow {
  const loc = lookup(ds.locations, r.locationId);
  const eq = lookup(ds.equipment, r.equipmentId);
  const room = ds.rooms.find((x) => x.locationId === r.locationId && x.inspectionId === r.inspectionId);
  const eff = resolveEffective(r, room, ds.inspection);
  return [
    formatImageDate(eff.imageDate),
    locationLabel(loc),
    eff.humidity,
    eff.backgroundTemp,
    eq?.name ?? "",
    r.component,
    eff.distance,
    r.possibleCause || POSSIBLE_CAUSE_NONE,
    r.irImageNumber,
    r.visualImageNumber,
    eff.emissivity,
    r.maxTemp, // never invented: blank when not measured
    eff.ambientTemp,
    r.opened,
    r.confidence,
    r.reviewNotes,
  ].map((v) => (v ?? "").toString()) as GeneratorRow;
}

export function buildGeneratorRows(ds: ExportDataset): GeneratorRow[] {
  return orderResults(ds).map((r) => buildGeneratorRow(r, ds));
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

export function exportFileName(customer: string, facility: string, date: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `InfraReport_${clean(customer)}_${clean(facility)}_${date}.csv`;
}
