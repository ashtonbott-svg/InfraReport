/**
 * PDF equipment list extraction from the PDF's text layer (no OCR).
 * Works from positioned text items, so it can rebuild table columns.
 *
 * Three strategies, all reviewable:
 *  - "table":   a header row with an Equipment column (plus Location/Room/
 *               Component/...) defines columns; rows below are read by position
 *  - "labeled": "Location: ...", "Equipment: ...", "Component: ..." fields,
 *               typical of one-item-per-page infrared report pages
 *  - "lines":   last resort, lines that start like equipment names; every
 *               row is flagged as uncertain
 */
import { classifyHeader, makeRow, markDuplicates, parseTabular, splitLocation, type ProposedRow } from "./table";
import { inferTypeFromName } from "../domain/rules";

export interface PdfItem { str: string; x: number; y: number; w: number; h: number }
export interface PdfCell { x: number; x2: number; text: string }
export interface PdfLine { page: number; y: number; cells: PdfCell[]; text: string }

export type PdfStrategy = "table" | "labeled" | "lines";

export interface PdfParseResult {
  pages: number;
  textChars: number;
  scanned: boolean;
  lines: PdfLine[];
  strategies: Record<PdfStrategy, ProposedRow[]>;
  best: PdfStrategy | null;
}

/** Group positioned text items into visual lines and cells. */
export function itemsToLines(items: PdfItem[], page: number): PdfLine[] {
  const sorted = items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; h: number; items: PdfItem[] }[] = [];
  for (const it of sorted) {
    const h = it.h || 10;
    const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, h) * 0.45));
    if (line) line.items.push(it);
    else lines.push({ y: it.y, h, items: [it] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((l) => {
      const its = l.items.sort((a, b) => a.x - b.x);
      const cells: PdfCell[] = [];
      for (const it of its) {
        const last = cells[cells.length - 1];
        const gap = last ? it.x - last.x2 : Infinity;
        const charW = (it.w || it.str.length * l.h * 0.5) / Math.max(1, it.str.length);
        if (last && gap < Math.max(charW * 1.6, l.h * 0.7)) {
          last.text += (gap > charW * 0.25 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
          last.x2 = Math.max(last.x2, it.x + it.w);
        } else {
          cells.push({ x: it.x, x2: it.x + (it.w || it.str.length * l.h * 0.5), text: it.str });
        }
      }
      cells.forEach((c) => (c.text = c.text.replace(/\s+/g, " ").trim()));
      const kept = cells.filter((c) => c.text);
      return { page, y: l.y, cells: kept, text: kept.map((c) => c.text).join("  ") };
    })
    .filter((l) => l.cells.length);
}

const SECTION = /\b(room|building|bldg|floor|level|mezzanine|basement|closet|yard|wing|tower|vault|substation|roof|penthouse|warehouse|area)\b/i;

/** Table strategy: header row anchors column positions; data cells snap to the nearest anchor on their left. */
export function parsePdfTable(lines: PdfLine[]): ProposedRow[] {
  const rows: string[][] = [];
  const labels: string[] = [];
  let anchors: number[] | null = null;
  let width = 0;
  let headerTexts: string[] = [];
  let nameAnchor = -1;
  const isHeader = (line: PdfLine) => {
    const kinds = line.cells.map((c) => classifyHeader(c.text));
    return kinds.includes("name") && kinds.filter((k) => k && k !== "observation").length >= 2;
  };
  // Pages that repeat the table header: text above it (title block) is skipped.
  const headerY = new Map<number, number>();
  for (const l of lines) if (isHeader(l) && !headerY.has(l.page)) headerY.set(l.page, l.y);
  for (const line of lines) {
    const hy = headerY.get(line.page);
    if (hy !== undefined && line.y > hy + 1) continue;
    if (isHeader(line)) {
      const kinds = line.cells.map((c) => classifyHeader(c.text));
      nameAnchor = kinds.indexOf("name");
      anchors = line.cells.map((c) => c.x);
      headerTexts = line.cells.map((c) => c.text);
      width = headerTexts.length;
      rows.push([...headerTexts]);
      labels.push(`Page ${line.page} header`);
      continue;
    }
    if (!anchors) continue; // text above the first table header (report title, address, etc.)
    if (line.cells.length === 1 && SECTION.test(line.cells[0].text) && !inferTypeFromName(line.cells[0].text) && line.cells[0].text.length < 80) {
      const r = new Array(width + 1).fill("");
      r[width] = line.cells[0].text; // outside any mapped column => section row
      rows.push(r);
      labels.push(`Page ${line.page}`);
      continue;
    }
    // A data row must have text in the Equipment column; anything else is report text.
    const nameX = anchors[nameAnchor];
    const nextX = anchors[nameAnchor + 1] ?? Infinity;
    if (!line.cells.some((c) => c.x >= nameX - 6 && c.x < nextX - 6)) continue;
    const r = new Array(width).fill("");
    for (const c of line.cells) {
      let col = 0;
      for (let k = 0; k < anchors.length; k++) if (anchors[k] <= c.x + 6) col = k;
      r[col] = r[col] ? `${r[col]} ${c.text}` : c.text;
    }
    rows.push(r);
    labels.push(`Page ${line.page}`);
  }
  if (!rows.length) return [];
  return parseTabular(rows, (i) => labels[i]).rows;
}

const LABELS = /(Building|Bldg\.?|Location|Room|Area|Equipment\s*Name|Equipment\s*Type|Equipment|Component|Type)\s*:\s*/gi;

/** Labeled-field strategy for report pages such as "Location: X  Equipment: Y  Component: Z". */
export function parsePdfLabeled(lines: PdfLine[]): ProposedRow[] {
  const out: ProposedRow[] = [];
  let building = "";
  let room = "";
  let current: { name: string; type: string; component: string; page: number } | null = null;
  const flush = () => {
    if (current?.name) out.push(makeRow({ building, room, name: current.name, type: current.type, component: current.component, source: `Page ${current.page}` }));
    current = null;
  };
  let lastPage = 0;
  for (const line of lines) {
    if (line.page !== lastPage) { flush(); lastPage = line.page; }
    const text = line.cells.map((c) => c.text).join("   ");
    const marks = [...text.matchAll(LABELS)];
    if (!marks.length) continue;
    marks.forEach((m, idx) => {
      const start = m.index! + m[0].length;
      const end = idx + 1 < marks.length ? marks[idx + 1].index! : text.length;
      // Cells are joined with 3 spaces; a value is the first cell after its label.
      const value = text.slice(start, end).trim().split(/\s{3,}/)[0].trim();
      const label = m[1].toLowerCase().replace(/\s+/g, " ");
      if (!value) return;
      if (label.startsWith("building") || label.startsWith("bldg")) building = value;
      else if (label === "location" || label === "room" || label === "area") {
        const s = splitLocation(value);
        room = s.room;
        if (s.building) building = s.building;
      } else if (label === "equipment" || label === "equipment name") {
        flush();
        current = { name: value, type: "", component: "", page: line.page };
      } else if (label === "component" && current) current.component = current.component || value;
      else if ((label === "type" || label === "equipment type") && current) current.type = current.type || value;
    });
  }
  flush();
  return out;
}

const EQUIPMENT_START = /^(panel|pnl|lp|pp|rp|dp|mdp|ldp|xfmr|xfmer|transformer|disc|disconnect|ds|mcc|swgr|switchgear|switchboard|swbd|breaker|cb|starter|contactor|cabinet|cab|ats|ups|generator|gen|vfd|bus\s*duct|busway|meter|main)\b/i;

/** Last resort: lines that look like equipment, everything flagged as uncertain. */
export function parsePdfLines(lines: PdfLine[]): ProposedRow[] {
  const out: ProposedRow[] = [];
  let room = "";
  let building = "";
  for (const line of lines) {
    const first = line.cells[0]?.text ?? "";
    if (line.cells.length === 1 && SECTION.test(first) && !EQUIPMENT_START.test(first) && first.length < 60) {
      const s = splitLocation(first.replace(/^(location|room)\s*[:\-]\s*/i, ""));
      room = s.room;
      if (s.building) building = s.building;
      continue;
    }
    if (EQUIPMENT_START.test(first) && first.length < 60) {
      out.push(makeRow({ building, room, name: first, source: `Page ${line.page}`, flags: ["Found as a text line, not in a table. Verify name and room."] }));
    }
  }
  return out;
}

export function analyzePdfLines(lines: PdfLine[], pages: number): PdfParseResult {
  const textChars = lines.reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
  const scanned = textChars < Math.max(30, pages * 15);
  const strategies: Record<PdfStrategy, ProposedRow[]> = {
    table: markDuplicates(parsePdfTable(lines)),
    labeled: markDuplicates(parsePdfLabeled(lines)),
    lines: markDuplicates(parsePdfLines(lines)),
  };
  const best: PdfStrategy | null = strategies.table.length ? "table" : strategies.labeled.length ? "labeled" : strategies.lines.length ? "lines" : null;
  return { pages, textChars, scanned, lines, strategies, best };
}

interface TextItemLike { str?: string; transform?: number[]; width?: number; height?: number }

/** Convert pdf.js getTextContent() items to positioned items. */
export function fromPdfJsItems(items: TextItemLike[]): PdfItem[] {
  return items
    .filter((i) => typeof i.str === "string" && i.transform)
    .map((i) => {
      const t = i.transform!;
      const h = i.height || Math.hypot(t[2], t[3]) || 10;
      return { str: i.str!, x: t[4], y: t[5], w: i.width ?? 0, h };
    });
}
