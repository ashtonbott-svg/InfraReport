/**
 * Two phones, two real accounts, one inspection. Runs the REAL device store
 * actions and the REAL sync engine against a REAL Supabase stack (auth,
 * PostgREST, Postgres with the project's RLS migrations). No mocks: the only
 * thing simulated is the network dropping (a fetch wrapper that refuses).
 *
 *   npx supabase start && npx supabase db reset && npm run test:integration
 */
import { beforeAll, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildGeneratorRows } from "@/lib/domain/csv";
import { Phone, PUB, SECRET, URL, noPersist, pepper, run, sql, uniq } from "./helpers";
import { activateDevice, createActivation, createTechnician, type AuthDeps } from "@/lib/server/tech-auth";

run("Two phones on one inspection (real Supabase, real store, real sync)", () => {
  let ashton: Phone, justice: Phone;
  let org = "", inspId = "", otherInspId = "";
  const admin = createClient(URL ?? "http://x", SECRET ?? "x", noPersist);

  beforeAll(async () => {
    await sql("truncate public.organizations, public.memberships, public.tech_credentials, public.tech_devices, public.tech_activations, public.auth_rate_limits cascade");
    const d: AuthDeps = { admin, anon: () => createClient(URL!, PUB, noPersist), pepper };
    const email = `ashton-${uniq()}@example.com`, pw = `Pw-${uniq()}-${uniq()}`;
    const { data: u } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    const ashtonId = u.user!.id;
    org = (await sql("select public.bootstrap_first_admin($1, 'Ashton Bott', 'Level III Certified Master Thermographer', 'Infinite Infrared LLC') as org", [email]))[0].org;
    const justiceId = await createTechnician(d, ashtonId, { name: "Justice Thompson", certification: "Level I Thermographer" });
    const { token } = await createActivation(d, ashtonId, justiceId);
    const act = await activateDevice(d, { token, tempPin: "12345", newPin: "482913", confirmPin: "482913", label: "Justice phone", ip: "10.0.0.2" });
    const members = [{ id: ashtonId, name: "Ashton Bott" }, { id: justiceId, name: "Justice Thompson" }];
    ashton = new Phone("Ashton", ashtonId, org, members);
    justice = new Phone("Justice", justiceId, org, members);
    const { data: s } = await createClient(URL!, PUB, noPersist).auth.signInWithPassword({ email, password: pw });
    await ashton.signIn(s.session!);
    await justice.signIn(act.session);
  }, 60_000);

  it("admin creates customer, facility and a job assigned to both; technician's phone receives it", async () => {
    const a = ashton.s;
    const cust = a.createCustomer({ name: "Canton Plant", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
    const fac = a.createFacility({ customerId: cust, name: "Canton", address: "1 Main St", city: "Canton", state: "OH", postalCode: "", notes: "" });
    inspId = a.createInspection({ customerId: cust, facilityId: fac, date: "2026-11-19", inspectorIds: [ashton.userId, justice.userId], carryForward: false });
    otherInspId = a.createInspection({ customerId: cust, facilityId: fac, date: "2026-12-01", inspectorIds: [ashton.userId], carryForward: false });
    await ashton.sync();
    expect(ashton.engine.snapshot().pending).toBe(0);
    expect(ashton.engine.snapshot().failed).toBe(0);

    await justice.sync();
    const j = justice.s;
    expect(j.inspections.map((i) => i.id)).toContain(inspId);
    expect(j.inspections.find((i) => i.id === inspId)!.inspectorIds.sort()).toEqual([ashton.userId, justice.userId].sort());
    expect(j.customers.map((c) => c.name)).toEqual(["Canton Plant"]);
    expect(j.facilities[0].address).toBe("1 Main St");
    // Technicians only see jobs they are assigned to.
    expect(j.inspections.map((i) => i.id)).not.toContain(otherInspId);
  });

  it("both phones add different rooms and equipment at the same time; both see everything", async () => {
    const insp = ashton.s.inspections.find((i) => i.id === inspId)!;
    const roomA = ashton.s.createRoomForInspection(inspId, { building: "", name: "MCC Room", area: "" }, { humidity: "45", ambientTemp: "72", backgroundTemp: "72" });
    ashton.s.addResult(inspId, roomA, { name: "MCC-1", equipmentType: "MCC", component: "Bucket" });
    ashton.s.addResult(inspId, roomA, { name: "MCC-2", equipmentType: "MCC", component: "Bucket" });
    const roomJ = justice.s.createRoomForInspection(inspId, { building: "", name: "Electrical Room", area: "" }, { humidity: "50", ambientTemp: "70", backgroundTemp: "70" });
    justice.s.addResult(inspId, roomJ, { name: "Panel P1", equipmentType: "Panel", irImageNumber: "101" });
    expect(insp.facilityId).toBeTruthy();

    await Promise.all([ashton.sync(), justice.sync()]);
    await Promise.all([ashton.sync(), justice.sync()]);
    for (const p of [ashton, justice]) {
      const names = p.s.locations.filter((l) => l.organizationId === org).map((l) => l.name).sort();
      expect(names).toEqual(["Electrical Room", "MCC Room"]);
      expect(p.s.results.filter((r) => r.inspectionId === inspId)).toHaveLength(3);
      expect(p.engine.snapshot()).toMatchObject({ pending: 0, failed: 0, conflicts: 0 });
    }
    const dbCount = await sql("select count(*)::int as n from public.results where inspection_id = $1 and deleted_at is null", [inspId]);
    expect(dbCount[0].n).toBe(3);
  });

  it("one phone continues the other's work: technician records numbers on admin's equipment", async () => {
    const mcc1 = justice.s.results.find((r) => justice.s.equipment.find((e) => e.id === r.equipmentId)?.name === "MCC-1")!;
    justice.s.updateThermalImage(mcc1.id, mcc1.images[0].id, { irImageNumber: "205", distance: "3" });
    justice.s.addThermalImage(mcc1.id, { component: "Breaker", irImageNumber: "206" });
    await justice.sync();
    await ashton.sync();
    const onAshton = ashton.s.results.find((r) => r.id === mcc1.id)!;
    expect(onAshton.images.map((i) => i.irImageNumber)).toEqual(["205", "206"]);
    expect(onAshton.images[0].visualImageNumber).toBe("205");
    expect(onAshton.images[0].distance).toBe("3");
  });

  it("different fields of the same record merge without a conflict", async () => {
    const r = ashton.s.results.find((x) => x.images.some((i) => i.irImageNumber === "205"))!;
    ashton.net.down = true;
    justice.net.down = true;
    ashton.s.updateResult(r.id, { opened: "No, Not Opened" });
    justice.s.updateResult(r.id, { reviewNotes: "Check lugs next year" });
    ashton.net.down = false; justice.net.down = false;
    await ashton.sync();
    await justice.sync();
    await ashton.sync();
    for (const p of [ashton, justice]) {
      const x = p.s.results.find((y) => y.id === r.id)!;
      expect(x.opened).toBe("No, Not Opened");
      expect(x.reviewNotes).toBe("Check lugs next year");
      expect(p.engine.snapshot().conflicts).toBe(0);
    }
  });

  it("the same field edited on both phones is a visible conflict, never a silent overwrite", async () => {
    const r = ashton.s.results.find((x) => x.images.some((i) => i.irImageNumber === "205"))!;
    const img = r.images[0];
    ashton.s.updateThermalImage(r.id, img.id, { maxTemp: "141" });
    justice.s.updateThermalImage(r.id, img.id, { maxTemp: "147" });
    await ashton.sync();      // Ashton saves first
    await justice.sync();     // Justice's write is refused (version moved) -> conflict
    const c = justice.engine.data.conflicts;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ table: "thermal_images", field: "max_temp", mine: "147", theirs: "141" });
    // Justice still sees her own value until she decides.
    expect(justice.s.results.find((x) => x.id === r.id)!.images[0].maxTemp).toBe("147");
    const db1 = await sql("select max_temp from public.thermal_images where id = $1", [img.id]);
    expect(db1[0].max_temp).toBe("141");

    justice.engine.resolveConflict(c[0].id, "mine");
    await justice.sync();
    await ashton.sync();
    expect((await sql("select max_temp from public.thermal_images where id = $1", [img.id]))[0].max_temp).toBe("147");
    expect(ashton.s.results.find((x) => x.id === r.id)!.images[0].maxTemp).toBe("147");
    expect(justice.engine.data.conflicts).toHaveLength(0);
  });

  it("'use theirs' takes the other phone's value locally", async () => {
    const r = ashton.s.results.find((x) => x.images.some((i) => i.irImageNumber === "205"))!;
    const img = r.images[0];
    ashton.s.updateThermalImage(r.id, img.id, { notes: "Ashton note" });
    justice.s.updateThermalImage(r.id, img.id, { notes: "Justice note" });
    await ashton.sync();
    await justice.sync();
    const c = justice.engine.data.conflicts[0];
    expect(c.field).toBe("notes");
    justice.engine.resolveConflict(c.id, "theirs");
    expect(justice.s.results.find((x) => x.id === r.id)!.images[0].notes).toBe("Ashton note");
    await justice.sync();
    expect(justice.engine.snapshot()).toMatchObject({ pending: 0, conflicts: 0 });
    expect((await sql("select notes from public.thermal_images where id = $1", [img.id]))[0].notes).toBe("Ashton note");
  });

  it("offline work is queued, survives an app restart, and uploads on reconnect", async () => {
    justice.net.down = true;
    const room = justice.s.rooms.find((x) => x.inspectionId === inspId && justice.s.locations.find((l) => l.id === x.locationId)?.name === "Electrical Room")!;
    const id = justice.s.addResult(inspId, room.locationId, { name: "Panel P2", equipmentType: "Panel", irImageNumber: "301" });
    await justice.sync();
    const snap = justice.engine.snapshot();
    expect(snap.offline).toBe(true);
    expect(snap.pending).toBeGreaterThan(0);
    // Not visible to the other phone while offline.
    await ashton.sync();
    expect(ashton.s.results.some((r) => r.id === id)).toBe(false);

    // Refresh the app on Justice's phone: same device storage, new engine.
    const queued = Object.keys(justice.engine.data.ops).length;
    justice.boot();
    expect(Object.keys(justice.engine.data.ops).length).toBe(queued);

    justice.net.down = false;
    await justice.sync();
    expect(justice.engine.snapshot()).toMatchObject({ pending: 0, failed: 0, offline: false });
    await ashton.sync();
    const got = ashton.s.results.find((r) => r.id === id)!;
    expect(got.images[0].irImageNumber).toBe("301");
  });

  it("a retry after a lost answer does not create duplicates", async () => {
    const room = ashton.s.rooms.find((x) => x.inspectionId === inspId)!;
    const before = (await sql("select count(*)::int as n from public.equipment where organization_id = $1", [org]))[0].n;
    ashton.net.loseNextInsertAnswer = true;
    const id = ashton.s.addResult(inspId, room.locationId, { name: "Disconnect D1", equipmentType: "Disconnect" });
    await ashton.sync(); // first insert reaches the database, answer lost
    await ashton.sync(); // retry: recognised as already saved
    await ashton.sync();
    expect(ashton.engine.snapshot()).toMatchObject({ pending: 0, failed: 0, conflicts: 0 });
    const after = (await sql("select count(*)::int as n from public.equipment where organization_id = $1", [org]))[0].n;
    expect(after).toBe(before + 1);
    expect((await sql("select count(*)::int as n from public.results where id = $1", [id]))[0].n).toBe(1);
  });

  it("both phones adding the same existing room to the job end up with one shared room record", async () => {
    // A room that exists in the facility inventory but is not in this inspection yet.
    const fac = ashton.s.inspections.find((i) => i.id === inspId)!.facilityId;
    const locId = ashton.s.createLocation({ facilityId: fac, building: "", name: "Roof", area: "" });
    await ashton.sync();
    await justice.sync();
    ashton.net.down = true; justice.net.down = true;
    ashton.s.addRoomToInspection(inspId, locId);
    justice.s.addRoomToInspection(inspId, locId);
    const jRoom = justice.s.rooms.find((r) => r.inspectionId === inspId && r.locationId === locId)!;
    justice.s.updateRoomConditions(jRoom.id, { humidity: "40" });
    ashton.net.down = false; justice.net.down = false;
    await ashton.sync();
    await justice.sync();
    await ashton.sync();
    const db = await sql("select id, humidity from public.room_conditions where inspection_id = $1 and location_id = $2 and deleted_at is null", [inspId, locId]);
    expect(db).toHaveLength(1);
    expect(db[0].humidity).toBe("40");
    for (const p of [ashton, justice]) {
      const rooms = p.s.rooms.filter((r) => r.inspectionId === inspId && r.locationId === locId);
      expect(rooms).toHaveLength(1);
      expect(rooms[0].humidity).toBe("40");
      expect(p.engine.snapshot()).toMatchObject({ pending: 0, failed: 0, conflicts: 0 });
    }
  });

  it("deleting an equipment line on one phone removes it from the other", async () => {
    const victim = ashton.s.results.find((r) => ashton.s.equipment.find((e) => e.id === r.equipmentId)?.name === "MCC-2")!;
    ashton.s.deleteResult(victim.id);
    await ashton.sync();
    await justice.sync();
    expect(justice.s.results.some((r) => r.id === victim.id)).toBe(false);
  });

  it("combined Excel rows on either phone contain both phones' work", async () => {
    await ashton.sync(); await justice.sync();
    const rowsA = buildGeneratorRows(ashton.dataset(inspId));
    const rowsJ = buildGeneratorRows(justice.dataset(inspId));
    expect(rowsJ).toEqual(rowsA);
    const irs = rowsA.map((r) => String(r[8])).filter(Boolean).sort();
    expect(irs).toEqual(expect.arrayContaining(["101", "205", "206", "301"]));
  });

  it("the front building photo: either phone confirms it once, the other phone sees it", async () => {
    await ashton.sync(); await justice.sync();
    expect(justice.s.exitCheck(inspId).allowed).toBe(false); // reminder: nobody has dealt with it yet
    expect(ashton.s.exitCheck(inspId).missing).toEqual(justice.s.exitCheck(inspId).missing);
    for (const b of justice.s.exitCheck(inspId).missing) expect(justice.s.acknowledgeExterior(inspId, b, "camera")).toBe(true);
    await justice.sync();
    await ashton.sync();
    expect(ashton.s.exitCheck(inspId).allowed).toBe(true);
    const c = ashton.s.exteriorChecks.find((x) => x.inspectionId === inspId)!;
    expect(c).toMatchObject({ status: "camera", acknowledgedBy: justice.userId });
    const db = await sql("select status, acknowledged_by from public.exterior_checks where inspection_id = $1", [inspId]);
    expect(db).toEqual([{ status: "camera", acknowledged_by: justice.userId }]);
    // An exception needs a reason.
    expect(ashton.s.acknowledgeExterior(inspId, "Annex", "exception", "")).toBe(false);
  });

  it("both phones confirm the same building offline: the first one wins, no conflict prompt", async () => {
    const building = "Warehouse";
    ashton.net.down = true; justice.net.down = true;
    ashton.s.acknowledgeExterior(inspId, building, "photo");
    justice.s.acknowledgeExterior(inspId, building, "camera");
    ashton.net.down = false; justice.net.down = false;
    await ashton.sync();
    await justice.sync();
    await ashton.sync();
    const rows = await sql("select status, acknowledged_by from public.exterior_checks where inspection_id = $1 and building = $2", [inspId, building]);
    expect(rows).toEqual([{ status: "photo", acknowledged_by: ashton.userId }]);
    for (const p of [ashton, justice]) {
      expect(p.s.exteriorChecks.filter((x) => x.inspectionId === inspId && x.building === building).map((x) => x.status)).toEqual(["photo"]);
      expect(p.engine.snapshot()).toMatchObject({ pending: 0, failed: 0, conflicts: 0 });
    }
  });

  it("a submission waits until the technician's readings are in the database", async () => {
    const r = justice.s.results.find((x) => x.inspectionId === inspId)!;
    justice.net.blockPath = "/rest/v1/thermal_images"; // readings cannot upload, everything else can
    justice.s.updateThermalImage(r.id, r.images[0].id, { maxTemp: "155" });
    justice.s.setInspectionStatus(inspId, "Needs Review");
    await justice.sync();
    await justice.sync();
    expect((await sql("select status from public.inspections where id = $1", [inspId]))[0].status).not.toBe("Needs Review");
    justice.net.blockPath = undefined;
    await justice.sync();
    expect((await sql("select status from public.inspections where id = $1", [inspId]))[0].status).toBe("Needs Review");
    expect((await sql("select max_temp from public.thermal_images where id = $1", [r.images[0].id]))[0].max_temp).toBe("155");
    // Back to work for the next test.
    await ashton.sync();
    ashton.s.setInspectionStatus(inspId, "In Progress");
    await ashton.sync();
    await justice.sync();
  });

  it("technician can submit for review but cannot approve; the admin approves", async () => {
    justice.s.setInspectionStatus(inspId, "Approved");
    await justice.sync();
    const failedOps = Object.values(justice.engine.data.ops).filter((o) => o.failed);
    expect(failedOps.length).toBe(1);
    expect((await sql("select status from public.inspections where id = $1", [inspId]))[0].status).not.toBe("Approved");
    // "Discard my change": the refused value is dropped and the server's value comes back.
    justice.engine.discardFailed(failedOps[0].key);
    await justice.sync();
    expect(justice.s.inspections.find((i) => i.id === inspId)!.status).toBe("In Progress");
    justice.s.setInspectionStatus(inspId, "Needs Review");
    await justice.sync();
    expect(justice.engine.snapshot()).toMatchObject({ failed: 0 });
    const row = (await sql("select status, submitted_by from public.inspections where id = $1", [inspId]))[0];
    expect(row).toMatchObject({ status: "Needs Review", submitted_by: justice.userId });
    await ashton.sync();
    ashton.s.setInspectionStatus(inspId, "Approved");
    await ashton.sync();
    const row2 = (await sql("select status, approved_by from public.inspections where id = $1", [inspId]))[0];
    expect(row2).toMatchObject({ status: "Approved", approved_by: ashton.userId });
  });

  it("approved: the phone refuses edits, and the database refuses them even if a phone sends one", async () => {
    await justice.sync();
    const insp = justice.s.inspections.find((i) => i.id === inspId)!;
    expect(insp.status).toBe("Approved");
    expect(insp.firstApprovedAt).toBeTruthy();
    // The approving phone also has the database's approval stamps (not just the other phone).
    expect(ashton.s.inspections.find((i) => i.id === inspId)!).toMatchObject({ status: "Approved" });
    expect(ashton.s.inspections.find((i) => i.id === inspId)!.approvedAt).toBeTruthy();
    const r = justice.s.results.find((x) => x.inspectionId === inspId)!;
    const before = (await sql("select max_temp, version from public.thermal_images where id = $1", [r.images[0].id]))[0];
    // The app itself refuses the edit on a locked inspection.
    justice.s.updateThermalImage(r.id, r.images[0].id, { maxTemp: "999" });
    expect(justice.s.results.find((x) => x.id === r.id)!.images[0].maxTemp).toBe(before.max_temp);
    // A change that slips past the app (old app version, or edited offline before the approval arrived) is refused by the database.
    justice.store.setState((s) => ({ results: s.results.map((x) => (x.id === r.id ? { ...x, images: x.images.map((im, i) => (i === 0 ? { ...im, maxTemp: "999" } : im)) } : x)) }));
    await justice.sync();
    const failed = Object.values(justice.engine.data.ops).filter((o) => o.failed);
    expect(failed).toHaveLength(1);
    expect(failed[0].failed).toMatch(/approved and is locked/);
    expect((await sql("select max_temp, version from public.thermal_images where id = $1", [r.images[0].id]))[0]).toEqual(before);
    // New rooms or equipment for the job are refused too.
    const fac = justice.s.inspections.find((i) => i.id === inspId)!.facilityId;
    const { error } = await justice.sb.from("locations").insert({ id: `loc-x-${uniq()}`, organization_id: org, facility_id: fac, name: "Sneaky Room" });
    expect(error?.message).toMatch(/approved and locked/);
    // Administrators are locked out too until they reopen.
    const { error: adminErr } = await ashton.sb.from("thermal_images").update({ max_temp: "888" }).eq("id", r.images[0].id);
    expect(adminErr?.message).toMatch(/approved and locked/);
    // Discard brings back the approved value on the phone.
    justice.engine.discardFailed(failed[0].key);
    await justice.sync();
    expect(justice.s.results.find((x) => x.id === r.id)!.images[0].maxTemp).toBe(before.max_temp);
    expect(justice.engine.snapshot()).toMatchObject({ failed: 0, pending: 0 });
  });

  it("offline work from before the approval cannot silently change it; after a reopen it can be retried and is tracked", async () => {
    // Reopen so Justice can work, then go offline and edit.
    await ashton.sync();
    expect(ashton.s.reopenInspection(inspId, "Missed panel")).toBe(true);
    await ashton.sync();
    await justice.sync();
    const r = justice.s.results.find((x) => x.inspectionId === inspId)!;
    justice.net.down = true;
    justice.s.updateThermalImage(r.id, r.images[0].id, { notes: "late offline note" });
    // Meanwhile the administrator approves again.
    ashton.s.setInspectionStatus(inspId, "Approved");
    await ashton.sync();
    justice.net.down = false;
    await justice.sync();
    const failed = Object.values(justice.engine.data.ops).filter((o) => o.failed);
    expect(failed.map((o) => o.table)).toEqual(["thermal_images"]);
    expect((await sql("select notes from public.thermal_images where id = $1", [r.images[0].id]))[0].notes).not.toBe("late offline note");

    // The administrator reopens for corrections: recorded, approval cleared.
    await ashton.sync();
    ashton.s.reopenInspection(inspId, "Add Justice's late note");
    await ashton.sync();
    const row = (await sql("select status, approved_at, first_approved_at, reopen_count, reopen_reason, reopened_by from public.inspections where id = $1", [inspId]))[0];
    expect(row).toMatchObject({ status: "In Progress", approved_at: null, reopen_count: 2, reopen_reason: "Add Justice's late note", reopened_by: ashton.userId });
    expect(row.first_approved_at).not.toBeNull();

    // Justice retries: accepted now, and the change is in the change log.
    justice.engine.retryFailed();
    await justice.sync();
    expect((await sql("select notes from public.thermal_images where id = $1", [r.images[0].id]))[0].notes).toBe("late offline note");
    const log = await sql("select table_name, action, changes, changed_by from public.inspection_changes where inspection_id = $1 order by id", [inspId]);
    expect(log.some((l) => l.table_name === "thermal_images" && l.changed_by === justice.userId && l.changes.notes?.[1] === "late offline note")).toBe(true);
    expect(log.filter((l) => l.action === "reopened")).toHaveLength(2);
    expect(log.some((l) => l.action === "approved")).toBe(true);
    // Administrators can read the log through the app; technicians cannot.
    const { data: adminLog } = await ashton.sb.from("inspection_changes").select("id").eq("inspection_id", inspId);
    const { data: techLog } = await justice.sb.from("inspection_changes").select("id").eq("inspection_id", inspId);
    expect(adminLog!.length).toBe(log.length);
    expect(techLog).toEqual([]);

    // Approval is required again; afterwards it is locked again.
    await ashton.sync();
    ashton.s.setInspectionStatus(inspId, "Approved");
    await ashton.sync();
    expect((await sql("select status, approved_by from public.inspections where id = $1", [inspId]))[0]).toEqual({ status: "Approved", approved_by: ashton.userId });
    await justice.sync();
    justice.s.updateThermalImage(r.id, r.images[0].id, { notes: "after" });
    expect(justice.s.results.find((x) => x.id === r.id)!.images[0].notes).toBe("late offline note");
  });

  it("technicians cannot reopen or change the database-managed approval fields", async () => {
    const { error } = await justice.sb.from("inspections").update({ status: "In Progress" }).eq("id", inspId);
    expect(error?.message).toMatch(/approved and locked/);
    const { error: e2 } = await ashton.sb.from("inspections").update({ notes: "edit while locked" }).eq("id", inspId);
    expect(e2?.message).toMatch(/approved and locked/);
    // Reopen count cannot be forged.
    const v = (await sql("select reopen_count from public.inspections where id = $1", [inspId]))[0].reopen_count;
    await ashton.sb.from("inspections").update({ reopen_count: 0, status: "Report Generated" }).eq("id", inspId);
    expect((await sql("select status, reopen_count from public.inspections where id = $1", [inspId]))[0]).toEqual({ status: "Report Generated", reopen_count: v });
    await ashton.sync();
  });

  it("removing a technician from a job removes it from their phone", async () => {
    await justice.sync();
    expect(justice.s.inspections.some((i) => i.id === inspId)).toBe(true);
    ashton.s.updateInspection(inspId, { inspectorIds: [ashton.userId] });
    await ashton.sync();
    await justice.sync();
    expect(justice.s.inspections.some((i) => i.id === inspId)).toBe(false);
    expect(justice.s.results.some((r) => r.inspectionId === inspId)).toBe(false);
  });
});
