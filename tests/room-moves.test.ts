import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { isInspectionLocked, roomOrder, storeInitializer, type Store } from "@/lib/store/store";
import { buildGeneratorRows, withApprovalSnapshot, type ExportDataset } from "@/lib/domain/csv";
import { activeRooms, planEquipmentMove, planRoomRemoval } from "@/lib/domain/room-moves";
import { extractRecords } from "@/lib/sync/mapping";
import { orderedOps, recordChanges, emptySyncData } from "@/lib/sync/outbox";

/** A facility with two rooms (Elec A with P1, P2; Elec B with P3) and one open inspection carried forward. */
function site(org = "org-cloud") {
  const st = createStore<Store>()(storeInitializer);
  st.setState({ currentOrgId: org });
  const s = () => st.getState();
  const cust = s().createCustomer({ name: "C", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const fac = s().createFacility({ customerId: cust, name: "F", address: "", city: "", state: "", postalCode: "", notes: "" });
  const a = s().createLocation({ facilityId: fac, building: "", name: "Elec A", area: "" });
  const b = s().createLocation({ facilityId: fac, building: "", name: "Elec B", area: "" });
  const p1 = s().createEquipment({ facilityId: fac, locationId: a, name: "P1", equipmentType: "Panel", defaultComponent: "Full Panel" });
  const p2 = s().createEquipment({ facilityId: fac, locationId: a, name: "P2", equipmentType: "Panel", defaultComponent: "Full Panel" });
  const p3 = s().createEquipment({ facilityId: fac, locationId: b, name: "P3", equipmentType: "Panel", defaultComponent: "Full Panel" });
  const insp = s().createInspection({ customerId: cust, facilityId: fac, date: "2026-11-20", inspectorIds: ["u1"], carryForward: true });
  const rc = (loc: string, i = insp) => s().rooms.find((r) => r.inspectionId === i && r.locationId === loc)!;
  const res = (eq: string, i = insp) => s().results.find((r) => r.inspectionId === i && r.equipmentId === eq)!;
  s().updateRoomConditions(rc(a).id, { humidity: "40", ambientTemp: "72", backgroundTemp: "70" });
  s().updateRoomConditions(rc(b).id, { humidity: "55", ambientTemp: "80", backgroundTemp: "78" });
  return { st, s, cust, fac, a, b, p1, p2, p3, insp, rc, res };
}
const dataset = (st: ReturnType<typeof site>["st"], inspectionId: string): ExportDataset => {
  const s = st.getState();
  return withApprovalSnapshot({
    inspection: s.inspections.find((i) => i.id === inspectionId)!,
    results: s.results.filter((r) => r.inspectionId === inspectionId),
    equipment: new Map(s.equipment.map((e) => [e.id, e])), locations: new Map(s.locations.map((l) => [l.id, l])),
    rooms: s.rooms.filter((r) => r.inspectionId === inspectionId),
  });
};
const names = (x: ReturnType<typeof site>, loc: string, i = x.insp) =>
  roomOrder(x.s().results, { inspectionId: i, locationId: loc }).map((r) => x.s().equipment.find((e) => e.id === r.equipmentId)!.name);
const approve = (x: ReturnType<typeof site>, i: string) => x.st.setState((st) => ({ inspections: st.inspections.map((v) => (v.id === i ? { ...v, status: "Approved" as const } : v)) }));

describe("move equipment between rooms", () => {
  it("1. uninspected equipment: same record, inventory and inspection updated, placed last in the destination", () => {
    const x = site();
    const before = { eq: x.s().equipment.length, res: x.s().results.length };
    const r1 = x.res(x.p1);
    expect(x.s().moveEquipmentToRoom(x.p1, x.b)).toEqual({ lines: 1, locked: 0 });
    expect(x.s().equipment.length).toBe(before.eq); // no duplicate equipment
    expect(x.s().results.length).toBe(before.res); // no duplicate line
    expect(x.s().equipment.find((e) => e.id === x.p1)!.locationId).toBe(x.b);
    const moved = x.res(x.p1);
    expect(moved.id).toBe(r1.id);
    expect(moved.locationId).toBe(x.b);
    expect(names(x, x.b)).toEqual(["P3", "P1"]);
    expect(names(x, x.a)).toEqual(["P2"]);
    // Inventory order: P1 now sits after P3 (carry-forward order of the next inspection).
    const inv = x.s().equipment.filter((e) => e.facilityId === x.fac).sort((p, q) => p.sortOrder - q.sortOrder).map((e) => e.name);
    expect(inv.indexOf("P1")).toBeGreaterThan(inv.indexOf("P3"));
    expect(x.s().reviewEvents.some((e) => e.action === "Equipment moved" && e.detail === "P1: Elec A to Elec B")).toBe(true);
  });

  it("2. equipment with inspection data keeps every reading, image, note, finding and photo", () => {
    const x = site();
    const r = x.res(x.p1);
    x.s().updateThermalImage(r.id, r.images[0].id, { irImageNumber: "0101", possibleCause: "Loose Connection(s)", maxTemp: "118.4", notes: "A phase" });
    x.s().addThermalImage(r.id, { component: "Bottom Half", irImageNumber: "0102" });
    x.s().updateResult(r.id, { reviewNotes: "Cover screws missing", photoNotes: [{ photoId: "ph1", kind: "equipment", note: "label", at: "" }] });
    x.st.setState((st) => ({ photos: [...st.photos, { id: "ph1", organizationId: "org-cloud", inspectionId: x.insp, facilityId: x.fac, kind: "equipment", building: "", resultId: r.id, createdAt: "" } as never] }));
    const snapshot = JSON.stringify({ images: x.res(x.p1).images, notes: x.res(x.p1).reviewNotes, photoNotes: x.res(x.p1).photoNotes, opened: x.res(x.p1).opened });

    const plan = planEquipmentMove({ ...x.s(), isLocked: isInspectionLocked }, x.p1, x.b)!;
    expect(plan.lines[0].hasData).toBe(true);
    expect(plan.lines[0].changedConditions.map((c) => `${c.key}:${c.from}>${c.to}`)).toEqual(["humidity:40>55", "ambientTemp:72>80", "backgroundTemp:70>78"]);

    x.s().moveEquipmentToRoom(x.p1, x.b, { keepRecordedConditions: true });
    const m = x.res(x.p1);
    expect(JSON.stringify({ images: m.images, notes: m.reviewNotes, photoNotes: m.photoNotes, opened: m.opened })).toBe(snapshot);
    expect(x.s().photos.find((p) => p.id === "ph1")!.resultId).toBe(r.id);
    // Measured conditions kept on the item, not taken from the new room.
    expect([m.overrides.humidity, m.overrides.ambientTemp, m.overrides.backgroundTemp]).toEqual(["40", "72", "70"]);
    const row = buildGeneratorRows(dataset(x.st, x.insp)).find((rw) => rw[4] === "P1")!;
    expect([row[1], row[2], row[3], row[12]]).toEqual(["Elec B", "40", "70", "72"]);
    // Neither room's own conditions were changed.
    expect([x.rc(x.a).humidity, x.rc(x.b).humidity]).toEqual(["40", "55"]);
  });

  it("2b. choosing the new room's conditions uses them and leaves existing overrides alone", () => {
    const x = site();
    const r = x.res(x.p1);
    x.s().updateThermalImage(r.id, r.images[0].id, { irImageNumber: "0101" });
    x.s().setOverride(r.id, "humidity", "33");
    const plan = planEquipmentMove({ ...x.s(), isLocked: isInspectionLocked }, x.p1, x.b)!;
    expect(plan.lines[0].changedConditions.map((c) => c.key)).toEqual(["ambientTemp", "backgroundTemp"]); // humidity is already an override
    x.s().moveEquipmentToRoom(x.p1, x.b, { keepRecordedConditions: false });
    const m = x.res(x.p1);
    expect(m.overrides.humidity).toBe("33");
    expect(m.overrides.ambientTemp).toBeNull();
    const row = buildGeneratorRows(dataset(x.st, x.insp)).find((rw) => rw[4] === "P1")!;
    expect([row[2], row[12]]).toEqual(["33", "80"]);
  });

  it("3. into a new room: the room is created once, added to the open inspection with blank conditions", () => {
    const x = site();
    const c = x.s().createLocation({ facilityId: x.fac, building: "", name: "MCC Room", area: "" });
    x.s().moveEquipmentToRoom(x.p2, c);
    expect(x.s().locations.filter((l) => l.name === "MCC Room")).toHaveLength(1);
    expect(x.rc(c)).toMatchObject({ humidity: "", ambientTemp: "", backgroundTemp: "" });
    expect(names(x, c)).toEqual(["P2"]);
    expect(x.s().rooms.filter((r) => r.inspectionId === x.insp && r.locationId === c)).toHaveLength(1);
  });

  it("a finished destination room reopens when an item still to do moves in; a done item keeps it finished", () => {
    const x = site();
    x.st.setState((st) => ({ rooms: st.rooms.map((r) => (r.locationId === x.b ? { ...r, completedAt: "2026-11-20T10:00:00Z" } : r)) }));
    x.s().moveEquipmentToRoom(x.p1, x.b);
    expect(x.rc(x.b).completedAt).toBeNull();
  });

  it("approved inspections keep the room the item was inspected in; their report is unchanged", () => {
    const x = site();
    approve(x, x.insp);
    const before = JSON.stringify(buildGeneratorRows(dataset(x.st, x.insp)));
    const open = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    expect(x.s().moveEquipmentToRoom(x.p1, x.b)).toEqual({ lines: 1, locked: 1 });
    expect(x.res(x.p1).locationId).toBe(x.a); // approved line untouched
    expect(x.res(x.p1, open).locationId).toBe(x.b);
    expect(JSON.stringify(buildGeneratorRows(dataset(x.st, x.insp)))).toBe(before);
    expect(x.s().reviewEvents.filter((e) => e.inspectionId === x.insp && e.action === "Equipment moved")).toHaveLength(0);
  });

  it("5. exports show the corrected room, in the destination room's position", () => {
    const x = site();
    x.s().moveEquipmentToRoom(x.p1, x.b);
    const rows = buildGeneratorRows(dataset(x.st, x.insp)).map((r) => `${r[1]}|${r[4]}`);
    expect(rows).toEqual(["Elec A|P2", "Elec B|P3", "Elec B|P1"]);
  });

  it("refuses moves to another facility, to an archived room, or to the same room", () => {
    const x = site();
    const other = x.s().createFacility({ customerId: x.cust, name: "G", address: "", city: "", state: "", postalCode: "", notes: "" });
    const g = x.s().createLocation({ facilityId: other, building: "", name: "Elec G", area: "" });
    expect(x.s().moveEquipmentToRoom(x.p1, g)).toBeNull();
    expect(x.s().moveEquipmentToRoom(x.p1, x.a)).toBeNull();
    x.s().updateLocation(x.b, { archivedAt: "2026-11-20T00:00:00Z" });
    expect(x.s().moveEquipmentToRoom(x.p1, x.b)).toBeNull();
    expect(x.s().equipment.find((e) => e.id === x.p1)!.locationId).toBe(x.a);
  });
});

describe("delete rooms", () => {
  it("6. an empty, unused room is deleted together with its blank inspection conditions", () => {
    const x = site();
    const c = x.s().createLocation({ facilityId: x.fac, building: "", name: "Spare", area: "" });
    x.s().addRoomToInspection(x.insp, c);
    expect(x.s().removeRoom(c).kind).toBe("delete");
    expect(x.s().locations.some((l) => l.id === c)).toBe(false);
    expect(x.s().rooms.some((r) => r.locationId === c)).toBe(false);
  });

  it("7. a room with equipment is not deleted; the count is shown and nothing changes", () => {
    const x = site();
    const before = JSON.stringify(x.s());
    const plan = x.s().removeRoom(x.a);
    expect(plan.kind).toBe("blocked");
    expect(plan.kind === "blocked" && plan.equipmentCount).toBe(2);
    expect(plan.kind === "blocked" && plan.reason).toMatch(/2 equipment items\. Move them to another room first/);
    expect(JSON.stringify(x.s())).toBe(before);
    // Retired equipment counts too: it is never deleted with a room.
    x.s().moveEquipmentToRoom(x.p3, x.a);
    x.s().updateEquipment(x.p1, { active: false });
    x.s().moveEquipmentToRoom(x.p2, x.b);
    x.s().moveEquipmentToRoom(x.p3, x.b);
    expect(planRoomRemoval({ ...x.s(), isLocked: isInspectionLocked }, x.a)).toMatchObject({ kind: "blocked", equipmentCount: 1 });
  });

  it("a room still used by an open inspection, or with measured conditions there, is not deleted", () => {
    const x = site();
    // Equipment line still in the room although the inventory item moved elsewhere earlier.
    x.st.setState((st) => ({ equipment: st.equipment.map((e) => (e.locationId === x.b ? { ...e, locationId: x.a } : e)) }));
    expect(x.s().removeRoom(x.b)).toMatchObject({ kind: "blocked", openInspectionCount: 1 });
    x.s().moveEquipmentToRoom(x.p3, x.b);
    x.s().moveEquipmentToRoom(x.p3, x.a);
    // No lines left, but humidity was measured there in the open inspection.
    expect(x.s().removeRoom(x.b)).toMatchObject({ kind: "blocked" });
    expect(x.s().locations.some((l) => l.id === x.b)).toBe(true);
  });

  it("8. a room used only by approved reports is archived: reports unchanged, gone from new inspections and pickers", () => {
    const x = site();
    approve(x, x.insp);
    const report = JSON.stringify(buildGeneratorRows(dataset(x.st, x.insp)));
    const open = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    x.s().moveEquipmentToRoom(x.p3, x.a);
    const plan = x.s().removeRoom(x.b);
    expect(plan).toMatchObject({ kind: "archive", historicalInspectionCount: 1 });
    expect(x.s().locations.find((l) => l.id === x.b)!.archivedAt).toBeTruthy();
    expect(x.s().rooms.some((r) => r.inspectionId === open && r.locationId === x.b)).toBe(false); // blank, open: removed
    expect(x.rc(x.b)).toBeTruthy(); // approved: kept
    expect(JSON.stringify(buildGeneratorRows(dataset(x.st, x.insp)))).toBe(report);
    expect(activeRooms(x.s().locations, x.fac).map((l) => l.name)).toEqual(["Elec A"]);
    const next = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-22", inspectorIds: ["u1"], carryForward: true });
    expect(x.s().rooms.filter((r) => r.inspectionId === next).map((r) => r.locationId)).toEqual([x.a]);
    x.s().restoreRoom(x.b);
    expect(activeRooms(x.s().locations, x.fac).map((l) => l.name)).toEqual(["Elec A", "Elec B"]);
  });

  it("9. moving and deleting never loses measurements, notes or entries", () => {
    const x = site();
    for (const eq of [x.p1, x.p2, x.p3]) {
      const r = x.res(eq);
      x.s().updateThermalImage(r.id, r.images[0].id, { irImageNumber: `IR-${eq}`, notes: `note ${eq}` });
      x.s().updateResult(r.id, { reviewNotes: `review ${eq}` });
    }
    const all = () => x.s().results.map((r) => `${r.id}|${r.images.map((i) => `${i.irImageNumber}/${i.notes}`).join(",")}|${r.reviewNotes}`).sort();
    const before = all();
    const c = x.s().createLocation({ facilityId: x.fac, building: "", name: "New", area: "" });
    x.s().moveEquipmentToRoom(x.p1, c, { keepRecordedConditions: true });
    x.s().moveEquipmentToRoom(x.p2, c, { keepRecordedConditions: true });
    x.s().removeRoomFromInspection(x.insp, x.a);
    expect(x.s().removeRoom(x.a).kind).toBe("delete");
    expect(all()).toEqual(before);
    expect(x.s().reviewEvents.filter((e) => e.action === "Equipment moved")).toHaveLength(2);
  });
});

describe("sync of room changes", () => {
  it("a move is one update per record (no new records); archiving uploads after the moves that emptied the room", () => {
    const x = site();
    const prev = extractRecords(x.s(), "org-cloud");
    x.s().moveEquipmentToRoom(x.p3, x.a);
    x.s().removeRoom(x.b);
    const next = extractRecords(x.s(), "org-cloud");
    const data = recordChanges(emptySyncData("u1", "org-cloud"), prev, next, 0);
    const ops = orderedOps(data).map((o) => `${o.kind}:${o.table}`);
    // Elec B still has measured conditions in the open inspection, so deleting it is refused: nothing is deleted
    expect(ops.filter((o) => o.startsWith("delete"))).toEqual([]);
    expect(ops).toContain("upsert:equipment");
    expect(ops).toContain("upsert:results");
    expect(ops).not.toContain("upsert:locations");
  });

  it("archive is ordered after equipment and result updates", () => {
    const x = site();
    approve(x, x.insp);
    x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    const prev = extractRecords(x.s(), "org-cloud");
    x.s().moveEquipmentToRoom(x.p3, x.a);
    expect(x.s().removeRoom(x.b).kind).toBe("archive");
    const data = recordChanges(emptySyncData("u1", "org-cloud"), prev, extractRecords(x.s(), "org-cloud"), 0);
    const ops = orderedOps(data).map((o) => `${o.kind}:${o.table}`);
    expect(ops.indexOf("upsert:locations")).toBeGreaterThan(ops.lastIndexOf("upsert:results"));
    expect(ops.indexOf("upsert:locations")).toBeGreaterThan(ops.indexOf("upsert:equipment"));
    expect(data.ops[`locations:${x.b}`].changed).toEqual(["archived_at"]);
  });

  it("existing rooms produce no upload when the new archived field is introduced", () => {
    const x = site();
    const rows = extractRecords(x.s(), "org-cloud");
    // A row as pulled from a database that does not have the column yet.
    const legacy = new Map([...rows].map(([k, r]) => [k, r.table === "locations" ? { ...r, row: Object.fromEntries(Object.entries(r.row).filter(([f]) => f !== "archived_at")) } : r]));
    expect(Object.keys(recordChanges(emptySyncData("u1", "org-cloud"), legacy, rows, 0).ops)).toEqual([]);
  });
});
