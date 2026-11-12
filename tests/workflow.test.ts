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

function customerFacility() {
  const customerId = S().createCustomer({ name: "Test Co", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const facilityId = S().createFacility({ customerId, name: "Plant 9", address: "", city: "", state: "", postalCode: "", notes: "" });
  return { customerId, facilityId };
}

describe("clean start", () => {
  beforeEach(() => S().resetDemoData());
  it("has no sample jobs and only the two thermographers", () => {
    const s = S();
    expect([s.customers, s.facilities, s.locations, s.equipment, s.inspections, s.results].every((x) => x.length === 0)).toBe(true);
    expect(s.users.map((u) => `${u.name} | ${u.certification}`)).toEqual([
      "Ashton Bott | Level III Certified Master Thermographer",
      "Justice Thompson | Level I Thermographer",
    ]);
    expect(s.organizations[0].name).toBe("Infinite Infrared LLC");
  });
});

describe("inspection workflow", () => {
  beforeEach(() => S().resetDemoData());

  it("creates customer, facility, inspection, rooms and equipment, then exports", () => {
    const { customerId, facilityId } = customerFacility();
    const inspectionId = S().createInspection({ customerId, facilityId, date: "2026-11-12", inspectorIds: ["user-ashton", "user-justice"], carryForward: true });
    const insp = S().inspections.find((i) => i.id === inspectionId)!;
    expect(insp.status).toBe("Draft");
    expect(insp.defaultEmissivity).toBe("0.95");
    expect(insp.inspectorIds).toEqual(["user-ashton", "user-justice"]);

    const room1 = S().createRoomForInspection(inspectionId, { building: "", name: "Electrical Room 1", area: "" }, { humidity: "45%", ambientTemp: "74", backgroundTemp: "73" });
    const room2 = S().createRoomForInspection(inspectionId, { building: "", name: "Electrical Room 2", area: "" }, { humidity: "50", ambientTemp: "80", backgroundTemp: "78" });
    const rc1 = S().rooms.find((r) => r.locationId === room1)!;
    expect(rc1.humidity).toBe("45");

    const p1 = S().addResult(inspectionId, room1, { name: "Panel P1", equipmentType: "Panel", irImageNumber: "1", visualImageNumber: "2", distance: "4 ft" });
    const p2 = S().addResult(inspectionId, room1, { name: "Panel P2", equipmentType: "Panel", distance: "6" });
    const t1 = S().addResult(inspectionId, room1, { name: "Transformer T1", equipmentType: "Other", irImageNumber: "5", visualImageNumber: "5", visualFromSinglePhoto: true, distance: "3" });
    S().addResult(inspectionId, room1, { name: "Disconnect D1", equipmentType: "Disconnect", opened: "Item Was Off at Time of Scan" });
    S().addResult(inspectionId, room2, { name: "SWGR-1", equipmentType: "Other" });
    expect(S().inspections.find((i) => i.id === inspectionId)?.status).toBe("In Progress");

    const res = (id: string) => S().results.find((r) => r.id === id)!;
    expect(res(p1).component).toBe("Full Panel");
    expect(res(t1).component).toBe("Full Transformer");
    expect(res(p1).opened).toBe("Yes, Completely");
    expect(res(p1).possibleCause).toBe("NONE");
    expect(res(p1).maxTemp).toBe("");
    expect([res(p1).distance, res(p2).distance, res(t1).distance]).toEqual(["4", "6", "3"]);

    S().updateResult(p1, { component: "Circuit 11", maxTemp: "131.7 °F", possibleCause: "Loose Connection(s)", problemNotes: "Lug hot" });
    S().setOverride(t1, "ambientTemp", "85");
    const dup = S().duplicateResult(p1)!;
    const dupRow = res(dup);
    expect(S().equipment.find((e) => e.id === dupRow.equipmentId)?.name).toBe("Panel P2");
    expect([dupRow.irImageNumber, dupRow.maxTemp, dupRow.distance, dupRow.possibleCause]).toEqual(["", "", "", "NONE"]);

    S().updateRoomConditions(rc1.id, { ambientTemp: "76" });

    const ds = datasetFor(inspectionId);
    const parsed = parseCsv(toCsv(buildGeneratorRows(ds)));
    expect(parsed).toHaveLength(7);
    expect(parsed.every((r) => r.length === 16)).toBe(true);
    const byName = Object.fromEntries(parsed.slice(1).map((r) => [r[4], r]));
    expect(byName["Panel P1"][6]).toBe("4"); // Distance stays in column 7 (Excel H)
    expect(byName["Transformer T1"][6]).toBe("3");
    expect(byName["Disconnect D1"][6]).toBe("");
    expect(byName["Panel P1"][12]).toBe("76");
    expect(byName["Panel P1"][11]).toBe("131.7");
    expect(byName["Disconnect D1"][11]).toBe(""); // NONE with no temp exports blank
    expect(byName["Transformer T1"][12]).toBe("85");
    expect(byName["Disconnect D1"][13]).toBe("Item Was Off at Time of Scan");
    expect(byName["SWGR-1"][2]).toBe("50");
    expect(parsed[1][0]).toBe("11/12/2026");

    const issues = validateInspection(ds, { allowedCauses: allowedCauses(S().organizations[0].settings) });
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("imports an inventory and a new inspection starts as a fresh scan", () => {
    const { customerId, facilityId } = customerFacility();
    const r = S().importInventory(facilityId, [
      { building: "Building A", room: "Electrical Room 1", name: "Panel P1", type: "Panel", component: "Full Panel", identifiers: "A-100" },
      { building: "Building A", room: "Electrical Room 1", name: "Transformer T1", type: "Transformer", component: "Full Transformer" },
      { building: "", room: "Pump Room", name: "Starter S3", type: "Starter", component: "Full Starter" },
      { building: "Building A", room: "electrical room 1 ", name: "Panel P2", type: "Panel", component: "Full Panel" },
    ], "old-report.pdf");
    expect(r).toEqual({ rooms: 2, equipment: 4, newRooms: 2 });
    const locs = S().locations.filter((l) => l.facilityId === facilityId);
    expect(locs.map((l) => `${l.building}|${l.name}`)).toEqual(["Building A|Electrical Room 1", "|Pump Room"]);
    const eq = S().equipment.filter((e) => e.facilityId === facilityId).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(eq.map((e) => e.name)).toEqual(["Panel P1", "Transformer T1", "Starter S3", "Panel P2"]);
    expect(eq[0].identifiers).toBe("A-100");
    expect(eq[0].importedFrom).toBe("old-report.pdf");

    const id = S().createInspection({ customerId, facilityId, date: "2026-11-12", inspectorIds: ["user-ashton"], carryForward: true });
    const rows = S().results.filter((x) => x.inspectionId === id).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.opened).toBe("Yes, Completely");
      expect(row.possibleCause).toBe("NONE");
      expect([row.maxTemp, row.distance, row.irImageNumber, row.visualImageNumber, row.problemNotes]).toEqual(["", "", "", "", ""]);
    }
    expect(S().rooms.filter((x) => x.inspectionId === id)).toHaveLength(2);
    expect(S().photos.filter((p) => p.inspectionId === id)).toHaveLength(0);

    // Importing again reuses existing rooms (case/space-insensitive)
    const again = S().importInventory(facilityId, [{ building: "Building A", room: "Electrical Room 1", name: "Panel P3", type: "Panel", component: "Full Panel" }], "x.csv");
    expect(again.newRooms).toBe(0);
  });

  it("flags non-numeric values and bad Opened values as errors", () => {
    const { customerId, facilityId } = customerFacility();
    const id = S().createInspection({ customerId, facilityId, date: "2026-11-12", inspectorIds: ["user-ashton"], carryForward: false });
    const room = S().createRoomForInspection(id, { building: "", name: "Room", area: "" });
    S().addResult(id, room, { name: "Panel P1", equipmentType: "Panel" });
    const ds = datasetFor(id);
    ds.results[0] = { ...ds.results[0], maxTemp: "hot", opened: "Open" };
    const issues = validateInspection(ds, { allowedCauses: ["NONE"] });
    expect(issues.filter((i) => i.severity === "error").map((i) => i.field)).toEqual(expect.arrayContaining(["Max Temp", "Opened"]));
  });

  it("isolates data by organization id", () => {
    const { customerId } = customerFacility();
    S().updateCustomer(customerId, { organizationId: "someone-else" } as never);
    expect(S().customers.find((c) => c.id === customerId)?.organizationId).toBe(S().currentOrgId);
  });
});

describe("sample data from earlier releases", () => {
  it("clears only the legacy sample records and anything attached to them", async () => {
    const { buildSeed: v2 } = await import("./fixtures/demo-seed-v2");
    const { migrateState } = await import("@/lib/store/store");
    const migrated = migrateState({ ...v2(), images: [], documents: [], photos: [], activeInspectionId: null } as never, 2);
    useStore.setState(migrated as never);
    const mine = S().createCustomer({ name: "Real Customer", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
    const fac = S().createFacility({ customerId: mine, name: "Real Plant", address: "", city: "", state: "", postalCode: "", notes: "" });
    const counts = S().clearDemoData();
    expect(counts).toEqual({ customers: 3, facilities: 3, inspections: 3, equipment: 13 });
    expect(S().customers.map((c) => c.name)).toEqual(["Real Customer"]);
    expect(S().facilities.map((f) => f.id)).toEqual([fac]);
    expect(S().results).toHaveLength(0);
    expect(S().equipment).toHaveLength(0);
  });
});
