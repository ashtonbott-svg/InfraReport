import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANY_BUILDING, checkExit, requiredBuildings, visitDayCount } from "@/lib/domain/site-visit";
import { migrateState, useStore } from "@/lib/store/store";
import type { Photo } from "@/lib/domain/types";

const S = () => useStore.getState();
let n = 0;
const photo = (inspectionId: string, building: string, kind: Photo["kind"] = "exterior"): Omit<Photo, "organizationId" | "savedAt"> => ({
  id: `p${++n}`, inspectionId, facilityId: "fac-x", kind, building, resultId: null, fileName: "front.jpg", mimeType: "image/jpeg", sizeBytes: 1000, capturedAt: new Date().toISOString(),
});

function newJob() {
  const customerId = S().createCustomer({ name: "Brim Laundry (fictional)", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const facilityId = S().createFacility({ customerId, name: "Main Plant", address: "", city: "", state: "", postalCode: "", notes: "" });
  const id = S().createInspection({ customerId, facilityId, date: "2026-11-09", inspectorId: "user-1", carryForward: false });
  return { id, facilityId };
}

describe("exterior photo requirements (pure rules)", () => {
  it("needs any exterior photo before rooms exist", () => {
    expect(requiredBuildings([], new Map())).toEqual([ANY_BUILDING]);
    expect(checkExit([ANY_BUILDING], [], "i").allowed).toBe(false);
    const p = { ...photo("i", "Some name"), organizationId: "o", savedAt: "" };
    expect(checkExit([ANY_BUILDING], [p], "i").allowed).toBe(true);
  });
  it("requires one photo per building used by rooms", () => {
    const locs = new Map([["a", { building: "" }], ["b", { building: "Building B" }], ["c", { building: "Building B " }]]);
    const req = requiredBuildings([{ locationId: "a" }, { locationId: "b" }, { locationId: "c" }], locs);
    expect(req).toEqual(["", "Building B"]);
    const main = { ...photo("i", ""), organizationId: "o", savedAt: "" };
    expect(checkExit(req, [main], "i")).toEqual({ allowed: false, missing: ["Building B"] });
  });
  it("ignores equipment photos and other inspections' photos", () => {
    const eq = { ...photo("i", "", "equipment"), organizationId: "o", savedAt: "" };
    const other = { ...photo("other", ""), organizationId: "o", savedAt: "" };
    expect(checkExit([""], [eq, other], "i").allowed).toBe(false);
  });
});

describe("site visit workflow (store)", () => {
  beforeEach(() => { S().resetDemoData(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T14:00:00")); });
  afterEach(() => vi.useRealTimers());

  it("start makes the inspection active and In Progress", () => {
    const { id } = newJob();
    S().startSiteVisit(id);
    const insp = S().inspections.find((i) => i.id === id)!;
    expect(S().activeInspectionId).toBe(id);
    expect(insp.siteVisit.state).toBe("active");
    expect(insp.siteVisit.sessions).toHaveLength(1);
    expect(insp.status).toBe("In Progress");
  });

  it("skipping the photo keeps working but blocks pause, finish and review", () => {
    const { id } = newJob();
    S().startSiteVisit(id);
    S().skipExteriorPrompt(id);
    const room = S().createRoomForInspection(id, { name: "Electrical Room 1", building: "", area: "" }, { humidity: "45", ambientTemp: "74", backgroundTemp: "73" });
    S().addResult(id, room, { name: "Panel P1", equipmentType: "Panel" });
    expect(S().inspections.find((i) => i.id === id)!.siteVisit.skippedExteriorPrompt).toBe(true);
    expect(S().pauseSiteVisit(id)).toEqual({ allowed: false, missing: [""] });
    expect(S().finishSiteVisit(id).allowed).toBe(false);
    expect(S().setInspectionStatus(id, "Needs Review")).toBe(false);
    const insp = S().inspections.find((i) => i.id === id)!;
    expect(insp.siteVisit.state).toBe("active");
    expect(insp.status).toBe("In Progress");
    expect(S().activeInspectionId).toBe(id);
  });

  it("a saved photo clears the requirement; pause keeps In Progress; resume next day keeps everything", () => {
    const { id, facilityId } = newJob();
    S().startSiteVisit(id);
    const room1 = S().createRoomForInspection(id, { name: "Electrical Room 1", building: "", area: "" }, { humidity: "45", ambientTemp: "74", backgroundTemp: "73" });
    const room2 = S().createRoomForInspection(id, { name: "Electrical Room 2", building: "", area: "" }, { humidity: "50", ambientTemp: "80", backgroundTemp: "78" });
    S().addResult(id, room1, { name: "Panel P1", equipmentType: "Panel" });
    S().addResult(id, room2, { name: "Panel P2", equipmentType: "Panel" });
    S().setLastActiveRoom(id, room2);
    S().addPhotoRecord({ ...photo(id, ""), facilityId });
    expect(S().exitCheck(id).allowed).toBe(true);

    expect(S().pauseSiteVisit(id).allowed).toBe(true);
    let insp = S().inspections.find((i) => i.id === id)!;
    expect(insp.siteVisit.state).toBe("paused");
    expect(insp.status).toBe("In Progress");
    expect(insp.siteVisit.sessions[0].endedAt).not.toBeNull();
    expect(S().activeInspectionId).toBeNull();

    vi.setSystemTime(new Date("2026-11-10T08:00:00"));
    S().startSiteVisit(id);
    insp = S().inspections.find((i) => i.id === id)!;
    expect(insp.siteVisit.state).toBe("active");
    expect(insp.siteVisit.sessions).toHaveLength(2);
    expect(visitDayCount(insp)).toBe(2);
    expect(insp.siteVisit.lastActiveLocationId).toBe(room2);
    expect(S().results.filter((r) => r.inspectionId === id)).toHaveLength(2);
    expect(S().exitCheck(id).allowed).toBe(true); // not requested again

    expect(S().finishSiteVisit(id).allowed).toBe(true);
    insp = S().inspections.find((i) => i.id === id)!;
    expect(insp.siteVisit.state).toBe("completed");
    expect(insp.status).toBe("Needs Review");
    expect(S().activeInspectionId).toBeNull();
  });

  it("tracks exterior photos per building on multi-building jobs", () => {
    const { id, facilityId } = newJob();
    S().startSiteVisit(id);
    S().addPhotoRecord({ ...photo(id, ""), facilityId }); // taken before any room existed
    expect(S().exitCheck(id).allowed).toBe(true);
    S().createRoomForInspection(id, { name: "MDF", building: "Building A", area: "" });
    S().createRoomForInspection(id, { name: "Boiler Room", building: "Building B", area: "" });
    expect(S().exitCheck(id).missing).toEqual(["Building A", "Building B"]);
    // Reassign the first photo to Building A, then photograph Building B
    S().setPhotoBuilding(S().photos.find((p) => p.inspectionId === id)!.id, "Building A");
    expect(S().exitCheck(id).missing).toEqual(["Building B"]);
    S().addPhotoRecord({ ...photo(id, "Building B"), facilityId });
    expect(S().exitCheck(id)).toEqual({ allowed: true, missing: [] });
  });

  it("starting again while active does not open a second session", () => {
    const { id } = newJob();
    S().startSiteVisit(id);
    S().startSiteVisit(id);
    expect(S().inspections.find((i) => i.id === id)!.siteVisit.sessions).toHaveLength(1);
  });

  it("migrates v1 saved data without losing records", () => {
    const v1 = {
      inspections: [
        { id: "a", status: "In Progress", organizationId: "o" },
        { id: "b", status: "Delivered", organizationId: "o" },
      ],
      results: [{ id: "r1" }],
    } as never;
    const out = migrateState(v1, 1);
    expect(out.inspections![0].siteVisit.state).toBe("not-started");
    expect(out.inspections![1].siteVisit.state).toBe("completed");
    expect(out.results).toHaveLength(1);
    expect(out.photos).toEqual([]);
    expect(out.activeInspectionId).toBeNull();
  });
});
