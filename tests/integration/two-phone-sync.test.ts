/**
 * Two phones, two real accounts, one inspection. Runs the REAL device store
 * actions and the REAL sync engine against a REAL Supabase stack (auth,
 * PostgREST, Postgres with the project's RLS migrations). No mocks: the only
 * thing simulated is the network dropping (a fetch wrapper that refuses).
 *
 *   npx supabase start && npx supabase db reset && npm run test:integration
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createStore, type StoreApi } from "zustand/vanilla";
import pg from "pg";
import { storeInitializer, type Store } from "@/lib/store/store";
import { SyncEngine } from "@/lib/sync/engine";
import { activateDevice, createActivation, createTechnician, type AuthDeps } from "@/lib/server/tech-auth";
import { buildGeneratorRows, type ExportDataset } from "@/lib/domain/csv";
import { DEFAULT_EMISSIVITY } from "@/lib/domain/constants";

const URL = process.env.SUPABASE_TEST_URL;
const PUB = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_TEST_SECRET_KEY!;
const DB = process.env.SUPABASE_TEST_DB_URL!;
const run = URL ? describe : describe.skip;
const pepper = "test-pepper-0123456789-0123456789-abcdef";
const uniq = () => Math.random().toString(36).slice(2, 10);
const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}

interface Net { down: boolean; loseNextInsertAnswer: boolean }

/** A phone: its own device store, its own outbox storage, its own network. */
class Phone {
  store: StoreApi<Store>;
  storage = new Map<string, string>();
  engine!: SyncEngine;
  net: Net = { down: false, loseNextInsertAnswer: false };
  sb!: SupabaseClient;
  constructor(public name: string, public userId: string, public orgId: string, public members: { id: string; name: string }[]) {
    this.store = createStore<Store>()(storeInitializer);
    this.store.setState((s) => ({
      currentOrgId: orgId, currentUserId: userId,
      organizations: [...s.organizations, { id: orgId, name: "Infinite Infrared LLC", slug: "c", isDemo: false, createdAt: "", settings: { defaultEmissivity: DEFAULT_EMISSIVITY, customPossibleCauses: [], csvIncludeBom: true } }],
      users: [...s.users, ...members.map((m) => ({ id: m.id, organizationId: orgId, name: m.name, email: "", role: "inspector" as const }))],
    }));
  }
  async signIn(session: { access_token: string; refresh_token: string }) {
    const net = this.net;
    const wrapped: typeof fetch = async (input, init) => {
      if (net.down) throw new TypeError("Failed to fetch");
      const res = await fetch(input, init);
      if (net.loseNextInsertAnswer && init?.method === "POST" && String(input).includes("/rest/v1/")) {
        net.loseNextInsertAnswer = false;
        throw new TypeError("Failed to fetch"); // the database got it; the phone never heard back
      }
      return res;
    };
    this.sb = createClient(URL!, PUB, { ...noPersist, db: { retry: false }, global: { fetch: wrapped } });
    const { error } = await this.sb.auth.setSession(session);
    if (error) throw error;
    this.boot();
  }
  /** (Re)start the app: a new engine reading the persisted outbox, like a page refresh. */
  boot() {
    this.engine = new SyncEngine({
      sb: this.sb, getState: () => this.store.getState(), setState: (p) => this.store.setState(p),
      storage: { get: (k) => this.storage.get(k) ?? null, set: (k, v) => void this.storage.set(k, v) },
    }, this.userId, this.orgId);
    this.store.subscribe((s) => this.engine.onLocalChange(s));
  }
  get s() { return this.store.getState(); }
  async sync() { this.engine.wake(); await this.engine.sync(); }
  dataset(inspectionId: string): ExportDataset {
    const s = this.s;
    return {
      inspection: s.inspections.find((i) => i.id === inspectionId)!,
      results: s.results.filter((r) => r.inspectionId === inspectionId),
      equipment: new Map(s.equipment.map((e) => [e.id, e])), locations: new Map(s.locations.map((l) => [l.id, l])),
      rooms: s.rooms.filter((r) => r.inspectionId === inspectionId),
    };
  }
}

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
