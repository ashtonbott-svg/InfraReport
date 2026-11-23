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
  await vis(stranger.page, "invalid, already used or expired").waitFor();
  if (await stranger.page.locator("#temp, #current, #new").count()) throw new Error("PIN fields offered for a used link");
  ok("2c. the activation link cannot be used a second time (refused before any PIN is asked)");

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

  // ---------------------------------------------------------------- 2f. same technician, another phone / web address: keep the PIN
  const pinBefore = (await sql("select pin_hash from public.tech_credentials"))[0].pin_hash;
  await A.page.goto(BASE + "/technicians");
  await A.page.getByRole("button", { name: /Activate a phone/ }).click();
  const link2 = await until("second activation link", async () => { const v = await A.page.locator("input[readonly]").first().inputValue().catch(() => ""); return v.includes("/activate#t=") && v !== link ? v : null; });
  if (!(await vis(A.page, "Their PIN does not change").count())) throw new Error("admin not told the PIN is kept");
  const J2 = await phone("Justice second phone");
  await J2.page.goto(link2.replace(/^https?:\/\/[^/]+/, BASE));
  await vis(J2.page, "Trust this phone, Justice").waitFor();
  if (await J2.page.locator("#temp").count()) throw new Error("temporary PIN asked although a PIN exists");
  await J2.page.locator("#current").fill("111111");
  await J2.page.getByRole("button", { name: /Trust This Phone/ }).click();
  await vis(J2.page, "PIN is not correct").waitFor();
  await J2.page.locator("#current").fill("482913");
  await J2.page.getByRole("button", { name: /Trust This Phone/ }).click();
  await J2.page.waitForURL(/\/jobs/);
  if ((await sql("select pin_hash from public.tech_credentials"))[0].pin_hash !== pinBefore) throw new Error("PIN changed by re-activation");
  await J2.ctx.close();
  ok("2f. another phone (like the production address): activation link + Justice's CURRENT PIN; wrong PIN refused; PIN unchanged; no new account");

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
  const ashtonId = (await sql("select user_id from public.memberships where role = 'admin'"))[0].user_id;
  const justiceId = (await sql("select user_id from public.memberships where role = 'technician'"))[0].user_id;
  // Two people assigned and no primary designated: the field team is asked.
  await J.page.getByTestId("primary-prompt").waitFor();
  await shot(J.page, "05a-primary-prompt");
  await J.page.getByTestId("primary-prompt").getByRole("button", { name: /Ashton Bott/ }).click();
  // Then the front building photo reminder.
  await J.page.getByTestId("remind-later").waitFor();
  for (const t of ["Take Front Photo", "Already Taken With Camera", "Remind Me Later"]) if (!(await J.page.getByRole("button", { name: t }).count())) throw new Error("reminder missing option " + t);
  await shot(J.page, "05b-front-photo-reminder");
  await J.page.getByTestId("remind-later").click();
  await until("primary synced to the admin phone", async () => (await store(A.page)).inspections.find((i) => i.id === inspId)?.primaryThermographerId === ashtonId);
  ok("5a. Start: Primary Thermographer prompt (Ashton chosen; synced to the other phone); front building photo reminder offers Take Front Photo / Already Taken With Camera / Remind Me Later");
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
  await Promise.all([
    addRoomAndEquipment(A.page, "MCC Room", [["MCC-1", "201"]]),
    addRoomAndEquipment(J.page, "Electrical Room", [["Panel P1", "101"]]),
  ]);
  await shot(J.page, "05-tech-entry");
  const names = async (p) => { const st = await store(p); return st.equipment.filter((e) => e.organizationId === org).map((e) => e.name).sort().join(","); };
  await until("both phones see both rooms' equipment", async () => (await names(A.page)) === "MCC-1,Panel P1" && (await names(J.page)) === "MCC-1,Panel P1");
  await until("Synced to Cloud on both", async () => (await A.page.getByTestId("sync-badge").filter({ visible: true }).first().innerText()).includes("Synced to Cloud") && (await J.page.getByTestId("sync-badge").filter({ visible: true }).first().innerText()).includes("Synced to Cloud"));
  ok("5. both phones created rooms and equipment at the same time; each sees the other's; both show Synced to Cloud");

  // ---------------------------------------------------------------- 5b. rename, multiple views, notes, reorder (through the screens)
  const resultByName = async (p, name) => { const st = await store(p); return st.results.find((r) => r.inspectionId === inspId && st.equipment.find((e) => e.id === r.equipmentId)?.name === name); };
  const jp1 = await resultByName(J.page, "Panel P1");
  await J.page.locator(`button[data-result-id="${jp1.id}"]`).click();
  await J.page.getByTestId("rename-equipment").click();
  await J.page.locator("#rename-input").fill("Panel P1A");
  await J.page.getByTestId("rename-save").click();
  await J.page.getByTestId("views-top-bottom").click();
  await J.page.getByTestId("next-view").click();
  await J.page.locator("#ed-1-ir").fill("105");
  await J.page.locator("#ed-1-notes").fill("RC 6, A Phase, Class 2");
  await shot(J.page, "05c-two-views");
  await J.page.keyboard.press("Escape");
  const p1a = (await store(J.page)).results.find((r) => r.id === jp1.id);
  if (JSON.stringify(p1a.images.map((i) => [i.component, i.irImageNumber])) !== JSON.stringify([["Top Half", "101"], ["Bottom Half", "105"]])) throw new Error("views: " + JSON.stringify(p1a.images));
  if ((await store(J.page)).equipment.filter((e) => e.name.startsWith("Panel P1")).length !== 1) throw new Error("rename created a duplicate");
  await until("rename and views reach the admin phone", async () => { const r = await resultByName(A.page, "Panel P1A"); return r && r.images.length === 2 && r.images[1].notes === "RC 6, A Phase, Class 2"; });
  ok("5b. renamed Panel P1 -> Panel P1A with the pencil (same record, IR 101 kept); Top & Bottom gave two views of ONE item; note typed on the Bottom Half view; all synced");

  // Administrator adds MCC-2 then moves it above MCC-1 with Reorder Equipment.
  await A.page.getByRole("button", { name: "Add Equipment" }).filter({ visible: true }).first().click();
  await A.page.locator("#eq-name-input").fill("MCC-2");
  await A.page.locator("#new-0-ir").fill("202");
  await A.page.getByRole("button", { name: "Save", exact: true }).click();
  await A.page.locator("button[data-result-id]").filter({ hasText: "MCC-2" }).first().waitFor();
  await A.page.getByTestId("reorder-open").click();
  await A.page.getByRole("button", { name: "Move MCC-2 up" }).click();
  await shot(A.page, "05d-reorder");
  await A.page.getByRole("button", { name: "Done", exact: true }).click();
  const order = async (p) => { const st = await store(p); return st.results.filter((r) => r.inspectionId === inspId && st.equipment.find((e) => e.id === r.equipmentId)?.name.startsWith("MCC")).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => st.equipment.find((e) => e.id === r.equipmentId).name).join(","); };
  if ((await order(A.page)) !== "MCC-2,MCC-1") throw new Error("reorder: " + (await order(A.page)));
  await until("order synced to technician", async () => (await order(J.page)) === "MCC-2,MCC-1");
  ok("5c. Reorder Equipment: MCC-2 moved above MCC-1; the order synced to the other phone");

  // Technician moves MCC-1 (already has IR 201) into a new room from the equipment screen.
  const mcc1 = await resultByName(J.page, "MCC-1");
  const eqBefore = (await sql("select count(*)::int n from public.equipment where deleted_at is null"))[0].n;
  await J.page.goto(BASE + `/inspections/${inspId}/entry?room=${mcc1.locationId}`);
  await J.page.locator(`button[data-result-id="${mcc1.id}"]`).click();
  await J.page.getByTestId("move-to-room").click();
  if ((await J.page.getByTestId("move-current-room").innerText()).trim() !== "MCC Room") throw new Error("current room not shown");
  await J.page.getByTestId("move-new-room").click();
  await J.page.locator("#move-room-name").fill("Switchgear Room");
  if (await J.page.getByTestId("move-conditions").count()) {
    if (await J.page.getByTestId("move-confirm").isEnabled()) throw new Error("move allowed before choosing the room conditions");
    await J.page.getByTestId("move-keep-conditions").click();
  }
  await shot(J.page, "05e-move-to-room");
  await J.page.getByTestId("move-confirm").click();
  const moved = async (p) => { const st = await store(p); const r = st.results.find((x) => x.id === mcc1.id); const l = st.locations.find((x) => x.id === r?.locationId); return r && l && l.name === "Switchgear Room" && r.images[0].irImageNumber === "201" && st.locations.filter((x) => x.name === "Switchgear Room").length === 1; };
  if (!(await moved(J.page))) throw new Error("move not applied on the technician phone");
  await until("move reaches the admin phone", () => moved(A.page));
  await until("move in database", async () => (await sql("select l.name from public.results r join public.locations l on l.id = r.location_id where r.id = $1", [mcc1.id]))[0].name === "Switchgear Room");
  if ((await sql("select count(*)::int n from public.equipment where deleted_at is null"))[0].n !== eqBefore) throw new Error("move duplicated equipment");
  ok("5d. Move to Room: technician moved MCC-1 (IR 201) into a new Switchgear Room; same record, readings kept, no duplicate; synced to the admin phone and the database");

  // Technician deletes a room of uninspected equipment from the Rooms list menu, undoes it, then deletes it for good.
  await addRoomAndEquipment(J.page, "Temp Room", [["TMP-1", ""], ["TMP-2", ""]]);
  const tmpIds = async (p) => (await store(p)).equipment.filter((e) => e.name.startsWith("TMP-")).map((e) => e.id);
  await until("temp items on admin phone", async () => (await tmpIds(A.page)).length === 2);
  const openRoomMenu = async (p, room) => {
    await p.getByRole("button", { name: "Switch room" }).filter({ visible: true }).first().click();
    await p.getByTestId("room-row").filter({ hasText: room }).getByTestId("room-menu").click();
  };
  await openRoomMenu(J.page, "Temp Room");
  await shot(J.page, "05e-room-menu");
  await J.page.getByTestId("room-menu-delete").click();
  await J.page.getByTestId("delete-room-summary").getByText("This room contains 2 uninspected equipment items. Delete the room and all 2 items?").waitFor();
  await J.page.getByTestId("confirm-delete-room").click();
  await until("temp room gone from the Rooms list", async () => !(await store(J.page)).locations.some((l) => l.name === "Temp Room"));
  await shot(J.page, "05f-room-deleted-undo");
  await J.page.getByTestId("toast-action").click();
  await until("undo restored the items on the technician phone", async () => (await tmpIds(J.page)).length === 2);
  await until("restored items on admin phone", async () => (await tmpIds(A.page)).length === 2);
  const tmpRoomId = (await store(J.page)).locations.find((l) => l.name === "Temp Room").id;
  await J.page.goto(BASE + `/inspections/${inspId}/entry?room=${tmpRoomId}`);
  // Two items with readings in the same room are protected: named, and moved together from the dialog.
  for (const [nm, ir] of [["TMP-3", "301"], ["TMP-4", "302"]]) {
    await J.page.getByRole("button", { name: "Add Equipment" }).filter({ visible: true }).first().click();
    await J.page.locator("#eq-name-input").fill(nm);
    await J.page.locator("#new-0-ir").fill(ir);
    await J.page.getByRole("button", { name: "Save", exact: true }).click();
    await J.page.locator("button[data-result-id]").filter({ hasText: nm }).first().waitFor();
  }
  await openRoomMenu(J.page, "Temp Room");
  await J.page.getByTestId("room-menu-delete").click();
  await J.page.getByTestId("delete-room-dialog").getByText(/must be moved to another room before the room is deleted: TMP-3, TMP-4/).waitFor();
  await J.page.getByTestId("protected-items").getByText("IR 302").waitFor();
  if (await J.page.getByTestId("confirm-delete-room").isEnabled()) throw new Error("delete offered while TMP-3/4 have readings");
  await shot(J.page, "05g-protected");
  await J.page.getByTestId("move-all-dest").selectOption({ label: "Electrical Room" });
  await J.page.getByTestId("move-all-confirm").click();
  await J.page.getByTestId("delete-room-summary").getByText("This room contains 2 uninspected equipment items. Delete the room and all 2 items?").waitFor();
  await J.page.getByTestId("confirm-delete-room").click();
  const tmpLeft = async (p) => (await store(p)).equipment.filter((e) => e.name.startsWith("TMP-")).map((e) => e.name).sort().join(",");
  await until("temp room gone on admin phone, TMP-3/4 kept", async () => (await tmpLeft(A.page)) === "TMP-3,TMP-4" && !(await store(A.page)).locations.some((l) => l.name === "Temp Room"));
  const kept = async () => (await sql("select e.name, t.ir_image_number ir, l.name room from public.equipment e join public.results r on r.equipment_id = e.id and r.deleted_at is null join public.thermal_images t on t.result_id = r.id and t.deleted_at is null join public.locations l on l.id = r.location_id where e.name in ('TMP-3','TMP-4') and e.deleted_at is null order by e.name")).map((x) => `${x.name}|${x.ir}|${x.room}`).join(",");
  await until("TMP-1/2 soft deleted in database, TMP-3/4 kept with readings in Electrical Room", async () => (await sql("select count(*)::int n from public.equipment where name in ('TMP-1','TMP-2') and deleted_at is not null"))[0].n === 2
    && (await kept()) === "TMP-3|301|Electrical Room,TMP-4|302|Electrical Room");
  if ((await resultByName(J.page, "MCC-1")).images[0].irImageNumber !== "201") throw new Error("other rooms changed");
  ok("5e. Rooms list menu (iPhone): Temp Room deleted with its 2 uninspected items in one confirmation; Undo brought them back on both phones; TMP-3 and TMP-4 (readings) named, moved together with Move all, kept; then room + 2 items deleted (soft) everywhere");

  // Administrator on a wide desktop renames a room from the Rooms sidebar menu; the technician's phone follows.
  const railMenu = (room) => A.page.getByTestId("room-row").filter({ visible: true, hasText: room }).getByTestId("room-menu").click();
  await A.page.setViewportSize({ width: 1700, height: 950 });
  await A.page.goto(BASE + `/inspections/${inspId}/entry`);
  await railMenu("MCC Room").catch(async (e) => { await A.page.screenshot({ path: (OUT || "/tmp") + "/fail-5e2.png" }); throw e; });
  await shot(A.page, "05h-room-menu-desktop");
  await A.page.getByTestId("room-menu-rename").click();
  await A.page.locator("#rename-room-name").fill("MCC Room East");
  await A.page.getByTestId("rename-room-save").click();
  await until("rename reaches the technician", async () => (await store(J.page)).locations.some((l) => l.name === "MCC Room East"));
  await A.page.getByTestId("room-row").filter({ visible: true, hasText: "MCC Room East" }).waitFor();
  await railMenu("MCC Room East");
  await A.page.getByTestId("room-menu-rename").click();
  await A.page.locator("#rename-room-name").fill("MCC Room");
  await A.page.getByTestId("rename-room-save").click();
  await until("name restored on the technician", async () => (await store(J.page)).locations.some((l) => l.name === "MCC Room") && !(await store(J.page)).locations.some((l) => l.name === "MCC Room East"));
  // Narrower desktop: the ⋯ button beside the room dropdown offers the same menu.
  await A.page.setViewportSize({ width: 1280, height: 800 });
  await A.page.getByRole("combobox", { name: "Select room" }).selectOption({ label: "MCC Room (1)" });
  await A.page.getByTestId("room-menu").filter({ visible: true }).first().click();
  await A.page.getByTestId("room-menu-delete").filter({ visible: true }).waitFor();
  await A.page.keyboard.press("Escape");
  await A.page.mouse.click(5, 5);
  await A.page.setViewportSize(devices["iPhone 13"].viewport);
  ok("5e2. Rooms sidebar menu (desktop): administrator renamed MCC Room and back; the technician's phone followed; the ⋯ menu is also beside the room dropdown on narrower screens");

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

  // ---------------------------------------------------------------- 7. finish without photos, admin review/edit, Excel before and after approval
  const readWorkbook = async (dl) => {
    const file = path.join(OUT || require("os").tmpdir(), `${Date.now()}-${dl.suggestedFilename()}`);
    await dl.saveAs(file);
    const { default: readXlsx } = await import(path.join(__dirname, "../node_modules/read-excel-file/universal/index.js"));
    const sheets = await readXlsx(new Blob([require("fs").readFileSync(file)]));
    const gen = sheets.find((x) => x.sheet === "Generator Import").data;
    if (!/^InfraReport_Canton_Plant_Canton_Main_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename())) throw new Error("Infinite Infrared filename: " + dl.suggestedFilename());
    if (gen[0].length !== 15 || gen[0].includes("Confidence") || !gen[0].includes("Max Temp")) throw new Error("export columns: " + gen[0].join("|"));
    if (sheets.map((x) => x.sheet).join("|") !== "Generator Import|Equipment Summary|Column Map") throw new Error("sheets: " + sheets.map((x) => x.sheet));
    const col = (h) => gen[0].indexOf(h);
    const ordered = gen.slice(1).map((r) => `${r[col("Location")]}|${r[col("Equipment")]}|${r[col("IR Image Number")]}`);
    const notes = Object.fromEntries(gen.slice(1).map((r) => [`${r[col("Equipment")]}|${r[col("IR Image Number")]}`, r[col("Review Notes")]]));
    return Object.assign([...ordered].sort(), { ordered, notes });
  };
  const readIrt = async (dl) => {
    if (!/^Canton_Plant_Canton_Main_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename())) throw new Error("IRT filename: " + dl.suggestedFilename());
    const file = path.join(OUT || require("os").tmpdir(), `${Date.now()}-${dl.suggestedFilename()}`);
    await dl.saveAs(file);
    const { default: readXlsx } = await import(path.join(__dirname, "../node_modules/read-excel-file/universal/index.js"));
    const sheets = await readXlsx(new Blob([require("fs").readFileSync(file)]));
    if (sheets.map((x) => x.sheet).join("|") !== "Data") throw new Error("IRT sheets: " + sheets.map((x) => x.sheet));
    const d = sheets[0].data;
    if (d[0].length !== 13 || d[0].includes("Max Temp") || d[0].includes("Visual Image Number") || d[0].includes("Confidence")) throw new Error("IRT columns: " + d[0].join("|"));
    if (/InfraReport|Infinite Infrared/.test(JSON.stringify(d))) throw new Error("IRT workbook contains branding");
    const col = (h) => d[0].indexOf(h);
    return d.slice(1).map((r) => `${r[col("Location")]}|${r[col("Equipment")]}|${r[col("IR Image Number")]}`).sort();
  };

  // Technician: Exit -> Finish Site Visit, with no exterior, equipment or thermal photos at all.
  await J.page.goto(BASE + `/inspections/${inspId}/entry`);
  await J.page.getByRole("button", { name: "Exit", exact: true }).click();
  // "Remind Me Later" earlier: the reminder comes back before finishing.
  await J.page.getByTestId("ack-camera").first().waitFor();
  if (!(await J.page.getByRole("button", { name: /Finish Site Visit/ }).isDisabled())) throw new Error("finish allowed before the front photo decision");
  await shot(J.page, "07-front-photo-before-finish");
  await J.page.getByTestId("ack-camera").first().click();
  await vis(J.page, "Taken with the camera").waitFor();
  await J.page.getByRole("button", { name: /Finish Site Visit/ }).click();
  await until("Needs Review in DB", async () => (await sql("select status, submitted_by is not null as s from public.inspections where id = $1", [inspId]))[0].status === "Needs Review");
  if ((await store(J.page)).photos.length !== 0) throw new Error("photos were required/saved");
  await J.page.goto(BASE + `/inspections/${inspId}/review`);
  if (await J.page.getByRole("button", { name: /Approve/ }).count()) throw new Error("technician sees Approve");
  if (await J.page.getByTestId("header-download-xlsx").count()) throw new Error("technician sees admin download in header");
  await shot(J.page, "07-tech-submitted");
  if ((await sql("select status, acknowledged_by from public.exterior_checks where inspection_id = $1", [inspId]))[0]?.acknowledged_by !== justiceId) throw new Error("front photo acknowledgment not stored");
  await J.page.getByTestId("submitted-info").filter({ hasText: "Justice Thompson" }).waitFor();
  ok("7a. reminder returned before finishing; 'Already Taken With Camera' recorded for Justice; finished with zero photos; Submitted for Review by Justice Thompson");

  // The other phone: the same inspection shows as submitted, with no second Submit button.
  await A.page.goto(BASE + `/inspections/${inspId}/review`);
  await until("admin sees the submission", async () => (await A.page.getByTestId("submitted-info").count()) > 0);
  if (await A.page.getByTestId("submit-review").count()) throw new Error("second Submit offered");
  if (!/Ashton Bott/.test(await A.page.getByTestId("review-primary").innerText())) throw new Error("primary not shown in review");
  await until("ack on admin phone", async () => ((await store(A.page)).exteriorChecks ?? []).some((c) => c.inspectionId === inspId && c.status === "camera"));
  const submissions = await sql("select count(*)::int n from public.review_events where inspection_id = $1 and action = 'Submitted for review'", [inspId]);
  if (submissions[0].n !== 1) throw new Error("submission events: " + submissions[0].n);
  ok("7a2. the other phone shows 'Submitted for Review' (no duplicate Submit), the primary thermographer and the front photo acknowledgment; exactly one submission event");

  // Administrator: review queue card with a prominent Download Excel button.
  await A.page.goto(BASE + "/");
  await until("submitted card on dashboard", async () => (await A.page.getByText("Submitted for review").count()) > 0);
  await shot(A.page, "08-admin-review-queue");

  // Administrator edits a technician's reading after submission.
  const st = await store(A.page);
  const p1 = st.results.find((r) => r.inspectionId === inspId && st.equipment.find((e) => e.id === r.equipmentId)?.name === "Panel P1A");
  await A.page.goto(BASE + `/inspections/${inspId}/entry?room=${p1.locationId}`);
  await A.page.locator(`button[data-result-id="${p1.id}"]`).click();
  await A.page.locator("#ed-0-ir").fill("111");
  await A.page.getByTestId("save-next").click();
  await until("admin edit in DB", async () => (await sql("select ir_image_number from public.thermal_images where result_id = $1 order by sort_order", [p1.id]))[0].ir_image_number === "111");
  ok("7b. administrator edited the technician's Panel P1A Top Half reading (IR 101 -> 111) after submission; saved to the database");

  // Download before approval from the dashboard card.
  await A.page.goto(BASE + "/");
  const card = A.page.getByTestId("job-card").filter({ hasText: "Canton Main" });
  await card.getByTestId("card-download-xlsx").click();
  await shot(A.page, "08b-format-choice");
  const [dl1] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("card-download-xlsx-infinite").click()]);
  const rows1 = await readWorkbook(dl1);
  const expected = ["Electrical Room|Panel P1A|105", "Electrical Room|Panel P1A|111", "Electrical Room|TMP-3|301", "Electrical Room|TMP-4|302", "Generator Room|Panel P2|102", "MCC Room|MCC-2|202", "Switchgear Room|MCC-1|201"];
  if (JSON.stringify(rows1) !== JSON.stringify(expected)) throw new Error("export before approval: " + JSON.stringify(rows1));
  const o = rows1.ordered;
  if (!(o.indexOf("MCC Room|MCC-2|202") < o.indexOf("Switchgear Room|MCC-1|201")) || !(o.indexOf("Electrical Room|Panel P1A|111") < o.indexOf("Electrical Room|Panel P1A|105"))) throw new Error("export order: " + JSON.stringify(o));
  if (rows1.notes["Panel P1A|105"] !== "RC 6, A Phase, Class 2") throw new Error("note missing in export: " + JSON.stringify(rows1.notes));
  await card.getByTestId("card-download-xlsx").click();
  const [dlIrt] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("card-download-xlsx-irt").click()]);
  const irtRows = await readIrt(dlIrt);
  if (JSON.stringify(irtRows) !== JSON.stringify(expected)) throw new Error("IRT rows: " + JSON.stringify(irtRows));
  ok("7c. before approval: Infinite Infrared (15 columns, 3 sheets, InfraReport_ filename) and IRT (13 columns, one Data sheet, no Max Temp or Visual Image Number, no branding, Customer_Facility_Date filename); every view of every item from both phones, new order, admin edit and the typed note");

  // Approve, then download again from the inspection header.
  await A.page.goto(BASE + `/inspections/${inspId}/review`);
  await A.page.getByRole("button", { name: /Approve/ }).click();
  await until("Approved in DB", async () => (await sql("select status, approved_by is not null as by from public.inspections where id = $1", [inspId]))[0].status === "Approved");
  await A.page.getByTestId("header-download-xlsx").click();
  const [dl2] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("header-download-xlsx-infinite").click()]);
  const rows2 = await readWorkbook(dl2);
  if (JSON.stringify(rows2) !== JSON.stringify(expected)) throw new Error("export after approval: " + JSON.stringify(rows2));
  await shot(A.page, "09-admin-approved");
  await A.page.getByTestId("header-download-xlsx").click();
  const [dl2b] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("header-download-xlsx-irt").click()]);
  if (JSON.stringify(await readIrt(dl2b)) !== JSON.stringify(expected)) throw new Error("IRT after approval");
  ok("7d. approved (database stamped approved_by); both Excel formats after approval give the same complete data");

  // ---------------------------------------------------------------- 7e. approved = locked; reopen, tracked, approve again
  await until("tech sees approved", async () => (await store(J.page)).inspections.find((i) => i.id === inspId)?.status === "Approved");
  await J.page.goto(BASE + `/inspections/${inspId}/review`);
  await J.page.getByTestId("approval-locked").waitFor();
  if (await J.page.getByTestId("reopen").count()) throw new Error("technician offered Reopen");
  const tst = await store(J.page);
  const p2 = tst.results.find((r) => r.inspectionId === inspId && tst.equipment.find((e) => e.id === r.equipmentId)?.name === "Panel P2");
  await J.page.goto(BASE + `/inspections/${inspId}/entry?room=${p2.locationId}`);
  await J.page.locator(`button[data-result-id="${p2.id}"]`).click();
  await J.page.locator("#ed-0-ir").fill("999");
  await vis(J.page, "approved and locked").waitFor();
  await shot(J.page, "10-tech-locked");
  await J.page.goto(BASE + "/jobs");
  if ((await store(J.page)).results.find((r) => r.id === p2.id).images[0].irImageNumber !== "102") throw new Error("locked edit was kept on the phone");
  if ((await sql("select ir_image_number from public.thermal_images where result_id = $1", [p2.id]))[0].ir_image_number !== "102") throw new Error("locked edit reached the database");
  ok("7e. approved inspection is locked: technician's edit refused with a message, nothing changed on the phone or in the database");

  await A.page.goto(BASE + `/inspections/${inspId}/review`);
  await A.page.getByTestId("reopen").click();
  await A.page.getByTestId("approval-reopened").waitFor();
  await until("reopened in DB", async () => (await sql("select status, reopen_count, approved_at from public.inspections where id = $1", [inspId]))[0].reopen_count === 1);
  await until("tech sees reopened", async () => (await store(J.page)).inspections.find((i) => i.id === inspId)?.status === "In Progress");
  await J.page.goto(BASE + `/inspections/${inspId}/entry?room=${p2.locationId}`);
  await J.page.locator(`button[data-result-id="${p2.id}"]`).click();
  await J.page.locator("#ed-0-ir").fill("103");
  await J.page.getByTestId("save-next").click();
  await until("correction in DB", async () => (await sql("select ir_image_number from public.thermal_images where result_id = $1", [p2.id]))[0].ir_image_number === "103");
  await A.page.reload();
  await until("change log shows correction", async () => /IR Image Number: 102 → 103/.test(await A.page.getByTestId("change-log").innerText().catch(() => "")));
  await shot(A.page, "11-admin-changes-since-approval");
  await A.page.getByRole("button", { name: /Approve again/ }).click();
  await until("approved again", async () => (await sql("select status from public.inspections where id = $1", [inspId]))[0].status === "Approved");
  await A.page.getByTestId("header-download-xlsx").click();
  const [dl3] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("header-download-xlsx-infinite").click()]);
  const rows3 = await readWorkbook(dl3);
  if (!rows3.includes("Generator Room|Panel P2|103")) throw new Error("export after re-approval: " + JSON.stringify(rows3));
  ok("7f. admin reopened for corrections, technician corrected IR 102 -> 103, change shown in Changes since approval, approved again, Excel has the correction");

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

  // ---------------------------------------------------------------- 8c. inventory: move, delete, archive (inspection is approved)
  const approvedRows = async () => { await A.page.goto(BASE + `/inspections/${inspId}/review`); await A.page.getByTestId("header-download-xlsx").click(); const [d] = await Promise.all([A.page.waitForEvent("download"), A.page.getByTestId("header-download-xlsx-infinite").click()]); return readWorkbook(d); };
  const reportBefore = JSON.stringify(await approvedRows());
  const facId = (await store(A.page)).inspections.find((i) => i.id === inspId).facilityId;
  await A.page.goto(BASE + `/facilities/${facId}`);
  const roomSection = (n) => A.page.locator("section").filter({ has: A.page.getByRole("heading", { name: n, exact: true }) });
  await roomSection("MCC Room").waitFor();
  const facOver = await A.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (facOver > 1) throw new Error(`facility inventory scrolls sideways by ${facOver}px on a phone`);
  await roomSection("MCC Room").getByTestId("delete-room").click();
  // MCC-2's readings are in the approved report: it is kept (retired) and the room archived.
  await A.page.getByTestId("delete-room-dialog").getByText(/approved report uses this room, so it is archived: those reports keep the room and its equipment \(retired, not deleted\)/).waitFor();
  await shot(A.page, "10-archive-room");
  await A.page.getByTestId("confirm-delete-room").click();
  await A.page.getByTestId("archived-rooms").getByText("MCC Room").waitFor();
  await until("archived in database", async () => (await sql("select archived_at is not null a, deleted_at is null d from public.locations where name = 'MCC Room'"))[0].a === true);
  if ((await sql("select deleted_at is null d from public.locations where name = 'MCC Room'"))[0].d !== true) throw new Error("archived room was deleted");
  await until("tech phone has the room archived and MCC-2 retired in it", async () => { const st = await store(J.page); const l = st.locations.find((x) => x.name === "MCC Room"); const e = st.equipment.find((x) => x.name === "MCC-2"); return l?.archivedAt && e && e.active === false && e.locationId === l.id; });
  if ((await sql("select deleted_at is null kept, active from public.equipment where name = 'MCC-2'"))[0].kept !== true) throw new Error("MCC-2 was deleted");
  if (JSON.stringify(await approvedRows()) !== reportBefore) throw new Error("approved report changed after inventory move/archive");
  // An empty room is deleted outright.
  await A.page.goto(BASE + `/facilities/${facId}`);
  await A.page.getByRole("button", { name: "Add Room" }).first().click();
  await A.page.locator("#l-name").fill("Spare Room");
  await A.page.getByRole("button", { name: "Save", exact: true }).click();
  await until("spare room uploaded", async () => (await sql("select count(*)::int n from public.locations where name = 'Spare Room' and deleted_at is null"))[0].n === 1);
  await until("spare room on tech phone", async () => (await store(J.page)).locations.some((x) => x.name === "Spare Room"));
  await roomSection("Spare Room").getByTestId("delete-room").click();
  await A.page.getByTestId("delete-room-summary").getByText(/It has no uninspected equipment/).waitFor();
  await A.page.getByTestId("confirm-delete-room").click();
  await until("spare room deleted in database", async () => (await sql("select deleted_at is not null g from public.locations where name = 'Spare Room'"))[0]?.g === true);
  await until("spare room gone on tech phone", async () => !(await store(J.page)).locations.some((x) => x.name === "Spare Room"));
  ok("8c. facility inventory: room used by the approved report is archived with MCC-2 retired, not deleted (approved report unchanged); empty room deleted; both phones and database agree");

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
