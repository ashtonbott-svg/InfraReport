/**
 * Electrical Infrared Inspection Report: HTML renderer (landscape, 10 x 7.5 in).
 *
 * A browser prints the document to PDF (page size comes from the CSS). The layout follows the owner's
 * own Infinite Infrared report (cover; how to read the report; one page per thermal image with the
 * thermal and visual photograph side by side; complete equipment list), presented as plain ruled
 * tables. Independent of the Excel exports and of the owner's Generator, PowerPoint and Word files.
 */
import { band, SEVERITY_BANDS, type Severity } from "./severity";
import { pageList, paginateInventory, SUMMARY_ROWS_PER_PAGE, type InspectionReportModel, type InventoryLine, type ReportEntry } from "./inspection-report";

export interface ReportAssets {
  logo: string;
  clientLogo?: string;
  fronts: { building: string; src: string }[];
  photos: (entry: ReportEntry) => { ir?: string; visual?: string };
  /** Draft reports carry a faint "DRAFT" mark on every page. */
  draft?: boolean;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const val = (s: string, empty = "Not recorded") => (s.trim() ? esc(s) : `<span class="nr">${empty}</span>`);
const NO_ANOMALY = "Not recorded (no anomaly found)";

// The owner's report wording (Brim Laundry report, page 2).
const ABOUT = [
  "Infrared thermography is a nondestructive inspection method used to identify abnormal thermal patterns in energized electrical equipment. These thermal patterns may indicate conditions such as loose or deteriorated connections, overloaded components, phase imbalance, damaged components, or other abnormal heating. Each identified thermal anomaly in this report is documented using infrared and visual imagery, temperature data, equipment identification, severity classification, and a recommended response.",
  "Delta T, or ΔT, represents the temperature difference between the identified thermal anomaly and the applicable reference temperature used for evaluation. Severity classifications are intended to assist with prioritizing further evaluation and corrective action.",
  "Infrared thermography identifies thermal conditions present at the time of inspection. It does not determine the definitive cause of a condition and does not replace electrical testing, troubleshooting, maintenance, or evaluation by a qualified electrical professional.",
];
const LIMITATIONS = [
  "Findings represent conditions observed at the time of inspection and may be affected by electrical load, equipment accessibility, operating conditions, environmental conditions, surface characteristics, and other factors.",
  "Only equipment and components that were accessible and included within the inspection scope were evaluated. Concealed, inaccessible, de energized, or otherwise unavailable conditions may not be detectable through infrared thermography.",
  "Severity classifications and recommended responses are guidelines only and should not be interpreted as a guarantee of equipment condition, remaining service life, future performance, or absence of other electrical deficiencies.",
  "All identified discrepancies should be evaluated by a qualified electrician or other qualified electrical professional before corrective action is performed.",
];

// Brand curves (cover and page corners), drawn in the company colours.
const SWOOSH = `<svg class="swoosh" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
  <path d="M400 0 L400 210 C330 120 250 60 140 0 Z" fill="#FFD23F"/>
  <path d="M400 0 L400 150 C340 85 280 40 210 0 Z" fill="#F26B3A"/>
  <path d="M400 0 L400 90 C360 55 320 25 280 0 Z" fill="#5B1A8C"/></svg>`;

const CSS = `
@page { size: 10in 7.5in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #e8e6ec; }
body { font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #1f2633; font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 10in; height: 7.5in; position: relative; overflow: hidden; background: #fff; margin: 0 auto 0.25in; break-after: page; page-break-after: always; }
@media print { html, body { background: #fff; } .page { margin: 0; } }
.draftmark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 9; }
.draftmark span { font-size: 92pt; font-weight: 700; color: rgba(201, 61, 11, 0.07); transform: rotate(-24deg); letter-spacing: .08em; }
h1, h2 { color: #44546A; margin: 0; font-weight: 700; }
h1 { font-size: 17pt; }
h2 { font-size: 11pt; margin: 0 0 5px; }
p { margin: 0 0 6px; line-height: 1.45; }
.nr { color: #6b7280; font-style: italic; }
.swoosh { position: absolute; top: 0; right: 0; width: 2.1in; height: 1.55in; }
.foot { position: absolute; left: 0.4in; right: 0.4in; bottom: 0.2in; display: flex; justify-content: space-between; font-size: 7.5pt; color: #5b6475; border-top: 1px solid #d9dde5; padding-top: 4px; }
.foot b { color: #44546A; }
.logo-s { position: absolute; left: 0.35in; top: 0.25in; width: 0.95in; }
.title { position: absolute; left: 1.45in; top: 0.42in; right: 2.2in; }
.title p { color: #5b6475; margin: 2px 0 0; }
.body { position: absolute; left: 0.4in; right: 0.4in; top: 1.35in; bottom: 0.55in; }
table { border-collapse: collapse; width: 100%; }
.ruled th { text-align: left; font-weight: 600; color: #44546A; border-bottom: 1.5px solid #44546A; padding: 4px 6px; font-size: 8.5pt; }
.ruled td { border-bottom: 1px solid #e3e6ec; padding: 4px 6px; vertical-align: top; }
.num { text-align: right; font-variant-numeric: tabular-nums; }

/* Cover */
.cover-swoosh { position: absolute; left: 0; bottom: 0; width: 5.2in; height: 1.25in; transform: scale(-1, -1); }
.cover-left { position: absolute; left: 0.45in; top: 0.45in; width: 2.85in; text-align: center; }
.cover-left .logo { width: 2.2in; }
.cover-left .rt { font-size: 19pt; font-weight: 700; color: #44546A; line-height: 1.15; margin-top: 0.15in; }
.cover-left .rule { width: 1.2in; height: 3px; background: #F26B3A; margin: 0.18in auto; }
.cover-left .kv { color: #2b3443; line-height: 1.5; font-size: 10.5pt; }
.cover-left .client-logo { margin-top: 0.2in; max-width: 1.5in; max-height: 0.75in; }
.cover-left .contact { margin: 0.25in auto 0; border: 1.5px solid #44546A; padding: 5px 10px; font-size: 9pt; line-height: 1.45; display: inline-block; }
.cover-right { position: absolute; left: 3.6in; right: 0.45in; top: 0.45in; bottom: 0.6in; display: flex; flex-direction: column; }
.cover-right .for { color: #F26B3A; font-weight: 700; font-size: 10.5pt; }
.cover-right .client { font-size: 22pt; font-weight: 700; color: #44546A; margin-top: 2px; }
.cover-right .addr { font-size: 11pt; color: #2b3443; margin-top: 3px; }
.fronts { flex: 1; margin-top: 0.2in; display: grid; gap: 0.12in; min-height: 0; }
.front { position: relative; border: 2px solid #44546A; overflow: hidden; background: #f2f3f6; min-height: 0; }
.front img { width: 100%; height: 100%; object-fit: cover; display: block; }
.front span { position: absolute; left: 0; bottom: 0; background: rgba(255,255,255,.9); padding: 2px 8px; font-size: 8.5pt; }

/* Understanding page */
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3in; height: 100%; }
.cols.u p { font-size: 8.8pt; line-height: 1.42; }
.sevtable td, .sevtable th { border: 1px solid #1f2633; padding: 5px 7px; font-size: 9pt; white-space: nowrap; }
.sevtable th { background: #fff; color: #1f2633; font-weight: 700; text-align: center; }
.sevtable td { text-align: center; }
.sevtable td.l { text-align: left; }

/* Finding page */
.f-loc { position: absolute; left: 1.45in; top: 0.3in; right: 4.75in; }
.f-loc .room { color: #5b6475; font-size: 9.5pt; }
.f-loc .eq { font-size: 16pt; font-weight: 700; color: #44546A; line-height: 1.15; margin-top: 2px; }
.f-loc .comp { font-size: 10.5pt; margin-top: 2px; }
.f-sev { position: absolute; right: 0.95in; top: 0.25in; width: 3.7in; }
.f-sev td { border: 1px solid #1f2633; padding: 3px 7px; font-size: 8.8pt; }
.f-sev td:first-child { font-weight: 600; width: 1.45in; }
.pageno { position: absolute; right: 0.35in; top: 0.22in; font-size: 20pt; font-weight: 700; color: #1f2633; }
.photos { position: absolute; left: 0.35in; right: 0.35in; top: 1.42in; display: grid; grid-template-columns: 1fr 1fr; gap: 0.12in; }
.ph .frame { position: relative; height: 3.42in; background: #111; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ph .frame .img { position: relative; max-width: 100%; max-height: 100%; }
.ph .frame img { display: block; max-width: 100%; max-height: 3.42in; }
.ph .box { position: absolute; border: 2px solid #F26B3A; box-shadow: 0 0 0 1px rgba(0,0,0,.35); }
.ph .missing { color: #d1d5db; font-size: 9pt; text-align: center; padding: 0 0.3in; }
.ph .cap { display: flex; justify-content: space-between; font-size: 8.3pt; padding: 2px 1px; color: #2b3443; }
.details { position: absolute; left: 0.35in; right: 0.35in; top: 5.12in; display: grid; grid-template-columns: 1.25fr 1fr; gap: 0.12in; }
.details td { border: 1px solid #1f2633; padding: 3px 7px; font-size: 8.8pt; vertical-align: top; }
.details td:first-child { font-weight: 600; width: 1.35in; }

/* Inventory */
.inv th, .inv td { font-size: 8.2pt; padding: 3px 5px; }
.inv tr.room td { padding-top: 8px; font-weight: 700; color: #44546A; font-size: 9.3pt; border-bottom: 1.5px solid #44546A; }
.res { display: inline-block; padding: 0 5px; font-weight: 600; font-size: 7.8pt; }
.scope { margin-top: 8px; padding: 6px 10px; border-left: 3px solid #F26B3A; background: #fff7ef; line-height: 1.4; }
`;

function shell(model: InspectionReportModel, page: number, inner: string, a: ReportAssets, opts: { swoosh?: boolean } = {}) {
  const m = model.meta;
  return `<section class="page">${opts.swoosh === false ? "" : SWOOSH}${inner}
  <div class="foot"><span><b>${esc(m.company.name)}</b> | ${esc(m.company.website)}</span><span>Temperatures are in degrees Fahrenheit</span><span>Page ${page} of ${model.layout.totalPages}</span></div>
  ${a.draft ? `<div class="draftmark"><span>DRAFT</span></div>` : ""}</section>`;
}

function cover(model: InspectionReportModel, a: ReportAssets) {
  const m = model.meta;
  const fronts = a.fronts;
  const cols = fronts.length <= 1 ? 1 : 2;
  return `<section class="page">${SWOOSH}<svg class="cover-swoosh" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true"><path d="M400 0 L400 160 C300 90 200 40 60 0 Z" fill="#FFD23F"/><path d="M400 0 L400 110 C320 60 240 25 150 0 Z" fill="#F26B3A"/><path d="M400 0 L400 60 C350 35 300 15 250 0 Z" fill="#5B1A8C"/></svg>
  <div class="cover-left">
    <img class="logo" src="${a.logo}" alt="Infinite Infrared">
    <div class="rt">Infrared<br>Inspection Report</div>
    <div class="rule"></div>
    <div class="kv">Inspection Date${m.inspectionDates.length > 1 ? "s" : ""}:<br>${m.inspectionDates.map(esc).join("<br>")}</div>
    ${a.clientLogo ? `<img class="client-logo" src="${a.clientLogo}" alt="">` : ""}
    <div class="contact">${esc(m.company.phone)}<br>${esc(m.company.website)}<br>Thermographer${m.thermographers.length > 1 ? "s" : ""}: ${m.thermographers.map(esc).join(", ")}</div>
  </div>
  <div class="cover-right">
    <div class="for">Report Created for:</div>
    <div class="client">${esc(m.clientName)}</div>
    ${m.facilityName && m.facilityName !== m.clientName && !m.address.toLowerCase().startsWith(m.facilityName.toLowerCase()) ? `<div class="addr">${esc(m.facilityName)}</div>` : ""}
    <div class="addr">${esc(m.address)}</div>
    <div class="fronts" style="grid-template-columns:repeat(${cols},1fr)">
      ${fronts.length ? fronts.map((f) => `<div class="front"><img src="${f.src}" alt="">${fronts.length > 1 || f.building ? `<span>${esc(f.building || "Main building")}</span>` : ""}</div>`).join("") : `<div class="front" style="display:flex;align-items:center;justify-content:center"><span style="position:static;background:none" class="nr">Building photograph not added</span></div>`}
    </div>
  </div>
  ${a.draft ? `<div class="draftmark"><span>DRAFT</span></div>` : ""}</section>`;
}

function understanding(model: InspectionReportModel, a: ReportAssets) {
  const rows = SEVERITY_BANDS.map((b) => `<tr style="background:${b.color}"><td>${esc(b.range.replace(" – ", " to "))}</td><td>${esc(b.label)}</td><td>${esc(b.priority.replace(/^./, (c) => c.toUpperCase()))}</td><td class="num">${model.counts[b.key]}</td><td>${esc(pageList(model.pagesBySeverity[b.key]))}</td></tr>`).join("");
  const notes = (model.meta.inspectionNotes ?? "").trim();
  return shell(model, 2, `<img class="logo-s" src="${a.logo}" alt=""><div class="title"><h1>Understanding This Report</h1></div>
  <div class="body"><div class="cols u">
    <div>${ABOUT.map((p) => `<p>${esc(p)}</p>`).join("")}
      <p>This inspection covered ${model.totals.equipment} equipment item${model.totals.equipment === 1 ? "" : "s"} in ${model.totals.rooms} location${model.totals.rooms === 1 ? "" : "s"}, documented in ${model.totals.images} thermal image${model.totals.images === 1 ? "" : "s"}. ${model.totals.notEvaluated + model.totals.notDocumented ? `${model.totals.notEvaluated + model.totals.notDocumented} item${model.totals.notEvaluated + model.totals.notDocumented === 1 ? " was" : "s were"} not evaluated; the reasons are listed in the Summary of Findings and the Equipment List.` : "Every listed item was evaluated."}</p>
      ${notes ? `<h2 style="margin-top:8px">Inspection Notes</h2><p>${esc(notes).replace(/\n/g, "<br>")}</p>` : ""}
      ${model.meta.scopeNotes.length ? `<h2 style="margin-top:8px">Scope</h2>${model.meta.scopeNotes.map((s) => `<p>${esc(s)}</p>`).join("")}` : ""}
    </div>
    <div>
      <table class="sevtable"><thead><tr><th>Delta T (ΔT)</th><th>Severity</th><th>Repair Priority</th><th>Images</th><th>Pages</th></tr></thead><tbody>${rows}</tbody></table>
      ${model.counts.visualFindings ? `<p style="margin-top:6px">${model.counts.visualFindings} visual finding${model.counts.visualFindings === 1 ? "" : "s"} without a measured temperature; see the Summary of Findings.</p>` : ""}
      <h2 style="margin-top:12px">Inspection Limitations</h2>${LIMITATIONS.map((p) => `<p>${esc(p)}</p>`).join("")}
    </div>
  </div></div>`, a);
}

function summaryPages(model: InspectionReportModel, a: ReportAssets) {
  type Row = { kind: "find"; e: ReportEntry } | { kind: "ne"; room: string; l: InventoryLine };
  const finds: Row[] = model.entries.filter((e) => e.assessment.kind === "visual-finding" || (e.assessment.kind === "severity" && e.assessment.severity !== "normal")).map((e) => ({ kind: "find" as const, e }));
  const ne: Row[] = model.inventory.flatMap((g) => g.lines.filter((l) => l.status.kind === "not-evaluated" || l.status.kind === "not-documented").map((l) => ({ kind: "ne" as const, room: g.room, l })));
  const all = [...finds, ...ne];
  const pages = Math.max(1, model.layout.frontPages - 2);
  const out: string[] = [];
  for (let p = 0; p < pages; p++) {
    const chunk = all.slice(p * SUMMARY_ROWS_PER_PAGE, (p + 1) * SUMMARY_ROWS_PER_PAGE);
    const f = chunk.filter((r): r is Extract<Row, { kind: "find" }> => r.kind === "find");
    const n = chunk.filter((r): r is Extract<Row, { kind: "ne" }> => r.kind === "ne");
    const findTable = f.length ? `<table class="ruled"><thead><tr><th class="num">Page</th><th>Location</th><th>Equipment</th><th>Component</th><th>Severity</th><th class="num">ΔT</th><th>Possible Cause</th></tr></thead><tbody>${f.map(({ e }) => `<tr><td class="num">${e.page}</td><td>${esc(e.room)}</td><td>${esc(e.equipment)}</td><td>${esc(e.component)}</td><td>${e.assessment.kind === "severity" ? `<span class="res" style="background:${band(e.assessment.severity).color}">${esc(band(e.assessment.severity).label)}</span>` : "Visual finding (severity to be set)"}</td><td class="num">${e.assessment.kind === "severity" && e.assessment.deltaT !== null ? e.assessment.deltaT : ""}</td><td>${esc(e.cause)}</td></tr>`).join("")}</tbody></table>` : "";
    const neTable = n.length ? `<h2 style="margin-top:12px">Equipment Not Evaluated</h2><table class="ruled"><thead><tr><th>Equipment</th><th>Location</th><th>Reason</th><th>Notes</th></tr></thead><tbody>${n.map(({ room, l }) => `<tr><td>${esc(l.equipment)}</td><td>${esc(room)}</td><td>${l.status.kind === "not-evaluated" ? esc(l.status.reason) : "No image recorded"}</td><td>${esc(l.notes)}</td></tr>`).join("")}</tbody></table>` : "";
    out.push(shell(model, 3 + p, `<img class="logo-s" src="${a.logo}" alt=""><div class="title"><h1>Summary of Findings${pages > 1 ? ` (${p + 1} of ${pages})` : ""}</h1><p>Discrepancies in order of severity, then equipment that could not be evaluated.</p></div>
      <div class="body">${p === 0 && !finds.length ? `<p>No thermal discrepancies were identified on the equipment evaluated.</p>` : ""}${findTable}${neTable}</div>`, a));
  }
  return out.join("");
}

function findingPage(model: InspectionReportModel, e: ReportEntry, a: ReportAssets) {
  const ph = a.photos(e);
  const as = e.assessment;
  const normal = as.kind === "severity" && as.severity === "normal";
  const color = as.kind === "severity" ? band(as.severity).color : "#E9D5FF";
  const sev = as.kind === "severity" ? band(as.severity).long : "Visual Finding, severity to be set by the reviewer";
  const dT = as.kind === "severity" && as.deltaT !== null ? String(as.deltaT) : normal ? NO_ANOMALY : "Not measured";
  const max = e.maxTemp ? esc(e.maxTemp) : normal ? NO_ANOMALY : "Not measured";
  const boxes = e.annotations.map((b) => `<div class="box" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"></div>`).join("");
  const frame = (src: string | undefined, label: string, num: string, overlay = "") => `<div class="ph"><div class="frame">${src ? `<div class="img"><img src="${src}" alt="">${overlay}</div>` : `<div class="missing">${esc(label)} ${num ? `${esc(num)} ` : ""}not uploaded</div>`}</div><div class="cap"><span>${esc(label)}</span><span>${num ? `Image ${esc(num)}` : ""}</span></div></div>`;
  return shell(model, e.page, `<img class="logo-s" src="${a.logo}" alt="">
  <div class="f-loc"><div class="room">${esc(e.room)}</div><div class="eq">${esc(e.equipment)}</div><div class="comp">${esc(e.component)}</div></div>
  <table class="f-sev"><tr style="background:${color}"><td>Severity</td><td>${esc(sev)}</td></tr><tr style="background:${normal ? "#fff" : color}"><td>Delta T (ΔT)</td><td>${dT}</td></tr><tr><td>Max Temperature</td><td>${max}</td></tr><tr><td>Ambient Temperature</td><td>${val(e.ambientTemp)}</td></tr></table>
  <div class="pageno">${e.page}</div>
  <div class="photos">${frame(ph.ir, "Thermal image", e.irNumber)}${frame(ph.visual, "Visual image", e.visualNumber, boxes)}</div>
  <div class="details">
    <table><tr><td>Possible Cause</td><td>${val(e.cause)}</td></tr><tr><td>Recommendation</td><td>${val(e.recommendation, "None defined; reviewer to add")}</td></tr>${e.notes ? `<tr><td>Notes</td><td>${esc(e.notes)}</td></tr>` : ""}${e.opened && e.opened !== "Yes, Completely" ? `<tr><td>Opened</td><td>${esc(e.opened)}</td></tr>` : ""}</table>
    <table><tr><td>Image Date</td><td>${val(e.imageDate)}</td></tr><tr><td>Emissivity</td><td>${val(e.emissivity)}</td></tr><tr><td>Distance</td><td>${e.distance ? `${esc(e.distance)} ft` : val("")}</td></tr><tr><td>Humidity</td><td>${e.humidity ? `${esc(e.humidity)}%` : val("")}</td></tr><tr><td>Background Temp</td><td>${val(e.backgroundTemp)}</td></tr></table>
  </div>`, a, { swoosh: false });
}

function resultCell(l: InventoryLine) {
  switch (l.status.kind) {
    case "severity": { const b = band(l.status.severity); return `<span class="res" style="background:${b.color}">${esc(b.label)}</span>`; }
    case "visual-finding": return "Visual finding";
    case "not-evaluated": return `Not Evaluated (${esc(l.status.reason)})`;
    default: return `<span style="color:#b3261e">Not documented</span>`;
  }
}

/** The equipment list pages; also used on their own for the separate Equipment List download. */
export function inventoryPagesHtml(model: InspectionReportModel, a: ReportAssets, firstPage = model.layout.inventoryStart, totalOverride?: number) {
  const pages = paginateInventory(model.inventory, model.meta.scopeNotes.length > 0);
  const anyNotes = model.inventory.some((g) => g.lines.some((l) => l.notes));
  const m2 = totalOverride ? { ...model, layout: { ...model.layout, totalPages: totalOverride } } : model;
  return pages.map((blocks, i) => {
    const last = i === pages.length - 1;
    const rows = blocks.map((b) => `<tr class="room"><td colspan="${anyNotes ? 7 : 6}">${esc(b.room)}${b.continued ? " (continued)" : ""}</td></tr>` + b.lines.map((l) => `<tr><td><b>${esc(l.equipment)}</b></td><td>${esc(l.components.join(", "))}</td><td>${esc(l.imageNumbers.join(", "))}</td><td>${esc(l.opened)}</td><td>${resultCell(l)}</td>${anyNotes ? `<td>${esc(l.notes)}</td>` : ""}<td class="num">${esc(l.pages.length ? pageList(l.pages) : "")}</td></tr>`).join("")).join("");
    return shell(m2, firstPage + i, `<img class="logo-s" src="${a.logo}" alt=""><div class="title"><h1>Equipment List</h1><p>${esc(model.meta.clientName)} · ${esc(model.meta.address)} · Inspection Date: ${esc(model.meta.inspectionDates.join(", "))}${pages.length > 1 ? ` · ${i + 1} of ${pages.length}` : ""}</p></div>
    <div class="body"><table class="ruled inv"><thead><tr><th>Equipment</th><th>Component(s)</th><th>Image</th><th>Opened</th><th>Result</th>${anyNotes ? "<th>Notes</th>" : ""}<th class="num">Page</th></tr></thead><tbody>${rows}</tbody></table>
    ${last ? model.meta.scopeNotes.map((s) => `<div class="scope">${esc(s)}</div>`).join("") : ""}</div>`, a);
  }).join("");
}

const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";

/** The whole report as one HTML document. */
export function renderInspectionReportHtml(model: InspectionReportModel, assets: ReportAssets, opts: { fontsHref?: string } = {}): string {
  const title = `${model.meta.clientName} Infrared Inspection Report ${model.meta.inspectionDates[0] ?? ""}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="${opts.fontsHref ?? FONTS}"><style>${CSS}</style></head><body>
${cover(model, assets)}${understanding(model, assets)}${summaryPages(model, assets)}${model.entries.map((e) => findingPage(model, e, assets)).join("")}${inventoryPagesHtml(model, assets)}
</body></html>`;
}

/** The separate Equipment List document (inventory pages only). */
export function renderEquipmentListHtml(model: InspectionReportModel, assets: ReportAssets, opts: { fontsHref?: string } = {}): string {
  const n = paginateInventory(model.inventory, model.meta.scopeNotes.length > 0).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`${model.meta.clientName} Equipment List ${model.meta.inspectionDates[0] ?? ""}`)}</title><link rel="stylesheet" href="${opts.fontsHref ?? FONTS}"><style>${CSS}</style></head><body>${inventoryPagesHtml(model, assets, 1, n)}</body></html>`;
}

export type { Severity };
