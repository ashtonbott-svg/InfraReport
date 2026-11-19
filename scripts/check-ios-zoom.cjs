/**
 * iPhone / iPad form zoom and overflow audit.
 * iOS zooms the page when a focused input's text is smaller than 16px; that zoom
 * also makes the page look wider than the screen. For every page and the main
 * dialogs this checks, on touch devices: every text input, select and textarea
 * is at least 16px, and nothing extends past the right edge of the screen.
 *   node scripts/check-ios-zoom.cjs [baseUrl]
 */
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] || "http://localhost:3100";
const DEVICES = { "iPhone SE": { ...devices["iPhone SE"] }, "iPhone 13": devices["iPhone 13"], "iPhone 15 Pro Max": devices["iPhone 15 Pro Max"], "iPad portrait": devices["iPad (gen 7)"] };
const PAGES = ["/", "/customers", "/facilities", "/inspections", "/inspections/new", "/reports", "/settings", "/field-notes", "/images", "/login", "/activate#t=x", "/jobs", "/sync", "/technicians"];

const audit = () => {
  const vw = document.documentElement.clientWidth;
  const small = [...document.querySelectorAll("input, select, textarea")]
    .filter((el) => el.offsetParent !== null && !["checkbox", "radio", "file", "hidden", "range"].includes(el.type))
    .map((el) => ({ id: el.id || el.name || el.getAttribute("aria-label") || el.placeholder || el.tagName, px: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((x) => x.px < 16);
  // Elements whose box goes past the right edge, unless they live inside a horizontal scroll container (tables, chip rows).
  const scrollsX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p).overflowX; if ((s === "auto" || s === "scroll") && p.scrollWidth > p.clientWidth) return true; } return false; };
  const over = [...document.querySelectorAll("body *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== "fixed" && !scrollsX(el);
  }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`);
  return { small, over, pageScroll: document.documentElement.scrollWidth - vw };
};

(async () => {
  const b = await chromium.launch();
  let problems = 0;
  for (const [dname, dev] of Object.entries(DEVICES)) {
    const ctx = await b.newContext({ ...dev });
    const p = await ctx.newPage();
    p.on("dialog", (d) => d.accept());
    const check = async (label) => {
      await p.waitForTimeout(500);
      const r = await p.evaluate(audit);
      const bad = r.small.length || r.over.length || r.pageScroll > 1;
      if (bad) { problems++; console.log(`✘ ${dname} ${label}: inputs<16px=${JSON.stringify(r.small.slice(0, 6))} overflow=${JSON.stringify(r.over)} pageScroll=${r.pageScroll}`); }
    };
    if (process.env.LOGIN_EMAIL) {
      // Cloud build: sign in first (the login form itself is audited before typing).
      await p.goto(BASE + "/login");
      await p.getByRole("tab", { name: /Administrator Login/ }).click();
      await check("login (administrator)");
      await p.locator("#email").fill(process.env.LOGIN_EMAIL);
      await p.locator("#password").fill(process.env.LOGIN_PASSWORD);
      await p.getByRole("button", { name: "Sign In" }).click();
      await p.waitForURL((u) => u.pathname === "/");
    }
    for (const path of PAGES) { await p.goto(BASE + path); await check(path); }
    // Dialogs and sheets that hold forms.
    await p.goto(BASE + "/customers");
    const newCust = p.getByRole("button", { name: /New Customer/ }).first();
    if (await newCust.count()) { await newCust.click(); await check("New Customer dialog");
      await p.locator("#c-name").focus(); await check("New Customer dialog, name focused"); }
    await p.goto(BASE + "/inspections/new");
    const newBtn = p.getByRole("button", { name: "New" }).first();
    if (await newBtn.count()) { await newBtn.click(); await check("New Inspection > New Customer dialog"); }
    await ctx.close();
  }
  await b.close();
  console.log(problems ? `${problems} screen(s) with problems` : "✔ all pages and dialogs: inputs >= 16px on touch devices, nothing past the right edge");
  process.exit(problems ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
