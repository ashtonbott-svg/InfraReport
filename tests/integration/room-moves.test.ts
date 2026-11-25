/**
 * Move equipment between rooms and delete rooms (migration 6) with two phones, real
 * accounts, the real device store and sync engine, against a real local Supabase stack.
 */
import { beforeAll, expect, it } from "vitest";
import { buildGeneratorRows } from "@/lib/domain/csv";
import { activeRooms } from "@/lib/domain/room-moves";
import { roomOrder } from "@/lib/store/store";
import { run, setupTwoPhones, sql, type Phone } from "./helpers";

run("Room moves and room deletion (real Supabase, two phones)", () => {
  let ashton: Phone, justice: Phone, inspId = "", facId = "", custId = "", roomA = "", roomB = "";

  beforeAll(async () => {
    ({ ashton, justice } = await setupTwoPhones());
    const a = ashton.s;
    custId = a.createCustomer({ name: "Cust", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
    facId = a.createFacility({ customerId: custId, name: "Plant", address: "", city: "", state: "", postalCode: "", notes: "" });
    roomA = a.createLocation({ facilityId: facId, building: "", name: "Elec A", area: "" });
    roomB = a.createLocation({ facilityId: facId, building: "", name: "Elec B", area: "" });
    for (const [name, loc] of [["P1", roomA], ["P2", roomA], ["P3", roomB]] as const) {
      ashton.s.createEquipment({ facilityId: facId, locationId: loc, name, equipmentType: "Panel", defaultComponent: "Full Panel" });
    }
    inspId = ashton.s.createInspection({ customerId: custId, facilityId: facId, date: "2026-11-20", inspectorIds: [ashton.userId, justice.userId], carryForward: true });
    const rc = (loc: string) => ashton.s.rooms.find((r) => r.inspectionId === inspId && r.locationId === loc)!.id;
    ashton.s.updateRoomConditions(rc(roomA), { humidity: "40", ambientTemp: "72", backgroundTemp: "70" });
    ashton.s.updateRoomConditions(rc(roomB), { humidity: "55", ambientTemp: "80", backgroundTemp: "78" });
    await ashton.sync();
    await justice.sync();
  }, 60_000);

  const eq = (p: Phone, name: string) => p.s.equipment.find((e) => e.facilityId === facId && e.name === name)!;
  const line = (p: Phone, name: string, i = inspId) => p.s.results.find((r) => r.inspectionId === i && r.equipmentId === eq(p, name).id)!;
  const names = (p: Phone, loc: string, i = inspId) => roomOrder(p.s.results, { inspectionId: i, locationId: loc }).map((r) => p.s.equipment.find((e) => e.id === r.equipmentId)!.name);
  const counts = async () => (await sql(`select (select count(*)::int from public.equipment where facility_id = $1 and deleted_at is null) eq,
    (select count(*)::int from public.results where inspection_id = $2 and deleted_at is null) res,
    (select count(*)::int from public.thermal_images where inspection_id = $2 and deleted_at is null) img`, [facId, inspId]))[0];

  it("1. a technician moves uninspected equipment in the field; the administrator's phone follows; no duplicates", async () => {
    const before = await counts();
    expect(justice.s.moveEquipmentToRoom(eq(justice, "P2").id, roomB)).toEqual({ lines: 1, locked: 0 });
    await justice.sync();
    await ashton.sync();
    const p2 = eq(ashton, "P2");
    expect((await sql("select location_id from public.equipment where id = $1", [p2.id]))[0].location_id).toBe(roomB);
    expect((await sql("select location_id from public.results where id = $1", [line(ashton, "P2").id]))[0].location_id).toBe(roomB);
    expect(p2.locationId).toBe(roomB);
    expect(names(ashton, roomB)).toEqual(["P3", "P2"]);
    expect(names(justice, roomB)).toEqual(["P3", "P2"]);
    expect(await counts()).toEqual(before);
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
  });

  it("2 and 3. equipment with readings moves into a new room; readings, images and notes are kept; both phones agree", async () => {
    const p1 = line(justice, "P1");
    justice.s.updateThermalImage(p1.id, p1.images[0].id, { irImageNumber: "0101", possibleCause: "Loose Connection(s)", maxTemp: "118.4", notes: "A phase" });
    justice.s.addThermalImage(p1.id, { component: "Bottom Half", irImageNumber: "0102" });
    justice.s.updateResult(p1.id, { reviewNotes: "Cover screws missing" });
    await justice.sync();
    await ashton.sync();
    const before = await counts();
    const mcc = ashton.s.createLocation({ facilityId: facId, building: "", name: "MCC Room", area: "" });
    ashton.s.moveEquipmentToRoom(eq(ashton, "P1").id, mcc, { keepRecordedConditions: true });
    await ashton.sync();
    await justice.sync();
    for (const p of [ashton, justice]) {
      const l = line(p, "P1");
      expect(l.id).toBe(p1.id);
      expect(l.locationId).toBe(mcc);
      expect(l.images.map((i) => i.irImageNumber)).toEqual(["0101", "0102"]);
      expect(l.images[0]).toMatchObject({ possibleCause: "Loose Connection(s)", maxTemp: "118.4", notes: "A phase" });
      expect(l.reviewNotes).toBe("Cover screws missing");
      expect([l.overrides.humidity, l.overrides.ambientTemp, l.overrides.backgroundTemp]).toEqual(["40", "72", "70"]);
      expect(p.s.locations.filter((x) => x.name === "MCC Room")).toHaveLength(1);
      expect(p.s.rooms.filter((r) => r.inspectionId === inspId && r.locationId === mcc)).toHaveLength(1);
    }
    expect(await counts()).toEqual(before);
    // 5. Exports on both phones show the corrected room and the readings' own conditions.
    const rows = (p: Phone) => buildGeneratorRows(p.dataset(inspId)).map((r) => `${r[1]}|${r[4]}|${r[5]}|${r[8]}|${r[2]}|${r[12]}`);
    expect(rows(ashton)).toEqual(rows(justice));
    expect(rows(ashton).filter((r) => r.includes("|P1|"))).toEqual(["MCC Room|P1|Full Panel|0101|40|72", "MCC Room|P1|Bottom Half|0102|40|72"]);
    expect(rows(ashton).find((r) => r.includes("|P3|"))).toBe("Elec B|P3|Full Panel||55|80");
  });

  it("6. an empty room is deleted after confirmation and disappears from the other phone", async () => {
    const spare = ashton.s.createLocation({ facilityId: facId, building: "", name: "Spare", area: "" });
    await ashton.sync(); await justice.sync();
    expect(justice.s.locations.some((l) => l.id === spare)).toBe(true);
    expect(ashton.s.removeRoom(spare).plan.kind).toBe("delete");
    await ashton.sync(); await justice.sync();
    expect((await sql("select deleted_at is not null as gone from public.locations where id = $1", [spare]))[0].gone).toBe(true);
    expect(justice.s.locations.some((l) => l.id === spare)).toBe(false);
  });

  it("imported uninspected equipment: a technician deletes the room and all 6 items in Field Mode; synced; Undo restores the same records on both phones", async () => {
    ashton.s.importInventory(facId, [1, 2, 3, 4, 5, 6].map((n) => ({ building: "", room: "Wrong Room", name: `MCC-${n}`, type: "MCC", component: "Full MCC" })), "inventory.xlsx");
    const wrong = ashton.s.locations.find((l) => l.name === "Wrong Room")!.id;
    for (const e of ashton.s.equipment.filter((x) => x.locationId === wrong)) ashton.s.addExistingEquipment(inspId, e.id);
    await ashton.sync(); await justice.sync();
    const eqIds = justice.s.equipment.filter((e) => e.locationId === wrong).map((e) => e.id);
    expect(eqIds).toHaveLength(6);
    const { plan, undo } = justice.s.removeRoom(wrong);
    expect(plan).toMatchObject({ kind: "delete" });
    await justice.sync(); await ashton.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    const db = async () => (await sql(`select (select count(*)::int from public.equipment where id = any($1) and deleted_at is null) eq,
      (select count(*)::int from public.equipment where id = any($1)) eq_rows,
      (select count(*)::int from public.results where equipment_id = any($1) and deleted_at is null) res,
      (select count(*)::int from public.locations where id = $2 and deleted_at is null) loc`, [eqIds, wrong]))[0];
    expect(await db()).toEqual({ eq: 0, eq_rows: 6, res: 0, loc: 0 }); // soft deleted: still recoverable
    for (const p of [ashton, justice]) {
      expect(p.s.equipment.some((e) => eqIds.includes(e.id))).toBe(false);
      expect(p.s.locations.some((l) => l.id === wrong)).toBe(false);
      expect(p.s.results.filter((r) => r.inspectionId === inspId).map((r) => p.s.equipment.find((e) => e.id === r.equipmentId)?.name).sort()).toEqual(["P1", "P2", "P3"]); // the other rooms are untouched
    }
    // Stale data cannot bring them back: Ashton refreshes his app and syncs again.
    ashton.boot(); await ashton.sync();
    expect(ashton.s.equipment.some((e) => eqIds.includes(e.id))).toBe(false);
    // Undo after the deletes reached the database: the same records come back.
    justice.s.undoRoomRemoval(undo!);
    await justice.sync(); await ashton.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    expect(justice.engine.data.conflicts).toEqual([]);
    expect(await db()).toEqual({ eq: 6, eq_rows: 6, res: 6, loc: 1 });
    expect(ashton.s.equipment.filter((e) => eqIds.includes(e.id))).toHaveLength(6);
    // And delete them for good.
    expect(ashton.s.removeRoom(wrong).plan.kind).toBe("delete");
    await ashton.sync(); await justice.sync();
    expect(await db()).toEqual({ eq: 0, eq_rows: 6, res: 0, loc: 0 });
    expect(justice.s.equipment.some((e) => eqIds.includes(e.id))).toBe(false);
  });

  it("offline second technician: a reading taken while the room was deleted elsewhere is kept, and can be kept for good", async () => {
    const off = ashton.s.createLocation({ facilityId: facId, building: "", name: "Offline Room", area: "" });
    const o1 = ashton.s.createEquipment({ facilityId: facId, locationId: off, name: "OFF-1", equipmentType: "Panel", defaultComponent: "Full Panel" });
    ashton.s.createEquipment({ facilityId: facId, locationId: off, name: "OFF-2", equipmentType: "Panel", defaultComponent: "Full Panel" });
    for (const e of ashton.s.equipment.filter((x) => x.locationId === off)) ashton.s.addExistingEquipment(inspId, e.id);
    await ashton.sync(); await justice.sync();
    // Ashton loses signal and records OFF-1.
    ashton.net.down = true;
    const r1 = line(ashton, "OFF-1");
    ashton.s.updateThermalImage(r1.id, r1.images[0].id, { irImageNumber: "0901", notes: "hot neutral" });
    await ashton.sync();
    // Justice still sees both items blank and deletes the room.
    expect(justice.s.removeRoom(off).plan).toMatchObject({ kind: "delete" });
    await justice.sync();
    // Ashton reconnects: his reading is not lost; he is asked.
    ashton.net.down = false;
    await ashton.sync(); await ashton.sync();
    expect(line(ashton, "OFF-1").images[0]).toMatchObject({ irImageNumber: "0901", notes: "hot neutral" });
    expect(ashton.s.equipment.some((e) => e.id === o1)).toBe(true);
    expect(ashton.s.locations.some((l) => l.id === off)).toBe(true);
    const asked = ashton.engine.data.conflicts.filter((c) => c.field === "__deleted").map((c) => c.table).sort();
    expect(asked).toEqual(expect.arrayContaining(["equipment", "locations", "results"]));
    for (const c of [...ashton.engine.data.conflicts]) ashton.engine.resolveConflict(c.id, "mine");
    await ashton.sync(); await ashton.sync(); await justice.sync();
    expect(Object.values(ashton.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    const row = (await sql(`select r.deleted_at r_del, e.deleted_at e_del, l.deleted_at l_del, t.ir_image_number ir, t.notes from public.results r
      join public.equipment e on e.id = r.equipment_id join public.locations l on l.id = r.location_id
      join public.thermal_images t on t.result_id = r.id and t.deleted_at is null where r.id = $1`, [r1.id]))[0];
    expect(row).toEqual({ r_del: null, e_del: null, l_del: null, ir: "0901", notes: "hot neutral" });
    expect(line(justice, "OFF-1").images[0].irImageNumber).toBe("0901");
    expect(justice.s.locations.some((l) => l.id === off)).toBe(true);
    // OFF-1 is now protected; move it and the room can go (OFF-2 stays deleted).
    expect(justice.s.removeRoom(off).plan).toMatchObject({ kind: "blocked", protectedItems: [expect.objectContaining({ reasons: ["IR 0901", "notes"] })] });
    justice.s.moveEquipmentToRoom(o1, roomA, { keepRecordedConditions: true });
    expect(justice.s.removeRoom(off).plan.kind).toBe("delete");
    await justice.sync(); await ashton.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    expect(line(ashton, "OFF-1")).toMatchObject({ locationId: roomA });
  });

  it("the last room of an inspection can be deleted with its uninspected items; the job, customer and other phone stay consistent", async () => {
    const job = ashton.s.createInspection({ customerId: custId, facilityId: facId, date: "2026-12-01", inspectorIds: [ashton.userId, justice.userId], carryForward: false });
    const only = ashton.s.createRoomForInspection(job, { building: "", name: "Only Room", area: "" }, { humidity: "55", ambientTemp: "55", backgroundTemp: "55" });
    for (const nm of ["IMP-1", "IMP-2", "IMP-3"]) ashton.s.addResult(job, only, { name: nm, equipmentType: "Panel" });
    await ashton.sync(); await justice.sync();
    expect(justice.s.rooms.filter((r) => r.inspectionId === job)).toHaveLength(1);
    const { plan, undo } = justice.s.removeRoom(only);
    expect(plan).toMatchObject({ kind: "delete", deleteEquipment: expect.arrayContaining([expect.objectContaining({ name: "IMP-1" })]) });
    await justice.sync(); await ashton.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    for (const p of [ashton, justice]) {
      expect(p.s.rooms.filter((r) => r.inspectionId === job)).toHaveLength(0);
      expect(p.s.results.filter((r) => r.inspectionId === job)).toHaveLength(0);
      expect(p.s.inspections.some((i) => i.id === job)).toBe(true);
    }
    const db = (await sql(`select (select count(*)::int from public.inspections where id = $1 and deleted_at is null) insp,
      (select count(*)::int from public.customers where id = $2 and deleted_at is null) cust,
      (select count(*)::int from public.room_conditions where inspection_id = $1 and deleted_at is null) rooms,
      (select count(*)::int from public.results where inspection_id = $1 and deleted_at is null) lines,
      (select count(*)::int from public.locations where id = $3 and deleted_at is null) loc`, [job, custId, only]))[0];
    expect(db).toEqual({ insp: 1, cust: 1, rooms: 0, lines: 0, loc: 0 });
    // Undo after sync brings it back everywhere; a stale reload does not resurrect it after the second delete.
    justice.s.undoRoomRemoval(undo!);
    await justice.sync(); await ashton.sync();
    expect(ashton.s.results.filter((r) => r.inspectionId === job)).toHaveLength(3);
    justice.s.removeRoom(only);
    await justice.sync(); ashton.boot(); await ashton.sync();
    expect(ashton.s.rooms.filter((r) => r.inspectionId === job)).toHaveLength(0);
    expect(justice.engine.data.conflicts).toEqual([]);
  });

  it("7. partially inspected room: only the inspected item is protected; the database refuses unsafe deletes too", async () => {
    const p3 = line(justice, "P3");
    justice.s.updateThermalImage(p3.id, p3.images[0].id, { irImageNumber: "0301" });
    await justice.sync(); await ashton.sync();
    const { plan } = ashton.s.removeRoom(roomB);
    expect(plan.kind).toBe("blocked");
    if (plan.kind !== "blocked") throw new Error();
    expect(plan.protectedItems.map((p) => p.equipment.name)).toEqual(["P3"]);
    // An older app (or a direct request) is refused by the database as well.
    const { error } = await ashton.sb.from("locations").update({ deleted_at: new Date().toISOString() }).eq("id", roomB);
    expect(error?.message).toMatch(/Room still has 2 equipment item\(s\)/);
    const { error: e2 } = await ashton.sb.from("equipment").update({ deleted_at: new Date().toISOString() }).eq("id", eq(ashton, "P2").id);
    expect(e2?.message).toMatch(/still has a line in an open inspection/);
    expect((await sql("select deleted_at, archived_at from public.locations where id = $1", [roomB]))[0]).toEqual({ deleted_at: null, archived_at: null });
  });

  it("8. a room used by an approved report is archived, not deleted; the approved report is unchanged on both phones", async () => {
    // Site visit finished (exterior photos are a separate, phone-only step).
    for (const p of [justice, ashton]) p.store.setState((st) => ({ inspections: st.inspections.map((i) => (i.id === inspId ? { ...i, siteVisit: { ...i.siteVisit, state: "completed" as const } } : i)) }));
    expect(justice.s.setInspectionStatus(inspId, "Needs Review")).toBe(true);
    await justice.sync(); await ashton.sync();
    ashton.s.setInspectionStatus(inspId, "Approved");
    await ashton.sync(); await justice.sync();
    expect((await sql("select status from public.inspections where id = $1", [inspId]))[0].status).toBe("Approved");
    expect(justice.s.inspections.find((i) => i.id === inspId)!.status).toBe("Approved");
    const approved = (p: Phone) => buildGeneratorRows(p.dataset(inspId)).map((r) => r.join("|"));
    const report = approved(ashton);
    expect(approved(justice)).toEqual(report);
    const next = ashton.s.createInspection({ customerId: custId, facilityId: facId, date: "2027-11-20", inspectorIds: [justice.userId], carryForward: true });
    await ashton.sync(); await justice.sync();
    // Empty Elec B in the inventory and in the new inspection.
    for (const n of ["P2", "P3"]) expect(justice.s.moveEquipmentToRoom(eq(justice, n).id, roomA)).toEqual({ lines: 1, locked: 1 });
    expect(line(justice, "P3").locationId).toBe(roomB); // approved line untouched
    expect(justice.s.removeRoom(roomB).plan).toMatchObject({ kind: "archive", historicalInspectionCount: 1 });
    await justice.sync(); await ashton.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    const db = (await sql("select deleted_at, archived_at from public.locations where id = $1", [roomB]))[0];
    expect(db.deleted_at).toBeNull();
    expect(db.archived_at).not.toBeNull();
    for (const p of [ashton, justice]) {
      expect(approved(p)).toEqual(report);
      expect(activeRooms(p.s.locations, facId).map((l) => l.name)).toEqual(["Elec A", "MCC Room"]);
      expect(p.s.rooms.some((r) => r.inspectionId === next && r.locationId === roomB)).toBe(false);
      expect(names(p, roomA, next)).toEqual(["OFF-1", "P2", "P3"]);
    }
    expect((await sql("select count(*)::int n from public.results where inspection_id = $1 and location_id = $2 and deleted_at is null", [inspId, roomB]))[0].n).toBe(2); // P2 and P3 were inspected there
    // Equipment that the approved report uses cannot be deleted, even by a direct request.
    const { error: delErr } = await ashton.sb.from("equipment").update({ deleted_at: new Date().toISOString() }).eq("id", eq(ashton, "P3").id);
    expect(delErr?.message).toMatch(/part of an approved report/);
    // A stale phone cannot put equipment back into the archived room.
    const { error } = await ashton.sb.from("equipment").update({ location_id: roomB }).eq("id", eq(ashton, "P2").id);
    expect(error?.message).toMatch(/deleted or archived/);
  });

  it("concurrent: one phone edits a line while the other moves its equipment; both changes survive", async () => {
    const next = ashton.s.inspections.find((i) => i.date === "2027-11-20")!.id;
    justice.net.down = true;
    const l = line(justice, "P3", next);
    justice.s.updateThermalImage(l.id, l.images[0].id, { irImageNumber: "0301", notes: "hot lug" });
    ashton.s.moveEquipmentToRoom(eq(ashton, "P3").id, ashton.s.locations.find((x) => x.name === "MCC Room")!.id);
    await ashton.sync();
    justice.net.down = false;
    await justice.sync(); await ashton.sync(); await justice.sync();
    for (const p of [ashton, justice]) {
      const x = line(p, "P3", next);
      expect(x.locationId).toBe(ashton.s.locations.find((y) => y.name === "MCC Room")!.id);
      expect(x.images[0]).toMatchObject({ irImageNumber: "0301", notes: "hot lug" });
    }
    expect(justice.engine.data.conflicts).toEqual([]);
  });
});
