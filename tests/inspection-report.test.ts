import { describe, expect, it } from "vitest";
import { newThermalImage } from "@/lib/domain/thermal";
import { EMPTY_OVERRIDES } from "@/lib/domain/rules";
import type { ExportDataset } from "@/lib/domain/csv";
import type { InspectionResult, ThermalImage } from "@/lib/domain/types";
import { assessImage, buildInspectionReport, pageList, paginateInventory } from "@/lib/reports/inspection-report";
import { recommendationFor, severityForDeltaT } from "@/lib/reports/severity";
import { renderInspectionReportHtml } from "@/lib/reports/render-inspection-report";

const meta = { clientName: "C", facilityName: "", address: "A", inspectionDates: ["November 9, 2026"], thermographers: ["Ashton Bott"], company: { name: "Infinite Infrared", phone: "p", website: "w" }, scopeNotes: [] };
let n = 0;
function line(name: string, opened: string, images: Partial<ThermalImage>[], extra: Partial<InspectionResult> = {}): InspectionResult {
  n++;
  return { id: `r${n}`, organizationId: "o", inspectionId: "i", equipmentId: `e-${name}`, locationId: "l", opened, exception: null, confidence: "", reviewNotes: "",
    images: images.map((p) => newThermalImage({ component: "Full Panel", ...p })), overrides: { ...EMPTY_OVERRIDES }, source: "manual", sortOrder: n, createdAt: "", updatedAt: "", ...extra };
}
function ds(results: InspectionResult[]): ExportDataset {
  return {
    inspection: { id: "i", organizationId: "o", customerId: "c", facilityId: "f", date: "2026-11-09", inspectorIds: [], status: "Needs Review", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "" } as never,
    results,
    equipment: new Map(results.map((r) => [r.equipmentId, { id: r.equipmentId, organizationId: "o", facilityId: "f", locationId: "l", name: r.equipmentId.slice(2), equipmentType: "", defaultComponent: "", active: true, sortOrder: 1, createdAt: "" }])),
    locations: new Map([["l", { id: "l", organizationId: "o", facilityId: "f", building: "", name: "Main Electrical Room", area: "", sortOrder: 1 }]]),
    rooms: [{ id: "rc", organizationId: "o", inspectionId: "i", locationId: "l", humidity: "53", ambientTemp: "76", backgroundTemp: "63", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null }],
  };
}

describe("severity (Generator thresholds)", () => {
  it("bands: below 19 normal, below 62 potential, below 128 serious, otherwise critical", () => {
    expect([0, 18.9, 19, 61.9, 62, 127.9, 128, 300].map(severityForDeltaT)).toEqual(["normal", "normal", "potential", "potential", "serious", "serious", "critical", "critical"]);
  });
  it("Delta T is Max minus the effective ambient; a blank Max is never a temperature", () => {
    expect(assessImage(newThermalImage({ maxTemp: "202.7", possibleCause: "Loose Connection(s)" }), "76")).toEqual({ kind: "severity", severity: "serious", deltaT: 126.7 });
    expect(assessImage(newThermalImage({}), "76")).toEqual({ kind: "severity", severity: "normal", deltaT: null });
    expect(assessImage(newThermalImage({ possibleCause: "Exposed Conductor" }), "76")).toEqual({ kind: "visual-finding" });
    expect(assessImage(newThermalImage({ irImageNumber: "63" }), "73", "Item Was Off at Time of Scan")).toEqual({ kind: "not-evaluated", reason: "Equipment Off" });
    expect(assessImage(newThermalImage({ irImageNumber: "63" }), "73", "Can’t Open Item")).toEqual({ kind: "severity", severity: "normal", deltaT: null }); // surface scanned
  });
  it("recommendations come from the owner's Validation table", () => {
    expect(recommendationFor("Loose Connection(s)")).toBe("Inspect, disassemble, clean and reassemble to proper component torque.");
    expect(recommendationFor("NONE")).toBe("All components, under load, have no significant discrepancies.");
    expect(recommendationFor("Something new")).toBeNull();
  });
});

describe("report model", () => {
  const build = () => buildInspectionReport(ds([
    line("Panel L1", "Yes, Completely", [{ irImageNumber: "51", distance: "8" }]),
    line("Switchboard", "Yes, Completely", [{ component: "Section 1", irImageNumber: "53" }, { component: "Section 2", irImageNumber: "54", maxTemp: "120", possibleCause: "Suspect Overload" }]),
    line("Panel P4", "Yes, Completely", [{ component: "Circuit 39", irImageNumber: "80", maxTemp: "202.7", possibleCause: "Loose Connection(s)" }]),
    line("Disconnect 1", "Item Was Off at Time of Scan", [{}]),
    line("Cabinet", "Item Was Off at Time of Scan", [{ irImageNumber: "63" }]),
    line("Transformer P5", "Can’t Open Item", [{}]),
    line("Transformer 2", "Yes, Completely", [{ distance: "5" }]),
    line("Cover", "Yes, Completely", [{ irImageNumber: "90", possibleCause: "Exposed Conductor" }]),
  ]), meta);

  it("worst first by severity then Delta T, then the rest in room order; real page numbers", () => {
    const m = build();
    expect(m.entries.map((e) => `${e.page}:${e.equipment}/${e.component}`)).toEqual([
      // A visual finding has no severity until the reviewer sets one: it is shown above Potential.
      "4:Panel P4/Circuit 39", "5:Cover/Full Panel", "6:Switchboard/Section 2", "7:Panel L1/Full Panel", "8:Switchboard/Section 1", "9:Cabinet/Full Panel",
    ]);
    expect(m.counts).toEqual({ normal: 2, potential: 1, serious: 1, critical: 0, visualFindings: 1 });
    expect(m.pagesBySeverity).toEqual({ normal: [7, 8], potential: [6], serious: [4], critical: [] });
  });

  it("inventory keeps every item with its real status; nothing unscanned is called Normal", () => {
    const m = build();
    const status = Object.fromEntries(m.inventory[0].lines.map((l) => [l.equipment, l.status.kind === "severity" ? l.status.severity : l.status.kind === "not-evaluated" ? `not evaluated: ${l.status.reason}` : l.status.kind]));
    expect(status).toEqual({
      "Panel L1": "normal", Switchboard: "potential", "Panel P4": "serious", "Disconnect 1": "not evaluated: Equipment Off", Cabinet: "not evaluated: Equipment Off",
      "Transformer P5": "not evaluated: Unable to Open", "Transformer 2": "not-documented", Cover: "visual-finding",
    });
    expect(m.totals).toMatchObject({ equipment: 8, notEvaluated: 3, notDocumented: 1, images: 6 });
  });

  it("the reviewer is told about every gap instead of the report inventing values", () => {
    const msgs = build().review.map((r) => `${r.level}: ${r.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^blocker: Cover, Full Panel: "Exposed Conductor" was recorded without a Max Temp/),
      expect.stringMatching(/^blocker: Transformer 2 \(Main Electrical Room\) has no image number and no reason/),
    ]));
  });

  it("renders every page, escapes text, and the inventory paginates without losing rows", () => {
    const m = build();
    const html = renderInspectionReportHtml(m, { logo: "l.png", fronts: [], photos: () => ({}) });
    expect((html.match(/class="page"/g) ?? []).length).toBe(m.layout.totalPages);
    expect(html).toContain("Thermal Image #80 not uploaded yet");
    const rooms = Array.from({ length: 3 }, (_, i) => ({ roomId: `r${i}`, room: `Room ${i}`, lines: Array.from({ length: 20 }, (_, j) => ({ resultId: `${i}-${j}`, equipment: `<Item ${j}>`, components: ["Full Panel"], imageNumbers: ["1"], opened: "Yes, Completely", status: { kind: "severity" as const, severity: "normal" as const }, notes: "", pages: [1] })) }));
    const pages = paginateInventory(rooms, true);
    expect(pages.flat().flatMap((b) => b.lines).length).toBe(60);
    expect(pages.length).toBeGreaterThan(1);
    expect(renderInspectionReportHtml({ ...m, inventory: rooms }, { logo: "", fronts: [], photos: () => ({}) })).toContain("&lt;Item 3&gt;");
  });

  it("page lists compact runs", () => {
    expect(pageList([])).toBe("None");
    expect(pageList([4])).toBe("4");
    expect(pageList([5, 6, 7, 9, 11, 12])).toBe("5 to 7, 9, 11 to 12");
  });
});
