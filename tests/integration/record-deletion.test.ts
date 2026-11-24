/**
 * Customer and facility deletion (migration 8) with two phones and real accounts against a local
 * Supabase stack: one-transaction delete, approval history confirmation, restore, permanent removal
 * after the recovery period, offline technician work, no orphans.
 */
import { beforeAll, expect, it } from "vitest";
import { run, setupTwoPhones, sql, type Phone } from "./helpers";

run("Customer and facility deletion (real Supabase, two phones)", () => {
  let ashton: Phone, justice: Phone;
  beforeAll(async () => { ({ ashton, justice } = await setupTwoPhones()); }, 60_000);

  const customer = (name: string) => ashton.s.createCustomer({ name, contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const facility = (cust: string, name: string) => ashton.s.createFacility({ customerId: cust, name, address: "1 Main St", city: "Dallas", state: "TX", postalCode: "", notes: "" });
  /** A facility with one room, two equipment lines (one with a reading) in an inspection assigned to both. */
  const withJob = (cust: string, fac: string) => {
    const insp = ashton.s.createInspection({ customerId: cust, facilityId: fac, date: "2026-11-24", inspectorIds: [ashton.userId, justice.userId], carryForward: false });
    const room = ashton.s.createRoomForInspection(insp, { building: "", name: "Elec", area: "" }, { humidity: "50", ambientTemp: "70", backgroundTemp: "70" });
    ashton.s.addResult(insp, room, { name: "P1", equipmentType: "Panel", irImageNumber: "11" });
    ashton.s.addResult(insp, room, { name: "P2", equipmentType: "Panel" });
    return insp;
  };
  const both = async () => { await ashton.sync(); await justice.sync(); await ashton.sync(); };
  const del = (p: Phone, kind: "customer" | "facility", id: string, history = false) => p.sb.rpc("admin_delete_records", { p_kind: kind, p_id: id, p_include_history: history });
  const live = async (table: string, col: string, id: string) => (await sql(`select count(*)::int n from public.${table} where ${col} = $1 and deleted_at is null`, [id]))[0].n;
  const approve = async (insp: string) => {
    for (const p of [justice, ashton]) p.store.setState((st) => ({ inspections: st.inspections.map((i) => (i.id === insp ? { ...i, siteVisit: { ...i.siteVisit, state: "completed" as const } } : i)) }));
    justice.s.setInspectionStatus(insp, "Needs Review"); await both();
    ashton.s.setInspectionStatus(insp, "Approved"); await both();
    expect((await sql("select status from public.inspections where id = $1", [insp]))[0].status).toBe("Approved");
  };
  const noFailures = (p: Phone) => expect(Object.values(p.engine.data.ops).filter((o) => o.failed).map((o) => o.lastError)).toEqual([]);

  it("an empty facility is deleted in one step and leaves both phones", async () => {
    const c = customer("Empty Fac Co"); const f = facility(c, "Empty Site");
    await both();
    const { data, error } = await del(ashton, "facility", f);
    expect(error).toBeNull();
    expect((data as { counts: Record<string, number> }).counts.facilities).toBe(1);
    await both();
    for (const p of [ashton, justice]) expect(p.s.facilities.some((x) => x.id === f)).toBe(false);
    expect(ashton.s.customers.some((x) => x.id === c)).toBe(true);
    noFailures(ashton);
  });

  it("a facility with unfinished test data: everything under it goes together; Undo restores it on both phones", async () => {
    const c = customer("Test Data Co"); const f = facility(c, "Test Site"); const insp = withJob(c, f);
    await both();
    expect(justice.s.results.filter((r) => r.inspectionId === insp)).toHaveLength(2);
    const { data, error } = await del(ashton, "facility", f);
    expect(error).toBeNull();
    const batch = (data as { batch: string }).batch;
    expect((data as { counts: Record<string, number> }).counts).toMatchObject({ facilities: 1, inspections: 1, results: 2, locations: 1, equipment: 2, room_conditions: 1 });
    await both();
    for (const p of [ashton, justice]) {
      expect(p.s.inspections.some((i) => i.id === insp)).toBe(false);
      expect(p.s.results.some((r) => r.inspectionId === insp)).toBe(false);
    }
    expect(await live("results", "inspection_id", insp)).toBe(0);
    noFailures(ashton); noFailures(justice);
    const r = await ashton.sb.rpc("admin_restore_deletion", { p_batch: batch });
    expect(r.error).toBeNull();
    await both();
    for (const p of [ashton, justice]) {
      expect(p.s.results.filter((x) => x.inspectionId === insp).map((x) => x.images[0].irImageNumber).sort()).toEqual(["", "11"]);
      expect(p.s.facilities.some((x) => x.id === f)).toBe(true);
    }
    // Restoring twice is refused; nothing deleted separately comes back.
    expect((await ashton.sb.rpc("admin_restore_deletion", { p_batch: batch })).error?.message).toMatch(/Already restored/);
  });

  it("a facility with an approved report: refused unless the history is confirmed; restore brings the locked report back unchanged", async () => {
    const c = customer("History Co"); const f = facility(c, "History Site"); const insp = withJob(c, f);
    await both(); await approve(insp);
    const before = (await sql("select status, approval_snapshot, version from public.inspections where id = $1", [insp]))[0];
    const refused = await del(ashton, "facility", f);
    expect(refused.error?.message).toMatch(/1 approved inspection report\(s\) belong to it/);
    expect(await live("inspections", "id", insp)).toBe(1);
    const { data, error } = await del(ashton, "facility", f, true);
    expect(error).toBeNull();
    await both();
    expect(justice.s.inspections.some((i) => i.id === insp)).toBe(false);
    expect((await ashton.sb.rpc("admin_restore_deletion", { p_batch: (data as { batch: string }).batch })).error).toBeNull();
    await both();
    const after = (await sql("select status, approval_snapshot from public.inspections where id = $1", [insp]))[0];
    expect([after.status, after.approval_snapshot]).toEqual([before.status, before.approval_snapshot]);
    expect(await live("results", "inspection_id", insp)).toBe(2);
    // The approval lock still holds after the restore.
    const line = justice.s.results.find((r) => r.inspectionId === insp)!;
    const edit = await justice.sb.from("results").update({ review_notes: "x" }).eq("id", line.id);
    expect(edit.error?.message).toMatch(/approved and locked/);
  });

  it("customers: empty one, one with several facilities (other customers untouched), one with historical reports", async () => {
    const empty = customer("Empty Customer");
    const multi = customer("Multi Site Co"); const f1 = facility(multi, "Site A"); const f2 = facility(multi, "Site B"); withJob(multi, f1);
    const other = customer("Unrelated Co"); const fo = facility(other, "Unrelated Site"); const io = withJob(other, fo);
    const hist = customer("Old Reports Co"); const fh = facility(hist, "Old Site"); const ih = withJob(hist, fh);
    await both(); await approve(ih);
    expect((await del(ashton, "customer", empty)).error).toBeNull();
    const m = await del(ashton, "customer", multi);
    expect(m.error).toBeNull();
    expect((m.data as { counts: Record<string, number> }).counts).toMatchObject({ customers: 1, facilities: 2, inspections: 1 });
    expect((await del(ashton, "customer", hist)).error?.message).toMatch(/approved inspection report/);
    expect((await del(ashton, "customer", hist, true)).error).toBeNull();
    await both();
    for (const p of [ashton, justice]) {
      expect(p.s.customers.map((x) => x.name)).not.toEqual(expect.arrayContaining(["Empty Customer"]));
      expect(p.s.facilities.some((x) => x.id === f2)).toBe(false);
    }
    expect([await live("customers", "id", other), await live("facilities", "id", fo), await live("results", "inspection_id", io)]).toEqual([1, 1, 2]);
    expect(ashton.s.inspections.some((i) => i.id === io)).toBe(true);
    noFailures(ashton); noFailures(justice);
  });

  it("only administrators can delete", async () => {
    const c = customer("Tech Cannot Co"); await both();
    expect((await del(justice, "customer", c)).error?.message).toMatch(/Only an administrator/);
    expect(await live("customers", "id", c)).toBe(1);
  });

  it("an offline technician's unsent work never revives deleted records and is saved after a restore", async () => {
    const c = customer("Offline Co"); const f = facility(c, "Offline Site"); const insp = withJob(c, f);
    await both();
    justice.net.down = true;
    const p2 = justice.s.results.find((r) => r.inspectionId === insp && r.images[0].irImageNumber === "")!;
    justice.s.updateThermalImage(p2.id, p2.images[0].id, { irImageNumber: "12" });
    justice.s.updateResult(p2.id, { reviewNotes: "found hot lug" });
    await justice.sync();
    const { data } = await del(ashton, "facility", f);
    justice.net.down = false;
    await justice.sync(); await justice.sync();
    // Nothing came back in the database: no orphan, no resurrection.
    expect(await live("results", "inspection_id", insp)).toBe(0);
    expect(await live("inspections", "id", insp)).toBe(0);
    // The technician's work is not lost: the phone keeps it and asks (deleted on another device).
    expect(justice.engine.data.conflicts.some((x) => x.key === `results:${p2.id}`)).toBe(true);
    expect(justice.s.results.find((r) => r.id === p2.id)?.reviewNotes).toBe("found hot lug");
    // Keeping it while the facility is still deleted is refused by the database with a clear message.
    for (const cf of [...justice.engine.data.conflicts]) justice.engine.resolveConflict(cf.id, "mine");
    await justice.sync(); await justice.sync();
    expect(Object.values(justice.engine.data.ops).filter((o) => o.failed).map((o) => o.failed).join(" ")).toMatch(/deleted by an administrator/);
    expect(await live("results", "inspection_id", insp)).toBe(0);
    // Restore, then the technician retries: the work is saved.
    expect((await ashton.sb.rpc("admin_restore_deletion", { p_batch: (data as { batch: string }).batch })).error).toBeNull();
    justice.engine.retryFailed();
    await justice.sync(); await justice.sync(); await ashton.sync();
    expect(justice.engine.data.conflicts).toEqual([]);
    const row = (await sql("select r.review_notes, t.ir_image_number from public.results r join public.thermal_images t on t.result_id = r.id and t.deleted_at is null where r.id = $1", [p2.id]))[0];
    expect(row).toEqual({ review_notes: "found hot lug", ir_image_number: "12" });
    noFailures(justice);
  });

  it("permanent removal waits for the 30-day recovery period, then leaves no orphans", async () => {
    const c = customer("Purge Co"); const f = facility(c, "Purge Site"); const insp = withJob(c, f);
    await both();
    const { data } = await del(ashton, "customer", c);
    const batch = (data as { batch: string }).batch;
    expect((await ashton.sb.rpc("admin_purge_deletion", { p_batch: batch })).error?.message).toMatch(/Still in the 30-day recovery period/);
    expect((await justice.sb.rpc("admin_purge_deletion", { p_batch: batch })).error?.message).toMatch(/Only an administrator|not found/i);
    // Pretend 31 days passed (same shift for the batch and its rows).
    for (const t of ["thermal_images", "results", "room_conditions", "exterior_checks", "inspections", "equipment", "locations", "facilities", "customers"]) {
      await sql(`update public.${t} set deleted_at = deleted_at - interval '31 days' where deleted_at = (select deleted_at from public.deletion_batches where id = $1)`, [batch]);
    }
    await sql("update public.deletion_batches set deleted_at = deleted_at - interval '31 days' where id = $1", [batch]);
    expect((await ashton.sb.rpc("admin_purge_deletion", { p_batch: batch })).error).toBeNull();
    const gone = (await sql(`select (select count(*)::int from public.customers where id = $1) c, (select count(*)::int from public.facilities where id = $2) f,
      (select count(*)::int from public.inspections where id = $3) i, (select count(*)::int from public.results where inspection_id = $3) r,
      (select count(*)::int from public.thermal_images where inspection_id = $3) t, (select count(*)::int from public.review_events where inspection_id = $3) e`, [c, f, insp]))[0];
    expect(gone).toEqual({ c: 0, f: 0, i: 0, r: 0, t: 0, e: 0 });
    const orphans = (await sql(`select
      (select count(*)::int from public.results r where not exists (select 1 from public.inspections i where i.id = r.inspection_id)) r,
      (select count(*)::int from public.thermal_images t where not exists (select 1 from public.results r where r.id = t.result_id)) t,
      (select count(*)::int from public.equipment e where not exists (select 1 from public.facilities f where f.id = e.facility_id)) e`))[0];
    expect(orphans).toEqual({ r: 0, t: 0, e: 0 });
    expect((await ashton.sb.rpc("admin_restore_deletion", { p_batch: batch })).error?.message).toMatch(/Permanently deleted/);
  });

  it("nothing can be added under a deleted facility or inspection", async () => {
    const c = customer("Guard Co"); const f = facility(c, "Guard Site"); const insp = withJob(c, f);
    await both();
    await del(ashton, "facility", f);
    const loc = (await sql("select id from public.locations where facility_id = $1", [f]))[0].id;
    const eq = (await sql("select id from public.equipment where facility_id = $1 limit 1", [f]))[0].id;
    const ins = await ashton.sb.from("results").insert({ id: "res-guard", organization_id: ashton.orgId, inspection_id: insp, equipment_id: eq, location_id: loc });
    expect(ins.error?.message).toMatch(/deleted by an administrator/);
    const eqIns = await ashton.sb.from("equipment").insert({ id: "eq-guard", organization_id: ashton.orgId, facility_id: f, location_id: loc, name: "X" });
    expect(eqIns.error?.message).toMatch(/deleted by an administrator/);
  });
});
