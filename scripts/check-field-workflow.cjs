/**
 * Browser check of the field inspection workflow (release 5).
 * Starts from saved data in the previous (schema v3) format to prove the
 * upgrade keeps it, then walks the room / equipment / image workflow on an
 * iPhone and verifies the Excel export cell by cell.
 *
 *   npm run build && npx next start -p 3100 &
 *   node scripts/check-field-workflow.cjs [baseUrl] [screenshotDir]
 */
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const BASE = process.argv[2] || "http://localhost:3100";
const OUT = process.argv[3] || null;
const ok = (...a) => console.log("✔", ...a);
const shot = async (p, n) => { if (OUT) await p.screenshot({ path: path.join(OUT, n + ".png") }); };

const O = "org-demo";
const ov = { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: null };
const legacyResult = (id, eq, loc, sort, extra = {}) => ({
  id, organizationId: O, inspectionId: "insp-canton", equipmentId: eq, locationId: loc, component: "Full Panel", distance: "", irImageNumber: "", visualImageNumber: "",
  visualFromSinglePhoto: false, maxTemp: "", opened: "Yes, Completely", possibleCause: "NONE", problemNotes: "", confidence: "", reviewNotes: "", overrides: ov,
  source: "carried-forward", sortOrder: sort, createdAt: "2026-11-12T14:00:00.000Z", updatedAt: "2026-11-12T14:00:00.000Z", ...extra,
});
const eq = (id, loc, name, sort, type = "Panel", comp = "Full Panel") => ({ id, organizationId: O, facilityId: "fac-canton", locationId: loc, name, equipmentType: type, defaultComponent: comp, active: true, sortOrder: sort, createdAt: "", importedFrom: "canton.pdf" });
/** What the phone stored after yesterday's field test (schema v3). */
const V3 = {
  version: 3,
  state: {
    schemaVersion: 3, currentOrgId: O, currentUserId: "user-ashton", activeInspectionId: null,
    organizations: [{ id: O, name: "Infinite Infrared LLC", slug: "infinite-infrared", isDemo: false, createdAt: "", settings: { defaultEmissivity: "0.95", customPossibleCauses: [], csvIncludeBom: true } }],
    users: [{ id: "user-ashton", organizationId: O, name: "Ashton Bott", email: "", role: "owner", certification: "Level III Certified Master Thermographer" }, { id: "user-justice", organizationId: O, name: "Justice Thompson", email: "", role: "inspector", certification: "Level I Thermographer" }],
    customers: [{ id: "cust-canton", organizationId: O, name: "Top Golf Canton, Massachusetts", contactName: "", contactEmail: "", contactPhone: "", notes: "", createdAt: "" }],
    facilities: [{ id: "fac-canton", organizationId: O, customerId: "cust-canton", name: "TopGolf Canton", address: "", city: "Canton", state: "MA", postalCode: "", notes: "", createdAt: "" }],
    locations: [{ id: "loc-1", organizationId: O, facilityId: "fac-canton", building: "", name: "Electrical Room 1", area: "", sortOrder: 1 }, { id: "loc-2", organizationId: O, facilityId: "fac-canton", building: "", name: "Electrical Room 2", area: "", sortOrder: 2 }],
    equipment: [eq("e1", "loc-1", "Panel P1", 1), eq("e2", "loc-1", "Panel P2", 2), eq("e3", "loc-1", "Panel P3", 3), eq("e4", "loc-1", "Disconnect D2", 4, "Disconnect", "Full Disconnect"), eq("e5", "loc-2", "Panel P11", 5)],
    inspections: [{ id: "insp-canton", organizationId: O, customerId: "cust-canton", facilityId: "fac-canton", date: "2026-11-12", inspectorIds: ["user-ashton", "user-justice"], status: "In Progress", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "2026-11-12T20:00:00.000Z",
      siteVisit: { state: "paused", sessions: [{ startedAt: "2026-11-12T13:00:00.000Z", endedAt: "2026-11-12T20:00:00.000Z" }], lastActiveLocationId: "loc-1", skippedExteriorPrompt: false, completedAt: null } }],
    rooms: [
      { id: "rc-1", organizationId: O, inspectionId: "insp-canton", locationId: "loc-1", humidity: "", ambientTemp: "72", backgroundTemp: "71", distance: "", imageDate: "" },
      { id: "rc-2", organizationId: O, inspectionId: "insp-canton", locationId: "loc-2", humidity: "", ambientTemp: "", backgroundTemp: "", distance: "", imageDate: "" },
    ],
    results: [
      legacyResult("r1", "e1", "loc-1", 1, { distance: "4", irImageNumber: "104", visualImageNumber: "104", visualFromSinglePhoto: true }),
      legacyResult("r2", "e2", "loc-1", 2, { component: "Circuit 11", distance: "6", irImageNumber: "105", visualImageNumber: "105", maxTemp: "131.7", possibleCause: "Loose Connection(s)", problemNotes: "hot lug" }),
      legacyResult("r3", "e3", "loc-1", 3),
      legacyResult("r4", "e4", "loc-1", 4, { component: "Full Disconnect" }),
      legacyResult("r5", "e5", "loc-2", 5),
    ],
    images: [], documents: [], reviewEvents: [],
    photos: [{ id: "ext-1", organizationId: O, inspectionId: "insp-canton", facilityId: "fac-canton", kind: "exterior", building: "", resultId: null, fileName: "front.jpg", mimeType: "image/jpeg", sizeBytes: 10, capturedAt: "", savedAt: "" }],
  },
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true });
  await ctx.addInitScript((data) => { if (!localStorage.getItem("infrareport-seeded")) { localStorage.setItem("infrareport-demo-v1", data); localStorage.setItem("infrareport-seeded", "1"); } }, JSON.stringify(V3));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  const vis = (t) => page.getByText(t, { exact: false }).filter({ visible: true }).first();

  // 15. Upgrade keeps yesterday's data
  await page.goto(BASE + "/");
  await page.locator("[data-testid=resume-card]").waitFor();
  const card = await page.locator("[data-testid=resume-card]").innerText();
  if (!/TopGolf Canton/.test(card) || !/5 equipment/.test(card)) throw new Error("resume card after upgrade: " + card);
  await page.getByRole("button", { name: /Resume Inspection/ }).click();
  await page.waitForURL(/entry/);
  const cards = page.locator("button[data-result-id]");
  await cards.first().waitFor();
  const c1 = await cards.nth(0).innerText(), c2 = await cards.nth(1).innerText();
  if (!/IR 104/.test(c1) || !/4 ft/.test(c1)) throw new Error("P1 after upgrade: " + c1);
  if (!/Circuit 11/.test(c2) || !/131.7/.test(c2) || !/Loose Connection/.test(c2)) throw new Error("P2 after upgrade: " + c2);
  ok("15. saved v3 data upgraded: resume card, readings, finding intact");

  // 9 (banner). Room conditions incomplete
  await vis("Room Conditions Incomplete").waitFor();
  await vis("Humidity required").waitFor();
  const prog = await page.locator("[data-testid=room-progress]").filter({ visible: true }).innerText();
  if (!/Equipment 4/.test(prog) || !/Done 2/.test(prog) || !/2 remaining/.test(prog)) throw new Error("progress: " + prog);
  ok("room status banner (Humidity required) and progress Equipment 4 · Done 2 · 2 remaining");
  await shot(page, "01-room-banner");

  // 10. Imported To Do item, IR first then distance, visual auto
  await cards.nth(2).click();
  await page.locator("[data-testid=item-status]").filter({ hasText: "To do" }).waitFor();
  const vp = page.viewportSize();
  for (const id of ["#ed-0-ir", "#ed-0-dist", "[data-testid=save-next]"]) {
    const b = await page.locator(id).boundingBox();
    if (!b || b.y < 0 || b.y + b.height > vp.height) throw new Error(`${id} not visible without scrolling: ${JSON.stringify(b)}`);
  }
  ok("16. IR # and Distance side by side, visible with Save & Next, no scrolling");
  await shot(page, "02-equipment-screen");
  await page.locator("#ed-0-ir").fill("120");
  await vis("Visual # 120").waitFor();
  await page.locator("#ed-0-ir").press("Enter");
  if (await page.evaluate(() => document.activeElement?.id) !== "ed-0-dist") throw new Error("Enter in IR should move to Distance");
  await page.keyboard.type("4");
  await page.locator("#ed-0-dist").press("Enter");
  ok("4/6. IR then Distance: visual auto = 120, Next moves IR -> Distance");

  // 2. second image; 7. Distance first then IR; 5. different visual
  await page.getByRole("button", { name: "Add Another Image" }).click();
  await page.locator("#ed-1-comp").fill("Bottom Half");
  await page.locator("#ed-1-dist").fill("3");
  await page.locator("#ed-1-dist").press("Enter");
  if (await page.evaluate(() => document.activeElement?.id) !== "ed-1-ir") throw new Error("Enter in Distance should move to IR when IR is empty");
  await page.keyboard.type("121");
  await page.getByRole("button", { name: "Use Different Visual Number" }).click();
  await page.locator("#ed-1-vis").fill("900");
  await shot(page, "03-two-images");
  ok("2/5/7. second image (Bottom Half), Distance first then IR, different Visual # 900");

  // 8. Save & Next -> next equipment
  await page.getByTestId("save-next").click();
  await page.getByRole("heading", { name: /Disconnect D2/ }).waitFor();
  ok("8. Save & Next opened Disconnect D2");

  // 11. Inaccessible, documented without image numbers
  await page.getByRole("button", { name: /Can't scan this item/ }).click();
  await page.locator("#exc-opened").click();
  await page.locator("#exc-opened").fill("lock");
  await page.getByRole("option", { name: "Item is Locked Out" }).click();
  await page.getByRole("button", { name: "Not Scanned", exact: true }).click();
  await page.locator("[data-testid=item-status]").filter({ hasText: "Not scanned" }).waitFor();
  ok("11. Disconnect D2 marked Item is Locked Out + Not Scanned, no image number needed");

  // 9. Last item -> room checkpoint; humidity blocks; enter it there
  await page.getByTestId("save-next").click();
  await vis("Humidity required for this room").waitFor();
  if (await page.getByTestId("finish-room").isEnabled()) throw new Error("finish must be blocked without humidity");
  await shot(page, "04-checkpoint-humidity");
  await page.locator("#cp-h").fill("45");
  await page.getByTestId("finish-room").waitFor();
  if (!(await page.getByTestId("finish-room").isEnabled())) throw new Error("finish should be allowed after humidity");
  await page.getByTestId("finish-room").click();
  await page.getByRole("button", { name: "Switch room" }).filter({ hasText: "Electrical Room 2" }).waitFor();
  ok("9. humidity missing blocked Finish Room; entered in checkpoint; finished and moved to Electrical Room 2");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("infrareport-demo-v1")).state.rooms.find((r) => r.id === "rc-1"));
  if (saved.humidity !== "45" || saved.ambientTemp !== "72" || saved.backgroundTemp !== "71" || !saved.completedAt) throw new Error("room 1 conditions after finishing: " + JSON.stringify(saved));
  ok("existing ambient 72 / background 71 kept; humidity 45 saved; room marked finished");

  // Room 2: remaining items listed, jump back to them
  await page.getByRole("button", { name: "Finish Room" }).filter({ visible: true }).click();
  await vis("1 Equipment Item Remaining").waitFor();
  await page.locator("[data-testid=remaining-items] button").first().click();
  await page.getByRole("heading", { name: /Panel P11/ }).waitFor();
  await page.locator("#ed-0-ir").fill("410");
  await page.locator("#ed-0-dist").fill("5");
  // 13. Before opening photo with note
  await page.getByRole("button", { name: /More Details/ }).click();
  await page.locator("[data-testid=before-camera-input]").setInputFiles(path.join(__dirname, "../tests/fixtures/photos/panel.jpg"));
  await page.getByLabel("Photo note").fill("Main breaker found tripped");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await vis("Before-opening photo saved").waitFor();
  await vis("Main breaker found tripped").waitFor();
  ok("13. Before Opening photo saved with note, separate from image numbers");
  await page.getByTestId("save-next").click();
  await vis("Humidity required for this room").waitFor();
  await page.locator("#cp-h").fill("50");
  await page.getByTestId("finish-room").click();
  ok("remaining item reached from checkpoint, recorded, room finished");
  await page.getByRole("button", { name: "Add Equipment" }).click();
  await page.waitForFunction(() => document.querySelector("#eq-name-input")?.value === "Panel P12");
  await page.getByRole("button", { name: "Close" }).click();
  ok("Add Equipment opens with the next name suggested (Panel P12)");

  // 12. New room inventory created during the inspection, copied conditions flagged
  await page.getByRole("button", { name: "Add Room" }).first().click();
  await page.locator("#room-name").fill("Generator Room");
  await page.getByRole("button", { name: /Save Room/ }).click();
  await vis("Conditions copied from").waitFor();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByRole("button", { name: "Add Equipment" }).click();
  await page.locator("#eq-name-input").pressSequentially("pa");
  await page.getByRole("listbox", { name: "Name suggestions" }).getByRole("option", { name: "Panel", exact: true }).click();
  await page.locator("#eq-name-input").pressSequentially("P20");
  await page.locator("#new-0-ir").fill("300");
  await page.locator("#new-0-dist").fill("5");
  await page.getByRole("button", { name: /Save & Add Next/ }).click();
  await page.waitForFunction(() => document.querySelector("#eq-name-input")?.value === "Panel P21");
  await page.getByRole("button", { name: "Close" }).click();
  ok("12. new room: copied conditions confirmed, Panel P20 added, next name Panel P21");

  // 14. Excel export (desktop)
  const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, storageState: await ctx.storageState() });
  const dp = await d.newPage();
  dp.on("dialog", (x) => x.accept());
  await dp.goto(BASE + "/inspections/insp-canton/review");
  const exportBtn = dp.getByTestId("export-xlsx");
  await exportBtn.waitFor();
  // The inspection is still active in the copied state; the review page belongs to it, so it is reachable.
  const [dl] = await Promise.all([dp.waitForEvent("download"), exportBtn.click()]);
  const file = path.join(OUT || require("os").tmpdir(), dl.suggestedFilename());
  await dl.saveAs(file);
  if (!file.endsWith(".xlsx")) throw new Error("not xlsx: " + file);
  const { default: readXlsx } = await import(path.join(__dirname, "../node_modules/read-excel-file/universal/index.js"));
  const book = await readXlsx(new Blob([fs.readFileSync(file)]));
  const gen = book[0].data;
  if (book[0].sheet !== "Generator Import" || gen[0].length !== 16 || gen.some((r) => r.length !== 16)) throw new Error("sheet shape");
  const rows = gen.slice(1).map((r) => `${r[4]}|${r[5]}|${r[6]}|${r[8]}|${r[9]}|${r[13]}`);
  const expect = [
    "Panel P1|Full Panel|4|104|104|Yes, Completely",
    "Panel P2|Circuit 11|6|105|105|Yes, Completely",
    "Panel P3|Full Panel|4|120|120|Yes, Completely",
    "Panel P3|Bottom Half|3|121|900|Yes, Completely",
    "Disconnect D2|Full Disconnect|null|null|null|Item is Locked Out",
    "Panel P11|Full Panel|5|410|410|Yes, Completely",
    "Panel P20|Full Panel|5|300|300|Yes, Completely",
  ];
  if (JSON.stringify(rows) !== JSON.stringify(expect)) throw new Error("xlsx rows:\n" + rows.join("\n"));
  if (typeof gen[1][6] !== "number" || typeof gen[1][8] !== "number" || !(gen[1][0] instanceof Date) || gen[1][2] !== 45) throw new Error("cell types: " + JSON.stringify(gen[1]));
  if (gen[2][11] !== 131.7 || gen[2][7] !== "Loose Connection(s)") throw new Error("finding row: " + JSON.stringify(gen[2]));
  ok(`14. ${dl.suggestedFilename()}: real .xlsx, 16 columns, one row per thermal image (7 rows for 6 items), typed cells`);
  await d.close();

  // Layout: IR/Distance visible without scrolling on small and large devices
  for (const [name, dev] of [["iPhone SE", devices["iPhone SE"]], ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]], ["iPad portrait", devices["iPad (gen 7)"]]]) {
    const c = await browser.newContext({ ...dev, storageState: await ctx.storageState() });
    const p = await c.newPage();
    await p.goto(BASE + "/inspections/insp-canton/entry?room=loc-1");
    await p.locator("button[data-result-id]").first().click();
    await p.locator("#ed-0-ir").waitFor();
    const v = p.viewportSize();
    const bad = [];
    for (const id of ["#ed-0-ir", "#ed-0-dist", "[data-testid=save-next]"]) { const b = await p.locator(id).boundingBox(); if (!b || b.y + b.height > v.height) bad.push(id); }
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (bad.length || overflow > 0) throw new Error(`${name}: not visible ${bad} overflow ${overflow}`);
    if (OUT) await p.screenshot({ path: path.join(OUT, `05-${name.replace(/ /g, "_")}.png`) });
    ok(`${name}: IR #, Distance and Save & Next visible without scrolling, no sideways scroll`);
    await c.close();
  }
  if (errors.length) throw new Error("page errors: " + errors.join("; "));
  ok("no page errors");
  await browser.close();
})().catch((e) => { console.error("✘ FAILED:", e.message.split("\n").slice(0, 12).join("\n")); process.exit(1); });
