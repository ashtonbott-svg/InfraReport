import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { planViews, newThermalImage, VIEW_PRESETS } from "@/lib/domain/thermal";
import { roomOrder, slotBetween, storeInitializer, type Store } from "@/lib/store/store";
import { ANY_BUILDING, checkExit, exteriorCheckId } from "@/lib/domain/site-visit";
import type { ExteriorCheck } from "@/lib/domain/types";

describe("multiple views of one equipment item", () => {
  const presets = Object.fromEntries(VIEW_PRESETS.map((p) => [p.key, p.components("Full Panel")]));
  it("presets", () => {
    expect(presets).toEqual({ full: ["Full Panel"], "top-bottom": ["Top Half", "Bottom Half"], "left-right": ["Left Side", "Right Side"], "main-bus": ["Main", "Bus"] });
  });
  it("single image -> Top & Bottom: renames the first view (keeps its readings) and adds one", () => {
    const a = newThermalImage({ component: "Full Panel", irImageNumber: "101", distance: "4", notes: "n" });
    expect(planViews([a], presets["top-bottom"])).toEqual({ rename: [{ id: a.id, component: "Top Half" }], add: ["Bottom Half"], removeEmpty: [], removeWithData: [] });
  });
  it("going back to fewer views lists filled views separately (they need confirmation)", () => {
    const a = newThermalImage({ component: "Top Half", irImageNumber: "101" });
    const b = newThermalImage({ component: "Bottom Half", irImageNumber: "105" });
    const c = newThermalImage({ component: "Section 3" });
    expect(planViews([a, b, c], presets.full)).toEqual({ rename: [{ id: a.id, component: "Full Panel" }], add: [], removeEmpty: [c.id], removeWithData: [b.id] });
  });
  it("three or more custom views", () => {
    const plan = planViews([], ["Section 1", "Section 2", "Section 3", "Section 4"]);
    expect(plan.add).toEqual(["Section 1", "Section 2", "Section 3", "Section 4"]);
  });
});

function phone(org = "org-cloud") {
  const st = createStore<Store>()(storeInitializer);
  st.setState({ currentOrgId: org });
  const s = st.getState();
  const cust = s.createCustomer({ name: "C", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const fac = s.createFacility({ customerId: cust, name: "F", address: "", city: "", state: "", postalCode: "", notes: "" });
  const insp = s.createInspection({ customerId: cust, facilityId: fac, date: "2026-11-18", inspectorIds: ["u1", "u2"], carryForward: false });
  const loc = st.getState().createRoomForInspection(insp, { building: "", name: "Room", area: "" });
  return { st, insp, loc };
}

describe("reordering equipment within a room", () => {
  it("move up / down / after, insert after; only the moved item changes", () => {
    const { st, insp, loc } = phone();
    const ids = ["A", "B", "C", "D"].map((n) => st.getState().addResult(insp, loc, { name: n, equipmentType: "Panel" }));
    const names = () => roomOrder(st.getState().results, { inspectionId: insp, locationId: loc }).map((r) => st.getState().equipment.find((e) => e.id === r.equipmentId)!.name).join("");
    const orders = () => new Map(st.getState().results.map((r) => [r.id, r.sortOrder]));
    expect(names()).toBe("ABCD");
    const before = orders();
    st.getState().moveResult(ids[3], "up");
    expect(names()).toBe("ABDC");
    const after = orders();
    expect([...after].filter(([id, v]) => before.get(id) !== v).map(([id]) => id)).toEqual([ids[3]]);
    st.getState().moveResult(ids[0], "down");
    expect(names()).toBe("BADC");
    st.getState().moveResult(ids[2], { after: null });
    expect(names()).toBe("CBAD");
    st.getState().moveResult(ids[2], { after: ids[3] });
    expect(names()).toBe("BADC");
    st.getState().addResult(insp, loc, { name: "E", equipmentType: "Panel", afterResultId: ids[1] });
    expect(names()).toBe("BEADC");
    expect(st.getState().moveResult(ids[1], "up")).toBe(false); // already first
  });
  it("positions between neighbours", () => {
    expect(slotBetween(undefined, undefined)).toBe(1000);
    expect(slotBetween(1, 2)).toBe(1.5);
    expect(slotBetween(5, undefined)).toBe(1005);
    expect(slotBetween(3, 3)).toBeNull();
  });
});

describe("front building photo reminder", () => {
  const ack = (building: string, inspectionId = "i"): ExteriorCheck => ({ id: exteriorCheckId(inspectionId, building), organizationId: "o", inspectionId, building, status: "camera", note: "", acknowledgedBy: "u", acknowledgedAt: "" });
  it("a teammate's acknowledgment covers the building on this phone; each building separately", () => {
    expect(checkExit(["", "Annex"], [], "i").missing).toEqual(["", "Annex"]);
    expect(checkExit(["", "Annex"], [], "i", [ack("")]).missing).toEqual(["Annex"]);
    expect(checkExit(["", "Annex"], [], "i", [ack(""), ack("Annex")]).allowed).toBe(true);
    expect(checkExit(["", "Annex"], [], "i", [ack("", "other")]).missing).toEqual(["", "Annex"]);
  });
  it("acknowledged before any room existed: covers the main building or the only building", () => {
    expect(checkExit([""], [], "i", [ack(ANY_BUILDING)]).allowed).toBe(true);
    expect(checkExit(["Plant 2"], [], "i", [ack(ANY_BUILDING)]).allowed).toBe(true);
    expect(checkExit(["Plant 2", "Plant 3"], [], "i", [ack(ANY_BUILDING)]).missing).toEqual(["Plant 2", "Plant 3"]);
  });
  it("same id for the same building on every phone", () => {
    expect(exteriorCheckId("insp-1", "Building A")).toBe(exteriorCheckId("insp-1", " building a "));
    expect(exteriorCheckId("insp-1", "")).toBe("xc-insp-1-main");
  });
  it("store: exception needs a reason; a phone photo acknowledges its building", () => {
    const { st, insp } = phone();
    expect(st.getState().acknowledgeExterior(insp, "", "exception", "")).toBe(false);
    expect(st.getState().acknowledgeExterior(insp, "", "exception", "Fenced off, no access")).toBe(true);
    expect(st.getState().exitCheck(insp).allowed).toBe(true);
    const b = phone();
    b.st.getState().addPhotoRecord({ id: "p1", inspectionId: b.insp, facilityId: "f", kind: "exterior", building: "", resultId: null, fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1, capturedAt: "" });
    expect(b.st.getState().exteriorChecks.map((c) => c.status)).toEqual(["photo"]);
  });
  it("device-only inspections keep their earlier behaviour (no shared acknowledgment written)", () => {
    const { st, insp } = phone("org-demo");
    st.getState().addPhotoRecord({ id: "p1", inspectionId: insp, facilityId: "f", kind: "exterior", building: "", resultId: null, fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1, capturedAt: "" });
    expect(st.getState().exteriorChecks).toEqual([]);
    expect(st.getState().exitCheck(insp).allowed).toBe(true);
  });
});

describe("primary thermographer (device rules)", () => {
  it("only assigned people; designation blocks field changes; auto-pick with one assignee", () => {
    const { st, insp } = phone();
    expect(st.getState().setPrimaryThermographer(insp, "stranger")).toBe(false);
    expect(st.getState().setPrimaryThermographer(insp, "u2")).toBe(true);
    expect(st.getState().setPrimaryThermographer(insp, "u1", { designate: true })).toBe(true);
    expect(st.getState().setPrimaryThermographer(insp, "u2")).toBe(false);
    expect(st.getState().inspections[0]).toMatchObject({ primaryThermographerId: "u1", primaryLocked: true });
    st.getState().updateInspection(insp, { inspectorIds: ["u2"] }); // u1 unassigned: primary cleared
    expect(st.getState().inspections[0]).toMatchObject({ primaryThermographerId: null, primaryLocked: false });
    st.getState().startSiteVisit(insp);
    expect(st.getState().inspections[0].primaryThermographerId).toBe("u2");
  });
});
