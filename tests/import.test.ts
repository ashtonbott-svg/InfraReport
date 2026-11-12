import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePdfFixture } from "./import-helpers";
import { csvToRows } from "@/lib/import/load-file";
import { markDuplicates, parseTabular, splitLocation } from "@/lib/import/table";

const F = (n: string) => `tests/fixtures/import/${n}`;
const summary = (rows: { include: boolean; building: string; room: string; name: string; type: string; component: string }[]) =>
  rows.map((r) => `${r.include ? "+" : "-"} ${r.building} | ${r.room} | ${r.name} | ${r.type} | ${r.component}`);

describe("PDF import (text layer)", () => {
  it("reads an equipment-list table across pages, keeps order and rooms, skips headers, totals and observations", async () => {
    const r = await parsePdfFixture(F("equipment-list-table.pdf"));
    expect(r.scanned).toBe(false);
    expect(r.best).toBe("table");
    expect(summary(r.strategies.table)).toEqual([
      "+ Building A | Electrical Room 1 | Panel P1 | Panel | Full Panel",
      "+ Building A | Electrical Room 1 | Panel P2 | Panel | Full Panel",
      "+ Building A | Electrical Room 1 | Transformer T1 | Transformer | Full Transformer",
      "+ Building A | Electrical Room 1 | Disconnect D1 | Disconnect | Full Disconnect",
      "+ Building A | Mezzanine MCC | MCC-1 Starter 3 | Starter | Full Starter",
      "+ Building A | Mezzanine MCC | MCC-1 Starter 4 | Starter | Full Starter",
      "+ Building B | Main Switchgear Room | Main Switchgear MSG | Switchgear | Full Panel",
      "+ Building B | Main Switchgear Room | Main Breaker MB-1 | Breaker | Full Breaker",
      "+ Building B | Main Switchgear Room | Lighting Contactor LC-1 | Contactor | Full Contactor",
      "+ Building B | Main Switchgear Room | Panel P2 | Panel | Circuit 11",
    ]);
    // Finding-specific component is flagged for review, never silently trusted
    expect(r.strategies.table[9].flags.join(" ")).toMatch(/past finding/);
    // Nothing from the title block, footer or totals
    const names = r.strategies.table.map((x) => x.name).join(" ");
    expect(names).not.toMatch(/Customer|Total|Page|Inspection Date|86\.2/);
  });

  it("reads section headings as rooms and keeps identifiers", async () => {
    const r = await parsePdfFixture(F("equipment-list-sections.pdf"));
    expect(summary(r.strategies.table)).toEqual([
      "+  | Electrical Room 1 | LP-1 | Panel | Full Panel",
      "+  | Electrical Room 1 | LP-2 | Panel | Full Panel",
      "+  | Electrical Room 1 | XFMR T1 | Transformer | Full Transformer",
      "+  | Generator Room | ATS-1 | Other | ",
      "+  | Generator Room | Disc D4 | Disconnect | Full Disconnect",
    ]);
    expect(r.strategies.table.map((x) => x.identifiers)).toEqual(["A-100", "A-101", "", "G-7", ""]);
  });

  it("reads one-item-per-page report pages from labeled fields", async () => {
    const r = await parsePdfFixture(F("report-per-page.pdf"));
    expect(r.best).toBe("labeled");
    expect(summary(r.strategies.labeled)).toEqual([
      "+  | Electrical Room 1 | Panel P1 | Panel | Full Panel",
      "+  | Electrical Room 1 | Panel P2 | Panel | Circuit 11",
      "+  | Pump Room | Starter S3 | Starter | Full Starter",
    ]);
  });

  it("detects scanned PDFs and imports nothing", async () => {
    const r = await parsePdfFixture(F("scanned.pdf"));
    expect(r.scanned).toBe(true);
    expect(r.best).toBeNull();
    expect(Object.values(r.strategies).every((s) => s.length === 0)).toBe(true);
  });
});

describe("CSV and Excel import", () => {
  it("reads an old 16-column Generator CSV: location split, observations ignored, duplicates flagged", () => {
    const parsed = parseTabular(csvToRows(readFileSync(F("generator-export.csv"), "utf8")));
    const rows = markDuplicates(parsed.rows);
    expect(summary(rows)).toEqual([
      "+ Building A | Electrical Room 1 | Panel P1 | Panel | Full Panel",
      "+ Building A | Electrical Room 1 | Panel P2 | Panel | Circuit 11",
      "+ Building A | Electrical Room 1 | Panel P2 | Panel | Full Panel",
      "+  | Electrical Room 2 | Disconnect D1 | Disconnect | Full Disconnect",
    ]);
    expect(rows[2].flags.join(" ")).toMatch(/Duplicate name in this room/);
    expect(parsed.ignoredColumns).toEqual(expect.arrayContaining(["Max Temp", "Opened", "Possible Cause", "IR Image Number", "Distance"]));
  });

  it("reads Excel with merged room cells and skips TOTAL rows", async () => {
    const { default: readXlsx } = await import("read-excel-file/universal");
    const buf = readFileSync(F("equipment-list.xlsx"));
    const sheets = (await readXlsx(new Blob([buf]))) as { sheet: string; data: unknown[][] }[];
    const sheet = sheets.find((s) => s.sheet === "Equipment")!;
    const rows = sheet.data.map((r) => r.map((c) => (c == null ? "" : String(c))));
    const parsed = parseTabular(rows);
    expect(summary(parsed.rows)).toEqual([
      "+ Plant 2 | Production Floor | Line 3 Panel LP-3 | Panel | Full Panel",
      "+ Plant 2 | Production Floor | Line 3 Disc D1 | Other | Full Disconnect",
      "+ Plant 2 | Compressor Room | MCC-2 | MCC | ",
      "+ Plant 2 | Compressor Room | Starter 2A | Starter | Full Starter",
    ]);
  });

  it("excludes exact duplicates and items already in the facility inventory", () => {
    const rows = parseTabular([["Location", "Equipment", "Component"], ["Room 1", "Panel P1", "Full Panel"], ["Room 1", "Panel P1", "Full Panel"], ["Room 1", "Panel P9", "Full Panel"]]).rows;
    const out = markDuplicates(rows, [{ building: "", room: "Room 1", name: "Panel P9" }]);
    expect(out.map((r) => r.include)).toEqual([true, false, false]);
  });

  it("does not treat files without an equipment header as equipment", () => {
    expect(parseTabular([["Customer", "Date"], ["Acme", "2025-01-01"]]).rows).toEqual([]);
  });

  it("splits combined locations only when the first part names a building", () => {
    expect(splitLocation("Building A - Electrical Room 1")).toEqual({ building: "Building A", room: "Electrical Room 1" });
    expect(splitLocation("MCC - 2")).toEqual({ building: "", room: "MCC - 2" });
  });
});
