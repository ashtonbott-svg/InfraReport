import { describe, expect, it } from "vitest";
import { groupGeneratorRows, parseGeneratorSheet } from "@/lib/reports/generator-import";

const head = ["Finding_Number", "ImageDate", "Location", "Humidity", "BackgroundTemp", "Equipment", "Component", "Distance", "PossibleCause", "ImageNum", "VisualNum", "Emissivity", "MaxTemp", "AmbientTemp", "DeltaT", "Severity", "Recommendation", "Opened?"];
const sheet = [
  ["Report Generator"], ["ClientName", "Sample Co"], ["Address", "1 Main St, Dallas, TX 75201"], ["InspectionDate", new Date("2026-11-09T00:00:00Z")],
  head,
  ["#1", 46335, "Main Room", 0.53, 63, "Panel L1", "Full Panel", 8, "NONE", 51, 51, 0.95, null, 73, -73, "Normal", "x", "Yes, Completely"],
  ["#2", 46335, "Main Room", 0.53, 63, "Switchboard\nSecond tenant", "Section 1", 7, "Loose Connection(s)", 53, 54, 0.95, 140, 73, 67, "Critical", "x", "Can't Open Item"],
  ["#3", 46335, "Main Room", 0.53, 63, "Switchboard", "Section 2", 7, "NONE", 55, 55, 0.95, null, 73, -73, "", "", "Item Was Off at Time of Scan"],
  ["#3b", null, null, null, null, null, null, null, null, null, null, null, null, null, 0, "0", "#N/A", "Yes, Completely"],
  ["#4", 46335, "Yard", 0.4, 70, "Disconnect", "Full Disconnect", 5, "NONE", 60, 60, 0.95, null, 80, -80, "", "", "Mystery"],
  ["#5", null, null, null, null, null, null, null, null, null, null, null, null, null, 0, "0", "#N/A", "Yes, Completely"],
];

describe("Generator workbook import", () => {
  it("reads values as written without inventing any", () => {
    const b = parseGeneratorSheet(sheet);
    expect(b).toMatchObject({ client: "Sample Co", address: "1 Main St, Dallas, TX 75201", date: "2026-11-09" });
    expect(b.rows).toHaveLength(4);
    expect(b.rows[0]).toMatchObject({ humidityPercent: "53", maxTemp: "", ir: "51", imageDate: "2026-11-09" });
    expect(b.rows[1]).toMatchObject({ equipment: "Switchboard", equipmentExtra: "Second tenant", maxTemp: "140", visual: "54", cause: "Loose Connection(s)" });
    expect(b.notes.join(" ")).toMatch(/Mystery/);
    expect(b.notes.join(" ")).toMatch(/Row #3b has no location/);
    expect(b.notes.join(" ")).not.toMatch(/Row #5/);
    expect(b.notes.join(" ")).not.toMatch(/Can't Open Item/);
  });
  it("groups consecutive components into one item of equipment per room", () => {
    const rooms = groupGeneratorRows(parseGeneratorSheet(sheet).rows);
    expect(rooms.map((r) => r.name)).toEqual(["Main Room", "Yard"]);
    expect(rooms[0].equipment.map((e) => [e.name, e.images.length])).toEqual([["Panel L1", 1], ["Switchboard", 2]]);
    expect(rooms[0].equipment[1].opened).toBe("Can't Open Item");
    expect(rooms[0].equipment[1].conflict).toMatch(/Item Was Off/);
    expect(rooms[0].equipment[1].extra).toBe("Second tenant");
  });
  it("refuses a workbook without the findings table", () => {
    expect(() => parseGeneratorSheet([["a"], ["b"]])).toThrow(/Finding_Number/);
  });
});
