/**
 * Prototype: Electrical Infrared Inspection Report from the Brim Laundry reference case.
 *
 *   npx tsx scripts/report-sample/brim-report.ts <brim-rows.json> <photo-folder> <logo.png> <front.jpg> <client-logo.jpg> <out-folder>
 *
 * brim-rows.json is a read-only extraction of tblFindings from the owner's Brim Laundry Gen.xlsm.
 * The rows are converted into InfraReport records (rooms, room conditions, equipment, equipment lines,
 * thermal image entries), the report is built from those records, and Chromium prints the PDF.
 * Customer data and photos are read from the paths given; nothing is written to the repository,
 * the database or the owner's files.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { OPENED_VALUES } from "@/lib/domain/constants";
import type { ExportDataset } from "@/lib/domain/csv";
import { newThermalImage } from "@/lib/domain/thermal";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Location } from "@/lib/domain/types";
import { EMPTY_OVERRIDES } from "@/lib/domain/rules";
import { buildInspectionReport } from "@/lib/reports/inspection-report";
import { renderInspectionReportHtml } from "@/lib/reports/render-inspection-report";

type Row = Record<string, string | null>;
const [rowsPath, photoDir, logoPath, frontPath, clientLogoPath, outDir] = process.argv.slice(2);
if (!outDir) throw new Error("usage: brim-report.ts <rows.json> <photos> <logo> <front> <client-logo> <out>");
const src = JSON.parse(readFileSync(rowsPath, "utf8")) as { client: string; address: string; date: string; rows: Row[] };
const S = (v: string | null | undefined) => (v ?? "").trim();
const ORG = "org-sample", INSP = "insp-brim", DATE = src.date;

/** Generator Opened text to InfraReport's Opened values (same list; the app uses a typographic apostrophe). */
const opened = (v: string) => OPENED_VALUES.find((o) => o.replace(/[‘’]/g, "'").toLowerCase() === v.replace(/[‘’]/g, "'").trim().toLowerCase()) ?? v.trim();
const n = (v: string | null) => { const s = S(v); return s && /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s; };

const locations: Location[] = [];
const rooms: InspectionRoomConditions[] = [];
const equipment: Equipment[] = [];
const results: InspectionResult[] = [];
const notes: string[] = [];

for (const [i, r] of src.rows.entries()) {
  const roomName = S(r.location);
  let loc = locations.find((l) => l.name === roomName);
  if (!loc && roomName) {
    loc = { id: `loc-${locations.length + 1}`, organizationId: ORG, facilityId: "fac-brim", building: "", name: roomName, area: "", sortOrder: locations.length + 1 };
    locations.push(loc);
    // Generator stores humidity as a fraction (0.53); InfraReport stores percent (53).
    const h = S(r.humidity) ? String(Math.round(Number(r.humidity) * 1000) / 10) : "";
    rooms.push({ id: `rc-${loc.id}`, organizationId: ORG, inspectionId: INSP, locationId: loc.id, humidity: h, ambientTemp: n(r.ambient), backgroundTemp: n(r.background), distance: "", imageDate: "", conditionsCopiedFrom: null, completedAt: null });
  }
  const [name, ...rest] = S(r.equipment).split(/\r?\n/);
  const extra = rest.map((x) => x.trim()).filter(Boolean).join(" ");
  let eq = equipment.find((e) => e.name === name.trim() && e.locationId === (loc?.id ?? ""));
  if (!eq || !name.trim()) {
    eq = { id: `eq-${equipment.length + 1}`, organizationId: ORG, facilityId: "fac-brim", locationId: loc?.id ?? "", name: name.trim(), equipmentType: "", defaultComponent: S(r.component), active: true, sortOrder: i + 1, createdAt: "" };
    equipment.push(eq);
    results.push({ id: `res-${eq.id}`, organizationId: ORG, inspectionId: INSP, equipmentId: eq.id, locationId: loc?.id ?? "", images: [], opened: opened(S(r.opened) || "Yes, Completely"), exception: null, confidence: "", reviewNotes: extra, overrides: { ...EMPTY_OVERRIDES }, source: "carried-forward", sortOrder: i + 1, createdAt: "", updatedAt: "" });
    if (!name.trim()) notes.push(`Generator row ${r.n} has no equipment name (AI note: ${S(r.aiNote)})`);
  }
  const res = results.find((x) => x.equipmentId === eq!.id)!;
  if (S(r.opened) && opened(S(r.opened)) !== "Yes, Completely") res.opened = opened(S(r.opened));
  res.images.push(newThermalImage({ id: `img-${S(r.n).replace("#", "")}`, component: S(r.component), irImageNumber: S(r.ir), visualOverridden: S(r.visual) !== S(r.ir), visualImageNumber: S(r.visual), distance: n(r.distance), possibleCause: S(r.cause) || "NONE", maxTemp: n(r.maxTemp), notes: "" }));
}

const inspection: Inspection = { id: INSP, organizationId: ORG, customerId: "cust-brim", facilityId: "fac-brim", date: DATE, inspectorIds: [], status: "Needs Review", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "" } as unknown as Inspection;
const ds: ExportDataset = { inspection, results, equipment: new Map(equipment.map((e) => [e.id, e])), locations: new Map(locations.map((l) => [l.id, l])), rooms };

const model = buildInspectionReport(ds, {
  clientName: src.client, facilityName: "", address: src.address,
  inspectionDates: [new Date(`${DATE}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
  thermographers: ["Ashton Bott"],
  company: { name: "Infinite Infrared", phone: "(682) 233-0257", website: "www.infiniteinfrared.com" },
  scopeNotes: ["Electrical equipment belonging to the second tenant and located downstream of the P8 distribution equipment was outside the inspection scope and was not thermally scanned. No assessment of that equipment's condition is provided in this report."],
});

mkdirSync(join(outDir, "assets"), { recursive: true });
const asset = (p: string) => { const name = basename(p); copyFileSync(p, join(outDir, "assets", name)); return `assets/${name}`; };
const photo = (num: string, kind: "IR" | "DAR") => {
  if (!num) return undefined;
  const p = join(photoDir, `HM_${num.padStart(5, "0")}_${kind}.jpg`);
  return existsSync(p) ? asset(p) : undefined;
};
const html = renderInspectionReportHtml(model, {
  logo: asset(logoPath), clientLogo: asset(clientLogoPath), fronts: [{ building: "", src: asset(frontPath) }],
  photos: (e) => ({ ir: photo(e.irNumber, "IR"), visual: photo(e.visualNumber, "DAR") }),
  draft: true,
});
writeFileSync(join(outDir, "report.html"), html);
writeFileSync(join(outDir, "review.json"), JSON.stringify({ conversionNotes: notes, review: model.review, totals: model.totals, counts: model.counts, pagesBySeverity: model.pagesBySeverity, layout: model.layout }, null, 1));

(async () => {
  // Pre-installed Chromium (Playwright is available in this environment, not an app dependency).
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(join(process.cwd(), "index.js"))("playwright") as { chromium: { launch(): Promise<any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${join(outDir, "report.html")}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = join(outDir, "Brim_Laundry_Machinery_Co_Infrared_Inspection_Report_2026-11-09_PROTOTYPE.pdf");
  await page.pdf({ path: pdf, width: "10in", height: "7.5in", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(JSON.stringify({ pdf, totals: model.totals, counts: model.counts, review: model.review.length, layout: model.layout }));
})();
