import { describe, expect, it } from "vitest";
import { buildWorkbook, typedCell, workbookBlob } from "@/lib/domain/xlsx-export";
import { GENERATOR_HEADERS, type ExportDataset } from "@/lib/domain/csv";
import { newThermalImage } from "@/lib/domain/thermal";
import { EMPTY_OVERRIDES } from "@/lib/domain/rules";
import { newSiteVisit } from "@/lib/domain/site-visit";
import type { Equipment, Inspection, InspectionResult, Location, InspectionRoomConditions } from "@/lib/domain/types";

const insp: Inspection = { id: "i1", organizationId: "o", customerId: "c", facilityId: "f", date: "2026-11-12", inspectorIds: ["u"], status: "In Progress", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "", siteVisit: newSiteVisit() };
const loc: Location = { id: "l1", organizationId: "o", facilityId: "f", building: "", name: "Electrical Room 1", area: "", sortOrder: 1 };
const room: InspectionRoomConditions = { id: "rc", organizationId: "o", inspectionId: "i1", locationId: "l1", humidity: "45", ambientTemp: "74", backgroundTemp: "73", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null };
const eq = (id: string, name: string): Equipment => ({ id, organizationId: "o", facilityId: "f", locationId: "l1", name, equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: 1, createdAt: "" });
let n = 0;
const res = (equipmentId: string, images: InspectionResult["images"], patch: Partial<InspectionResult> = {}): InspectionResult => ({
  id: `r${++n}`, organizationId: "o", inspectionId: "i1", equipmentId, locationId: "l1", images, opened: "Yes, Completely", exception: null,
  confidence: "", reviewNotes: "", overrides: { ...EMPTY_OVERRIDES }, source: "manual", sortOrder: n, createdAt: "", updatedAt: "", ...patch,
});

export function sampleDataset(): ExportDataset {
  const equipment = [eq("e1", "Panel P1"), eq("e2", "Switchboard MSB"), eq("e3", "Panel P2"), eq("e4", "Disconnect D1")];
  const results = [
    res("e1", [newThermalImage({ component: "Top Half", irImageNumber: "104", distance: "4" }), newThermalImage({ component: "Bottom Half", irImageNumber: "105", distance: "3" })]),
    res("e2", ["Main", "Bus", "Distribution Section 1", "Distribution Section 2"].map((c, i) => newThermalImage({ component: c, irImageNumber: String(201 + i), distance: "6" }))),
    res("e3", [newThermalImage({ component: "Full Panel", irImageNumber: "0110", visualOverridden: true, visualImageNumber: "0111", distance: "5", possibleCause: "Loose Connection(s)", maxTemp: "131.7" })]),
    res("e4", [newThermalImage({ component: "Full Disconnect" })], { opened: "Item is Locked Out", exception: { kind: "not-scanned", note: "LOTO tag", at: "" } }),
  ];
  return { inspection: insp, results, equipment: new Map(equipment.map((e) => [e.id, e])), locations: new Map([[loc.id, loc]]), rooms: [room] };
}

describe("Excel workbook export", () => {
  it("types cells: numbers, dates, text, image numbers with leading zeros kept as text", () => {
    expect(typedCell("Humidity", "45")).toEqual({ value: 45, type: "Number" });
    expect(typedCell("Distance", "")).toBeNull();
    expect(typedCell("IR Image Number", "104")).toEqual({ value: 104, type: "Number" });
    expect(typedCell("IR Image Number", "0104")).toEqual({ value: "0104", type: "String" });
    expect(typedCell("Image Date", "11/12/2026")?.type).toBe("Date");
    expect(typedCell("Opened", "Yes, Completely")).toEqual({ value: "Yes, Completely", type: "String" });
  });

  it("writes a real .xlsx with one Generator row per thermal image, read back cell by cell", async () => {
    const sheets = buildWorkbook(sampleDataset(), { customer: "C", facility: "F", inspectionDate: "2026-11-12", thermographers: "Ashton Bott", generatedAt: new Date() });
    const blob = await workbookBlob(sheets);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // ZIP container ("PK"), i.e. a real OOXML workbook
    const { default: read } = await import("read-excel-file/universal");
    const book = (await read(blob)) as { sheet: string; data: unknown[][] }[];
    expect(book.map((s) => s.sheet)).toEqual(["Generator Import", "Equipment Summary", "Column Map"]);
    const gen = book[0].data;
    expect(gen[0]).toEqual(GENERATOR_HEADERS);
    expect(gen).toHaveLength(1 + 2 + 4 + 1 + 1); // P1 x2, MSB x4, P2 x1, D1 x1
    for (const row of gen) expect(row).toHaveLength(16);
    const p1a = gen[1], p1b = gen[2];
    expect([p1a[4], p1a[5], p1a[6], p1a[8], p1a[9]]).toEqual(["Panel P1", "Top Half", 4, 104, 104]);
    expect([p1b[4], p1b[5], p1b[6], p1b[8], p1b[9]]).toEqual(["Panel P1", "Bottom Half", 3, 105, 105]);
    expect(gen.slice(3, 7).map((r) => r[5])).toEqual(["Main", "Bus", "Distribution Section 1", "Distribution Section 2"]);
    expect(gen.slice(3, 7).every((r) => r[4] === "Switchboard MSB")).toBe(true);
    const p2 = gen[7];
    expect([p2[7], p2[8], p2[9], p2[11]]).toEqual(["Loose Connection(s)", "0110", "0111", 131.7]);
    const d1 = gen[8];
    expect([d1[4], d1[8], d1[9], d1[11], d1[13]]).toEqual(["Disconnect D1", null, null, null, "Item is Locked Out"]);
    expect(p1a[0]).toBeInstanceOf(Date);
    expect((p1a[0] as Date).toISOString().slice(0, 10)).toBe("2026-11-12");
    expect([p1a[2], p1a[3], p1a[10], p1a[12]]).toEqual([45, 73, 0.95, 74]);
    expect(p1a[11]).toBeNull(); // NONE: Max Temp blank, never invented
    // Summary counts equipment once
    const summary = book[1].data;
    expect(summary).toHaveLength(5);
    expect(summary[1]).toEqual(["Electrical Room 1", "Panel P1", 2, "Top Half; Bottom Half", "Recorded", "Yes, Completely", null]);
    expect(summary[4][4]).toBe("Not scanned");
  });
});
