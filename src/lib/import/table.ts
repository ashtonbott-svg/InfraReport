/**
 * Turns tabular data (CSV rows, Excel sheets, PDF table lines) into proposed
 * permanent-inventory records for review. Pure functions, no browser APIs.
 *
 * Rules:
 *  - Only permanent identity is taken: building, room, equipment name, type,
 *    component, identifiers. Temperatures, image numbers, causes, access
 *    ("Opened") and notes from old reports are ignored on purpose.
 *  - Nothing is invented. Blank stays blank; uncertain rows are flagged.
 *  - Original order and room grouping are preserved.
 */
import { EQUIPMENT_PRESETS, OTHER_EQUIPMENT_TYPE } from "../domain/constants";
import { defaultComponentForType, inferTypeFromName } from "../domain/rules";

export interface ProposedRow {
  id: string;
  include: boolean;
  building: string;
  room: string;
  name: string;
  type: string;
  component: string;
  identifiers: string;
  /** Where it came from, e.g. "Row 12" or "Page 2, line 14". */
  source: string;
  flags: string[];
}

export type Field = "building" | "room" | "location" | "name" | "type" | "component" | "identifiers";

const HEADER_WORDS: Record<Field, RegExp> = {
  building: /^(building|bldg\.?|building\s*name|facility\s*area|structure)$/i,
  location: /^(location|loc\.?|location\s*name|area\s*\/\s*room)$/i,
  room: /^(room|room\s*name|room\s*\/\s*area|electrical\s*room|area)$/i,
  name: /^(equipment|equipment\s*name|equip\.?|equipment\s*id|equipment\s*description|description|item|panel|panel\s*name|device|name)$/i,
  type: /^(type|equipment\s*type|equip\.?\s*type|category|class)$/i,
  component: /^(component|components|section|component\s*inspected)$/i,
  identifiers: /^(tag|asset|asset\s*tag|asset\s*#|asset\s*id|serial|serial\s*#|id|id\s*#|equipment\s*#|tag\s*#)$/i,
};

/** Old-report columns that are observations, never inventory. Recognized only so they are skipped deliberately. */
const OBSERVATION_WORDS = /^(image\s*date|humidity|background\s*temp|distance|possible\s*cause|ir\s*image\s*(number|#)?|visual\s*image\s*(number|#)?|emissivity|max\s*temp|ambient\s*temp|opened|confidence|review\s*notes|delta\s*t|severity|priority|load|amps?|rated\s*amps|findings?|recommendation|notes?|comments?|temp(erature)?)$/i;

export function normHeader(s: string): string {
  return s.replace(/[_\n\r]+/g, " ").replace(/\s+/g, " ").replace(/[:*]$/, "").trim();
}

export function classifyHeader(cell: string): Field | "observation" | null {
  const h = normHeader(cell);
  if (!h) return null;
  for (const f of Object.keys(HEADER_WORDS) as Field[]) if (HEADER_WORDS[f].test(h)) return f;
  if (OBSERVATION_WORDS.test(h)) return "observation";
  return null;
}

export interface HeaderMatch {
  index: number;
  columns: Partial<Record<Field, number>>;
  score: number;
}

/** Finds the most likely header row in the first 40 rows. Requires an equipment column. */
export function findHeader(rows: string[][]): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const columns: Partial<Record<Field, number>> = {};
    let score = 0;
    rows[i].forEach((cell, c) => {
      const k = classifyHeader(cell);
      if (!k) return;
      if (k === "observation") { score += 0.5; return; }
      if (columns[k] === undefined) { columns[k] = c; score += k === "name" ? 3 : 2; }
    });
    if (columns.name === undefined) continue;
    if (score < 4) continue; // equipment column plus at least one more recognized column
    if (!best || score > best.score) best = { index: i, columns, score };
  }
  return best;
}

const SKIP_ROW = /^(total|totals|grand\s*total|summary|subtotal|count|page\s*\d+|page\s*\d+\s*of\s*\d+|continued|end\s*of\s*(report|list)|prepared\s*by|report\s*date)\b/i;
const LOCATION_HINT = /\b(room|building|bldg|floor|level|mezzanine|basement|closet|yard|area|wing|tower|mcc|switchgear|vault|substation|roof|penthouse|plant|shop|warehouse|office)\b/i;
const BUILDING_PREFIX = /^(building|bldg\.?|tower|wing|plant|site|annex)\b/i;

/** "Building A - Electrical Room 1" -> building + room. Only splits when the first part names a building. */
export function splitLocation(loc: string): { building: string; room: string } {
  const t = loc.trim();
  const m = t.match(/^(.+?)\s+[-–—/|]\s+(.+)$/);
  if (m && BUILDING_PREFIX.test(m[1].trim())) return { building: m[1].trim(), room: m[2].trim() };
  return { building: "", room: t };
}

export function matchPresetType(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const p of EQUIPMENT_PRESETS) {
    if (p.type.toLowerCase() === t || p.aliases.includes(t)) return p.type;
  }
  return null;
}

let seq = 0;
const nextId = () => `imp-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function makeRow(partial: Partial<ProposedRow> & { name: string; source: string }): ProposedRow {
  const name = partial.name.replace(/\s+/g, " ").trim();
  const explicitType = partial.type ? matchPresetType(partial.type) : null;
  const type = explicitType ?? inferTypeFromName(name) ?? (partial.type?.trim() ? partial.type.trim() : OTHER_EQUIPMENT_TYPE);
  const flags = [...(partial.flags ?? [])];
  let component = (partial.component ?? "").replace(/\s+/g, " ").trim();
  if (component && !/^full\b/i.test(component) && component.toLowerCase() !== defaultComponentForType(type).toLowerCase()) {
    flags.push("Component may describe a past finding. Confirm it belongs in the permanent inventory.");
  }
  if (!component) component = defaultComponentForType(type);
  return {
    id: nextId(),
    include: partial.include ?? true,
    building: (partial.building ?? "").trim(),
    room: (partial.room ?? "").trim(),
    name,
    type,
    component,
    identifiers: (partial.identifiers ?? "").trim(),
    source: partial.source,
    flags,
  };
}

export interface TableParse {
  rows: ProposedRow[];
  header: HeaderMatch | null;
  ignoredColumns: string[];
  skipped: number;
}

/**
 * Parse rows that have a header. Location carries down when a cell is blank
 * (merged or grouped cells) and single-cell section rows set the current room.
 */
export function parseTabular(rows: string[][], sourceLabel: (i: number) => string = (i) => `Row ${i + 1}`): TableParse {
  const clean = rows.map((r) => r.map((c) => (c ?? "").toString().replace(/\s+/g, " ").trim()));
  const header = findHeader(clean);
  if (!header) return { rows: [], header: null, ignoredColumns: [], skipped: 0 };
  const cols = header.columns;
  const headerRow = clean[header.index];
  const ignoredColumns = headerRow.filter((h, c) => h && !Object.values(cols).includes(c));
  const headerKey = headerRow.join("|").toLowerCase();
  const get = (r: string[], f: Field) => (cols[f] !== undefined ? r[cols[f]!] ?? "" : "");
  const out: ProposedRow[] = [];
  let curBuilding = "";
  let curRoom = "";
  let skipped = 0;
  for (let i = header.index + 1; i < clean.length; i++) {
    const r = clean[i];
    const filled = r.filter(Boolean);
    if (!filled.length) continue;
    if (r.join("|").toLowerCase() === headerKey) continue; // repeated header (page breaks)
    if (SKIP_ROW.test(filled[0])) { skipped++; continue; }
    const name = get(r, "name");
    // Section row: one cell of text that looks like a location, no equipment
    if (!name && filled.length === 1 && LOCATION_HINT.test(filled[0]) && filled[0].length < 80) {
      const loc = splitLocation(filled[0].replace(/^(location|room)\s*[:\-]\s*/i, ""));
      if (loc.building) curBuilding = loc.building;
      curRoom = loc.room;
      continue;
    }
    if (!name) { skipped++; continue; }
    const building = get(r, "building");
    const room = get(r, "room");
    const location = get(r, "location");
    let b = building;
    let rm = room;
    if (location) {
      // A combined location cell names its own building; it never inherits one.
      const sp = splitLocation(location);
      rm = room || sp.room;
      b = building || sp.building;
    }
    if (cols.building !== undefined) {
      if (building) curBuilding = building;
      b = b || curBuilding; // merged / grouped building cells
    }
    if (rm) {
      curRoom = rm;
      if (cols.building === undefined) curBuilding = b;
    } else {
      rm = curRoom; // merged / grouped room cells, or a section row above
      if (!b) b = curBuilding;
    }
    out.push(makeRow({
      building: b,
      room: rm,
      name,
      type: get(r, "type"),
      component: get(r, "component"),
      identifiers: get(r, "identifiers"),
      source: sourceLabel(i),
      flags: rm ? [] : ["No room found. Assign one before approving."],
    }));
  }
  return { rows: out, header, ignoredColumns, skipped };
}

/**
 * Mark duplicates for review:
 *  - identical room + name + component inside the file: later copies excluded
 *  - same room + name, different component: flagged, kept (often one panel listed per section)
 *  - already in the facility inventory: excluded and flagged
 */
export function markDuplicates(rows: ProposedRow[], existing: { building: string; room: string; name: string }[] = []): ProposedRow[] {
  const k = (b: string, r: string, n: string) => `${b.toLowerCase()}|${r.toLowerCase()}|${n.toLowerCase()}`;
  const inv = new Set(existing.map((e) => k(e.building.trim(), e.room.trim(), e.name.trim())));
  const seenFull = new Set<string>();
  const seenName = new Map<string, number>();
  return rows.map((row) => {
    const flags = row.flags.filter((f) => !f.startsWith("Duplicate") && !f.startsWith("Already in"));
    let include = row.include;
    const base = k(row.building, row.room, row.name);
    const full = `${base}|${row.component.toLowerCase()}`;
    if (inv.has(base)) { flags.push("Already in this facility's inventory."); include = false; }
    else if (seenFull.has(full)) { flags.push("Duplicate of an earlier row (same room, name and component)."); include = false; }
    else if (seenName.has(base)) flags.push(`Duplicate name in this room (also on row ${seenName.get(base)! + 1} of the list). Keep both only if they are different items.`);
    seenFull.add(full);
    if (!seenName.has(base)) seenName.set(base, rows.indexOf(row));
    return { ...row, flags, include };
  });
}
