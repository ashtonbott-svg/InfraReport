import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { onLockedEdit, storeInitializer, type Store } from "@/lib/store/store";

function phone(orgId: string) {
  const st = createStore<Store>()(storeInitializer);
  st.setState({ currentOrgId: orgId });
  const s = st.getState();
  const cust = s.createCustomer({ name: "C", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const fac = s.createFacility({ customerId: cust, name: "F", address: "", city: "", state: "", postalCode: "", notes: "" });
  const insp = s.createInspection({ customerId: cust, facilityId: fac, date: "2026-11-18", inspectorIds: [], carryForward: false });
  const loc = st.getState().createRoomForInspection(insp, { building: "", name: "Room", area: "" });
  const res = st.getState().addResult(insp, loc, { name: "Panel P1", equipmentType: "Panel", irImageNumber: "101" });
  return { st, insp, res, loc };
}

describe("approved shared inspections are read only on the phone", () => {
  it("refuses every kind of data change and reports it", () => {
    const { st, insp, res, loc } = phone("org-cloud");
    st.setState((s) => ({ inspections: s.inspections.map((i) => (i.id === insp ? { ...i, status: "Approved" as const } : i)) }));
    const told: string[] = [];
    onLockedEdit((i) => told.push(i.id));
    const s = st.getState();
    const img = s.results.find((r) => r.id === res)!.images[0];
    s.updateThermalImage(res, img.id, { irImageNumber: "999" });
    s.addThermalImage(res);
    s.updateResult(res, { opened: "No, Not Opened" });
    s.setException(res, { kind: "not-scanned", note: "x" });
    s.deleteResult(res);
    expect(s.addResult(insp, loc, { name: "P2", equipmentType: "Panel" })).toBe("");
    expect(s.createRoomForInspection(insp, { building: "", name: "New", area: "" })).toBe("");
    s.updateInspection(insp, { notes: "changed" });
    const room = st.getState().rooms.find((r) => r.inspectionId === insp)!;
    s.updateRoomConditions(room.id, { humidity: "50" });
    const after = st.getState();
    expect(after.results).toHaveLength(1);
    expect(after.results[0].images).toEqual([img]);
    expect(after.results[0].opened).not.toBe("No, Not Opened");
    expect(after.inspections[0].notes).toBe("");
    expect(after.rooms[0].humidity).toBe("");
    expect(told.length).toBeGreaterThan(5);
    // Assignments may still change; reopening unlocks it and records why.
    s.updateInspection(insp, { inspectorIds: ["u1"] });
    expect(st.getState().inspections[0].inspectorIds).toEqual(["u1"]);
    expect(s.reopenInspection(insp, "fix IR")).toBe(true);
    expect(st.getState().inspections[0]).toMatchObject({ status: "In Progress", reopenReason: "fix IR" });
    st.getState().updateThermalImage(res, img.id, { irImageNumber: "999" });
    expect(st.getState().results[0].images[0].irImageNumber).toBe("999");
    onLockedEdit(null);
  });

  it("device-only inspections keep working exactly as before", () => {
    const { st, insp, res } = phone("org-demo");
    st.setState((s) => ({ inspections: s.inspections.map((i) => (i.id === insp ? { ...i, status: "Approved" as const } : i)) }));
    const img = st.getState().results[0].images[0];
    st.getState().updateThermalImage(res, img.id, { irImageNumber: "555" });
    expect(st.getState().results[0].images[0].irImageNumber).toBe("555");
  });
});
