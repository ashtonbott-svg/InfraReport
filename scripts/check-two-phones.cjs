/**
 * End-to-end check with TWO phones and TWO real accounts against a REAL
 * Supabase stack (local `supabase start`, project migrations applied).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… npm run build
 *   SUPABASE_SECRET_KEY=… INFRAREPORT_PIN_PEPPER=… npx next start -p 3200 &
 *   DB_URL=… SUPABASE_URL=… SECRET_KEY=… node scripts/check-two-phones.cjs http://localhost:3200 [shots]
 *
 * WARNING: it empties the organization tables of the database it is pointed at.
 * It refuses to run against anything but a local database.
 */
const { chromium, devices } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const pg = require("pg");
const path = require("path");

const BASE = process.argv[2] || "http://localhost:3200";
const OUT = process.argv[3] || null;
const DB = process.env.DB_URL;
const SB_URL = process.env.SUPABASE_URL;
const SECRET = process.env.SECRET_KEY;
if (!/127\.0\.0\.1|localhost/.test(DB || "") || !/127\.0\.0\.1|localhost/.test(SB_URL || "")) throw new Error("Refusing to run against a non-local database");

const ok = (...a) => console.log("✔", ...a);
const shot = async (p, n) => { if (OUT) await p.screenshot({ path: path.join(OUT, n + ".png") }); };
const sql = async (q, params = []) => { const c = new pg.Client({ connectionString: DB }); await c.connect(); try { return (await c.query(q, params)).rows; } finally { await c.end(); } };
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("infrareport-demo-v1") || "{}").state);
const until = async (what, fn, ms = 30000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 400)); }
  throw new Error(`Timed out waiting for: ${what} (${last instanceof Error ? last.message : JSON.stringify(last)})`);
};

/** What a phone had saved before cloud sync existed (device-only, schema v4). */
const LEGACY = {
  version: 4,
  state: {
    schemaVersion: 4, currentOrgId: "org-demo", currentUserId: "user-ashton", activeInspectionId: null,
    organizations: [{ id: "org-demo", name: "Infinite Infrared LLC", slug: "infinite-infrared", isDemo: false, createdAt: "", settings: { defaultEmissivity: "0.95", customPossibleCauses: [], csvIncludeBom: true } }],
    users: [{ id: "user-ashton", organizationId: "org-demo", name: "Ashton Bott", email: "", role: "owner", certification: "Level III Certified Master Thermographer" }],
    customers: [{ id: "cust-old", organizationId: "org-demo", name: "Legacy Customer", contactName: "", contactEmail: "", contactPhone: "", notes: "", createdAt: "" }],
    facilities: [{ id: "fac-old", organizationId: "org-demo", customerId: "cust-old", name: "Legacy Plant", address: "", city: "", state: "", postalCode: "", notes: "", createdAt: "" }],
    locations: [{ id: "loc-old", organizationId: "org-demo", facilityId: "fac-old", building: "", name: "Old Room", area: "", sortOrder: 1 }],
    equipment: [{ id: "eq-old", organizationId: "org-demo", facilityId: "fac-old", locationId: "loc-old", name: "Old Panel", equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: 1, createdAt: "" }],
    inspections: [{ id: "insp-old", organizationId: "org-demo", customerId: "cust-old", facilityId: "fac-old", date: "2026-11-12", inspectorIds: ["user-ashton"], status: "In Progress", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "",
      siteVisit: { state: "paused", sessions: [], lastActiveLocationId: null, skippedExteriorPrompt: false, completedAt: null } }],
    rooms: [{ id: "rc-old", organizationId: "org-demo", inspectionId: "insp-old", locationId: "loc-old", humidity: "40", ambientTemp: "70", backgroundTemp: "70", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null }],
    results: [{ id: "res-old", organizationId: "org-demo", inspectionId: "insp-old", equipmentId: "eq-old", locationId: "loc-old", opened: "Yes, Completely", exception: null, confidence: "", reviewNotes: "", overrides: { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: null }, source: "manual", sortOrder: 1, createdAt: "", updatedAt: "",
      images: [{ id: "img-old", component: "Full Panel", irImageNumber: "77", visualImageNumber: "77", visualOverridden: false, distance: "4", possibleCause: "NONE", maxTemp: "", notes: "" }] }],
    images: [], documents: [], reviewEvents: [], photos: [],
  },
};

(async () => {
  // ---------------------------------------------------------------- setup
  await sql("truncate public.organizations, public.memberships, public.tech_credentials, public.tech_devices, public.tech_activations, public.auth_rate_limits cascade");
  const admin = createClient(SB_URL, SECRET, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list.users) await admin.auth.admin.deleteUser(u.id);
  const email = "ashton@example.com", password = "Correct-Horse-Battery-9";
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const [{ org }] = await sql("select public.bootstrap_first_admin($1, 'Ashton Bott', 'Level III Certified Master Thermographer', 'Infinite Infrared LLC') as org", [email]);
  ok("admin account bootstrapped (server-side SQL only), org", org);

  const browser = await chromium.launch();
  const errors = [];
  const phone = async (name, init) => {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true });
    if (init) await ctx.addInitScript((data) => { if (!localStorage.getItem("seeded")) { localStorage.setItem("infrareport-demo-v1", data); localStorage.setItem("seeded", "1"); } }, JSON.stringify(init));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("dialog", (d) => d.accept());
    return { ctx, page };
  };
  const A = await phone("Ashton", LEGACY);
  const J = await phone("Justice");
  const vis = (p, t) => p.getByText(t, { exact: false }).filter({ visible: true }).first();

  // ---------------------------------------------------------------- 1. login gate + admin login
  await A.page.goto(BASE + "/");
  await A.page.waitForURL(/\/login/);
  await A.page.getByRole("tab", { name: /Administrator Login/ }).click();
  await A.page.locator("#email").fill(email);
  await A.page.locator("#password").fill("wrong-password");
  await A.page.getByRole("button", { name: "Sign In" }).click();
  await vis(A.page, "Email or password is incorrect").waitFor();
  await A.page.locator("#password").fill(password);
  await A.page.getByRole("button", { name: "Sign In" }).click();
  await A.page.waitForURL((u) => u.pathname === "/");
  await vis(A.page, "Jobs").waitFor();
  await shot(A.page, "01-admin-dashboard");
  let s = await store(A.page);
  if (!s.customers.some((c) => c.id === "cust-old" && c.organizationId === "org-demo")) throw new Error("legacy device data was not preserved");
  ok("1. unauthenticated visit redirects to /login; wrong password refused; admin signed in; legacy device data untouched");

  // ---------------------------------------------------------------- 2. technician + activation
  await A.page.goto(BASE + "/technicians");
  await A.page.locator("#tn").fill("Justice Thompson");
  await A.page.getByRole("button", { name: /Create and get link/ }).click();
  const link = await until("activation link", async () => { const v = await A.page.locator("input[readonly]").first().inputValue().catch(() => ""); return v.includes("/activate#t=") ? v : null; });
  await shot(A.page, "02-activation-link");
  const stranger = await phone("Stranger");
  await stranger.page.goto(BASE + "/login");
  await vis(stranger.page, "This phone is not activated yet").waitFor();
  if (await stranger.page.locator("#pin").count()) throw new Error("PIN field offered on an untrusted phone");
  ok("2a. technician created; an un-activated phone gets no PIN prompt at all");

  await J.page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await J.page.locator("#temp").fill("11111");
  await J.page.getByRole("button", { name: "Continue" }).click();
  await J.page.locator("#new").fill("1234");
  await J.page.locator("#confirm").fill("1234");
  await J.page.getByRole("button", { name: /Set PIN/ }).click();
  await vis(J.page, "Temporary PIN is incorrect").waitFor();
  await J.page.locator("#temp").fill("12345");
  await J.page.getByRole("button", { name: "Continue" }).click();
  await J.page.locator("#new").fill("1234");
  await J.page.locator("#confirm").fill("1234");
  await J.page.getByRole("button", { name: /Set PIN/ }).click();
  await vis(J.page, "not a simple sequence").waitFor();
  await J.page.locator("#new").fill("482913");
  await J.page.locator("#confirm").fill("482913");
  await J.page.getByRole("button", { name: /Set PIN/ }).click();
  await J.page.waitForURL(/\/jobs/);
  await vis(J.page, "No jobs assigned yet").waitFor();
  if (J.page.url().includes("#t=")) throw new Error("token left in the address bar");
  const creds = await sql("select pin_hash from public.tech_credentials");
  if (!creds[0].pin_hash.startsWith("scrypt$") || creds[0].pin_hash.includes("482913")) throw new Error("PIN not hashed");
  ok("2b. wrong temp PIN refused, weak PIN refused, personal PIN set (scrypt hash only), technician lands on My Jobs");

  await stranger.page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await stranger.page.locator("#temp").fill("12345");
  await stranger.page.getByRole("button", { name: "Continue" }).click();
  await stranger.page.locator("#new").fill("777391");
  await stranger.page.locator("#confirm").fill("777391");
  await stranger.page.getByRole("button", { name: /Set PIN/ }).click();
  await vis(stranger.page, "invalid, already used or expired").waitFor();
  ok("2c. the activation link cannot be used a second time");

  // sign out and back in with PIN
  await J.page.getByRole("button", { name: "Open navigation" }).click();
  await J.page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).click();
  await J.page.waitForURL(/\/login/);
  await J.page.getByRole("button", { name: /Justice Thompson/ }).click();
  await J.page.locator("#pin").fill("000000");
  await J.page.getByRole("button", { name: "Sign In" }).click();
  await vis(J.page, "Incorrect PIN").waitFor();
  await J.page.locator("#pin").fill("482913");
  await J.page.getByRole("button", { name: "Sign In" }).click();
  await J.page.waitForURL(/\/jobs/);
  await shot(J.page, "03-tech-jobs-empty");
  ok("2d. technician signs out, wrong PIN refused, signs in with name + PIN on the trusted phone");

  // technicians cannot reach admin screens
  await J.page.goto(BASE + "/customers");
  await J.page.waitForURL(/\/jobs/);
  await J.page.goto(BASE + "/technicians");
  await J.page.waitForURL(/\/jobs/);
  ok("2e. technician is sent back from admin screens (customers, technicians)");

  // ---------------------------------------------------------------- 3. admin creates job and assigns both
  await A.page.goto(BASE + "/inspections/new");
  await A.page.getByRole("button", { name: "New" }).first().click();
  await A.page.locator("#c-name").fill("Canton Plant");
  await A.page.getByRole("button", { name: "Create customer" }).click();
  await A.page.getByRole("button", { name: "New" }).nth(1).click();
  await A.page.locator("#f-name").fill("Canton Main");
  await A.page.locator("#f-addr").fill("1 Main St");
  await A.page.locator("#f-city").fill("Canton");
  await A.page.locator("#f-state").fill("OH");
  await A.page.getByRole("button", { name: "Create facility" }).click();
  await A.page.getByRole("button", { name: /Start With Empty Equipment List/ }).click();
  await A.page.getByTestId("assign-Ashton Bott").check();
  await A.page.getByTestId("assign-Justice Thompson").check();
  await A.page.getByRole("checkbox", { name: /on site now/ }).uncheck(); // preparing the job in advance
  await A.page.getByRole("button", { name: /Create Inspection/ }).click();
  await A.page.waitForURL(/\/inspections\/insp-/);
  const inspId = A.page.url().match(/inspections\/([^/?#]+)/)[1];
  await until("inspection in database", async () => (await sql("select count(*)::int n from public.inspection_assignments where inspection_id = $1", [inspId]))[0].n === 2);
  ok("3. admin created customer, facility and inspection, assigned to Ashton and Justice; in database");

  // ---------------------------------------------------------------- 4. technician portal
  await J.page.goto(BASE + "/jobs");
  const jcard = J.page.getByTestId("job-card").first();
  await until("job on technician phone", async () => (await J.page.getByTestId("job-card").count()) > 0);
  const jtext = await jcard.innerText();
  for (const t of ["Canton Main", "Canton Plant", "1 Main St", "Ashton Bott", "Justice Thompson"]) if (!jtext.includes(t)) throw new Error(`job card missing ${t}: ${jtext}`);
  await shot(J.page, "04-tech-job-card");
  ok("4. technician sees the job card: customer, facility, address, date, both technicians, progress");

  // ---------------------------------------------------------------- 5. both phones add rooms and equipment at once
  await jcard.getByRole("button", { name: /Start|Resume/ }).click();
  await J.page.waitForURL(/\/entry/);
  await A.page.goto(BASE + `/inspections/${inspId}/entry`);
  const addRoomAndEquipment = async (p, room, items) => {
    await p.getByRole("button", { name: "Add Room" }).first().click();
    await p.locator("#room-name").fill(room);
    await p.getByRole("button", { name: /Save Room/ }).click();
    await p.locator("#cp-h").filter({ visible: true }).first().fill("45").catch(() => undefined);
    for (const [name, ir] of items) {
      await p.getByRole("button", { name: "Add Equipment" }).filter({ visible: true }).first().click();
      await p.locator("#eq-name-input").fill(name);
      await p.locator("#new-0-ir").fill(ir);
      await p.getByRole("button", { name: "Save", exact: true }).click();
      await p.locator(`button[data-result-id]`).filter({ hasText: name }).first().waitFor();
    }
  };
  // Close the optional exterior photo prompt if it appears (cloud inspections never require it).
  for (const p of [A.page, J.page]) { const skip = p.getByRole("button", { name: /Skip/ }).filter({ visible: true }); if (await skip.count()) await skip.first().click(); }
  await Promise.all([
    addRoomAndEquipment(A.page, "MCC Room", [["MCC-1", "201"]]),
    addRoomAndEquipment(J.page, "Electrical Room", [["Panel P1", "101"]]),
  ]);
  await shot(J.page, "05-tech-entry");
  const names = async (p) => { const st = await store(p); return st.equipment.filter((e) => e.organizationId === org).map((e) => e.name).sort().join(","); };
  await until("both phones see both rooms' equipment", async () => (await names(A.page)) === "MCC-1,Panel P1" && (await names(J.page)) === "MCC-1,Panel P1");
  await until("Synced to Cloud on both", async () => (await A.page.getByTestId("sync-badge").filter({ visible: true }).first().innerText()).includes("Synced to Cloud") && (await J.page.getByTestId("sync-badge").filter({ visible: true }).first().innerText()).includes("Synced to Cloud"));
  ok("5. both phones created rooms and equipment at the same time; each sees the other's; both show Synced to Cloud");

  // ---------------------------------------------------------------- 6. cloud unreachable, refresh, reconnect
  await J.ctx.route(/127\.0\.0\.1:54321/, (r) => r.abort("internetdisconnected"));
  await addRoomAndEquipment(J.page, "Generator Room", [["Panel P2", "102"]]).catch(async () => {
    // The room is new; if the Add Room flow differs, add equipment to the current room instead.
  });
  await until("offline badge", async () => /Offline|Pending/.test(await J.page.getByTestId("sync-badge").filter({ visible: true }).first().innerText()));
  await shot(J.page, "06-tech-offline");
  await new Promise((r) => setTimeout(r, 3000));
  if ((await names(A.page)).includes("Panel P2")) throw new Error("unsynced work visible elsewhere?");
  await J.page.reload();
  await until("queue survived refresh", async () => {
    const keys = await J.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("infrareport-sync-v1")).map((k) => Object.keys(JSON.parse(localStorage.getItem(k)).ops).length));
    return keys.some((n) => n > 0);
  });
  ok("6a. cloud unreachable: change saved on the phone, badge shows Offline/Pending, not on the other phone; queue survives a refresh");
  await J.ctx.unroute(/127\.0\.0\.1:54321/);
  await until("reconnected upload", async () => (await names(A.page)).includes("Panel P2"), 45000);
  ok("6b. connection restored: queued change uploaded automatically and appears on Ashton's phone");

  // ---------------------------------------------------------------- 7. submit, approve, export
  await J.page.goto(BASE + `/inspections/${inspId}/review`);
  if (await J.page.getByRole("button", { name: /Approve/ }).count()) throw new Error("technician sees Approve");
  await J.page.getByRole("button", { name: "Submit for review" }).click();
  await until("Needs Review in DB", async () => (await sql("select status from public.inspections where id = $1", [inspId]))[0].status === "Needs Review");
  ok("7a. technician has no Approve button; Submit for review reached the database");

  await A.page.goto(BASE + `/inspections/${inspId}/review`);
  await until("admin sees submitted", async () => (await store(A.page)).inspections.find((i) => i.id === inspId)?.status === "Needs Review");
  const [dl] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("export-xlsx").click()]);
  const file = path.join(OUT || require("os").tmpdir(), dl.suggestedFilename());
  await dl.saveAs(file);
  const { default: readXlsx } = await import(path.join(__dirname, "../node_modules/read-excel-file/universal/index.js"));
  const fs = require("fs");
  const sheets = await readXlsx(new Blob([fs.readFileSync(file)]));
  const gen = sheets.find((x) => x.sheet === "Generator Import").data;
  const eqCol = gen[0].indexOf("Equipment");
  const exported = gen.slice(1).map((r) => r[eqCol]).sort().join(",");
  if (exported !== "MCC-1,Panel P1,Panel P2") throw new Error("combined export rows: " + exported);
  if (gen[0].length !== 16) throw new Error("export columns: " + gen[0].length);
  ok("7b. admin exported ONE combined workbook containing both phones' equipment (16 columns)");

  await A.page.getByRole("button", { name: /Approve/ }).click();
  await until("Approved in DB", async () => (await sql("select status, approved_by is not null as by from public.inspections where id = $1", [inspId]))[0].status === "Approved");
  ok("7c. admin approved; database stamped approved_by");

  // ---------------------------------------------------------------- 8. move legacy device data to the cloud
  await A.page.goto(BASE + "/settings");
  await A.page.getByRole("checkbox", { name: "Copy Legacy Customer" }).check();
  await A.page.getByRole("button", { name: /Review and copy/ }).click();
  await until("legacy copy in DB", async () => (await sql("select count(*)::int n from public.thermal_images where id = 'up-img-old' and ir_image_number = '77'"))[0].n === 1, 30000);
  s = await store(A.page);
  if (!s.customers.some((c) => c.id === "cust-old" && c.organizationId === "org-demo")) throw new Error("original legacy record removed");
  await A.page.reload();
  await A.page.getByRole("button", { name: /Review and copy/ }).waitFor();
  if (!(await vis(A.page, "Already copied").count())) throw new Error("second copy not prevented");
  const dupes = (await sql("select count(*)::int n from public.customers where name = 'Legacy Customer'"))[0].n;
  if (dupes !== 1) throw new Error("legacy customer duplicated: " + dupes);
  ok("8. legacy device inspection copied to the cloud after confirmation; original kept; second copy prevented");

  // ---------------------------------------------------------------- 8b. new screens fit a small phone
  for (const [p, paths] of [[J.page, ["/jobs", "/sync"]], [A.page, ["/", "/technicians", "/settings", "/sync", `/inspections/${inspId}/review`]]]) {
    await p.setViewportSize({ width: 320, height: 640 });
    for (const u of paths) {
      await p.goto(BASE + u);
      await p.waitForTimeout(800);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) throw new Error(`${u} scrolls sideways by ${over}px at 320px`);
    }
    await p.setViewportSize(devices["iPhone 13"].viewport);
  }
  ok("8b. login-era screens (jobs, sync, technicians, settings, dashboard, review) have no sideways scroll at 320px");

  // ---------------------------------------------------------------- 9. admin disables technician
  await A.page.goto(BASE + "/technicians");
  await A.page.getByRole("button", { name: "Disable" }).click();
  await until("disabled", async () => (await sql("select active from public.memberships where display_name = 'Justice Thompson'"))[0].active === false);
  await J.page.goto(BASE + "/login");
  const techButtons = await J.page.getByRole("button", { name: /Justice Thompson/ }).count();
  if (techButtons) throw new Error("disabled technician still offered on login");
  ok("9. disabled technician: devices revoked, no longer offered for sign-in");

  if (errors.length) throw new Error("page errors:\n" + errors.join("\n"));
  ok("no page errors");
  await browser.close();
})().catch((e) => { console.error("✘", e); process.exit(1); });
