import { describe, expect, it } from "vitest";
import {
  GENERATOR_COLUMNS, GENERATOR_HEADERS, buildGeneratorRows, escapeCsvField, formatImageDate, parseCsv, toCsv, type ExportDataset,
} from "@/lib/domain/csv";
import { DEFAULT_EMISSIVITY, OPENED_VALUES, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import { EMPTY_OVERRIDES } from "@/lib/domain/rules";
import { newSiteVisit } from "@/lib/domain/site-visit";
import { newThermalImage } from "@/lib/domain/thermal";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Location } from "@/lib/domain/types";

const EXPECTED = [
  "Image Date", "Location", "Humidity", "Background Temp", "Equipment", "Component", "Distance", "Possible Cause",
  "IR Image Number", "Visual Image Number", "Emissivity", "Max Temp", "Ambient Temp", "Opened", "Confidence", "Review Notes",
];

const insp: Inspection = { id: "i1", organizationId: "o", customerId: "c", facilityId: "f", date: "2026-03-10", inspectorIds: ["u"], status: "In Progress", defaultEmissivity: DEFAULT_EMISSIVITY, notes: "", createdAt: "", updatedAt: "", siteVisit: newSiteVisit() };
const loc1: Location = { id: "l1", organizationId: "o", facilityId: "f", building: "", name: "Electrical Room 1", area: "", sortOrder: 1 };
const loc2: Location = { id: "l2", organizationId: "o", facilityId: "f", building: "Building B", name: "MCC Room", area: "", sortOrder: 2 };
const room1: InspectionRoomConditions = { id: "rc1", organizationId: "o", inspectionId: "i1", locationId: "l1", humidity: "45", ambientTemp: "74", backgroundTemp: "73", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null };
const room2: InspectionRoomConditions = { id: "rc2", organizationId: "o", inspectionId: "i1", locationId: "l2", humidity: "", ambientTemp: "", backgroundTemp: "", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null };
const eq = (id: string, name: string, locationId = "l1"): Equipment => ({ id, organizationId: "o", facilityId: "f", locationId, name, equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: 1, createdAt: "" });
let n = 0;
type ImageFields = { component?: string; irImageNumber?: string; visualImageNumber?: string; maxTemp?: string; possibleCause?: string; distance?: string };
/** One result with a single thermal image (the pre-release-5 shape, expressed in the new model). */
const res = (equipmentId: string, patch: Partial<InspectionResult> & ImageFields = {}): InspectionResult => {
  const { component = "Full Panel", irImageNumber = "", visualImageNumber, maxTemp = "", possibleCause = POSSIBLE_CAUSE_NONE, distance = "", ...rest } = patch;
  const vis = visualImageNumber ?? irImageNumber;
  return {
    id: `r${++n}`, organizationId: "o", inspectionId: "i1", equipmentId, locationId: "l1",
    images: [newThermalImage({ component, irImageNumber, visualOverridden: vis !== irImageNumber, visualImageNumber: vis, maxTemp, possibleCause, distance })],
    opened: "Yes, Completely", exception: null, confidence: "", reviewNotes: "", overrides: { ...EMPTY_OVERRIDES },
    source: "manual", sortOrder: n, createdAt: "", updatedAt: "", ...rest,
  };
};

function dataset(results: InspectionResult[], equipment: Equipment[]): ExportDataset {
  return { inspection: insp, results, equipment: new Map(equipment.map((e) => [e.id, e])), locations: new Map([[loc1.id, loc1], [loc2.id, loc2]]), rooms: [room1, room2] };
}

describe("Generator column layout", () => {
  it("has exactly 16 headers in the required order", () => {
    expect(GENERATOR_HEADERS).toEqual(EXPECTED);
    expect(GENERATOR_HEADERS).toHaveLength(16);
  });
  it("maps to the Generator Excel columns and never to O, P or Q", () => {
    const map = Object.fromEntries(GENERATOR_COLUMNS.map((c) => [c.header, c.excelColumn]));
    expect(map).toEqual({
      "Image Date": "B", Location: "C", Humidity: "D", "Background Temp": "E", Equipment: "F", Component: "G", Distance: "H",
      "Possible Cause": "I", "IR Image Number": "J", "Visual Image Number": "K", Emissivity: "L", "Max Temp": "M", "Ambient Temp": "N",
      Opened: "R", Confidence: null, "Review Notes": null,
    });
    const cols = GENERATOR_COLUMNS.map((c) => c.excelColumn);
    for (const forbidden of ["O", "P", "Q"]) expect(cols).not.toContain(forbidden);
  });
});

describe("CSV export", () => {
  const equipment = [eq("e1", "Panel P1"), eq("e2", "Panel P2"), eq("e3", "Transformer T1"), eq("e4", "Disconnect D1"), eq("e5", "Starter S1", "l2")];
  const results = [
    res("e1", { irImageNumber: "1021", visualImageNumber: "1022", maxTemp: "86.2", distance: "4" }),
    res("e2", { component: "Circuit 11", irImageNumber: "1023", visualImageNumber: "1024", maxTemp: "131.7", possibleCause: "Loose Connection(s)", reviewNotes: 'Lug "hot", re-torque', distance: "4" }),
    res("e3", { component: "Full Transformer", distance: "6", overrides: { ...EMPTY_OVERRIDES, humidity: "50" } }),
    res("e4", { component: "Full Disconnect", opened: "Item is Locked Out", distance: "4" }), // no image number: must be kept
    res("e5", { component: "Full Starter", locationId: "l2", opened: "Can’t Open Item" }),
  ];
  const ds = dataset(results, equipment);
  const rows = buildGeneratorRows(ds);
  const csv = toCsv(rows, { includeBom: true });
  const parsed = parseCsv(csv);

  it("round-trips: header + one line per equipment record, 16 fields each", () => {
    expect(parsed[0]).toEqual(EXPECTED);
    expect(parsed).toHaveLength(results.length + 1);
    for (const r of parsed) expect(r).toHaveLength(16);
  });
  it("starts with a UTF-8 BOM and uses CRLF", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")).toHaveLength(results.length + 2);
  });
  it("aligns every field with its header", () => {
    const row = Object.fromEntries(EXPECTED.map((h, i) => [h, parsed[2][i]]));
    expect(row).toEqual({
      "Image Date": "03/10/2026", Location: "Electrical Room 1", Humidity: "45", "Background Temp": "73", Equipment: "Panel P2",
      Component: "Circuit 11", Distance: "4", "Possible Cause": "Loose Connection(s)", "IR Image Number": "1023", "Visual Image Number": "1024",
      Emissivity: "0.95", "Max Temp": "131.7", "Ambient Temp": "74", Opened: "Yes, Completely", Confidence: "", "Review Notes": 'Lug "hot", re-torque',
    });
  });
  it("applies row overrides without touching other rows", () => {
    expect(parsed[3][2]).toBe("50"); // humidity override
    expect(parsed[3][6]).toBe("6"); // distance override
    expect(parsed[1][2]).toBe("45");
    expect(parsed[1][6]).toBe("4");
  });
  it("keeps rows without image numbers and leaves blanks in place", () => {
    const d1 = parsed[4];
    expect(d1[4]).toBe("Disconnect D1");
    expect(d1[8]).toBe("");
    expect(d1[9]).toBe("");
    expect(d1[11]).toBe(""); // max temp never invented
    expect(d1[13]).toBe("Item is Locked Out");
  });
  it("exports blank room conditions as blanks, building-qualified location", () => {
    const s1 = parsed[5];
    expect(s1[1]).toBe("Building B - MCC Room");
    expect([s1[2], s1[3], s1[6], s1[12]]).toEqual(["", "", "", ""]);
    expect(s1[13]).toBe("Can’t Open Item");
  });
  it("defaults Possible Cause to NONE and emissivity to 0.95", () => {
    expect(parsed[1][7]).toBe("NONE");
    expect(parsed.slice(1).every((r) => r[10] === "0.95")).toBe(true);
  });
  it("exports all eight Opened values exactly", () => {
    const eqs = OPENED_VALUES.map((_, i) => eq(`o${i}`, `Item ${i}`));
    const rs = OPENED_VALUES.map((o, i) => res(`o${i}`, { opened: o }));
    const out = parseCsv(toCsv(buildGeneratorRows(dataset(rs, eqs))));
    expect(out.slice(1).map((r) => r[13])).toEqual([...OPENED_VALUES]);
    expect(out.slice(1).every((r) => r.length === 16)).toBe(true);
  });
  it("rejects a row that is not 16 fields", () => {
    expect(() => toCsv([["a", "b"]])).toThrow();
  });
  it("escapes commas, quotes and newlines", () => {
    expect(escapeCsvField("Yes, Completely")).toBe('"Yes, Completely"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
    expect(escapeCsvField("")).toBe("");
  });
  it("formats image dates as MM/DD/YYYY", () => {
    expect(formatImageDate("2026-03-10")).toBe("03/10/2026");
  });
});
