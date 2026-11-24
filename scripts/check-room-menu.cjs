/**
 * Room menu and room deletion in Field Mode on an iPhone, including the last room.
 * Demo mode (device storage only): no database, no real inspection is touched.
 *   npx next dev -p 3100 (without Supabase variables), then: node scripts/check-room-menu.cjs http://localhost:3100
 */
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] || "http://localhost:3100";
const OUT = process.argv[3] || null;
const ok = (...a) => console.log("✔", ...a);
const O = "org-demo", I = "insp-roomtest", now = new Date().toISOString();
const img = (n, ir = "") => ({ id: `img-${n}`, component: "Full Panel", irImageNumber: ir, visualImageNumber: ir, visualOverridden: false, distance: "", possibleCause: "NONE", maxTemp: "", notes: "" });
function seed(rooms) {
  const s = { currentOrgId: O, activeInspectionId: I, customers: [{ id: "cust-rt", organizationId: O, name: "Room Test Co", contactName: "", contactEmail: "", contactPhone: "", notes: "", createdAt: now }],
    facilities: [{ id: "fac-rt", organizationId: O, customerId: "cust-rt", name: "Room Test Plant", address: "", city: "", state: "", postalCode: "", notes: "", createdAt: now }],
    locations: [], equipment: [], rooms: [], results: [], photos: [], reviewEvents: [],
    inspections: [{ id: I, organizationId: O, customerId: "cust-rt", facilityId: "fac-rt", date: now.slice(0, 10), inspectorIds: [], status: "In Progress", defaultEmissivity: "0.95", notes: "", createdAt: now, updatedAt: now,
      siteVisit: { state: "active", sessions: [{ startedAt: now, endedAt: null }], lastActiveLocationId: null, skippedExteriorPrompt: true, completedAt: null } }] };
  let n = 0;
  rooms.forEach(([name, items], ri) => {
    const loc = `loc-rt-${ri}`;
    s.locations.push({ id: loc, organizationId: O, facilityId: "fac-rt", building: "", name, area: "", sortOrder: ri + 1 });
    s.rooms.push({ id: `rc-${loc}`, organizationId: O, inspectionId: I, locationId: loc, humidity: "55", ambientTemp: "55", backgroundTemp: "55", distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null });
    for (const [eq, ir] of items) {
      n++;
      s.equipment.push({ id: `eq-${n}`, organizationId: O, facilityId: "fac-rt", locationId: loc, name: eq, equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: n, createdAt: now, importedFrom: "inventory.xlsx" });
      s.results.push({ id: `res-${n}`, organizationId: O, inspectionId: I, equipmentId: `eq-${n}`, locationId: loc, images: [img(n, ir)], opened: "Yes, Completely", exception: null, confidence: "", reviewNotes: "",
        overrides: { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: null }, source: "carried-forward", sortOrder: n, createdAt: now, updatedAt: now });
    }
  });
  return JSON.stringify({ state: s, version: 4 });
}
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("infrareport-demo-v1")).state);
  const load = async (rooms) => {
    await page.goto(BASE + "/", { timeout: 120000 });
    await page.evaluate((v) => localStorage.setItem("infrareport-demo-v1", v), seed(rooms));
    await page.goto(BASE + `/inspections/${I}/entry`, { timeout: 120000 });
  };
  const openPicker = async () => { await page.getByRole("button", { name: "Switch room" }).filter({ visible: true }).first().click(); await page.getByText("Switch Room").first().waitFor(); };
  const menu = async (room) => {
    await page.getByTestId("room-row").filter({ hasText: room }).getByTestId("room-menu").click();
    const del = page.getByTestId("room-menu-delete");
    await del.waitFor();
    // Fully visible and on top: nothing (sheet header, scroll area) covers it.
    const top = await del.evaluate((el) => { const r = el.getBoundingClientRect(); const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && (x === el || el.contains(x)); });
    if (!top) throw new Error(`room menu for ${room} is covered or off screen`);
  };
  const shot = (n) => OUT && page.screenshot({ path: `${OUT}/${n}.png` });

  // 3 rooms, 6 items: counts are labelled.
  await load([["Kitchen Electrical Room", [["Panel L", ""], ["Panel T", ""], ["Panel K", ""]]], ["Mechanical Room", [["Pump 1", "101"], ["Pump 2", ""]]], ["Main Electrical Room", [["MDP", ""]]]]);
  await openPicker();
  await page.getByText("3 rooms · 6 equipment items").waitFor();
  if ((await page.getByTestId("all-rooms-count").innerText()).trim() !== "6 items") throw new Error("All rooms count");
  const chips = await page.getByTestId("room-item-count").allInnerTexts();
  if (JSON.stringify(chips) !== JSON.stringify(["3 items", "2 items", "1 item"])) throw new Error("room chips " + chips);
  await shot("rm-1-counts");
  ok("counts: subtitle '3 rooms · 6 equipment items', All rooms '6 items', each room '3 items / 2 items / 1 item'");

  // Delete a room with one uninspected item.
  await menu("Main Electrical Room");
  await page.getByTestId("room-menu-delete").click();
  await page.getByTestId("delete-room-summary").getByText("This room contains 1 uninspected equipment item. Delete the room and the item?").waitFor();
  await page.getByTestId("confirm-delete-room").click();
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("infrareport-demo-v1")).state.locations.some((l) => l.name === "Main Electrical Room"));
  ok("room with 1 uninspected item deleted from the menu");

  // Mixed room: the item with a reading goes to a new room, the rest is deleted.
  await openPicker();
  await page.getByText("2 rooms · 5 equipment items").waitFor();
  await menu("Mechanical Room");
  await page.getByTestId("room-menu-delete").click();
  await page.getByTestId("delete-room-dialog").getByText(/must be moved to another room before the room is deleted: Pump 1/).waitFor();
  await page.getByTestId("move-all-dest").selectOption("__new__");
  await page.getByTestId("move-all-new-name").fill("Pump Room");
  await page.getByTestId("move-all-confirm").click();
  await page.getByTestId("delete-room-summary").getByText("This room contains 1 uninspected equipment item. Delete the room and the item?").waitFor();
  await page.getByTestId("confirm-delete-room").click();
  await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem("infrareport-demo-v1")).state; return !s.locations.some((l) => l.name === "Mechanical Room") && s.results.some((r) => r.images[0].irImageNumber === "101"); });
  ok("mixed room: Pump 1 (IR 101) moved to a new Pump Room, Pump 2 deleted with the room");

  // Last room: 1 room with 3 imported, uninspected items.
  await load([["Kitchen Electrical Room", [["Panel L", ""], ["Panel T", ""], ["Panel K", ""]]]]);
  await openPicker();
  await page.getByText("1 room · 3 equipment items").waitFor();
  await menu("Kitchen Electrical Room");
  await shot("rm-2-last-room-menu");
  await page.getByTestId("room-menu-delete").click();
  await page.getByTestId("delete-room-summary").getByText("This room contains 3 uninspected equipment items. Delete the room and all 3 items?").waitFor();
  await page.getByTestId("confirm-delete-room").click();
  await page.getByText("Add the first room").first().waitFor();
  await shot("rm-3-empty");
  let s = await st();
  if (s.locations.length || s.equipment.length || s.results.length || s.rooms.length) throw new Error("last room not fully removed");
  if (!s.inspections.some((i) => i.id === I) || !s.customers.length || !s.facilities.length) throw new Error("inspection, customer or facility lost");
  ok("last room deleted with its 3 uninspected items; clean 'Add the first room' state; inspection, customer and facility kept");
  await page.getByTestId("toast-action").click();
  await page.getByText("Panel K").first().waitFor();
  s = await st();
  if (s.equipment.length !== 3 || s.locations.length !== 1) throw new Error("undo");
  ok("Undo restored the room and its 3 items");
  await openPicker();
  await menu("Kitchen Electrical Room");
  await page.getByTestId("room-menu-delete").click();
  await page.getByTestId("confirm-delete-room").click();
  await page.getByText("Add the first room").first().waitFor();
  await page.reload();
  await page.getByText("Add the first room").first().waitFor();
  ok("deleted again; after a reload the inspection still opens with zero rooms (no deleted room referenced)");

  // Last room with saved work: protected, must be kept.
  await load([["Only Room", [["Panel A", "201"], ["Panel B", ""]]]]);
  await openPicker();
  await menu("Only Room");
  await page.getByTestId("room-menu-delete").click();
  await page.getByTestId("protected-items").getByText("IR 201").waitFor();
  if (await page.getByTestId("confirm-delete-room").isEnabled()) throw new Error("last room with work deletable");
  await shot("rm-4-last-room-protected");
  ok("last room holding a reading (Panel A, IR 201) is protected; it can be moved to a new room first");

  if (errors.length) throw new Error("page errors:\n" + errors.join("\n"));
  ok("no page errors");
  await browser.close();
})().catch((e) => { console.error("✘", e); process.exit(1); });
