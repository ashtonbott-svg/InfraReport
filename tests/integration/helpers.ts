/** Shared harness for the two-phone integration tests (real Supabase, real store, real sync engine). */
import { describe } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createStore, type StoreApi } from "zustand/vanilla";
import pg from "pg";
import { storeInitializer, type Store } from "@/lib/store/store";
import { SyncEngine } from "@/lib/sync/engine";
import { activateDevice, createActivation, createTechnician, type AuthDeps } from "@/lib/server/tech-auth";
import { withApprovalSnapshot, type ExportDataset } from "@/lib/domain/csv";
import { DEFAULT_EMISSIVITY } from "@/lib/domain/constants";

export const URL = process.env.SUPABASE_TEST_URL;
export const PUB = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!;
export const SECRET = process.env.SUPABASE_TEST_SECRET_KEY!;
export const DB = process.env.SUPABASE_TEST_DB_URL!;
export const run = URL ? describe : describe.skip;
export const pepper = "test-pepper-0123456789-0123456789-abcdef";
export const uniq = () => Math.random().toString(36).slice(2, 10);
export const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}

export interface Net { down: boolean; loseNextInsertAnswer: boolean; blockPath?: string }

/** A phone: its own device store, its own outbox storage, its own network. */
export class Phone {
  store: StoreApi<Store>;
  storage = new Map<string, string>();
  engine!: SyncEngine;
  net: Net = { down: false, loseNextInsertAnswer: false };
  sb!: SupabaseClient;
  constructor(public name: string, public userId: string, public orgId: string, public members: { id: string; name: string }[], public deviceId?: string) {
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
      if (net.down || (net.blockPath && String(input).includes(net.blockPath))) throw new TypeError("Failed to fetch");
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
      deviceId: this.deviceId,
    }, this.userId, this.orgId);
    this.store.subscribe((s) => this.engine.onLocalChange(s));
  }
  get s() { return this.store.getState(); }
  async sync() { this.engine.wake(); await this.engine.sync(); }
  dataset(inspectionId: string): ExportDataset {
    const s = this.s;
    return withApprovalSnapshot({
      inspection: s.inspections.find((i) => i.id === inspectionId)!,
      results: s.results.filter((r) => r.inspectionId === inspectionId),
      equipment: new Map(s.equipment.map((e) => [e.id, e])), locations: new Map(s.locations.map((l) => [l.id, l])),
      rooms: s.rooms.filter((r) => r.inspectionId === inspectionId),
    });
  }
}


/** Fresh database state: Ashton (admin, bootstrapped) and Justice (technician, activated phone). */
export async function setupTwoPhones(deviceIds = true) {
  await sql("truncate public.organizations, public.memberships, public.tech_credentials, public.tech_devices, public.tech_activations, public.auth_rate_limits cascade");
  const admin = createClient(URL!, SECRET, noPersist);
  const d: AuthDeps = { admin, anon: () => createClient(URL!, PUB, noPersist), pepper };
  const email = `ashton-${uniq()}@example.com`, pw = `Pw-${uniq()}-${uniq()}`;
  const { data: u } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  const ashtonId = u.user!.id;
  const org = (await sql("select public.bootstrap_first_admin($1, 'Ashton Bott', 'Level III Certified Master Thermographer', 'Infinite Infrared LLC') as org", [email]))[0].org as string;
  const justiceId = await createTechnician(d, ashtonId, { name: "Justice Thompson", certification: "Level I Thermographer" });
  const { token } = await createActivation(d, ashtonId, justiceId);
  const act = await activateDevice(d, { token, tempPin: "12345", newPin: "482913", confirmPin: "482913", label: "Justice phone", ip: "10.0.0.2" });
  const members = [{ id: ashtonId, name: "Ashton Bott" }, { id: justiceId, name: "Justice Thompson" }];
  const ashton = new Phone("Ashton", ashtonId, org, members, deviceIds ? "device-ashton" : undefined);
  const justice = new Phone("Justice", justiceId, org, members, deviceIds ? "device-justice" : undefined);
  const { data: s } = await createClient(URL!, PUB, noPersist).auth.signInWithPassword({ email, password: pw });
  await ashton.signIn(s.session!);
  await justice.signIn(act.session);
  return { ashton, justice, org, admin };
}
