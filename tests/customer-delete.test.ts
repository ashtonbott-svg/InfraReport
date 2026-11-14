import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { planCustomerDeletion, useStore } from "@/lib/store/store";
import { deleteOrphanPhotoBlobs, getPhotoBlob, savePhotoBlob } from "@/lib/photos/photo-db";
import type { Photo } from "@/lib/domain/types";

const S = () => useStore.getState();

/** Customer with one facility, imported inventory, an inspection with results and photos. */
function makeCustomer(name: string, equipmentCount: number) {
  const customerId = S().createCustomer({ name, contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const facilityId = S().createFacility({ customerId, name: `${name} venue`, address: "", city: "", state: "", postalCode: "", notes: "" });
  S().importInventory(facilityId, Array.from({ length: equipmentCount }, (_, i) => ({
    building: "", room: i < equipmentCount / 2 ? "Electrical Room 1" : "Electrical Room 2", name: `Panel P${i + 1}`, type: "Panel", component: "Full Panel",
  })), "list.pdf");
  const inspectionId = S().createInspection({ customerId, facilityId, date: "2026-11-13", inspectorIds: ["user-ashton"], carryForward: true });
  const resultId = S().results.find((r) => r.inspectionId === inspectionId)!.id;
  S().updateThermalImage(resultId, S().results.find((r) => r.id === resultId)!.images[0].id, { distance: "4", irImageNumber: "101" });
  const photo = (id: string, kind: Photo["kind"]): Omit<Photo, "organizationId" | "savedAt"> => ({
    id, inspectionId, facilityId, kind, building: "", resultId: kind === "equipment" ? resultId : null, fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 3, capturedAt: "2026-11-13T12:00:00.000Z",
  });
  S().addPhotoRecord(photo(`${name}-ext`, "exterior"));
  S().addPhotoRecord(photo(`${name}-eq`, "equipment"));
  return { customerId, facilityId, inspectionId };
}

function snapshotFor(customerId: string) {
  const s = S();
  const fac = new Set(s.facilities.filter((f) => f.customerId === customerId).map((f) => f.id));
  const insp = new Set(s.inspections.filter((i) => i.customerId === customerId).map((i) => i.id));
  return JSON.stringify({
    customer: s.customers.filter((c) => c.id === customerId),
    facilities: s.facilities.filter((f) => fac.has(f.id)),
    locations: s.locations.filter((l) => fac.has(l.facilityId)),
    equipment: s.equipment.filter((e) => fac.has(e.facilityId)),
    inspections: s.inspections.filter((i) => insp.has(i.id)),
    rooms: s.rooms.filter((r) => insp.has(r.inspectionId)),
    results: s.results.filter((r) => insp.has(r.inspectionId)),
    photos: s.photos.filter((p) => insp.has(p.inspectionId)),
  });
}

describe("customer deletion", () => {
  beforeEach(() => S().resetDemoData());

  it("removes the customer and all its records, leaving other customers byte-identical", () => {
    const canton = makeCustomer("Top Golf Canton, Massachusetts", 28);
    const cranston = makeCustomer("Top Golf Cranston RI", 6);
    S().startSiteVisit(canton.inspectionId);
    const before = snapshotFor(canton.customerId);

    const plan = planCustomerDeletion(S(), cranston.customerId)!;
    expect(plan.counts).toEqual({ facilities: 1, rooms: 2, equipment: 6, inspections: 1, results: 6, photos: 2, documents: 0 });
    expect(plan.activeInspectionId).toBeNull();

    const removed = S().deleteCustomer(cranston.customerId)!;
    expect(removed.photoIds.sort()).toEqual(["Top Golf Cranston RI-eq", "Top Golf Cranston RI-ext"]);
    const s = S();
    expect(s.customers.map((c) => c.name)).toEqual(["Top Golf Canton, Massachusetts"]);
    expect(s.facilities.some((f) => f.customerId === cranston.customerId)).toBe(false);
    expect(s.locations.some((l) => l.facilityId === cranston.facilityId)).toBe(false);
    expect(s.equipment.some((e) => e.facilityId === cranston.facilityId)).toBe(false);
    expect(s.inspections.some((i) => i.id === cranston.inspectionId)).toBe(false);
    expect(s.results.some((r) => r.inspectionId === cranston.inspectionId)).toBe(false);
    expect(s.rooms.some((r) => r.inspectionId === cranston.inspectionId)).toBe(false);
    expect(s.photos.some((p) => p.inspectionId === cranston.inspectionId)).toBe(false);
    expect(s.reviewEvents.some((e) => e.inspectionId === cranston.inspectionId)).toBe(false);

    // Canton untouched: 28 equipment, rooms, thermographer, readings, photos, active visit
    expect(snapshotFor(canton.customerId)).toBe(before);
    expect(s.equipment.filter((e) => e.facilityId === canton.facilityId)).toHaveLength(28);
    expect(s.activeInspectionId).toBe(canton.inspectionId);
  });

  it("ends the active site visit when its customer is deleted", () => {
    const a = makeCustomer("Active Co", 2);
    S().startSiteVisit(a.inspectionId);
    expect(planCustomerDeletion(S(), a.customerId)!.activeInspectionId).toBe(a.inspectionId);
    S().deleteCustomer(a.customerId);
    expect(S().activeInspectionId).toBeNull();
    expect(S().inspections).toHaveLength(0);
  });

  it("returns null for an unknown customer and changes nothing", () => {
    makeCustomer("Keep", 2);
    const before = JSON.stringify(S());
    expect(S().deleteCustomer("nope")).toBeNull();
    expect(JSON.stringify(S())).toBe(before);
  });

  it("deletes orphaned photo binaries but keeps referenced and very recent ones", async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await savePhotoBlob("kept", new Blob([new Uint8Array(5)]), null);
    await savePhotoBlob("orphan", new Blob([new Uint8Array(5)]), null);
    await savePhotoBlob("fresh-orphan", new Blob([new Uint8Array(5)]), null);
    // age the first two
    const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open("infrareport-photos", 1); r.onsuccess = () => res(r.result); });
    await new Promise<void>((res) => {
      const t = db.transaction("blobs", "readwrite");
      const st = t.objectStore("blobs");
      for (const id of ["kept", "orphan"]) st.get(id).onsuccess = (e) => { const rec = (e.target as IDBRequest).result; st.put({ ...rec, savedAt: old }); };
      t.oncomplete = () => res();
    });
    const n = await deleteOrphanPhotoBlobs(new Set(["kept"]));
    expect(n).toBe(1);
    expect(await getPhotoBlob("kept")).toBeDefined();
    expect(await getPhotoBlob("orphan")).toBeUndefined();
    expect(await getPhotoBlob("fresh-orphan")).toBeDefined();
  });
});
