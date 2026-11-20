import { describe, expect, it } from "vitest";
import { DEFAULT_OPENED, LIMITED_ACCESS_OPENED, OPENED_VALUES } from "@/lib/domain/constants";
import { buildGeneratorRows, type ExportDataset } from "@/lib/domain/csv";
import { checkRoom, newThermalImage, resultStatus, roomProgress } from "@/lib/domain/thermal";
import { validateInspection } from "@/lib/domain/validation";
import { buildIrtWorkbook, buildWorkbook, workbookBlob } from "@/lib/domain/xlsx-export";
import type { InspectionResult, ResultException, ThermalImage } from "@/lib/domain/types";

const room = { id: "rc", organizationId: "o", inspectionId: "i", locationId: "l", humidity: "40", ambientTemp: "72", backgroundTemp: "70", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null } as const;
function ds(results: InspectionResult[]): ExportDataset {
  return {
    inspection: { id: "i", organizationId: "o", customerId: "c", facilityId: "f", date: "2026-11-20", inspectorIds: [], status: "In Progress", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "" } as never,
    results,
    equipment: new Map(results.map((r) => [r.equipmentId, { id: r.equipmentId, organizationId: "o", facilityId: "f", locationId: "l", name: r.equipmentId, equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: 1, createdAt: "" }])),
    locations: new Map([["l", { id: "l", organizationId: "o", facilityId: "f", building: "", name: "Elec", area: "", sortOrder: 1 }]]),
    rooms: [{ ...room }],
  };
}
let n = 0;
function line(opened: string, images: Partial<ThermalImage>[], exception: Omit<ResultException, "at"> | null = null, reviewNotes = ""): InspectionResult {
  n++;
  return { id: `r${n}`, organizationId: "o", inspectionId: "i", equipmentId: `EQ${n}`, locationId: "l", opened, exception: exception ? { ...exception, at: "" } : null,
    images: images.map((p) => newThermalImage({ component: "Full Panel", ...p })), confidence: "", reviewNotes, overrides: { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: null },
    source: "carried-forward", sortOrder: n, createdAt: "", updatedAt: "" };
}
const issuesFor = (r: InspectionResult) => validateInspection(ds([r]), { allowedCauses: ["NONE", "Loose Connection(s)"] }).filter((i) => i.resultId === r.id);
const irIssues = (r: InspectionResult) => issuesFor(r).filter((i) => i.field === "IR Image Number" || i.field === "Distance");
const SCANNED = { irImageNumber: "0101", distance: "4" };

describe("status for every Opened value, with and without image entries", () => {
  for (const opened of OPENED_VALUES) {
    const limited = LIMITED_ACCESS_OPENED.includes(opened);
    it(`${opened}: blank placeholder is ${limited ? "Not scanned" : "To Do"}; with an image number it is scanned`, () => {
      const blank = line(opened, [{}]);
      expect(resultStatus(blank)).toBe(limited ? "not-scanned" : "todo");
      const scanned = line(opened, [SCANNED]);
      expect(resultStatus(scanned)).toBe("recorded");
      expect(irIssues(scanned)).toEqual([]); // scanned through a cover, dead front or surface: validated normally, nothing missing
      const scannedNoDistance = line(opened, [{ irImageNumber: "0102" }]);
      expect(issuesFor(scannedNoDistance).map((i) => i.field)).toContain("Distance"); // still checked when scanned
      if (limited) expect(irIssues(blank)).toEqual([]);
      else expect(irIssues(blank).map((i) => i.message)).toEqual([`${blank.equipmentId}: Not inspected yet (To Do). The row is kept and exported.`]);
    });
    it(`${opened}: Not Scanned and Deferred exceptions`, () => {
      const ns = line(opened, [{}, {}], { kind: "not-scanned", note: "LOTO tag" });
      expect(resultStatus(ns)).toBe("not-scanned");
      expect(irIssues(ns)).toEqual([]);
      expect(issuesFor(ns)).toEqual([]);
      const def = line(opened, [{}], { kind: "deferred", note: "" });
      expect(resultStatus(def)).toBe("deferred");
      expect(issuesFor(def).map((i) => i.field)).toEqual(["Opened"]); // still a warning: come back to it
    });
  }

  it("the default Opened value never counts as inspected", () => {
    expect(resultStatus(line(DEFAULT_OPENED, [{}]))).toBe("todo");
    expect(resultStatus(line("Yes, with Dead-Front on", [{}]))).toBe("todo");
    expect(resultStatus(line("Scanned Surface Only", [{}]))).toBe("todo");
  });

  it("Not Scanned without any reason still gets a warning", () => {
    expect(issuesFor(line(DEFAULT_OPENED, [{}], { kind: "not-scanned", note: "" })).map((i) => i.message)).toEqual([expect.stringMatching(/Not Scanned without a reason/)]);
    expect(issuesFor(line(DEFAULT_OPENED, [{}], { kind: "not-scanned", note: "Breaker off per site" }))).toEqual([]);
    expect(issuesFor(line("Item Was Off at Time of Scan", [{}], { kind: "not-scanned", note: "" }))).toEqual([]);
  });

  it("documented not-scanned items count as done for the room", () => {
    const rs = [line("Can’t Open Item", [{}]), line(DEFAULT_OPENED, [SCANNED]), line(DEFAULT_OPENED, [{}])];
    expect(roomProgress(rs)).toMatchObject({ total: 3, done: 2 });
    expect(checkRoom(room, rs.slice(0, 2)).canFinish).toBe(true);
    expect(checkRoom(room, rs).canFinish).toBe(false);
  });
});

describe("image placeholders and legitimate warnings", () => {
  it("several empty placeholders on a scanned item give one warning, not one each", () => {
    const r = line(DEFAULT_OPENED, [{ component: "Top Half", ...SCANNED }, { component: "Bottom Half" }, { component: "Section 3" }]);
    const w = irIssues(r);
    expect(w).toHaveLength(1);
    expect(w[0].message).toBe(`${r.equipmentId}: 2 image entries have no image number (Bottom Half, Section 3). Enter them or remove the entries.`);
  });
  it("an entry with readings but no image number keeps its own warning", () => {
    const r = line(DEFAULT_OPENED, [SCANNED, { component: "Bottom Half", possibleCause: "Loose Connection(s)", maxTemp: "118" }]);
    expect(irIssues(r).map((i) => i.message)).toEqual([`${r.equipmentId} (image 2, Bottom Half): Readings were entered but this image entry has no image number.`]);
  });
  it("a blank IR number alone never hides a To Do item", () => {
    const r = line(DEFAULT_OPENED, [{}, {}]);
    expect(irIssues(r)).toHaveLength(1);
    expect(issuesFor(r)[0].message).toMatch(/Not inspected yet \(To Do\)/);
  });
  it("a limited Opened value with a finding but no number is validated (not silently dropped)", () => {
    const r = line("Can’t Open Item", [{ possibleCause: "Loose Connection(s)", maxTemp: "" }]);
    expect(issuesFor(r).map((i) => i.field)).toContain("Max Temp");
  });
});

describe("exports keep the exact reason and notes", () => {
  it("Opened reason and exception note on both Excel formats", async () => {
    const a = line("Equipment Inaccessible Due to Obstruction(s) in Front of Panel", [{}], { kind: "not-scanned", note: "Pallets stacked in front" });
    const b = line("Can’t Open Item", [{}], null, "Cover bolted, no tools");
    const c = line("Item is Locked Out", [{}]);
    const data = ds([a, b, c]);
    const rows = buildGeneratorRows(data).map((r) => [r[4], r[13], r[14], r[8]]);
    expect(rows).toEqual([
      [a.equipmentId, "Equipment Inaccessible Due to Obstruction(s) in Front of Panel", "Pallets stacked in front", ""],
      [b.equipmentId, "Can’t Open Item", "Cover bolted, no tools", ""],
      [c.equipmentId, "Item is Locked Out", "", ""],
    ]);
    const { default: read } = await import("read-excel-file/universal");
    const inf = (await read(await workbookBlob(buildWorkbook(data, { customer: "C", facility: "F", inspectionDate: "2026-11-20", thermographers: "", generatedAt: new Date() })))) as { sheet: string; data: unknown[][] }[];
    const irt = (await read(await workbookBlob(buildIrtWorkbook(data)))) as { sheet: string; data: unknown[][] }[];
    const pick = (d: unknown[][], o: number, nCol: number) => d.slice(1).map((r) => [r[4], r[o], r[nCol] ?? ""]);
    expect(pick(inf[0].data, 13, 14)).toEqual(rows.map((r) => [r[0], r[1], r[2]]));
    expect(pick(irt[0].data, 11, 12)).toEqual(rows.map((r) => [r[0], r[1], r[2]]));
    const summary = inf[1].data.map((r) => r.map((v) => String(v ?? "")).join("|")).join("\n");
    expect(summary).not.toMatch(/To do/i);
  });
});
