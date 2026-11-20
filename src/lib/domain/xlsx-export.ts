/**
 * Excel (.xlsx) exports. Both formats are built from the same rows.
 *
 * Infinite Infrared (15 columns, three sheets):
 * Sheet "Generator Import": header + one row per thermal image, columns A..O
 * in the established Generator order (same as the CSV). Values are real typed
 * Excel cells: numbers are numbers, the image date is a date, text is text.
 * Sheet "Equipment Summary": one row per physical equipment item.
 * Sheet "Column Map": where each field goes in the Generator workbook
 * (B..N and R; formula columns O, P, Q are never written).
 *
 * IRT (Infrared Team, 13 columns, one sheet "Data"): the same rows without
 * Max Temp and Visual Image Number, no summary, no column map, no branding.
 *
 * This file only builds sheet data; it does not run Excel macros or produce
 * the finished report.
 */
import { GENERATOR_COLUMNS, GENERATOR_HEADERS, IRT_HEADERS, buildGeneratorRow, combineNotes, equipmentNotes, exportFileName, flattenImages, locationLabel, toIrtRow, type ExportDataset, type ExportFormat } from "./csv";
import { isNumericText } from "./rules";
import { resultStatus } from "./thermal";
import type { Equipment, Location } from "./types";

export type CellType = "String" | "Number" | "Date";
export interface XCell { value: string | number | Date | null; type: CellType; format?: string; fontWeight?: "bold"; wrap?: boolean }
export interface XSheet { sheet: string; data: (XCell | null)[][]; columns: { width: number }[]; stickyRowsCount?: number }

/** Columns written as numbers when they hold a plain number. */
const NUMERIC_COLUMNS = new Set(["Humidity", "Background Temp", "Distance", "Emissivity", "Max Temp", "Ambient Temp"]);
/** Image numbers: numbers unless they have leading zeros or letters (kept as text so "0104" stays "0104"). */
const IMAGE_NUMBER_COLUMNS = new Set(["IR Image Number", "Visual Image Number"]);

const text = (v: string): XCell | null => (v === "" ? null : { value: v, type: "String" });

export function typedCell(header: string, raw: string): XCell | null {
  const v = (raw ?? "").trim();
  if (v === "") return null; // empty cell: column position is kept, nothing invented
  if (header === "Image Date") {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return { value: new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))), type: "Date", format: "mm/dd/yyyy" };
    return text(v);
  }
  if (NUMERIC_COLUMNS.has(header)) return isNumericText(v) ? { value: Number(v), type: "Number" } : text(v);
  if (IMAGE_NUMBER_COLUMNS.has(header)) return /^(0|[1-9]\d{0,14})$/.test(v) ? { value: Number(v), type: "Number" } : text(v);
  return text(v);
}

export interface WorkbookMeta {
  customer: string;
  facility: string;
  inspectionDate: string;
  thermographers: string;
  generatedAt: Date;
}

export function buildWorkbook(ds: ExportDataset, meta: WorkbookMeta): XSheet[] {
  const bold = (v: string): XCell => ({ value: v, type: "String", fontWeight: "bold" });
  const refs = flattenImages(ds);
  const genRows = refs.map(({ result, image }) => buildGeneratorRow(result, ds, image));

  const generator: XSheet = {
    sheet: "Generator Import",
    data: [GENERATOR_HEADERS.map(bold), ...genRows.map((row) => row.map((v, i) => typedCell(GENERATOR_HEADERS[i], v)))],
    columns: [12, 30, 10, 14, 28, 20, 10, 30, 14, 16, 11, 10, 13, 34, 40].map((width) => ({ width })),
    stickyRowsCount: 1,
  };

  const eqMap = ds.equipment instanceof Map ? ds.equipment : new Map(Object.entries(ds.equipment) as [string, Equipment][]);
  const locMap = ds.locations instanceof Map ? ds.locations : new Map(Object.entries(ds.locations) as [string, Location][]);
  const seen = new Set<string>();
  const statusLabel = { recorded: "Recorded", todo: "To Do", "not-scanned": "Not scanned", deferred: "Deferred" } as const;
  const summaryRows: (XCell | null)[][] = [];
  for (const { result } of refs) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    summaryRows.push([
      text(locationLabel(locMap.get(result.locationId))),
      text(eqMap.get(result.equipmentId)?.name ?? ""),
      { value: result.images.length, type: "Number" },
      text(result.images.map((i) => i.component).filter(Boolean).join("; ")),
      text(statusLabel[resultStatus(result)]),
      text(result.opened),
      text(combineNotes(...equipmentNotes(result))),
    ]);
  }
  const summary: XSheet = {
    sheet: "Equipment Summary",
    data: [["Location", "Equipment", "Thermal Images", "Components", "Status", "Opened", "Equipment Notes"].map(bold), ...summaryRows],
    columns: [30, 28, 14, 40, 13, 34, 30].map((width) => ({ width })),
    stickyRowsCount: 1,
  };

  const map: XSheet = {
    sheet: "Column Map",
    data: [
      [bold("InfraReport export")],
      [text("Customer"), text(meta.customer)],
      [text("Facility"), text(meta.facility)],
      [text("Inspection date"), text(meta.inspectionDate)],
      [text("Thermographer(s)"), text(meta.thermographers)],
      [text("Generated"), text(meta.generatedAt.toLocaleString("en-US"))],
      [text("Equipment items"), { value: seen.size, type: "Number" }],
      [text("Generator rows (one per thermal image)"), { value: genRows.length, type: "Number" }],
      [],
      [bold("Generator Import column"), bold("Field"), bold("Generator workbook column")],
      ...GENERATOR_COLUMNS.map((c, i) => [text(String.fromCharCode(65 + i)), text(c.header), text(c.excelColumn ?? "Not written (notes for the report writer)")]),
      [],
      [text("Columns O, P and Q in the Generator are formulas and are never written by InfraReport.")],
      [text("Review Notes combine the thermal image note with the equipment notes, without repeating identical text.")],
      [text("Confidence is no longer exported (older files that contain it can still be imported).")],
      [text("Macros are not run and the finished report is not generated by this export.")],
    ],
    columns: [38, 26, 36].map((width) => ({ width })),
  };

  return [generator, summary, map];
}

/** IRT (Infrared Team): one plain "Data" sheet, 13 columns, no Max Temp or Visual Image Number, no branding or metadata. */
export function buildIrtWorkbook(ds: ExportDataset): XSheet[] {
  const bold = (v: string): XCell => ({ value: v, type: "String", fontWeight: "bold" });
  const rows = flattenImages(ds).map(({ result, image }) => toIrtRow(buildGeneratorRow(result, ds, image)));
  return [{
    sheet: "Data",
    data: [IRT_HEADERS.map(bold), ...rows.map((row) => row.map((v, i) => typedCell(IRT_HEADERS[i], v)))],
    columns: [12, 30, 10, 14, 28, 20, 10, 30, 14, 11, 13, 34, 40].map((width) => ({ width })),
    stickyRowsCount: 1,
  }];
}

export function buildWorkbookFor(format: ExportFormat, ds: ExportDataset, meta: WorkbookMeta): XSheet[] {
  return format === "irt" ? buildIrtWorkbook(ds) : buildWorkbook(ds, meta);
}

export function xlsxFileName(customer: string, facility: string, date: string, format: ExportFormat = "infinite"): string {
  return exportFileName(customer, facility, date, format, "xlsx");
}

/** Converts sheets to the write-excel-file format and returns an .xlsx Blob. */
/** The library writes no document properties (no author/company metadata), so IRT files carry no branding. */
export async function workbookBlob(sheets: XSheet[]): Promise<Blob> {
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const toCell = (c: XCell | null) => (c === null ? null : {
    value: c.value,
    type: c.type === "Number" ? Number : c.type === "Date" ? Date : String,
    ...(c.format ? { format: c.format } : {}),
    ...(c.fontWeight ? { fontWeight: c.fontWeight } : {}),
  });
  const input = sheets.map((s) => ({
    data: s.data.map((row) => row.map(toCell)),
    sheet: s.sheet,
    columns: s.columns,
    ...(s.stickyRowsCount ? { stickyRowsCount: s.stickyRowsCount } : {}),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (writeExcelFile as any)(input).toBlob();
}
