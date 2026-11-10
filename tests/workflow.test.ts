/**
 * End-to-end workflow through the real store actions (the same code the UI
 * calls): customer -> facility -> inspection -> rooms -> equipment -> CSV.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useStore, allowedCauses } from "@/lib/store/store";
import { buildGeneratorRows, parseCsv, toCsv, type ExportDataset } from "@/lib/domain/csv";
import { validateInspection } from "@/lib/domain/validation";

const S = () => useStore.getState();

function datasetFor(inspectionId: string): ExportDataset {
  const s = S();
  return {
    inspection: s.inspections.find((i) => i.id === inspectionId)!,
    results: s.results.filter((r) => r.inspectionId === inspectionId),
    equipment: new Map(s.equipment.map((e) => [e.id, e])),
    locations: new Map(s.locations.map((l) => [l.id, l])),
    rooms: s.rooms.filter((r) => r.inspectionId === inspectionId),
  };
}

describe("inspection workflow", () => {
  beforeEach(() => S().resetDemoData());

  it("creates customer, facility, inspection, rooms and equipment, then exports", () => {
    const customerId = S().createCustomer({ name: "Test Co", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
    const facilityId = S().createFacility({ customerId, name: "Plant 9", address: "", city: "", state: "", postalCode: "", notes: "" });
    const inspectionId = S().createInspection({ customerId, facilityId, date: "2026-11-10", inspectorId: "user-1", carryForward: true });
    expect(S().inspections.find((i) => i.id === inspectionId)?.status).toBe("Draft");
    expect(S().inspections.find((i) => i.id === inspectionId)?.defaultEmissivity).toBe("0.95");

    const room1 = S().createRoomForInspection(inspectionId, { building: "", name: "Electrical Room 1", area: "" }, { humidity: "45%", ambientTemp: "74", backgroundTemp: "73", distance: "4 ft" });
    const room2 = S().createRoomForInspection(inspectionId, { building: "", name: "Electrical Room 2", area: "" }, { humidity: "50", ambientTemp: "80", backgroundTemp: "78", distance: "" });
    const rc1 = S().rooms.find((r) => r.locationId === room1)!;
    expect(rc1.humidity).toBe("45");
    expect(rc1.distance).toBe("4");

    const p1 = S().addResult(inspectionId, room1, { name: "Panel P1", equipmentType: "Panel", irImageNumber: "1", visualImageNumber: "2" });
    S().addResult(inspectionId, room1, { name: "Panel P2", equipmentType: "Panel" });
    const t1 = S().addResult(inspectionId, room1, { name: "Transformer T1", equipmentType: "Other", irImageNumber: "5", visualImageNumber: "5", visualFromSinglePhoto: true });
    S().addResult(inspectionId, room1, { name: "Disconnect D1", equipmentType: "Disconnect", opened: "Item Was Off at Time of Scan" });
    S().addResult(inspectionId, room2, { name: "SWGR-1", equipmentType: "Other" });
    expect(S().inspections.find((i) => i.id === inspectionId)?.status).toBe("In Progress");

    // presets (including inference from the name when the type is "Other")
    const comp = (id: string) => S().results.find((r) => r.id === id)!.component;
    expect(comp(p1)).toBe("Full Panel");
    expect(comp(t1)).toBe("Full Transformer");
    expect(S().results.find((r) => S().equipment.find((e) => e.id === r.equipmentId)?.name === "SWGR-1")?.component).toBe("Full Panel");

    // edit + override + duplicate
    S().updateResult(p1, { component: "Circuit 11", maxTemp: "131.7 °F", possibleCause: "Loose Connection(s)", problemNotes: "Lug hot" });
    S().setOverride(t1, "ambientTemp", "85");
    const dup = S().duplicateResult(p1)!;
    const dupRow = S().results.find((r) => r.id === dup)!;
    expect(S().equipment.find((e) => e.id === dupRow.equipmentId)?.name).toBe("Panel P2");
    expect(dupRow.irImageNumber).toBe("");
    expect(dupRow.maxTemp).toBe("");
    expect(dupRow.possibleCause).toBe("NONE");

    // room change carries down to rows without overrides only
    S().updateRoomConditions(rc1.id, { ambientTemp: "76" });

    const ds = datasetFor(inspectionId);
    const parsed = parseCsv(toCsv(buildGeneratorRows(ds)));
    expect(parsed).toHaveLength(7);
    const byName = Object.fromEntries(parsed.slice(1).map((r) => [r[4], r]));
    expect(byName["Panel P1"][12]).toBe("76");
    expect(byName["Panel P1"][11]).toBe("131.7");
    expect(byName["Panel P1"][5]).toBe("Circuit 11");
    expect(byName["Transformer T1"][12]).toBe("85");
    expect(byName["Transformer T1"][9]).toBe("5");
    expect(byName["Disconnect D1"][13]).toBe("Item Was Off at Time of Scan");
    expect(byName["SWGR-1"][2]).toBe("50");
    expect(byName["SWGR-1"][6]).toBe("");
    expect(parsed[1][0]).toBe("11/10/2026");

    const issues = validateInspection(ds, { allowedCauses: allowedCauses(S().organizations[0].settings) });
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(issues.some((i) => i.field === "Visual Image Number")).toBe(true);
  });

  it("carries forward facility inventory without copying readings", () => {
    const id = S().createInspection({ customerId: "cust-1", facilityId: "fac-1", date: "2027-03-09", inspectorId: "user-1", carryForward: true });
    const rows = S().results.filter((r) => r.inspectionId === id);
    expect(rows.length).toBe(S().equipment.filter((e) => e.facilityId === "fac-1" && e.active).length);
    expect(rows.every((r) => r.irImageNumber === "" && r.maxTemp === "" && r.possibleCause === "NONE")).toBe(true);
    expect(S().rooms.filter((r) => r.inspectionId === id).length).toBe(3);
  });

  it("flags non-numeric values and bad Opened values as errors", () => {
    const ds = datasetFor("insp-2");
    const r = ds.results[0];
    ds.results[0] = { ...r, maxTemp: "hot", opened: "Open" };
    const issues = validateInspection(ds, { allowedCauses: ["NONE"] });
    expect(issues.filter((i) => i.severity === "error").map((i) => i.field)).toEqual(expect.arrayContaining(["Max Temp", "Opened"]));
  });

  it("isolates data by organization id", () => {
    const s = S();
    expect(s.customers.every((c) => c.organizationId === s.currentOrgId)).toBe(true);
    S().updateCustomer("cust-1", { organizationId: "someone-else" } as never);
    expect(S().customers.find((c) => c.id === "cust-1")?.organizationId).toBe(s.currentOrgId);
  });
});
