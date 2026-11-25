/**
 * Read a Report Generator workbook (.xlsm / .xlsx, "Generator" sheet, tblFindings) into a new
 * InfraReport inspection, so an inspection done before InfraReport can be reported natively.
 * The workbook is only read (in the browser); macros never run and the file is never changed.
 * Values are copied as written: a blank Max Temp stays blank, nothing is calculated or guessed,
 * and anything that cannot be mapped is listed for the reviewer.
 */
import { OPENED_VALUES } from "@/lib/domain/constants";

export interface GeneratorRow {
  finding: string; location: string; humidityPercent: string; background: string; ambient: string;
  equipment: string; equipmentExtra: string; component: string; distance: string; cause: string;
  ir: string; visual: string; maxTemp: string; opened: string; imageDate: string;
}
export interface GeneratorWorkbook { client: string; address: string; date: string; rows: GeneratorRow[]; notes: string[] }

const S = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
const num = (v: unknown) => { const s = S(v); return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s; };
const isoDate = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = S(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  return "";
};
const norm = (s: string) => s.replace(/[‘’]/g, "'").trim().toLowerCase();

/** Generator Opened text to InfraReport's Opened value (same list, apostrophes differ); unknown text is kept and flagged. */
export function mapOpened(v: string): { value: string; known: boolean } {
  if (!v.trim()) return { value: "Yes, Completely", known: true };
  const hit = OPENED_VALUES.find((o) => norm(o) === norm(v));
  return hit ? { value: hit, known: true } : { value: v.trim(), known: false };
}

/** sheet = the Generator sheet's cells (rows of values). */
export function parseGeneratorSheet(sheet: unknown[][]): GeneratorWorkbook {
  const label = (name: string) => sheet.find((r) => norm(S(r[0])) === name.toLowerCase())?.[1];
  const h = sheet.findIndex((r) => r.some((c) => S(c) === "Finding_Number"));
  if (h < 0) throw new Error("This workbook has no Generator sheet with the findings table (Finding_Number column).");
  const head = sheet[h].map(S);
  const col = (name: string) => head.indexOf(name);
  const need = ["Location", "Equipment", "Component", "PossibleCause", "ImageNum", "MaxTemp"];
  const lacking = need.filter((n) => col(n) < 0);
  if (lacking.length) throw new Error(`The findings table is missing columns: ${lacking.join(", ")}.`);
  const get = (r: unknown[], name: string) => (col(name) < 0 ? undefined : r[col(name)]);
  const notes: string[] = [];
  const rows: GeneratorRow[] = [];
  const gaps: { finding: string; after: number }[] = [];
  for (const r of sheet.slice(h + 1)) {
    const [first, ...rest] = S(get(r, "Equipment")).split(/\r?\n/);
    const row: GeneratorRow = {
      finding: S(get(r, "Finding_Number")), location: S(get(r, "Location")),
      // The Generator stores humidity as a fraction (0.53); InfraReport stores percent (53).
      humidityPercent: (() => { const v = S(get(r, "Humidity")); if (!v) return ""; const n = Number(v); return Number.isFinite(n) ? String(Math.round((n <= 1 ? n * 100 : n) * 10) / 10) : v; })(),
      background: num(get(r, "BackgroundTemp")), ambient: num(get(r, "AmbientTemp")),
      equipment: first.trim(), equipmentExtra: rest.map((x) => x.trim()).filter(Boolean).join(" "),
      component: S(get(r, "Component")), distance: num(get(r, "Distance")), cause: S(get(r, "PossibleCause")),
      ir: num(get(r, "ImageNum")), visual: num(get(r, "VisualNum")), maxTemp: num(get(r, "MaxTemp")),
      opened: S(get(r, "Opened?")), imageDate: isoDate(get(r, "ImageDate")),
    };
    if (!row.location && !row.equipment && !row.component && !row.ir) {
      // Empty rows after the findings are just the unused table; an empty row between findings is reported.
      if (row.finding) gaps.push({ finding: row.finding, after: rows.length });
      continue;
    }
    if (!row.equipment) notes.push(`Row ${row.finding || rows.length + 1}: no equipment name; imported as "Unnamed equipment".`);
    if (!row.location) notes.push(`Row ${row.finding || rows.length + 1}: no location; imported into "No location".`);
    if (!mapOpened(row.opened).known) notes.push(`Row ${row.finding}: Opened value "${row.opened}" is not one of InfraReport's options; kept as written.`);
    if (row.maxTemp && !/^-?\d+(\.\d+)?$/.test(row.maxTemp)) notes.push(`Row ${row.finding}: Max Temp "${row.maxTemp}" is not a number.`);
    rows.push(row);
  }
  if (!rows.length) throw new Error("The findings table has no rows.");
  for (const g of gaps) if (g.after < rows.length) notes.push(`Row ${g.finding} has no location, equipment, component or image number and was not imported. Check the workbook in case something was meant to be recorded there.`);
  return { client: S(label("ClientName")), address: S(label("Address")), date: isoDate(label("InspectionDate")) || rows.find((r) => r.imageDate)?.imageDate || "", rows, notes };
}

/** Group rows into rooms, equipment (in order) and thermal image entries, as the app records them. */
export function groupGeneratorRows(rows: GeneratorRow[]) {
  const rooms: { name: string; humidity: string; ambient: string; background: string; imageDate: string; equipment: { name: string; extra: string; opened: string; conflict?: string; images: GeneratorRow[] }[] }[] = [];
  for (const r of rows) {
    const roomName = r.location || "No location";
    let room = rooms.find((x) => x.name === roomName);
    if (!room) { room = { name: roomName, humidity: r.humidityPercent, ambient: r.ambient, background: r.background, imageDate: r.imageDate, equipment: [] }; rooms.push(room); }
    const name = r.equipment || "Unnamed equipment";
    // Consecutive rows naming the same equipment are its components (the Generator repeats the name).
    const last = room.equipment[room.equipment.length - 1];
    const eq = last && last.name === name && r.equipment ? last : (room.equipment.push({ name, extra: r.equipmentExtra, opened: r.opened, images: [] }), room.equipment[room.equipment.length - 1]);
    // One Opened value per item of equipment: the first one that is not the default wins, and a
    // different later value is reported instead of silently replacing it.
    const isDefault = (v: string) => mapOpened(v).value === "Yes, Completely";
    if (eq.images.length && r.opened && !isDefault(r.opened) && norm(r.opened) !== norm(eq.opened)) {
      if (isDefault(eq.opened)) eq.opened = r.opened;
      else eq.conflict = `${name} has different Opened values (${eq.opened}; ${r.opened}); "${eq.opened}" was used.`;
    }
    if (r.equipmentExtra && !eq.extra.includes(r.equipmentExtra)) eq.extra = [eq.extra, r.equipmentExtra].filter(Boolean).join(" ");
    eq.images.push(r);
  }
  return rooms;
}
