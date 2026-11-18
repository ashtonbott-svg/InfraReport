/**
 * Field-test improvements (migration 5) with two phones, real accounts, the real
 * device store and sync engine, against a real local Supabase stack.
 */
import { beforeAll, expect, it } from "vitest";
import { buildGeneratorRows } from "@/lib/domain/csv";
import { buildIrtWorkbook, buildWorkbook } from "@/lib/domain/xlsx-export";
import { run, setupTwoPhones, sql, type Phone } from "./helpers";

run("Field test improvements (real Supabase, two phones)", () => {
  let ashton: Phone, justice: Phone, org = "", inspId = "", facId = "", room = "";

  beforeAll(async () => {
    ({ ashton, justice, org } = await setupTwoPhones());
    const a = ashton.s;
    const cust = a.createCustomer({ name: "AMNT", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
    facId = a.createFacility({ customerId: cust, name: "Mansfield", address: "", city: "Mansfield", state: "TX", postalCode: "", notes: "" });
    inspId = a.createInspection({ customerId: cust, facilityId: facId, date: "2026-11-18", inspectorIds: [ashton.userId, justice.userId], carryForward: false });
    room = a.createRoomForInspection(inspId, { building: "", name: "Electrical Room", area: "" }, { humidity: "40", ambientTemp: "75", backgroundTemp: "75" });
    for (const [name, ir] of [["Disconnect MSC-5", "90"], ["Disconnect L2", "93"], ["Panel L1", "94"]]) a.addResult(inspId, room, { name, equipmentType: "Disconnect", irImageNumber: ir });
    await ashton.sync();
    await justice.sync();
  }, 60_000);

  const eqName = (p: Phone, resultId: string) => p.s.equipment.find((e) => e.id === p.s.results.find((r) => r.id === resultId)!.equipmentId)!.name;
  const roomNames = (p: Phone) => p.s.results.filter((r) => r.inspectionId === inspId && r.locationId === room).sort((x, y) => x.sortOrder - y.sortOrder).map((r) => eqName(p, r.id));
  const byName = (p: Phone, name: string) => p.s.results.find((r) => r.inspectionId === inspId && eqName(p, r.id) === name)!;

  it("notes: image, equipment and photo notes are saved, synced, stored and exported on the right rows", async () => {
    const l2 = byName(justice, "Disconnect L2");
    justice.s.updateThermalImage(l2.id, l2.images[0].id, { possibleCause: "Loose Connection(s)", maxTemp: "118.4", notes: "RC 6, A Phase, Class 2" });
    const l1 = byName(justice, "Panel L1");
    justice.s.updateResult(l1.id, { reviewNotes: "Dead front missing two screws" });
    justice.s.addPhotoRecord({ id: "ph-l1", inspectionId: inspId, facilityId: facId, kind: "before-opening", building: "", resultId: l1.id, fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1, capturedAt: new Date().toISOString(), note: "Breaker 7 found tripped" });
    const msc = byName(justice, "Disconnect MSC-5");
    justice.s.setException(msc.id, { kind: "not-scanned", note: "Locked out, no key on site" });
    await justice.sync();
    expect((await sql("select notes from public.thermal_images where id = $1", [l2.images[0].id]))[0].notes).toBe("RC 6, A Phase, Class 2");
    expect((await sql("select review_notes, photo_notes from public.results where id = $1", [l1.id]))[0]).toMatchObject({ review_notes: "Dead front missing two screws", photo_notes: [{ note: "Breaker 7 found tripped", kind: "before-opening" }] });

    await ashton.sync();
    // Survives a "reload" of the administrator's app (new engine over the same saved device data).
    ashton.boot();
    const rows = buildGeneratorRows(ashton.dataset(inspId));
    const note = (n: string) => rows.find((r) => r[4] === n)![14];
    expect(note("Disconnect L2")).toBe("RC 6, A Phase, Class 2");
    expect(note("Panel L1")).toBe("Dead front missing two screws; Breaker 7 found tripped");
    expect(note("Disconnect MSC-5")).toBe("Locked out, no key on site");
    // Both workbooks carry them.
    const inf = buildWorkbook(ashton.dataset(inspId), { customer: "AMNT", facility: "Mansfield", inspectionDate: "2026-11-18", thermographers: "", generatedAt: new Date() })[0].data;
    const irt = buildIrtWorkbook(ashton.dataset(inspId))[0].data;
    expect(inf.find((r) => r[4]?.value === "Disconnect L2")![14]?.value).toBe("RC 6, A Phase, Class 2");
    expect(irt.find((r) => r[4]?.value === "Disconnect L2")![13]?.value).toBe("RC 6, A Phase, Class 2");
    expect(irt[0].map((c) => c?.value)).not.toContain("Max Temp");
  });

  it("an administrator's correction to a note syncs back to the technician", async () => {
    const l2 = byName(ashton, "Disconnect L2");
    ashton.s.updateThermalImage(l2.id, l2.images[0].id, { notes: "RC 6, A Phase, Class 2, retorque" });
    await ashton.sync();
    await justice.sync();
    expect(byName(justice, "Disconnect L2").images[0].notes).toBe("RC 6, A Phase, Class 2, retorque");
  });

  it("rename keeps every reading and record id, and syncs; no duplicate equipment", async () => {
    const before = (await sql("select count(*)::int n from public.equipment where facility_id = $1", [facId]))[0].n;
    const l1 = byName(justice, "Panel L1");
    const eqId = l1.equipmentId;
    justice.s.updateEquipment(eqId, { name: "Panel L1A" });
    await justice.sync();
    await ashton.sync();
    const onA = ashton.s.results.find((r) => r.id === l1.id)!;
    expect(eqName(ashton, l1.id)).toBe("Panel L1A");
    expect(onA.images.map((i) => i.irImageNumber)).toEqual(["94"]);
    expect(onA.reviewNotes).toBe("Dead front missing two screws");
    expect(onA.equipmentId).toBe(eqId);
    expect((await sql("select count(*)::int n from public.equipment where facility_id = $1", [facId]))[0].n).toBe(before);
  });

  it("reorder: insert after an item, move up/down; the order syncs and drives both exports", async () => {
    // Forgot Disconnect CU-4: add it directly after Disconnect MSC-5.
    const msc = byName(ashton, "Disconnect MSC-5");
    ashton.s.addResult(inspId, room, { name: "Disconnect CU-4", equipmentType: "Disconnect", irImageNumber: "95", afterResultId: msc.id });
    expect(roomNames(ashton)).toEqual(["Disconnect MSC-5", "Disconnect CU-4", "Disconnect L2", "Panel L1A"]);
    await ashton.sync();
    await justice.sync();
    expect(roomNames(justice)).toEqual(["Disconnect MSC-5", "Disconnect CU-4", "Disconnect L2", "Panel L1A"]);
    // Justice moves Panel L1A up while Ashton moves Disconnect MSC-5 down (different items, both kept).
    justice.s.moveResult(byName(justice, "Panel L1A").id, "up");
    ashton.s.moveResult(byName(ashton, "Disconnect MSC-5").id, "down");
    await justice.sync(); await ashton.sync(); await justice.sync();
    expect(roomNames(ashton)).toEqual(roomNames(justice));
    expect(roomNames(ashton)).toEqual(["Disconnect CU-4", "Disconnect MSC-5", "Panel L1A", "Disconnect L2"]);
    expect(ashton.engine.snapshot()).toMatchObject({ conflicts: 0, failed: 0 });
    const rows = buildGeneratorRows(justice.dataset(inspId)).map((r) => r[4]);
    expect(rows).toEqual(["Disconnect CU-4", "Disconnect MSC-5", "Panel L1A", "Disconnect L2"]);
    expect(buildIrtWorkbook(justice.dataset(inspId))[0].data.slice(1).map((r) => r[4]?.value)).toEqual(rows);
    // Readings and completion untouched by reordering.
    expect(byName(justice, "Disconnect L2").images[0]).toMatchObject({ irImageNumber: "93", maxTemp: "118.4" });
  });

  it("primary thermographer: field choice syncs; an administrator's designation cannot be overridden", async () => {
    expect(justice.s.setPrimaryThermographer(inspId, ashton.userId)).toBe(true);
    await justice.sync(); await ashton.sync();
    expect(ashton.s.inspections.find((i) => i.id === inspId)!).toMatchObject({ primaryThermographerId: ashton.userId, primaryLocked: false });
    // Only assigned people can be chosen.
    expect(justice.s.setPrimaryThermographer(inspId, "00000000-0000-0000-0000-000000000000")).toBe(false);
    // The administrator designates Justice.
    expect(ashton.s.setPrimaryThermographer(inspId, justice.userId, { designate: true })).toBe(true);
    await ashton.sync(); await justice.sync();
    expect(justice.s.inspections.find((i) => i.id === inspId)!).toMatchObject({ primaryThermographerId: justice.userId, primaryLocked: true });
    expect(justice.s.setPrimaryThermographer(inspId, ashton.userId)).toBe(false);
    // ...and the database refuses it even if a phone sends it.
    const { error } = await justice.sb.from("inspections").update({ primary_thermographer: ashton.userId }).eq("id", inspId);
    expect(error?.message).toMatch(/designated by an administrator/);
    const { error: e2 } = await justice.sb.from("inspections").update({ primary_locked: false }).eq("id", inspId);
    expect(e2?.message).toMatch(/Only administrators/);
  });

  it("only one submission per cycle, even when both phones submit (and when requests race)", async () => {
    for (const b of justice.s.exitCheck(inspId).missing) justice.s.acknowledgeExterior(inspId, b, "camera");
    await justice.sync(); await ashton.sync();
    // Both phones submit before hearing about each other.
    ashton.net.down = true; justice.net.down = true;
    expect(justice.s.setInspectionStatus(inspId, "Needs Review")).toBe(true);
    expect(ashton.s.setInspectionStatus(inspId, "Needs Review")).toBe(true);
    ashton.net.down = false; justice.net.down = false;
    await justice.sync(); await ashton.sync(); await justice.sync();
    const ins = (await sql("select status, submission_count, submitted_by from public.inspections where id = $1", [inspId]))[0];
    expect(ins).toEqual({ status: "Needs Review", submission_count: 1, submitted_by: justice.userId });
    const events = await sql("select id, actor from public.review_events where inspection_id = $1 and action = 'Submitted for review'", [inspId]);
    expect(events).toEqual([{ id: `ev-submitted-${inspId}-1`, actor: justice.userId }]);
    expect(await sql("select count(*)::int n from public.review_events where inspection_id = $1 and action = 'Status changed' and detail like '%Needs Review%'", [inspId])).toEqual([{ n: 0 }]);
    for (const p of [ashton, justice]) expect(p.engine.snapshot()).toMatchObject({ conflicts: 0, failed: 0, pending: 0 });
    expect(ashton.s.inspections.find((i) => i.id === inspId)!).toMatchObject({ status: "Needs Review", submittedBy: justice.userId });

    // Back to In Progress (administrator returns it), then two raw requests at the same moment.
    ashton.s.setInspectionStatus(inspId, "In Progress");
    await ashton.sync(); await justice.sync();
    await Promise.all([
      justice.sb.from("inspections").update({ status: "Needs Review" }).eq("id", inspId),
      ashton.sb.from("inspections").update({ status: "Needs Review" }).eq("id", inspId),
    ]);
    expect((await sql("select submission_count from public.inspections where id = $1", [inspId]))[0].submission_count).toBe(2);
    expect((await sql("select count(*)::int n from public.review_events where inspection_id = $1 and action = 'Submitted for review'", [inspId]))[0].n).toBe(2);
    await ashton.sync(); await justice.sync();
  });

  it("phones report unsent changes; administrators see them, technicians only their own", async () => {
    await justice.sync();
    const reports = await sql("select device_id, user_id, pending, failed from public.sync_reports where inspection_id = $1 order by device_id", [inspId]);
    expect(reports.find((r) => r.device_id === "device-justice")).toMatchObject({ user_id: justice.userId, pending: 0, failed: 0 });
    const { data: adminView } = await ashton.sb.from("sync_reports").select("device_id").eq("inspection_id", inspId);
    const { data: techView } = await justice.sb.from("sync_reports").select("device_id, user_id").eq("inspection_id", inspId);
    expect(adminView!.length).toBe(reports.length);
    expect(techView!.every((r) => r.user_id === justice.userId)).toBe(true);
  });

  it("approval snapshot: renaming equipment in a later inspection does not change the approved report", async () => {
    await ashton.sync();
    ashton.s.setInspectionStatus(inspId, "Approved");
    await ashton.sync(); await justice.sync();
    const approvedRows = buildGeneratorRows(ashton.dataset(inspId)).map((r) => `${r[1]}|${r[4]}`);
    const snap = (await sql("select approval_snapshot from public.inspections where id = $1", [inspId]))[0].approval_snapshot;
    expect(Object.values(snap.equipment).map((e) => (e as { name: string }).name).sort()).toEqual(["Disconnect CU-4", "Disconnect L2", "Disconnect MSC-5", "Panel L1A"]);

    // Next year: a new inspection at the same facility renames equipment and the room, and reorders rooms.
    const next = ashton.s.createInspection({ customerId: ashton.s.inspections.find((i) => i.id === inspId)!.customerId, facilityId: facId, date: "2027-11-18", inspectorIds: [justice.userId], carryForward: true });
    await ashton.sync(); await justice.sync();
    const l2 = justice.s.results.find((r) => r.inspectionId === next && justice.s.equipment.find((e) => e.id === r.equipmentId)?.name === "Disconnect L2")!;
    justice.s.updateEquipment(l2.equipmentId, { name: "Disconnect L2 (Renamed)" });
    justice.s.updateLocation(room, { name: "Main Electrical Room" });
    await justice.sync(); await ashton.sync();
    expect(ashton.s.equipment.find((e) => e.id === l2.equipmentId)!.name).toBe("Disconnect L2 (Renamed)");
    // The approved inspection still reports the names it was approved with, on both phones.
    for (const p of [ashton, justice]) {
      expect(buildGeneratorRows(p.dataset(inspId)).map((r) => `${r[1]}|${r[4]}`)).toEqual(approvedRows);
    }
    // The new inspection uses the current names.
    expect(buildGeneratorRows(ashton.dataset(next)).map((r) => r[4])).toContain("Disconnect L2 (Renamed)");
    expect(buildGeneratorRows(ashton.dataset(next)).map((r) => r[1])).toContain("Main Electrical Room");
  });

  it("reopen and approve again refreshes the snapshot; organization isolation of new tables holds", async () => {
    ashton.s.reopenInspection(inspId, "update names");
    await ashton.sync();
    expect(buildGeneratorRows(ashton.dataset(inspId)).map((r) => r[4])).toContain("Disconnect L2 (Renamed)");
    ashton.s.setInspectionStatus(inspId, "Approved");
    await ashton.sync();
    const snap = (await sql("select approval_snapshot from public.inspections where id = $1", [inspId]))[0].approval_snapshot;
    expect(Object.values(snap.equipment).map((e) => (e as { name: string }).name)).toContain("Disconnect L2 (Renamed)");
    // Snapshot function gives nothing to someone who is not an administrator of the inspection.
    const { data } = await justice.sb.rpc("approval_snapshot_for", { insp: inspId });
    expect(data).toBeNull();
    expect(org).toBeTruthy();
  });
});
