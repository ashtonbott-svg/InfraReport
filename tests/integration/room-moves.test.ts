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
    expect(ashton.s.removeRoom(spare).kind).toBe("delete");
    await ashton.sync(); await justice.sync();
    expect((await sql("select deleted_at is not null as gone from public.locations where id = $1", [spare]))[0].gone).toBe(true);
    expect(justice.s.locations.some((l) => l.id === spare)).toBe(false);
  });

  it("7. a room with equipment is not deleted, on the phone or in the database", async () => {
    const plan = ashton.s.removeRoom(roomB);
    expect(plan).toMatchObject({ kind: "blocked", equipmentCount: 2 });
    // An older app (or a direct request) is refused by the database as well.
    const { error } = await ashton.sb.from("locations").update({ deleted_at: new Date().toISOString() }).eq("id", roomB);
    expect(error?.message).toMatch(/Room still has 2 equipment item\(s\)/);
    const { error: e2 } = await ashton.sb.from("locations").update({ archived_at: new Date().toISOString() }).eq("id", roomB);
    expect(e2?.message).toMatch(/Room still has 2 equipment item\(s\)/);
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
    expect(justice.s.removeRoom(roomB)).toMatchObject({ kind: "archive", historicalInspectionCount: 1 });
    await justice.sync(); await ashton.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed)).toEqual([]);
    const db = (await sql("select deleted_at, archived_at from public.locations where id = $1", [roomB]))[0];
    expect(db.deleted_at).toBeNull();
    expect(db.archived_at).not.toBeNull();
    for (const p of [ashton, justice]) {
      expect(approved(p)).toEqual(report);
      expect(activeRooms(p.s.locations, facId).map((l) => l.name)).toEqual(["Elec A", "MCC Room"]);
      expect(p.s.rooms.some((r) => r.inspectionId === next && r.locationId === roomB)).toBe(false);
      expect(names(p, roomA, next)).toEqual(["P2", "P3"]);
    }
    expect((await sql("select count(*)::int n from public.results where inspection_id = $1 and location_id = $2 and deleted_at is null", [inspId, roomB]))[0].n).toBe(2); // P2 and P3 were inspected there
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
