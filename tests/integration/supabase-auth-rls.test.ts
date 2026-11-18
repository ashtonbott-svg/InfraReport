/**
 * Integration tests against a REAL Supabase stack (Postgres + GoTrue auth +
 * PostgREST), with the project's migrations applied:
 *
 *   npx supabase start && npx supabase db reset
 *   npm run test:integration
 *
 * Skipped automatically when SUPABASE_TEST_URL is not set.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { activateDevice, activationInfo, AuthError, createActivation, createTechnician, deviceTechnicians, pinLogin, resetPin, revokeDevice, updateTechnician, type AuthDeps } from "@/lib/server/tech-auth";

const URL = process.env.SUPABASE_TEST_URL;
const PUB = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_TEST_SECRET_KEY!;
const DB = process.env.SUPABASE_TEST_DB_URL!;
const run = URL ? describe : describe.skip;

const pepper = "test-pepper-0123456789-0123456789-abcdef";
let clock = new Date();
const deps = (): AuthDeps => ({
  admin: createClient(URL!, SECRET, { auth: { persistSession: false, autoRefreshToken: false } }),
  anon: () => createClient(URL!, PUB, { auth: { persistSession: false, autoRefreshToken: false } }),
  pepper,
  now: () => clock,
});
const asUser = (accessToken: string): SupabaseClient =>
  createClient(URL!, PUB, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
const anonClient = () => createClient(URL!, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
const uniq = () => Math.random().toString(36).slice(2, 10);

async function sql(q: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}

run("Supabase auth + Row Level Security (real database)", () => {
  let ashton: SupabaseClient, ashtonId = "", org = "";
  let justice: SupabaseClient, justiceId = "", justiceDevice = "";
  let otherAdmin: SupabaseClient, otherOrg = "";
  const ids = { cust: `cust-${uniq()}`, fac: `fac-${uniq()}`, insp: `insp-${uniq()}`, insp2: `insp-${uniq()}`, loc: `loc-${uniq()}`, eq: `eq-${uniq()}`, rc: `rc-${uniq()}`, res: `res-${uniq()}`, img: `img-${uniq()}` };

  beforeAll(async () => {
    await sql("truncate public.organizations, public.memberships, public.tech_credentials, public.tech_devices, public.tech_activations, public.auth_rate_limits cascade");
    const d = deps();
    // Administrator: an existing, confirmed email account (like ashton@infiniteinfrared.com)
    const email = `ashton-${uniq()}@example.com`;
    const pw = `Pw-${uniq()}-${uniq()}`;
    const { data: u } = await d.admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
    ashtonId = u.user!.id;
    const [row] = await sql("select public.bootstrap_first_admin($1, 'Ashton Bott', 'Level III Certified Master Thermographer', 'Infinite Infrared LLC') as org", [email]);
    org = row.org;
    const { data: s } = await anonClient().auth.signInWithPassword({ email, password: pw });
    ashton = asUser(s.session!.access_token);

    // A second company with its own admin, to prove isolation
    const e2 = `other-${uniq()}@example.com`;
    const { data: u2 } = await d.admin.auth.admin.createUser({ email: e2, password: pw, email_confirm: true });
    otherOrg = `org-other-${uniq()}`;
    await sql("insert into public.organizations (id, name) values ($1, 'Other Co')", [otherOrg]);
    await sql("insert into public.memberships (user_id, organization_id, role, display_name) values ($1, $2, 'admin', 'Other Admin')", [u2.user!.id, otherOrg]);
    const { data: s2 } = await anonClient().auth.signInWithPassword({ email: e2, password: pw });
    otherAdmin = asUser(s2.session!.access_token);
  }, 60_000);

  it("bootstrap cannot be used again or by app users", async () => {
    await expect(sql("select public.bootstrap_first_admin('x@example.com','x','x','x')")).rejects.toThrow(/already exists/);
    const { error } = await ashton.rpc("bootstrap_first_admin", { admin_email: "x", admin_name: "x", admin_certification: "x", org_name: "x" });
    expect(error).not.toBeNull();
  });

  it("public sign-up is disabled", async () => {
    const { error } = await anonClient().auth.signUp({ email: `intruder-${uniq()}@example.com`, password: "Password-123456" });
    expect(error?.message ?? "").toMatch(/disabled|not allowed/i);
  });

  it("administrator creates a technician; only admins can", async () => {
    justiceId = await createTechnician(deps(), ashtonId, { name: "Justice Thompson", certification: "Level I Thermographer" });
    const m = await sql("select role, display_name, organization_id from public.memberships where user_id = $1", [justiceId]);
    expect(m[0]).toMatchObject({ role: "technician", display_name: "Justice Thompson", organization_id: org });
    await expect(createTechnician(deps(), justiceId, { name: "Hacker", certification: "" })).rejects.toThrow(/Administrator access required/);
  });

  it("temporary PIN alone grants nothing; activation needs a valid single-use token", async () => {
    const d = deps();
    await expect(activateDevice(d, { token: "made-up", tempPin: "12345", newPin: "482913", confirmPin: "482913", label: "x", ip: "1.1.1.1" })).rejects.toThrow(/invalid, already used or expired/);
    await expect(pinLogin(d, { deviceToken: "", userId: justiceId, pin: "12345", ip: "1.1.1.2" })).rejects.toThrow(/not activated/);
    const { token } = await createActivation(d, ashtonId, justiceId, 24);
    await expect(activateDevice(d, { token, tempPin: "11111", newPin: "482913", confirmPin: "482913", label: "x", ip: "1.1.1.3" })).rejects.toThrow(/Temporary PIN is incorrect/);
    await expect(activateDevice(d, { token, tempPin: "12345", newPin: "12345", confirmPin: "12345", label: "x", ip: "1.1.1.3" })).rejects.toThrow(/simple sequence/);
    await expect(activateDevice(d, { token, tempPin: "12345", newPin: "482913", confirmPin: "482914", label: "x", ip: "1.1.1.3" })).rejects.toThrow(/do not match/);
    const r = await activateDevice(d, { token, tempPin: "12345", newPin: "482913", confirmPin: "482913", label: "Justice iPhone", ip: "1.1.1.3" });
    expect(r.userId).toBe(justiceId);
    expect(r.session.access_token).toBeTruthy();
    justiceDevice = r.deviceToken;
    // single use
    await expect(activateDevice(d, { token, tempPin: "12345", newPin: "482913", confirmPin: "482913", label: "again", ip: "1.1.1.4" })).rejects.toThrow(/invalid, already used or expired/);
    const cred = await sql("select pin_hash from public.tech_credentials where user_id = $1", [justiceId]);
    expect(cred[0].pin_hash).toMatch(/^scrypt\$/);
    expect(cred[0].pin_hash).not.toContain("482913");
  });

  it("expired activation tokens are refused", async () => {
    const d = deps();
    const t2 = await createTechnician(d, ashtonId, { name: "Temp Tech", certification: "" });
    const { token } = await createActivation(d, ashtonId, t2, 1);
    clock = new Date(Date.now() + 2 * 3600_000);
    await expect(activateDevice(deps(), { token, tempPin: "12345", newPin: "482913", confirmPin: "482913", label: "x", ip: "1.1.2.1" })).rejects.toThrow(/expired/);
    clock = new Date();
  });

  it("a new phone or a new web address: activation link + CURRENT PIN; the PIN is kept, 12345 does not work", async () => {
    const d = deps();
    const before = (await sql("select pin_hash from public.tech_credentials where user_id = $1", [justiceId]))[0].pin_hash;
    const { token } = await createActivation(d, ashtonId, justiceId);
    expect(await activationInfo(d, { token, ip: "4.4.4.1" })).toEqual({ name: "Justice Thompson", hasPin: true });
    // The temporary PIN cannot be used to take over an account that already has a PIN.
    await expect(activateDevice(d, { token, tempPin: "12345", newPin: "777777", confirmPin: "777777", label: "x", ip: "4.4.4.2" })).rejects.toThrow(/PIN is not correct/);
    await expect(activateDevice(d, { token, currentPin: "000000", label: "x", ip: "4.4.4.3" })).rejects.toThrow(/PIN is not correct/);
    const r = await activateDevice(d, { token, currentPin: "482913", label: "Justice phone (production)", ip: "4.4.4.4" });
    expect(r.keptPin).toBe(true);
    expect((await sql("select pin_hash from public.tech_credentials where user_id = $1", [justiceId]))[0].pin_hash).toBe(before);
    // The new device signs in with the same PIN; the earlier device still works too.
    expect((await pinLogin(d, { deviceToken: r.deviceToken, userId: justiceId, pin: "482913", ip: "4.4.4.5" })).userId).toBe(justiceId);
    expect((await pinLogin(d, { deviceToken: justiceDevice, userId: justiceId, pin: "482913", ip: "4.4.4.6" })).userId).toBe(justiceId);
    // Single use as before.
    await expect(activateDevice(d, { token, currentPin: "482913", label: "x", ip: "4.4.4.7" })).rejects.toThrow(/invalid, already used or expired/);
  });

  it("PIN login: trusted device + personal PIN; lockout after repeated failures", async () => {
    const d = deps();
    expect((await deviceTechnicians(d, [justiceDevice])).map((x) => x.name)).toEqual(["Justice Thompson"]);
    const ok = await pinLogin(d, { deviceToken: justiceDevice, userId: justiceId, pin: "482913", ip: "2.2.2.1" });
    justice = asUser(ok.session.access_token);
    await expect(pinLogin(d, { deviceToken: "stolen-or-guessed", userId: justiceId, pin: "482913", ip: "2.2.2.2" })).rejects.toThrow(/not activated/);
    for (let i = 0; i < 4; i++) await expect(pinLogin(d, { deviceToken: justiceDevice, userId: justiceId, pin: "000001", ip: "2.2.2.3" })).rejects.toThrow(/Incorrect PIN/);
    await expect(pinLogin(d, { deviceToken: justiceDevice, userId: justiceId, pin: "000001", ip: "2.2.2.3" })).rejects.toThrow(/Locked for/);
    await expect(pinLogin(d, { deviceToken: justiceDevice, userId: justiceId, pin: "482913", ip: "2.2.2.3" })).rejects.toThrow(/Locked until/); // even the right PIN
    clock = new Date(Date.now() + 16 * 60_000);
    await pinLogin(deps(), { deviceToken: justiceDevice, userId: justiceId, pin: "482913", ip: "2.2.2.4" });
    clock = new Date();
  });

  it("rate limits PIN attempts per network address", async () => {
    const d = deps();
    let limited = false;
    for (let i = 0; i < 22 && !limited; i++) {
      try { await pinLogin(d, { deviceToken: "nope", userId: justiceId, pin: "000000", ip: "9.9.9.9" }); }
      catch (e) { if ((e as AuthError).code === "rate_limited") limited = true; }
    }
    expect(limited).toBe(true);
  });

  it("anonymous clients and technicians cannot read credential tables", async () => {
    for (const c of [anonClient(), justice]) {
      const { data, error } = await c.from("tech_credentials").select("*");
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    const { data: anonCust, error: anonErr } = await anonClient().from("customers").select("*");
    expect(anonErr !== null || (anonCust ?? []).length === 0).toBe(true);
  });

  it("admin creates the job; the technician sees nothing until assigned", async () => {
    expect((await ashton.from("customers").insert({ id: ids.cust, organization_id: org, name: "TopGolf (test)" })).error).toBeNull();
    expect((await ashton.from("facilities").insert({ id: ids.fac, organization_id: org, customer_id: ids.cust, name: "Venue" })).error).toBeNull();
    expect((await ashton.from("inspections").insert({ id: ids.insp, organization_id: org, customer_id: ids.cust, facility_id: ids.fac, date: "2026-11-19" })).error).toBeNull();
    expect((await ashton.from("inspections").insert({ id: ids.insp2, organization_id: org, customer_id: ids.cust, facility_id: ids.fac, date: "2026-12-01" })).error).toBeNull();
    expect((await justice.from("inspections").select("id")).data).toEqual([]);
    expect((await justice.from("customers").select("id")).data).toEqual([]);
    // technicians cannot create customers or assign themselves
    expect((await justice.from("customers").insert({ id: `c-${uniq()}`, organization_id: org, name: "x" })).error).not.toBeNull();
    expect((await justice.from("inspection_assignments").insert({ inspection_id: ids.insp, user_id: justiceId, organization_id: org })).error).not.toBeNull();
    expect((await ashton.from("inspection_assignments").insert({ inspection_id: ids.insp, user_id: justiceId, organization_id: org })).error).toBeNull();
    expect((await ashton.from("inspection_assignments").insert({ inspection_id: ids.insp, user_id: ashtonId, organization_id: org })).error).toBeNull();
    expect((await justice.from("inspections").select("id")).data).toEqual([{ id: ids.insp }]); // not insp2
    expect((await justice.from("customers").select("id")).data).toEqual([{ id: ids.cust }]);
  });

  it("both users create rooms, equipment, conditions, results and images in the shared inspection", async () => {
    expect((await justice.from("locations").insert({ id: ids.loc, organization_id: org, facility_id: ids.fac, name: "Electrical Room 1" })).error).toBeNull();
    const ashLoc = `loc-${uniq()}`;
    expect((await ashton.from("locations").insert({ id: ashLoc, organization_id: org, facility_id: ids.fac, name: "Electrical Room 2" })).error).toBeNull();
    expect((await justice.from("equipment").insert({ id: ids.eq, organization_id: org, facility_id: ids.fac, location_id: ids.loc, name: "Panel P1" })).error).toBeNull();
    expect((await justice.from("room_conditions").insert({ id: ids.rc, organization_id: org, inspection_id: ids.insp, location_id: ids.loc, humidity: "45" })).error).toBeNull();
    expect((await justice.from("results").insert({ id: ids.res, organization_id: org, inspection_id: ids.insp, equipment_id: ids.eq, location_id: ids.loc })).error).toBeNull();
    expect((await justice.from("thermal_images").insert({ id: ids.img, organization_id: org, inspection_id: ids.insp, result_id: ids.res, component: "Top Half", ir_image_number: "104", visual_image_number: "104", distance: "4" })).error).toBeNull();
    // both see both rooms
    const names = (await ashton.from("locations").select("name").eq("facility_id", ids.fac).order("name")).data!.map((r) => r.name);
    expect(names).toEqual(["Electrical Room 1", "Electrical Room 2"]);
    expect(((await justice.from("locations").select("name").eq("facility_id", ids.fac)).data ?? []).length).toBe(2);
    // who and when are recorded by the database
    const [rc] = (await ashton.from("room_conditions").select("created_by, updated_by, version").eq("id", ids.rc)).data!;
    expect(rc).toEqual({ created_by: justiceId, updated_by: justiceId, version: 1 });
  });

  it("versioning: updates bump the version; stale updates change nothing (no silent overwrite)", async () => {
    const a = await ashton.from("thermal_images").update({ distance: "5" }).eq("id", ids.img).eq("version", 1).select("version, updated_by");
    expect(a.data).toEqual([{ version: 2, updated_by: ashtonId }]);
    const stale = await justice.from("thermal_images").update({ distance: "9" }).eq("id", ids.img).eq("version", 1).select("version");
    expect(stale.data).toEqual([]); // conflict detected: the device must reconcile
    const [row] = (await justice.from("thermal_images").select("distance, version").eq("id", ids.img)).data!;
    expect(row).toEqual({ distance: "5", version: 2 });
    // clients cannot forge ownership/version columns
    await justice.from("thermal_images").update({ version: 99, created_by: ashtonId, organization_id: otherOrg }).eq("id", ids.img);
    const [after] = (await ashton.from("thermal_images").select("version, created_by, organization_id").eq("id", ids.img)).data!;
    expect(after).toEqual({ version: 3, created_by: justiceId, organization_id: org });
  });

  it("retried inserts cannot duplicate records", async () => {
    const again = await justice.from("thermal_images").insert({ id: ids.img, organization_id: org, inspection_id: ids.insp, result_id: ids.res });
    expect(again.error?.code).toBe("23505");
    const dupRoom = await ashton.from("room_conditions").insert({ id: `rc-${uniq()}`, organization_id: org, inspection_id: ids.insp, location_id: ids.loc });
    expect(dupRoom.error?.code).toBe("23505"); // one condition row per room per inspection
    const dupResult = await ashton.from("results").insert({ id: `res-${uniq()}`, organization_id: org, inspection_id: ids.insp, equipment_id: ids.eq, location_id: ids.loc });
    expect(dupResult.error?.code).toBe("23505");
  });

  it("technicians submit; only administrators approve or delete customers", async () => {
    const subm = await justice.from("inspections").update({ status: "Needs Review" }).eq("id", ids.insp).select("status, submitted_by");
    expect(subm.data).toEqual([{ status: "Needs Review", submitted_by: justiceId }]);
    const tryApprove = await justice.from("inspections").update({ status: "Approved" }).eq("id", ids.insp);
    expect(tryApprove.error?.message).toMatch(/Only administrators/);
    expect((await justice.from("customers").delete().eq("id", ids.cust).select("id")).data ?? []).toEqual([]);
    expect((await ashton.from("customers").select("id").eq("id", ids.cust)).data).toHaveLength(1);
    expect((await ashton.from("inspections").update({ status: "Approved" }).eq("id", ids.insp).select("status, approved_by")).data).toEqual([{ status: "Approved", approved_by: ashtonId }]);
    // Approved inspections are locked (migration 4): a technician's late edit is refused.
    const late = await justice.from("thermal_images").update({ notes: "late edit" }).eq("id", ids.img).select("id");
    expect(late.error?.message).toMatch(/approved and locked/);
  });

  it("another company's administrator sees none of it", async () => {
    for (const t of ["customers", "facilities", "locations", "equipment", "inspections", "results", "thermal_images", "room_conditions"]) {
      expect(((await otherAdmin.from(t).select("id")).data ?? []).length).toBe(0);
    }
    expect((await otherAdmin.from("customers").insert({ id: `x-${uniq()}`, organization_id: org, name: "x" })).error).not.toBeNull();
  });

  it("revoked devices, PIN resets and disabled accounts stop access", async () => {
    const d = deps();
    const dev = (await sql("select id from public.tech_devices where user_id = $1 and revoked_at is null", [justiceId]))[0].id;
    await revokeDevice(d, ashtonId, dev);
    await expect(pinLogin(d, { deviceToken: justiceDevice, userId: justiceId, pin: "482913", ip: "3.3.3.1" })).rejects.toThrow(/not activated/);
    const { token } = await resetPin(d, ashtonId, justiceId);
    const re = await activateDevice(d, { token, tempPin: "12345", newPin: "730264", confirmPin: "730264", label: "new phone", ip: "3.3.3.2" });
    const ok = await pinLogin(d, { deviceToken: re.deviceToken, userId: justiceId, pin: "730264", ip: "3.3.3.3" });
    expect(((await asUser(ok.session.access_token).from("inspections").select("id")).data ?? []).length).toBe(1);
    await updateTechnician(d, ashtonId, justiceId, { active: false });
    await expect(pinLogin(d, { deviceToken: re.deviceToken, userId: justiceId, pin: "730264", ip: "3.3.3.4" })).rejects.toThrow(/disabled|not activated/);
    // a token issued before disabling no longer reads data (membership inactive)
    expect(((await asUser(ok.session.access_token).from("inspections").select("id")).data ?? []).length).toBe(0);
    await updateTechnician(d, ashtonId, justiceId, { active: true });
  });
});
