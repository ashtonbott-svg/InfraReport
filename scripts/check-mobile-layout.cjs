/**
 * Browser check: no page may be wider than the phone screen, and customer
 * deletion must only remove the chosen customer.
 *
 *   npm run build && npx next start -p 3100 &
 *   node scripts/check-mobile-layout.cjs [baseUrl] [screenshotDir]
 *
 * Requires Playwright with Chromium (preinstalled in the dev container).
 */
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] || "http://localhost:3100";
const OUT = process.argv[3] || null;
const FX = require("path").join(__dirname, "../tests/fixtures/import");
const ok = (...a) => console.log("✔", ...a);

async function makeCustomer(page, name, facility) {
  await page.goto(BASE + "/customers");
  await page.getByRole("button", { name: "New Customer" }).first().click();
  await page.fill("#c-name", name);
  await page.getByRole("button", { name: "Create customer" }).click();
  await page.getByRole("link", { name }).first().click();
  await page.getByRole("button", { name: "Add Facility" }).first().click();
  await page.fill("#f-name", facility);
  await page.getByRole("button", { name: "Create facility" }).click();
  await page.getByRole("button", { name: /Import Existing Equipment List/ }).click();
  await page.locator("[data-testid=import-file]").setInputFiles(FX + "/equipment-list-table.pdf");
  await page.getByText("equipment items ready").first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /Approve & Save Inventory/ }).click();
  await page.getByRole("button", { name: /Create New Inspection/ }).click();
  await page.selectOption("#ni-th-lead", { index: 1 });
  await page.getByLabel(/on site now/).uncheck();
  await page.getByRole("button", { name: "Create Inspection" }).click();
  await page.waitForURL(/entry/);
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return { vw, sw: document.documentElement.scrollWidth, body: document.body.scrollWidth };
  });
}

(async () => {
  const browser = await chromium.launch();
  const setup = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await setup.newPage();
  sp.on("dialog", (d) => d.accept());
  await makeCustomer(sp, "Top Golf Canton, Massachusetts", "Top Golf Canton Entertainment Venue");
  await makeCustomer(sp, "Top Golf Cranston RI", "Cranston Test Site");
  const state = await setup.storageState();
  const inspUrl = sp.url();
  let bad = 0;
  const sizes = [["iPhone SE", devices["iPhone SE"]], ["iPhone 13", devices["iPhone 13"]], ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]], ["iPad portrait", devices["iPad (gen 7)"]]];
  for (const [name, dev] of sizes) {
    const c = await browser.newContext({ ...dev, storageState: state });
    const p = await c.newPage();
    for (const path of ["/", "/customers", "/facilities", "/inspections", "/inspections/new", "/reports", "/settings", "/field-notes", "/images", new URL(inspUrl).pathname, new URL(inspUrl).pathname.replace("/entry", "/review"), new URL(inspUrl).pathname.replace("/entry", "")]) {
      await p.goto(BASE + path);
      await p.waitForTimeout(500);
      const r = await overflow(p);
      if (r.sw > r.vw || r.body > r.vw) { bad++; console.log(`✘ ${name} ${path}: page ${r.sw}px wide on a ${r.vw}px screen`); }
      if (OUT && path === "/") await p.screenshot({ path: `${OUT}/dashboard-${name.replace(/ /g, "_")}.png`, fullPage: true });
    }
    // Pipeline uses the full content width
    await p.goto(BASE + "/");
    const pipe = await p.getByText("Inspections by status").locator("xpath=../../..").boundingBox();
    const main = await p.locator("main").boundingBox();
    if (pipe && main && pipe.width < main.width - 80) { bad++; console.log(`✘ ${name}: Pipeline ${pipe.width}px of ${main.width}px`); }
    ok(`${name}: ${dev.viewport.width}px, no page-level sideways scroll, Pipeline full width`);
    await c.close();
  }

  // Delete the Cranston customer on a phone; Canton must be untouched
  const c = await browser.newContext({ ...devices["iPhone 13"], storageState: state });
  const p = await c.newPage();
  await p.goto(BASE + "/customers");
  await p.getByRole("button", { name: "Delete Top Golf Cranston RI" }).filter({ visible: true }).click();
  await p.getByText("Delete Customer?").waitFor();
  await p.getByText("Are you sure you want to delete").waitFor();
  const counts = await p.locator("[data-testid=delete-counts]").innerText();
  if (!/1\s*facility/.test(counts) || !/10\s*equipment records/.test(counts) || !/1\s*inspection\b/.test(counts)) throw new Error("counts wrong: " + counts);
  if (await p.getByTestId("confirm-delete-customer").isEnabled()) throw new Error("delete must need explicit acknowledgement");
  if (OUT) await p.screenshot({ path: `${OUT}/delete-dialog.png` });
  await p.getByTestId("ack-delete").check();
  await p.getByTestId("confirm-delete-customer").click();
  await p.getByText("Top Golf Cranston RI deleted").waitFor();
  const names = await p.locator("ul.divide-y li a span.block.truncate").allInnerTexts();
  if (JSON.stringify(names) !== JSON.stringify(["Top Golf Canton, Massachusetts"])) throw new Error("customers after delete: " + names);
  await p.goto(BASE + "/facilities");
  await p.getByRole("link", { name: "Top Golf Canton Entertainment Venue" }).click();
  await p.getByText("Active items").waitFor();
  const summary = await p.locator("text=Active items").locator("xpath=..").innerText();
  if (!/10/.test(summary)) throw new Error("Canton inventory changed: " + summary);
  ok("deleted Cranston from the phone Customers page; Canton and its 10 equipment records intact");
  await c.close();
  await browser.close();
  if (bad) { console.log(`✘ ${bad} layout problem(s)`); process.exit(1); }
  ok("all layout checks passed");
})().catch((e) => { console.error("✘ FAILED:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
