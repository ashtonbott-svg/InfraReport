/**
 * Electrical Infrared Inspection Report: HTML renderer (landscape, 10 x 7.5 in, 4:3).
 *
 * Produces one self-contained HTML document; a browser prints it to PDF (page size and margins come
 * from the CSS). The layout is original to InfraReport and uses only Infinite Infrared's own brand
 * and report wording. It is a separate generator: the Excel exports and the owner's Generator,
 * PowerPoint and Word templates are not used or changed.
 */
import { band, SEVERITY_BANDS, type Severity } from "./severity";
import { pageList, paginateInventory, type InspectionReportModel, type InventoryLine, type ReportEntry } from "./inspection-report";

export interface ReportAssets {
  /** Company logo (Infinite Infrared). */
  logo: string;
  clientLogo?: string;
  /** Front of building photos (one per building). */
  fronts: { building: string; src: string }[];
  /** Original thermal and visual photo for an entry, when uploaded and matched. */
  photos: (entry: ReportEntry) => { ir?: string; visual?: string };
  /** Shown in the corner of every page while the report is not approved. */
  draftLabel?: string;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const blank = (s: string, fallback = "—") => (s.trim() ? esc(s) : `<span class="muted">${fallback}</span>`);
const pct = (h: string) => (h ? `${esc(h)}%` : "");
const img = (n: string) => (n ? esc(n) : "");

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

const CSS = `
@page { size: 10in 7.5in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #e9e6ef; }
body { font-family: Inter, "Helvetica Neue", Arial, sans-serif; color: #1d2433; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 10pt; }
.page { width: 10in; height: 7.5in; position: relative; overflow: hidden; background: #fff; margin: 0 auto 0.25in; page-break-after: always; break-after: page; }
@media print { body { background: #fff; } .page { margin: 0; } }
h1, h2, h3, .display { font-family: "Space Grotesk", Inter, sans-serif; }
.muted { color: #8a93a6; }
.ribbon { position: absolute; left: 0; right: 0; bottom: 0; height: 0.09in; background: linear-gradient(90deg, #3b0a63 0%, #7a1fa2 28%, #d9412b 58%, #f7931e 78%, #ffd23f 100%); }
.foot { position: absolute; left: 0.45in; right: 0.45in; bottom: 0.17in; display: flex; justify-content: space-between; font-size: 7.5pt; color: #5d6679; }
.foot b { color: #3a4660; font-weight: 600; }
.draft { position: absolute; top: 0.12in; left: 50%; transform: translateX(-50%); font-size: 7pt; letter-spacing: .12em; text-transform: uppercase; color: #b3261e; border: 1px solid #f0b4ae; background: #fff4f2; padding: 2px 8px; border-radius: 99px; z-index: 5; }
.arc { position: absolute; right: -1.2in; top: -1.6in; width: 4.2in; height: 4.2in; border-radius: 50%; border: 0.16in solid transparent; background: linear-gradient(#fff,#fff) padding-box, linear-gradient(135deg, #ffd23f, #f7931e 35%, #d9412b 60%, #7a1fa2 85%) border-box; opacity: .9; }
.arc.small { width: 2.6in; height: 2.6in; right: -1.05in; top: -1.25in; border-width: 0.1in; opacity: .75; }

/* Cover */
.cover-left { position: absolute; left: 0; top: 0; bottom: 0; width: 3.45in; padding: 0.45in 0.4in 0.5in; display: flex; flex-direction: column; align-items: center; text-align: center; background: linear-gradient(180deg, #fff 0%, #faf7fd 100%); border-right: 1px solid #eee8f5; }
.cover-left .logo { width: 2.15in; }
.cover-title { margin-top: 0.22in; font-size: 21pt; line-height: 1.12; font-weight: 700; color: #3a4660; }
.cover-title small { display: block; font-size: 10.5pt; letter-spacing: .14em; text-transform: uppercase; color: #d9412b; font-weight: 600; margin-bottom: 4px; }
.rule { width: 1.2in; height: 3px; border-radius: 2px; background: linear-gradient(90deg, #f7931e, #d9412b); margin: 0.2in auto; }
.kv-center { font-size: 10pt; color: #3a4660; line-height: 1.5; }
.kv-center b { display: block; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; color: #8a93a6; font-weight: 600; }
.client-logo { margin-top: 0.22in; max-width: 1.6in; max-height: 0.8in; object-fit: contain; }
.contact { margin-top: auto; font-size: 8.5pt; line-height: 1.5; color: #3a4660; border: 1px solid #d9dfeb; border-radius: 8px; padding: 6px 12px; background: #fff; }
.cover-right { position: absolute; left: 3.45in; right: 0; top: 0; bottom: 0; padding: 0.5in 0.55in 0.45in 0.5in; display: flex; flex-direction: column; }
.prepared { font-size: 8.5pt; letter-spacing: .16em; text-transform: uppercase; color: #d9412b; font-weight: 700; }
.client { font-size: 24pt; font-weight: 700; color: #26324a; margin-top: 4px; line-height: 1.1; }
.facility { font-size: 12pt; color: #3a4660; margin-top: 6px; }
.address { font-size: 10.5pt; color: #5d6679; margin-top: 2px; }
.fronts { flex: 1; margin-top: 0.25in; display: grid; gap: 0.12in; min-height: 0; }
.front { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid #cfd6e4; background: #eef1f6; min-height: 0; }
.front img { width: 100%; height: 100%; object-fit: cover; display: block; }
.front span { position: absolute; left: 8px; bottom: 8px; background: rgba(23, 8, 38, .78); color: #fff; font-size: 8pt; padding: 2px 8px; border-radius: 99px; }

/* Section headings */
.head { position: absolute; left: 0.45in; right: 0.45in; top: 0.32in; display: flex; align-items: center; gap: 0.2in; }
.head img { height: 0.62in; }
.head h1 { margin: 0; font-size: 18pt; color: #3a4660; font-weight: 700; }
.head p { margin: 1px 0 0; font-size: 9pt; color: #6b7487; }
.body { position: absolute; left: 0.45in; right: 0.45in; top: 1.1in; bottom: 0.5in; }

/* Understanding page */
.two { display: grid; grid-template-columns: 1fr 1.12fr; gap: 0.24in; height: 100%; }
.card { border: 1px solid #dde3ee; border-radius: 10px; padding: 10px 14px; background: #fff; }
.card h2 { margin: 0 0 6px; font-size: 11pt; color: #3a4660; }
.card p { margin: 0 0 6px; font-size: 8.4pt; line-height: 1.42; color: #3c4558; }
table { border-collapse: collapse; width: 100%; }
.sev { font-size: 8.6pt; }
.sev th { text-align: left; font-size: 7.4pt; letter-spacing: .06em; text-transform: uppercase; color: #6b7487; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #dde3ee; }
.sev td { padding: 6px 6px; border-bottom: 1px solid #eef1f6; }
.sev td:first-child, .sev .chip { white-space: nowrap; }
.chip { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; color: #1d2433; border: 1px solid rgba(0,0,0,.08); }
.num { font-variant-numeric: tabular-nums; text-align: right; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 10px; }
.stat { border-radius: 8px; background: #f5f3f9; padding: 7px 10px; }
.stat b { display: block; font-size: 15pt; color: #26324a; font-family: "Space Grotesk", Inter, sans-serif; }
.stat span { font-size: 7.4pt; color: #6b7487; text-transform: uppercase; letter-spacing: .06em; }

/* Overview */
.ov { font-size: 8.4pt; }
.ov th { text-align: left; font-size: 7.2pt; text-transform: uppercase; letter-spacing: .05em; color: #6b7487; padding: 4px 5px; border-bottom: 1px solid #dde3ee; font-weight: 600; }
.ov td { padding: 4px 5px; border-bottom: 1px solid #f0f2f7; vertical-align: top; }
.none { padding: 14px; border-radius: 8px; background: #f2f9ea; color: #2f5a12; font-size: 9pt; }
.scope { margin-top: 8px; padding: 8px 12px; border-left: 3px solid #f7931e; background: #fff8ef; font-size: 8.4pt; color: #5a3b12; line-height: 1.4; }

/* Finding page */
.fhead { position: absolute; left: 0.35in; right: 0.35in; top: 0.24in; height: 1.12in; display: grid; grid-template-columns: 0.95in 1fr 3.55in; gap: 0.16in; align-items: stretch; }
.fhead .logo { width: 0.95in; align-self: center; }
.ident { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.ident .room { font-size: 8pt; text-transform: uppercase; letter-spacing: .1em; color: #8a93a6; font-weight: 600; }
.ident .room b { color: #d9412b; }
.ident .eq { font-family: "Space Grotesk", Inter, sans-serif; font-size: 17pt; font-weight: 700; color: #26324a; line-height: 1.12; margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ident .comp { font-size: 10.5pt; color: #3a4660; margin-top: 2px; }
.sevcard { border-radius: 10px; overflow: hidden; border: 1px solid #d6dbe6; display: grid; grid-template-rows: auto 1fr; }
.sevcard .top { padding: 6px 10px; font-weight: 700; font-size: 9.6pt; color: #1d2433; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sevcard .top small { font-weight: 500; font-size: 7.6pt; opacity: .85; }
.sevcard .temps { display: grid; grid-template-columns: repeat(3, 1fr); background: #fff; }
.sevcard .temps div { padding: 4px 8px; border-left: 1px solid #edf0f5; }
.sevcard .temps div:first-child { border-left: 0; }
.sevcard .temps span { display: block; font-size: 6.6pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7487; }
.sevcard .temps b { display: block; font-size: 11.5pt; color: #26324a; font-variant-numeric: tabular-nums; margin-top: 1px; }
.sevcard .temps b.na { font-size: 8pt; font-weight: 600; color: #5d6679; line-height: 1.2; }
.pageno { position: absolute; right: 0.35in; top: 0.1in; }
.photos { position: absolute; left: 0.35in; right: 0.35in; top: 1.46in; display: grid; grid-template-columns: 1fr 1fr; gap: 0.14in; }
.ph { border-radius: 8px; overflow: hidden; border: 1px solid #cfd6e4; background: #10131a; }
.ph .frame { height: 3.38in; display: flex; align-items: center; justify-content: center; }
.ph .frame img { width: 100%; height: 100%; object-fit: contain; display: block; }
.ph .missing { color: #f4c7c3; font-size: 9pt; text-align: center; padding: 0 0.4in; }
.ph .cap { display: flex; justify-content: space-between; background: #f5f3f9; padding: 3px 10px; font-size: 7.8pt; color: #3a4660; }
.ph .cap b { font-weight: 600; }
.details { position: absolute; left: 0.35in; right: 0.35in; top: 5.12in; height: 1.62in; display: grid; grid-template-columns: 1.35fr 1fr; gap: 0.14in; }
.details .box { border: 1px solid #dde3ee; border-radius: 8px; padding: 9px 12px; overflow: hidden; }
.dl { display: grid; grid-template-columns: 1.3in 1fr; row-gap: 6px; column-gap: 10px; font-size: 10.5pt; line-height: 1.35; }
.dl dt { color: #6b7487; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; padding-top: 3px; }
.dl dd { margin: 0; color: #1d2433; }
.cond { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 12px; font-size: 11pt; }
.cond span { display: block; font-size: 7.4pt; text-transform: uppercase; letter-spacing: .06em; color: #6b7487; font-weight: 600; }
.cond b { font-weight: 600; color: #1d2433; font-variant-numeric: tabular-nums; }
.unit { margin-top: 10px; font-size: 7.4pt; color: #8a93a6; }

/* Inventory */
.inv { font-size: 8pt; table-layout: fixed; }
.inv col.e { width: 24%; } .inv col.c { width: 21%; } .inv col.i { width: 9%; } .inv col.o { width: 18%; } .inv col.r { width: 20%; } .inv col.n { width: 0; } .inv col.p { width: 8%; }
.inv.notes col.c { width: 17%; } .inv.notes col.o { width: 15%; } .inv.notes col.n { width: 12%; } .inv.notes col.r { width: 17%; } .inv.notes col.e { width: 22%; }
.inv th { text-align: left; font-size: 6.8pt; text-transform: uppercase; letter-spacing: .05em; color: #6b7487; padding: 3px 5px; border-bottom: 1px solid #dde3ee; font-weight: 600; }
.inv td { padding: 3px 5px; border-bottom: 1px solid #f0f2f7; vertical-align: top; line-height: 1.25; overflow-wrap: anywhere; }
.inv tr.roomrow td { padding-top: 9px; border-bottom: 1.5px solid #3a4660; font-family: "Space Grotesk", Inter, sans-serif; font-weight: 700; font-size: 9.6pt; color: #3a4660; }
.res { display: inline-block; padding: 1px 6px; border-radius: 4px; font-weight: 600; font-size: 7.4pt; color: #1d2433; }
.res.ne { background: #e7eaf0; color: #3a4660; }
.res.nd { background: #fff; color: #b3261e; border: 1px solid #f0b4ae; }
.res.vf { background: #f3e8ff; color: #5b1a8c; }
`;

function severityChip(s: Severity, long = false) {
  const b = band(s);
  return `<span class="chip" style="background:${b.color}">${esc(long ? b.long : b.label)}</span>`;
}

function shell(model: InspectionReportModel, page: number, inner: string, assets: ReportAssets) {
  const m = model.meta;
  return `<section class="page">${assets.draftLabel ? `<div class="draft">${esc(assets.draftLabel)}</div>` : ""}${inner}
  <div class="foot"><span><b>${esc(m.company.name)}</b> | ${esc(m.company.website)} | ${esc(m.company.phone)}</span><span>${esc(m.clientName)}${m.facilityName && m.facilityName !== m.clientName ? ` · ${esc(m.facilityName)}` : ""} · ${esc(m.inspectionDates.join(", "))}</span><span>Page ${page} of ${model.layout.totalPages}</span></div>
  <div class="ribbon"></div></section>`;
}

function cover(model: InspectionReportModel, a: ReportAssets) {
  const m = model.meta;
  const fronts = a.fronts.length ? a.fronts : [];
  const cols = fronts.length <= 1 ? 1 : 2;
  const rows = Math.ceil(Math.max(fronts.length, 1) / cols);
  return `<section class="page">${a.draftLabel ? `<div class="draft">${esc(a.draftLabel)}</div>` : ""}
  <div class="cover-left">
    <img class="logo" src="${a.logo}" alt="Infinite Infrared">
    <div class="cover-title display"><small>Electrical</small>Infrared<br>Inspection Report</div>
    <div class="rule"></div>
    <div class="kv-center"><b>Inspection Date${m.inspectionDates.length > 1 ? "s" : ""}</b>${m.inspectionDates.map(esc).join("<br>")}</div>
    <div class="kv-center" style="margin-top:10px"><b>Thermographer${m.thermographers.length > 1 ? "s" : ""}</b>${m.thermographers.map(esc).join("<br>")}</div>
    ${a.clientLogo ? `<img class="client-logo" src="${a.clientLogo}" alt="">` : ""}
    <div class="contact">${esc(m.company.phone)}<br>${esc(m.company.website)}</div>
  </div>
  <div class="arc small"></div>
  <div class="cover-right">
    <div class="prepared">Report prepared for</div>
    <div class="client display">${esc(m.clientName)}</div>
    ${m.facilityName && m.facilityName !== m.clientName ? `<div class="facility">${esc(m.facilityName)}</div>` : ""}
    <div class="address">${esc(m.address)}</div>
    <div class="fronts" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">
      ${fronts.length ? fronts.map((f) => `<div class="front"><img src="${f.src}" alt="">${fronts.length > 1 || f.building ? `<span>${esc(f.building || "Front of building")}</span>` : ""}</div>`).join("") : `<div class="front" style="display:flex;align-items:center;justify-content:center;color:#8a93a6">Front of building photo not added</div>`}
    </div>
  </div>
  <div class="ribbon"></div></section>`;
}

function understanding(model: InspectionReportModel, a: ReportAssets) {
  const t = model.totals;
  const rows = SEVERITY_BANDS.map((b) => `<tr><td>${esc(b.range)}</td><td><span class="chip" style="background:${b.color}">${esc(b.label)}</span></td><td>${esc(b.priority)}</td><td class="num"><b>${model.counts[b.key]}</b></td><td>${esc(pageList(model.pagesBySeverity[b.key]))}</td></tr>`).join("");
  return shell(model, 2, `<div class="arc small"></div>
  <div class="head"><img src="${a.logo}" alt=""><div><h1>Understanding This Report</h1><p>How findings are measured, classified and limited</p></div></div>
  <div class="body"><div class="two">
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="card">${ABOUT.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
      <div class="card"><h2>This Inspection at a Glance</h2>
        <div class="stats">
          <div class="stat"><b>${t.rooms}</b><span>Rooms</span></div>
          <div class="stat"><b>${t.equipment}</b><span>Equipment items</span></div>
          <div class="stat"><b>${t.images}</b><span>Thermal images</span></div>
          <div class="stat"><b>${t.notEvaluated + t.notDocumented}</b><span>Not evaluated</span></div>
        </div>
        <p style="margin-top:8px;font-size:7.8pt;color:#6b7487">Temperatures are in degrees Fahrenheit. Each illustrated page documents one thermal image; the Equipment Inventory at the end lists every item, including equipment that could not be evaluated and why.</p>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="card"><h2>Severity Classification</h2>
        <table class="sev"><thead><tr><th>Delta T (ΔT)</th><th>Severity</th><th>Repair Priority</th><th class="num">Images</th><th>Pages</th></tr></thead><tbody>${rows}</tbody></table>
        ${model.counts.visualFindings ? `<p style="margin-top:6px;font-size:8pt">${model.counts.visualFindings} visual finding${model.counts.visualFindings === 1 ? "" : "s"} without a measured temperature (see the Findings Overview).</p>` : ""}
      </div>
      <div class="card"><h2>Inspection Limitations</h2>${LIMITATIONS.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    </div>
  </div></div>`, a);
}

function overview(model: InspectionReportModel, a: ReportAssets) {
  const findings = model.entries.filter((e) => e.assessment.kind === "visual-finding" || (e.assessment.kind === "severity" && e.assessment.severity !== "normal"));
  const notEval = model.inventory.flatMap((g) => g.lines.filter((l) => l.status.kind === "not-evaluated" || l.status.kind === "not-documented").map((l) => ({ room: g.room, l })));
  const fRows = findings.slice(0, 9).map((e) => `<tr><td class="num">${e.page}</td><td>${esc(e.room)}</td><td><b>${esc(e.equipment)}</b><br><span class="muted">${esc(e.component)}</span></td><td>${e.assessment.kind === "severity" ? severityChip(e.assessment.severity) : `<span class="res vf">Visual finding</span>`}</td><td class="num">${e.assessment.kind === "severity" && e.assessment.deltaT !== null ? `${e.assessment.deltaT}` : "N/A"}</td><td>${esc(e.cause)}</td></tr>`).join("");
  const half = Math.ceil(notEval.length / 2);
  const neTable = (list: typeof notEval) => `<table class="ov"><thead><tr><th>Equipment</th><th>Location</th><th>Reason</th></tr></thead><tbody>${list.map(({ room, l }) => `<tr><td>${esc(l.equipment)}</td><td>${esc(room)}</td><td>${l.status.kind === "not-evaluated" ? esc(l.status.reason) + (l.pages.length ? ` <span class="muted">(photo p. ${esc(pageList(l.pages))})</span>` : "") : `<span style="color:#b3261e">No image recorded</span>`}</td></tr>`).join("")}</tbody></table>`;
  return shell(model, 3, `<div class="arc small"></div>
  <div class="head"><img src="${a.logo}" alt=""><div><h1>Findings Overview</h1><p>Discrepancies first, then equipment that could not be evaluated</p></div></div>
  <div class="body" style="display:flex;flex-direction:column;gap:10px">
    <div class="card"><h2>Discrepancies</h2>
      ${findings.length ? `<table class="ov"><thead><tr><th class="num">Page</th><th>Location</th><th>Equipment</th><th>Severity</th><th class="num">ΔT °F</th><th>Possible Cause</th></tr></thead><tbody>${fRows}</tbody></table>${findings.length > 9 ? `<p class="muted" style="font-size:8pt;margin-top:4px">and ${findings.length - 9} more, in order of severity on the pages that follow.</p>` : ""}`
        : `<div class="none">No thermal discrepancies were identified on the equipment evaluated.</div>`}
    </div>
    <div class="card" style="flex:1;min-height:0;overflow:hidden"><h2>Equipment Not Evaluated (${notEval.length})</h2>
      ${notEval.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${neTable(notEval.slice(0, half))}${neTable(notEval.slice(half))}</div>` : `<p>Every listed item was scanned.</p>`}
      ${model.meta.scopeNotes.map((s) => `<div class="scope"><b>Scope:</b> ${esc(s)}</div>`).join("")}
    </div>
  </div>`, a);
}

function findingPage(model: InspectionReportModel, e: ReportEntry, a: ReportAssets) {
  const photos = a.photos(e);
  const as = e.assessment;
  const isNormal = as.kind === "severity" && as.severity === "normal";
  const color = as.kind === "severity" ? band(as.severity).color : as.kind === "not-evaluated" ? "#dfe3ea" : "#e9d5ff";
  const sevText = as.kind === "severity" ? band(as.severity).label : as.kind === "not-evaluated" ? `Not Evaluated (${as.reason})` : "Visual Finding";
  const prio = as.kind === "severity" ? band(as.severity).priority : as.kind === "not-evaluated" ? "No thermal assessment" : "Severity set by reviewer";
  const na = isNormal ? "N/A (Equipment is Normal)" : as.kind === "not-evaluated" ? `N/A (${as.reason})` : "N/A (Visual Finding)";
  const dT = e.assessment.kind === "severity" && e.assessment.deltaT !== null ? `${e.assessment.deltaT}` : null;
  const frame = (src: string | undefined, label: string, num: string) => `<div class="ph"><div class="frame">${src ? `<img src="${src}" alt="">` : `<div class="missing">${esc(label)} ${num ? `#${esc(num)} ` : ""}not uploaded yet</div>`}</div><div class="cap"><b>${esc(label)}</b><span>${num ? `Image # ${img(num)}` : ""}</span></div></div>`;
  return shell(model, e.page, `
  <div class="fhead">
    <img class="logo" src="${a.logo}" alt="">
    <div class="ident"><div class="room">Location · <b>${esc(e.room)}</b></div><div class="eq">${esc(e.equipment)}</div><div class="comp">${blank(e.component)}</div></div>
    <div class="sevcard"><div class="top" style="background:${color}"><span>${esc(sevText)}</span><small>${esc(prio)}</small></div>
      <div class="temps">
        <div><span>Max Temp</span>${e.maxTemp ? `<b>${esc(e.maxTemp)}</b>` : `<b class="na">${esc(na)}</b>`}</div>
        <div><span>Ambient</span><b>${blank(e.ambientTemp)}</b></div>
        <div><span>Delta T (ΔT)</span>${dT !== null ? `<b>${esc(dT)}</b>` : `<b class="na">${esc(na)}</b>`}</div>
      </div></div>
  </div>
  <div class="photos">${frame(photos.ir, "Thermal Image", e.irNumber)}${frame(photos.visual, "Visual Image", e.visualNumber)}</div>
  <div class="details">
    <div class="box"><dl class="dl">
      <dt>Possible Cause</dt><dd>${blank(e.cause)}</dd>
      <dt>Recommendation</dt><dd>${blank(e.recommendation)}</dd>
      ${e.notes ? `<dt>Notes</dt><dd>${esc(e.notes)}</dd>` : ""}
      ${e.opened && e.opened !== "Yes, Completely" ? `<dt>Opened</dt><dd>${esc(e.opened)}</dd>` : ""}
    </dl></div>
    <div class="box"><div class="cond">
      <div><span>Image Date</span><b>${blank(e.imageDate)}</b></div>
      <div><span>Emissivity</span><b>${blank(e.emissivity)}</b></div>
      <div><span>Distance (ft)</span><b>${blank(e.distance)}</b></div>
      <div><span>Humidity</span><b>${e.humidity ? pct(e.humidity) : blank("")}</b></div>
      <div><span>Background</span><b>${blank(e.backgroundTemp)}</b></div>
      <div><span>Ambient</span><b>${blank(e.ambientTemp)}</b></div>
    </div><div class="unit">Temperatures are in degrees Fahrenheit.</div></div>
  </div>`, a);
}

function resultCell(l: InventoryLine) {
  switch (l.status.kind) {
    case "severity": { const b = band(l.status.severity); return `<span class="res" style="background:${b.color}">${esc(b.label)}</span>`; }
    case "visual-finding": return `<span class="res vf">Visual finding</span>`;
    case "not-evaluated": return `<span class="res ne">Not Evaluated (${esc(l.status.reason)})</span>`;
    default: return `<span class="res nd">Not documented</span>`;
  }
}

function inventoryPages(model: InspectionReportModel, a: ReportAssets) {
  const pages = paginateInventory(model.inventory, model.meta.scopeNotes.length > 0);
  const anyNotes = model.inventory.some((g) => g.lines.some((l) => l.notes));
  return pages.map((blocks, i) => {
    const last = i === pages.length - 1;
    const rows = blocks.map((b) => `<tr class="roomrow"><td colspan="${anyNotes ? 7 : 6}">${esc(b.room)}${b.continued ? ` <span class="muted" style="font-weight:500;font-size:8pt">(continued)</span>` : ""}</td></tr>` + b.lines.map((l) => `<tr><td><b>${esc(l.equipment)}</b></td><td>${esc(l.components.join(", "))}</td><td>${esc(l.imageNumbers.join(", "))}</td><td>${esc(l.opened)}</td><td>${resultCell(l)}</td>${anyNotes ? `<td>${esc(l.notes)}</td>` : ""}<td class="num">${esc(l.pages.length ? pageList(l.pages) : "")}</td></tr>`).join("")).join("");
    return shell(model, model.layout.inventoryStart + i, `
    <div class="head"><img src="${a.logo}" alt=""><div><h1>Equipment Inventory</h1><p>Every item in the inspection scope, by location${pages.length > 1 ? ` · ${i + 1} of ${pages.length}` : ""}</p></div></div>
    <div class="body"><table class="inv${anyNotes ? " notes" : ""}"><colgroup><col class="e"><col class="c"><col class="i"><col class="o"><col class="r">${anyNotes ? `<col class="n">` : ""}<col class="p"></colgroup>
      <thead><tr><th>Equipment</th><th>Component(s)</th><th>Image #</th><th>Opened</th><th>Result</th>${anyNotes ? "<th>Notes</th>" : ""}<th class="num">Page</th></tr></thead><tbody>${rows}</tbody></table>
      ${last ? model.meta.scopeNotes.map((s) => `<div class="scope"><b>Scope:</b> ${esc(s)}</div>`).join("") : ""}
    </div>`, a);
  }).join("");
}

/** The whole report as one HTML document. */
export function renderInspectionReportHtml(model: InspectionReportModel, assets: ReportAssets, opts: { fontsHref?: string } = {}): string {
  const fonts = opts.fontsHref ?? "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap";
  const title = `${model.meta.clientName} Infrared Inspection Report ${model.meta.inspectionDates[0] ?? ""}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="${fonts}"><style>${CSS}</style></head><body>
${cover(model, assets)}${understanding(model, assets)}${overview(model, assets)}${model.entries.map((e) => findingPage(model, e, assets)).join("")}${inventoryPages(model, assets)}
</body></html>`;
}
