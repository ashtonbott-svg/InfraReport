import { describe, expect, it } from "vitest";
import { buildIrtWorkbook, buildWorkbook, workbookBlob } from "@/lib/domain/xlsx-export";
import {
  GENERATOR_HEADERS, IRT_HEADERS, buildGeneratorRows, combineNotes, customerFacilityPart, exportFileName, inspectionStartDate, rowNotes, type ExportDataset,
} from "@/lib/domain/csv";
import { newThermalImage } from "@/lib/domain/thermal";
import { sampleDataset } from "./xlsx-export.test";

const meta = { customer: "AMNT", facility: "Mansfield", inspectionDate: "2026-11-18", thermographers: "Ashton Bott", generatedAt: new Date() };
type Book = { sheet: string; data: unknown[][] }[];
async function readBack(sheets: Parameters<typeof workbookBlob>[0]): Promise<Book> {
  const { default: read } = await import("read-excel-file/universal");
  return (await read(await workbookBlob(sheets))) as Book;
}

/** The Mansfield finding: Disconnect L2, IR 93, note typed on the thermal image entry. */
function mansfield(): ExportDataset {
  const ds = sampleDataset();
  const d1 = ds.results[3];
  ds.results.push({
    ...d1, id: "r-l2", equipmentId: "e-l2", exception: null, opened: "Yes, Completely", reviewNotes: "",
    images: [newThermalImage({ component: "Full Disconnect", irImageNumber: "93", possibleCause: "Loose Connection(s)", maxTemp: "118.4", notes: "RC 6, A Phase, Class 2" })],
    sortOrder: 99,
  });
  (ds.equipment as Map<string, unknown>).set("e-l2", { id: "e-l2", organizationId: "o", facilityId: "f", locationId: "l1", name: "Disconnect L2", equipmentType: "Disconnect", defaultComponent: "", active: true, sortOrder: 9, createdAt: "" });
  return ds;
}

describe("notes in exports", () => {
  it("the image note typed on a finding is in Review Notes (the Mansfield case)", () => {
    const rows = buildGeneratorRows(mansfield());
    const l2 = rows.find((r) => r[4] === "Disconnect L2")!;
    expect(l2[8]).toBe("93");
    expect(l2[14]).toBe("RC 6, A Phase, Class 2");
  });

  it("equipment notes on every row of the item, image notes on their own row, combined without duplicates", () => {
    const ds = sampleDataset();
    const p1 = ds.results[0];
    p1.reviewNotes = "Panel cover missing screws";
    p1.images[0].notes = "Circuit 4, B Phase";
    p1.images[1].notes = "panel cover missing  SCREWS"; // same text as the equipment note
    p1.photoNotes = [{ photoId: "ph", kind: "before-opening", note: "Breaker 12 found tripped", at: "" }];
    const rows = buildGeneratorRows(ds).filter((r) => r[4] === "Panel P1");
    expect(rows.map((r) => r[14])).toEqual([
      "Circuit 4, B Phase; Panel cover missing screws; Breaker 12 found tripped",
      "panel cover missing  SCREWS; Breaker 12 found tripped",
    ]);
  });

  it("notes are kept when Possible Cause is NONE and for equipment that was not scanned", () => {
    const ds = sampleDataset();
    ds.results[1].images[0].notes = "Main breaker 2000A, no anomaly";
    const rows = buildGeneratorRows(ds);
    expect(rows.find((r) => r[5] === "Main")![7]).toBe("NONE");
    expect(rows.find((r) => r[5] === "Main")![14]).toBe("Main breaker 2000A, no anomaly");
    expect(rows.find((r) => r[4] === "Disconnect D1")![14]).toBe("LOTO tag"); // inaccessible explanation
  });

  it("never invents text", () => {
    expect(combineNotes("", undefined, null, "  ")).toBe("");
    expect(rowNotes(sampleDataset().results[0], sampleDataset().results[0].images[0])).toBe("");
  });
});

describe("Infinite Infrared and IRT workbooks", () => {
  it("Infinite Infrared: 15 columns incl. Max Temp, no Confidence, three sheets", async () => {
    const book = await readBack(buildWorkbook(mansfield(), meta));
    expect(book.map((s) => s.sheet)).toEqual(["Generator Import", "Equipment Summary", "Column Map"]);
    const gen = book[0].data;
    expect(gen[0]).toEqual(GENERATOR_HEADERS);
    expect(gen[0]).toHaveLength(15);
    expect(gen[0]).toContain("Max Temp");
    expect(gen[0]).not.toContain("Confidence");
    const l2 = gen.find((r) => r[4] === "Disconnect L2")!;
    expect([l2[8], l2[11], l2[14]]).toEqual([93, 118.4, "RC 6, A Phase, Class 2"]);
    const map = book[2].data.flat().map(String).join("|");
    expect(map).not.toMatch(/Confidence\|/);
  });

  it("IRT: one Data sheet, 14 columns, no Max Temp, no Confidence, no branding; same rows in the same order", async () => {
    const ds = mansfield();
    const book = await readBack(buildIrtWorkbook(ds));
    expect(book.map((s) => s.sheet)).toEqual(["Data"]);
    const data = book[0].data;
    expect(data[0]).toEqual(IRT_HEADERS);
    expect(data[0]).toEqual(["Image Date", "Location", "Humidity", "Background Temp", "Equipment", "Component", "Distance", "Possible Cause",
      "IR Image Number", "Visual Image Number", "Emissivity", "Ambient Temp", "Opened", "Review Notes"]);
    for (const row of data) expect(row).toHaveLength(14);
    const all = data.flat().map((v) => String(v ?? "")).join(" ");
    expect(all).not.toMatch(/InfraReport|Infinite Infrared|118\.4/);
    const inf = buildGeneratorRows(ds);
    expect(data.length - 1).toBe(inf.length);
    expect(data.slice(1).map((r) => `${r[4]}|${r[5]}`)).toEqual(inf.map((r) => `${r[4]}|${r[5]}`));
    const p2 = data.find((r) => r[4] === "Panel P2")!;
    expect([p2[8], p2[9]]).toEqual(["0110", "0111"]); // leading zeros kept
    expect(data.find((r) => r[4] === "Disconnect L2")![13]).toBe("RC 6, A Phase, Class 2");
  });
});

describe("file names", () => {
  it("Infinite Infrared keeps InfraReport_Customer_Facility_Date; IRT has no product or company names", () => {
    expect(exportFileName("AMNT", "Burleson", "2026-11-18", "infinite", "xlsx")).toBe("InfraReport_AMNT_Burleson_2026-11-18.xlsx");
    expect(exportFileName("AMNT", "Mansfield", "2026-11-18", "irt", "xlsx")).toBe("AMNT_Mansfield_2026-11-18.xlsx");
  });
  it("sanitizes characters and does not repeat names", () => {
    expect(customerFacilityPart("AMNT", "AMNT Burleson")).toBe("AMNT_Burleson");
    expect(customerFacilityPart("AMNT Burleson", "Burleson")).toBe("AMNT_Burleson");
    expect(customerFacilityPart("Top Golf", "Top Golf")).toBe("Top_Golf");
    expect(customerFacilityPart("A/B: Co. <Inc>", "Plant #2 / North")).toBe("A_B_Co_Inc_Plant_2_North");
    expect(exportFileName("Café Ltd", "Zürich", "2026-11-18", "irt", "xlsx")).toBe("Cafe_Ltd_Zurich_2026-11-18.xlsx");
  });
  it("uses the inspection start date, not today, and the earliest date of a multi-day inspection", () => {
    const ds = sampleDataset();
    expect(inspectionStartDate(ds)).toBe("2026-11-12");
    expect(inspectionStartDate({ ...ds, rooms: [{ ...ds.rooms[0], imageDate: "2026-11-13" }] })).toBe("2026-11-12");
    expect(inspectionStartDate({ ...ds, rooms: [{ ...ds.rooms[0], imageDate: "2026-11-10" }] })).toBe("2026-11-10");
  });
});
