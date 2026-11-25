/**
 * End-to-end check of photographs and native reports against a LOCAL Supabase stack:
 * Generator workbook import, bulk photo upload (with an interrupted upload), matching review,
 * building photo, Download All Photographs ZIP + manifest, draft report, marked areas, approval.
 *
 *   DB_URL=… SUPABASE_URL=… SECRET_KEY=… node scripts/check-reports.cjs http://localhost:3200 <Generator.xlsm> <photo-folder> <front.jpg> [out]
 *
 * Customer files are read from the paths given; nothing from them is written to the repository.
 * WARNING: it empties the organization tables of the database it is pointed at (local only).
 */
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const pg = require("pg");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { unzipSync, strFromU8 } = require("fflate");

const [BASE, BOOK, PHOTOS, FRONT, OUT = fs.mkdtempSync(path.join(os.tmpdir(), "rep-"))] = process.argv.slice(2);
const DB = process.env.DB_URL, SB_URL = process.env.SUPABASE_URL, SECRET = process.env.SECRET_KEY;
if (!/127\.0\.0\.1|localhost/.test(DB || "") || !/127\.0\.0\.1|localhost/.test(SB_URL || "")) throw new Error("Refusing to run against a non-local database");
const ok = (...a) => console.log("✔", ...a);
const sql = async (q, p = []) => { const c = new pg.Client({ connectionString: DB }); await c.connect(); try { return (await c.query(q, p)).rows; } finally { await c.end(); } };
const until = async (what, fn, ms = 60000) => {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`Timed out waiting for: ${what} (${last instanceof Error ? last.message : JSON.stringify(last)})`);
};
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

(async () => {
  await sql("truncate public.organizations, public.memberships, public.tech_credentials, public.tech_devices, public.tech_activations, public.auth_rate_limits cascade");
  const admin = createClient(SB_URL, SECRET, { auth: { persistSession: false } });
  for (const u of (await admin.auth.admin.listUsers()).data.users) await admin.auth.admin.deleteUser(u.id);
  const email = "ashton@example.com", password = "Correct-Horse-Battery-9";
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  await sql("select public.bootstrap_first_admin($1, 'Ashton Bott', 'Level III Certified Master Thermographer', 'Infinite Infrared LLC')", [email]);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });

  await page.goto(BASE + "/login");
  await page.getByRole("tab", { name: /Administrator Login/ }).click();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((u) => u.pathname === "/");

  // ------------------------------------------------------------ 1. Generator workbook import
  await page.goto(BASE + "/reports/import");
  await page.getByTestId("generator-file").setInputFiles(BOOK);
  const summary = await until("import summary", async () => (await page.getByTestId("import-summary").textContent().catch(() => "")) || null);
  await page.getByTestId("assign-Ashton Bott").check();
  await shot("01-import");
  await page.getByTestId("import-create").click();
  await page.waitForURL(/\/reports\/insp-/);
  const inspId = page.url().split("/reports/")[1];
  const images = await until("inspection synced to the cloud", async () => {
    const [r] = await sql("select count(*)::int n from public.thermal_images t join public.results r on r.id = t.result_id where r.inspection_id = $1", [inspId]);
    return r.n === Number(/(\d+) rows/.exec(summary)[1]) && r.n;
  }, 120000);
  ok(`1. workbook imported: ${summary.trim()} → ${images} thermal image entries in the cloud`);

  // ------------------------------------------------------------ 2. bulk upload with an interrupted upload
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ph-"));
  const files = fs.readdirSync(PHOTOS).filter((f) => /\.jpe?g$/i.test(f)).map((f) => path.join(PHOTOS, f));
  const dupe = path.join(tmp, "HM_00051_IR (1).jpg"); fs.copyFileSync(files.find((f) => f.endsWith("HM_00051_IR.jpg")), dupe);
  const stray = path.join(tmp, "IMG_9999.jpg"); fs.copyFileSync(FRONT, stray);
  let aborted = 0;
  await page.route("**/storage/v1/object/inspection-photos/**", async (route) => {
    if (route.request().method() === "POST" && aborted < 2 && /HM_00053_IR/.test(route.request().url())) { aborted++; return route.abort("connectionreset"); }
    return route.continue();
  });
  await page.goto(`${BASE}/inspections/${inspId}/photos`);
  await page.getByTestId("photo-input").setInputFiles([...files, dupe, stray]);
  await page.getByTestId("exterior-building").fill("Main building");
  await page.getByTestId("exterior-input").setInputFiles(FRONT);
  const total = files.length + 3;
  await until("all uploads stored and verified", async () => {
    const [r] = await sql("select count(*) filter (where verified_at is not null)::int v, count(*)::int n from public.photo_files where inspection_id = $1", [inspId]);
    return r.v === total && r;
  }, 240000);
  if (aborted < 2) throw new Error("interrupted upload was not exercised");
  const bad = await sql("select original_name, verify_error from public.photo_files where inspection_id = $1 and (verified_at is null or verify_error is not null)", [inspId]);
  if (bad.length) throw new Error("unverified files: " + JSON.stringify(bad));
  // Integrity: every stored object equals the local original byte for byte.
  const stored = await sql("select original_name, sha256, size_bytes from public.photo_files where inspection_id = $1", [inspId]);
  const local = new Map([...files, dupe, stray].map((f) => [path.basename(f), fs.readFileSync(f)]));
  for (const s of stored) { const b = s.original_name === path.basename(FRONT) ? fs.readFileSync(FRONT) : local.get(s.original_name); if (!b || sha(b) !== s.sha256 || b.length !== Number(s.size_bytes)) throw new Error("integrity mismatch " + s.original_name); }
  ok(`2. ${total} photographs uploaded and verified by the server (SHA-256 and size equal to the originals); an upload cut off twice recovered on its own`);

  await page.reload();
  await page.getByTestId("photo-review").waitFor();
  const reviewText = await page.getByTestId("photo-review").textContent();
  if (!/Same file as HM_00051_IR\.jpg/.test(reviewText)) throw new Error("duplicate not reported: " + reviewText.slice(0, 300));
  if (!/IMG_9999/.test(reviewText)) throw new Error("unmatched file not reported");
  const missingText = (await page.getByTestId("photo-missing").textContent().catch(() => "")) || "";
  await shot("02-photos-review");
  ok(`2b. review lists the duplicate and the unmatched file; missing list: ${missingText.replace(/\s+/g, " ").slice(0, 160)}`);
  const strayItem = page.getByTestId("review-item").filter({ hasText: "IMG_9999" });
  await strayItem.getByTestId("assign-select").selectOption("__exclude");
  await until("stray excluded", async () => (await sql("select metadata->>'excluded' x from public.photo_files where original_name = 'IMG_9999.jpg'"))[0].x === "true");
  ok("2c. manual correction: the stray file marked Not used for this inspection");

  // ------------------------------------------------------------ 3. Download All Photographs
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByTestId("zip-photos").click()]);
  const zipPath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(zipPath);
  const zip = unzipSync(fs.readFileSync(zipPath));
  const names = Object.keys(zip);
  const manifest = JSON.parse(strFromU8(zip[names.find((n) => n.endsWith("manifest.json"))]));
  for (const f of manifest.files.filter((f) => f.zip_path)) if (sha(zip[f.zip_path]) !== f.sha256) throw new Error("ZIP file differs from the stored original: " + f.zip_path);
  if (!names.some((n) => /01 Building Exterior\/Main building\//.test(n))) throw new Error("no exterior folder");
  if (!names.some((n) => /02 Infrared and Visual\/Main Electrical Room\/Panel L1\/Full Panel - IR - HM_00051_IR\.jpg$/.test(n))) throw new Error("matched IR not filed by room/equipment");
  ok(`3. ZIP ${dl.suggestedFilename()}: ${manifest.included} originals (byte-identical to the stored files), manifest.csv + manifest.json, folders: ${[...new Set(names.map((n) => n.split("/")[1]))].join(", ")}`);

  // ------------------------------------------------------------ 4. draft report
  await page.unroute("**/storage/v1/object/inspection-photos/**");
  await page.goto(`${BASE}/reports/${inspId}`);
  await page.locator("#scope").fill("Electrical equipment belonging to the second tenant, downstream of the P8 distribution equipment, was outside the inspection scope and was not scanned.");
  await page.getByTestId("generate-draft").click();
  await page.getByTestId("report-version").first().waitFor();
  const frame = page.frameLocator("[data-testid=report-preview]");
  await frame.getByText("Understanding This Report").first().waitFor({ timeout: 60000 });
  const review = await page.getByTestId("report-review").textContent();
  if (!(await page.getByTestId("approve-report").isDisabled())) throw new Error("approve allowed with Must fix items");
  const [v1] = await sql("select model from public.report_versions where inspection_id = $1 and number = 1", [inspId]);
  if (!JSON.stringify(v1.model).includes("second tenant")) throw new Error("scope statement missing from draft 1");
  await shot("03-draft");
  ok(`4. draft 1 generated and previewed; approval blocked by: ${review.replace(/\s+/g, " ").slice(0, 220)}`);

  // marked area on the serious finding's visual image
  await page.getByTestId("mark-area").first().click();
  const box = await page.getByTestId("annotator").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 5 }); await page.mouse.up();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByTestId("generate-draft").click();
  await until("draft 2", async () => (await sql("select count(*)::int n from public.report_versions where inspection_id = $1", [inspId]))[0].n === 2);
  const [v2] = await sql("select model from public.report_versions where inspection_id = $1 and number = 2", [inspId]);
  const marked = v2.model.entries.filter((e) => e.annotations && e.annotations.length);
  if (marked.length !== 1) throw new Error("annotation not stored on the finding");
  if (!JSON.stringify(v2.model).includes("second tenant")) throw new Error("scope statement lost when the marked area was saved");
  await frame.locator(".box").first().waitFor({ timeout: 30000 }).catch(() => { throw new Error("annotation box not drawn in the preview"); });
  const pagesWithPhotos = await frame.locator("img[src*='inspection-photos']").count();
  await shot("04-marked");
  ok(`4b. marked area saved and drawn on the visual photograph in draft 2; preview shows ${pagesWithPhotos} private photographs`);

  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("download-report").click()]);
  await until("print dialog opened after images loaded", () => popup.evaluate(() => window.__printed === true), 60000);
  const broken = await popup.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).length);
  if (broken) throw new Error(`${broken} images failed to load in the printed report`);
  const pdf = path.join(OUT, "draft_report.pdf");
  await popup.pdf({ path: pdf, width: "10in", height: "7.5in", printBackground: true, preferCSSPageSize: true });
  ok(`4c. Download Report PDF waits for every photograph, then prints (saved a copy: ${pdf})`);
  await popup.close();

  // ------------------------------------------------------------ 5. approval on a clean inspection
  const { default: writeXlsxFile } = await import("write-excel-file/node");
  const cell = (v) => (v === null ? null : { value: v });
  const head = ["Finding_Number", "ImageDate", "Location", "Humidity", "BackgroundTemp", "Equipment", "Component", "Distance", "PossibleCause", "ImageNum", "VisualNum", "Emissivity", "MaxTemp", "AmbientTemp", "DeltaT", "Severity", "Recommendation", "Opened?"];
  const rows = [["Report Generator"], ["ClientName", "Sample Test Co"], ["Address", "1 Test Rd, Dallas, TX 75201"], ["InspectionDate", "2026-11-20"], [], [], head,
    ["#1", "2026-11-20", "Room A", 0.5, 70, "Panel A", "Full Panel", 5, "NONE", 1, 1, 0.95, null, 72, null, null, null, "Yes, Completely"],
    ["#2", "2026-11-20", "Room A", 0.5, 70, "Panel B", "Main Breaker", 5, "Loose Connection(s)", 2, 2, 0.95, 110, 72, null, null, null, "Yes, Completely"],
    ["#3", "2026-11-20", "Room A", 0.5, 70, "Disconnect C", "Full Disconnect", 5, "NONE", null, null, 0.95, null, 72, null, null, null, "Item Was Off at Time of Scan"]];
  const clean = path.join(OUT, "clean-generator.xlsx");
  await writeXlsxFile(rows.map((r) => r.map(cell)), { sheet: "Generator" }).toFile(clean);
  await page.goto(BASE + "/reports/import");
  await page.getByTestId("generator-file").setInputFiles(clean);
  await page.getByTestId("import-summary").waitFor();
  await page.getByTestId("assign-Ashton Bott").check();
  await page.getByTestId("import-create").click();
  await page.waitForURL(/\/reports\/insp-/);
  const cleanId = page.url().split("/reports/")[1];
  await until("clean inspection synced", async () => (await sql("select count(*)::int n from public.thermal_images t join public.results r on r.id = t.result_id where r.inspection_id = $1", [cleanId]))[0].n === 3, 90000);
  await page.getByTestId("generate-draft").click();
  await page.getByTestId("report-version").first().waitFor();
  const cleanReview = await page.getByTestId("report-review").textContent();
  if (/Must fix/.test(cleanReview)) throw new Error("clean inspection has blockers: " + cleanReview);
  if (!/missing a verified thermal or visual photograph/.test(cleanReview)) throw new Error("missing photographs not flagged");
  await page.getByTestId("approve-report").click();
  await until("version 1 approved", async () => (await sql("select status from public.report_versions where inspection_id = $1 and number = 1", [cleanId]))[0].status === "approved");
  let immutable = false;
  try { await sql("update public.report_versions set model = '{}'::jsonb where inspection_id = $1 and number = 1", [cleanId]); } catch { immutable = true; }
  if (!immutable) throw new Error("approved report could be changed");
  const [{ model: m1 }] = await sql("select model from public.report_versions where inspection_id = $1 and number = 1", [cleanId]);
  const finding = m1.entries.find((e) => e.equipment === "Panel B");
  if (!finding || finding.assessment.severity !== "potential" || m1.entries.find((e) => e.equipment === "Panel A").assessment.severity !== "normal") throw new Error("severity wrong: " + JSON.stringify(finding && finding.assessment));
  await page.getByTestId("generate-draft").click();
  await until("draft 2", async () => (await sql("select count(*)::int n from public.report_versions where inspection_id = $1", [cleanId]))[0].n === 2);
  await page.getByTestId("report-version").first().click();
  await page.getByTestId("approve-report").click();
  await until("v1 superseded, v2 approved", async () => { const r = await sql("select number, status from public.report_versions where inspection_id = $1 order by number", [cleanId]); return r[0].status === "superseded" && r[1].status === "approved"; });
  await shot("05-approved");
  ok("5. clean inspection: draft approved (Panel B 110 °F vs 72 °F ambient = 38 °F ΔT, Potential); the approved version cannot be changed; approving a later draft supersedes it");

  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  console.log(JSON.stringify({ inspId, out: OUT }));
  await browser.close();
})().catch((e) => { console.error("✘", e); process.exit(1); });
