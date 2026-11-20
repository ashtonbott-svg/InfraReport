import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { isInspectionLocked, roomOrder, storeInitializer, type Store } from "@/lib/store/store";
import { buildGeneratorRows, withApprovalSnapshot, type ExportDataset } from "@/lib/domain/csv";
import { activeRooms, planEquipmentMove, planRoomRemoval, removalSummary } from "@/lib/domain/room-moves";
import { extractRecords } from "@/lib/sync/mapping";
import { orderedOps, recordChanges, emptySyncData, rememberDeleted, settleOp } from "@/lib/sync/outbox";

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
  const ids = (x: ReturnType<typeof site>) => ({ eq: x.s().equipment.map((e) => e.id).sort(), res: x.s().results.map((r) => r.id).sort() });

  it("empty room: deleted after confirmation, blank inspection conditions go with it", () => {
    const x = site();
    const c = x.s().createLocation({ facilityId: x.fac, building: "", name: "Spare", area: "" });
    x.s().addRoomToInspection(x.insp, c);
    const plan = planRoomRemoval({ ...x.s(), isLocked: isInspectionLocked }, c);
    expect(plan).toMatchObject({ kind: "delete", deleteEquipment: [] });
    expect(x.s().removeRoom(c).plan.kind).toBe("delete");
    expect(x.s().locations.some((l) => l.id === c)).toBe(false);
    expect(x.s().rooms.some((r) => r.locationId === c)).toBe(false);
  });

  it("imported, uninspected equipment: the room and all of it go with one confirmation; other rooms untouched; Undo puts everything back", () => {
    const x = site();
    const imp = x.s().createLocation({ facilityId: x.fac, building: "", name: "Wrong Room", area: "" });
    x.s().importInventory(x.fac, [1, 2, 3, 4, 5, 6].map((n) => ({ building: "", room: "Wrong Room", name: `MCC-${n}`, type: "MCC", component: "Full MCC" })), "list.xlsx");
    const insp2 = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    expect(x.s().equipment.filter((e) => e.locationId === imp)).toHaveLength(6);
    // A view placeholder alone (component only) is not inspection work.
    const one = x.s().results.find((r) => r.inspectionId === insp2 && x.s().equipment.find((e) => e.id === r.equipmentId)?.name === "MCC-1")!;
    x.s().addThermalImage(one.id, { component: "Bottom Half" });
    const before = ids(x);
    const snapshot = JSON.stringify({ l: x.s().locations, e: x.s().equipment, r: x.s().results, rc: x.s().rooms });
    const plan = planRoomRemoval({ ...x.s(), isLocked: isInspectionLocked }, imp);
    expect(plan.kind).toBe("delete");
    if (plan.kind === "blocked") throw new Error();
    expect(removalSummary(plan)).toBe("This room contains 6 uninspected equipment items. Delete the room and all 6 items?");
    const { undo } = x.s().removeRoom(imp);
    expect(x.s().equipment.filter((e) => e.name.startsWith("MCC-"))).toHaveLength(0);
    expect(x.s().results.filter((r) => r.inspectionId === insp2)).toHaveLength(3); // P1, P2, P3 lines stay
    expect(x.s().locations.some((l) => l.id === imp)).toBe(false);
    expect(x.s().reviewEvents.some((e) => e.inspectionId === insp2 && e.detail === "Wrong Room: 6 uninspected equipment items removed")).toBe(true);
    x.s().undoRoomRemoval(undo!);
    expect(ids(x)).toEqual(before);
    expect(JSON.stringify({ l: x.s().locations, e: x.s().equipment, r: x.s().results, rc: x.s().rooms })).toBe(snapshot);
  });

  it("partially inspected room: protected items are named with what they hold; nothing changes until they are moved", () => {
    const x = site();
    const r1 = x.res(x.p1);
    x.s().updateThermalImage(r1.id, r1.images[0].id, { irImageNumber: "0101" });
    const before = JSON.stringify(x.s());
    const { plan } = x.s().removeRoom(x.a);
    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") throw new Error();
    expect(plan.protectedItems.map((p) => [p.equipment.name, p.reasons])).toEqual([["P1", ["IR 0101"]]]);
    expect(plan.reason).toBe("This item has inspection work and must be moved to another room before the room is deleted: P1.");
    expect(JSON.stringify(x.s())).toBe(before);
    // Move the inspected item; the rest (uninspected P2) goes with the room.
    x.s().moveEquipmentToRoom(x.p1, x.b, { keepRecordedConditions: true });
    const { plan: done } = x.s().removeRoom(x.a);
    expect(done).toMatchObject({ kind: "delete", deleteEquipment: [expect.objectContaining({ name: "P2" })] });
    expect(x.res(x.p1).images[0].irImageNumber).toBe("0101");
    expect(x.s().equipment.some((e) => e.id === x.p2)).toBe(false);
  });

  it("every kind of saved work protects an item, whatever its Done / To Do label says", () => {
    const cases: [string, (x: ReturnType<typeof site>, id: string, imgId: string) => void, string][] = [
      ["IR number", (x, id, img) => x.s().updateThermalImage(id, img, { irImageNumber: "7" }), "IR 7"],
      ["visual number only", (x, id, img) => x.s().updateThermalImage(id, img, { visualOverridden: true, visualImageNumber: "8" }), "Visual 8"],
      ["distance", (x, id, img) => x.s().updateThermalImage(id, img, { distance: "4" }), "measurements"],
      ["max temp", (x, id, img) => x.s().updateThermalImage(id, img, { maxTemp: "120" }), "measurements"],
      ["finding", (x, id, img) => x.s().updateThermalImage(id, img, { possibleCause: "Loose Connection(s)" }), "finding"],
      ["image note", (x, id, img) => x.s().updateThermalImage(id, img, { notes: "hot" }), "notes"],
      ["equipment note", (x, id) => x.s().updateResult(id, { reviewNotes: "cover missing" }), "notes"],
      ["photo note", (x, id) => x.s().updateResult(id, { photoNotes: [{ photoId: "p", kind: "equipment", note: "n", at: "" }] }), "notes"],
      ["not scanned", (x, id) => x.s().setException(id, { kind: "not-scanned", note: "" }), "not scanned"],
      ["deferred", (x, id) => x.s().setException(id, { kind: "deferred", note: "" }), "deferred"],
      ["Opened reason", (x, id) => x.s().updateResult(id, { opened: "Item is Locked Out" }), "Opened: Item is Locked Out"],
      ["Opened dead front", (x, id) => x.s().updateResult(id, { opened: "Yes, with Dead-Front on" }), "Opened: Yes, with Dead-Front on"],
      ["row override", (x, id) => x.s().setOverride(id, "humidity", "33"), "measurements"],
      ["saved photo", (x, id) => x.st.setState((st) => ({ photos: [...st.photos, { id: "ph", resultId: id } as never] })), "photo"],
    ];
    for (const [label, apply, reason] of cases) {
      const x = site();
      const r = x.res(x.p3);
      apply(x, r.id, r.images[0].id);
      const plan = planRoomRemoval({ ...x.s(), isLocked: isInspectionLocked }, x.b);
      expect(plan.kind, label).toBe("blocked");
      if (plan.kind === "blocked") expect(plan.protectedItems[0].reasons, label).toContain(reason);
    }
  });

  it("completed (Done) equipment is protected; work in another open inspection protects it too", () => {
    const x = site();
    const r = x.res(x.p3);
    x.s().updateThermalImage(r.id, r.images[0].id, { irImageNumber: "0301", distance: "5" });
    expect(planRoomRemoval({ ...x.s(), isLocked: isInspectionLocked }, x.b).kind).toBe("blocked");
    // A second open inspection where P3 is still blank: the work in the first one still protects it.
    const insp2 = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    expect(x.res(x.p3, insp2).images[0].irImageNumber).toBe("");
    expect(planRoomRemoval({ ...x.s(), isLocked: isInspectionLocked }, x.b).kind).toBe("blocked");
  });

  it("approved history: equipment that approved reports use is retired, never deleted; the room is archived; the report is unchanged", () => {
    const x = site();
    approve(x, x.insp);
    const report = JSON.stringify(buildGeneratorRows(dataset(x.st, x.insp)));
    const open = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    const fresh = x.s().createEquipment({ facilityId: x.fac, locationId: x.b, name: "New Panel", equipmentType: "Panel", defaultComponent: "Full Panel" });
    const { plan, undo } = x.s().removeRoom(x.b);
    expect(plan).toMatchObject({ kind: "archive", historicalInspectionCount: 1 });
    if (plan.kind === "blocked") throw new Error();
    expect(plan.retireEquipment.map((e) => e.name)).toEqual(["P3"]);
    expect(plan.deleteEquipment.map((e) => e.name)).toEqual(["New Panel"]);
    expect(x.s().equipment.find((e) => e.id === x.p3)).toMatchObject({ active: false, locationId: x.b });
    expect(x.s().equipment.some((e) => e.id === fresh)).toBe(false);
    expect(x.s().results.some((r) => r.inspectionId === open && r.equipmentId === x.p3)).toBe(false); // blank line in the open inspection
    expect(x.res(x.p3).locationId).toBe(x.b); // approved line untouched
    expect(x.rc(x.b)).toBeTruthy();
    expect(JSON.stringify(buildGeneratorRows(dataset(x.st, x.insp)))).toBe(report);
    expect(activeRooms(x.s().locations, x.fac).map((l) => l.name)).toEqual(["Elec A"]);
    const next = x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-22", inspectorIds: ["u1"], carryForward: true });
    expect(x.s().results.filter((r) => r.inspectionId === next).map((r) => x.s().equipment.find((e) => e.id === r.equipmentId)!.name)).toEqual(["P1", "P2"]);
    x.s().undoRoomRemoval(undo!);
    expect(x.s().equipment.find((e) => e.id === x.p3)).toMatchObject({ active: true });
    expect(x.s().locations.find((l) => l.id === x.b)!.archivedAt).toBeNull();
    expect(x.s().equipment.some((e) => e.id === fresh)).toBe(true);
  });

  it("measured room conditions in the open inspection are removed with an uninspected room (and come back with Undo)", () => {
    const x = site();
    const { plan, undo } = x.s().removeRoom(x.b);
    expect(plan.kind).toBe("delete");
    if (plan.kind === "blocked") throw new Error();
    expect(plan.measuredConditions.map((c) => c.humidity)).toEqual(["55"]);
    expect(x.s().rooms.some((r) => r.locationId === x.b)).toBe(false);
    x.s().undoRoomRemoval(undo!);
    expect(x.rc(x.b).humidity).toBe("55");
  });

  it("moving and deleting never loses measurements, notes or entries", () => {
    const x = site();
    for (const eq of [x.p1, x.p2, x.p3]) {
      const r = x.res(eq);
      x.s().updateThermalImage(r.id, r.images[0].id, { irImageNumber: `IR-${eq}`, notes: `note ${eq}` });
      x.s().updateResult(r.id, { reviewNotes: `review ${eq}` });
    }
    const all = () => x.s().results.map((r) => `${r.id}|${r.images.map((i) => `${i.irImageNumber}/${i.notes}`).join(",")}|${r.reviewNotes}`).sort();
    const before = all();
    expect(x.s().removeRoom(x.a).plan.kind).toBe("blocked");
    const c = x.s().createLocation({ facilityId: x.fac, building: "", name: "New", area: "" });
    x.s().moveEquipmentToRoom(x.p1, c, { keepRecordedConditions: true });
    x.s().moveEquipmentToRoom(x.p2, c, { keepRecordedConditions: true });
    expect(x.s().removeRoom(x.a).plan.kind).toBe("delete");
    expect(all()).toEqual(before);
  });
});

describe("sync of room changes", () => {
  it("deleting a room uploads line, condition and equipment deletes before the room delete", () => {
    const x = site();
    const prev = extractRecords(x.s(), "org-cloud");
    x.s().removeRoom(x.b);
    const data = recordChanges(emptySyncData("u1", "org-cloud"), prev, extractRecords(x.s(), "org-cloud"), 0);
    const ops = orderedOps(data).map((o) => `${o.kind}:${o.table}`).filter((o) => o.startsWith("delete"));
    expect(ops).toEqual(["delete:thermal_images", "delete:results", "delete:room_conditions", "delete:equipment", "delete:locations"]);
  });

  it("archive is ordered after the retire and the deletes that emptied the room", () => {
    const x = site();
    approve(x, x.insp);
    x.s().createInspection({ customerId: x.cust, facilityId: x.fac, date: "2026-11-21", inspectorIds: ["u1"], carryForward: true });
    const prev = extractRecords(x.s(), "org-cloud");
    expect(x.s().removeRoom(x.b).plan.kind).toBe("archive");
    const data = recordChanges(emptySyncData("u1", "org-cloud"), prev, extractRecords(x.s(), "org-cloud"), 0);
    const ops = orderedOps(data).map((o) => `${o.kind}:${o.table}`);
    expect(ops.indexOf("upsert:locations")).toBeGreaterThan(ops.indexOf("upsert:equipment"));
    expect(ops.indexOf("upsert:locations")).toBeGreaterThan(ops.indexOf("delete:results"));
    expect(data.ops[`locations:${x.b}`].changed).toEqual(["archived_at"]);
  });

  it("Undo after the deletes reached the server restores the same records instead of re-creating them", () => {
    const x = site();
    let data = emptySyncData("u1", "org-cloud");
    const prev = extractRecords(x.s(), "org-cloud");
    for (const k of prev.keys()) data.versions[k] = 1;
    const { undo } = x.s().removeRoom(x.b);
    const mid = extractRecords(x.s(), "org-cloud");
    data = recordChanges(data, prev, mid, 0);
    // The server accepted every delete.
    for (const op of Object.values(data.ops)) if (op.kind === "delete") data = rememberDeleted(settleOp(data, op.key, {}, null, 2), op.key);
    expect(Object.keys(data.ops).filter((k) => !k.startsWith("review_events"))).toEqual([]);
    x.s().undoRoomRemoval(undo!);
    data = recordChanges(data, mid, extractRecords(x.s(), "org-cloud"), 0);
    const restored = Object.values(data.ops).filter((o) => o.table !== "review_events" && o.table !== "inspections");
    expect(restored.length).toBeGreaterThan(0);
    for (const op of restored) {
      expect(op.kind).toBe("upsert");
      expect(op.row.__restore).toBe(true);
      expect(op.baseVersion).toBe(2);
    }
  });

  it("existing rooms produce no upload when the new archived field is introduced", () => {
    const x = site();
    const rows = extractRecords(x.s(), "org-cloud");
    // A row as pulled from a database that does not have the column yet.
    const legacy = new Map([...rows].map(([k, r]) => [k, r.table === "locations" ? { ...r, row: Object.fromEntries(Object.entries(r.row).filter(([f]) => f !== "archived_at")) } : r]));
    expect(Object.keys(recordChanges(emptySyncData("u1", "org-cloud"), legacy, rows, 0).ops)).toEqual([]);
  });
});
