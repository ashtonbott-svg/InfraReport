"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, ListChecks, RefreshCw, ShieldCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { useRole } from "@/lib/cloud/role";
import { useCustomers, useFacilities, useInspectionBundle, useUsers } from "@/lib/store/hooks";
import { inspectorNames } from "@/components/forms/thermographer-picker";
import { formatDate, formatDateTime } from "@/lib/format";
import { listPhotoFiles, type PhotoFile } from "@/lib/photos/photo-files";
import { signedPhotoUrl } from "@/lib/photos/cloud-upload";
import { approveVersion, createDraft, listVersions, loadSettings, printHtml, renderVersion, reportPhotoMap, saveSettings, type ReportSettings, type ReportVersion } from "@/lib/reports/report-data";
import { band } from "@/lib/reports/severity";

type Box = { x: number; y: number; w: number; h: number };

export default function ReportWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const bundle = useInspectionBundle(id);
  const { cloud, isAdmin } = useRole();
  const facility = useFacilities().find((f) => f.id === bundle?.dataset.inspection.facilityId);
  const customer = useCustomers().find((c) => c.id === bundle?.dataset.inspection.customerId);
  const users = useUsers();
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [versions, setVersions] = useState<ReportVersion[]>([]);
  const [files, setFiles] = useState<PhotoFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [scopeText, setScopeText] = useState("");
  const [marking, setMarking] = useState<{ imageId: string; label: string; url: string; boxes: Box[] } | null>(null);

  const reload = useCallback(async () => {
    const [s, v, f] = await Promise.all([loadSettings(id), listVersions(id), listPhotoFiles(id)]);
    setSettings(s); setVersions(v); setFiles(f); setScopeText((s.scopeNotes ?? []).join("\n"));
    setSelected((cur) => cur ?? v[0]?.id ?? null);
  }, [id]);
  useEffect(() => {
    if (!cloud || !isAdmin) return;
    let live = true;
    Promise.all([loadSettings(id), listVersions(id), listPhotoFiles(id)]).then(([s, v, f]) => {
      if (!live) return;
      setSettings(s); setVersions(v); setFiles(f); setScopeText((s.scopeNotes ?? []).join("\n")); setSelected(v[0]?.id ?? null);
    }, (e) => toast((e as Error).message, "error"));
    return () => { live = false; };
  }, [id, cloud, isAdmin]);
  const version = versions.find((v) => v.id === selected) ?? null;
  useEffect(() => {
    if (!version) return;
    let live = true;
    renderVersion(version).then((h) => { if (live) setHtml(h); }, (e) => toast((e as Error).message, "error"));
    return () => { live = false; };
  }, [version]);

  const ds = bundle?.dataset;
  const meta = useMemo(() => ds ? ({
    clientName: customer?.name ?? "", facilityName: facility?.name ?? "",
    address: [facility?.address, facility?.city, facility?.state, facility?.postalCode].filter(Boolean).join(", "),
    inspectionDates: [new Date(`${ds.inspection.date}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })],
    thermographers: inspectorNames(ds.inspection.inspectorIds, users).split(/,\s*|\s*&\s*/).filter(Boolean),
    company: { name: "Infinite Infrared", phone: "(682) 233-0257", website: "www.infiniteinfrared.com" },
    scopeNotes: [], inspectionNotes: ds.inspection.notes,
  }) : null, [ds, customer, facility, users]);
  const photoMap = useMemo(() => (ds && settings ? reportPhotoMap(ds, files, settings) : null), [ds, files, settings]);

  if (!cloud || !isAdmin) return <EmptyState title="Administrators only" description="Reports are prepared and approved by an administrator." />;
  if (!ds || !meta) return <EmptyState title="Inspection not found" />;

  const generate = async () => {
    if (!settings) return;
    setBusy("Generating draft…");
    try {
      const next = { ...settings, scopeNotes: scopeText.split("\n").map((s) => s.trim()).filter(Boolean) };
      await saveSettings(id, ds.inspection.organizationId, next);
      setSettings(next);
      const v = await createDraft(ds, meta, next);
      toast(`Draft ${v.number} generated`);
      await reload(); setSelected(v.id);
    } catch (e) { toast((e as Error).message, "error"); }
    setBusy(null);
  };
  const approve = async () => {
    if (!version) return;
    if (!confirm(`Approve report version ${version.number}? It becomes the final report and can no longer be changed (a new draft can replace it later).`)) return;
    setBusy("Approving…");
    try { await approveVersion(version); toast(`Report version ${version.number} approved`); await reload(); } catch (e) { toast((e as Error).message, "error"); }
    setBusy(null);
  };
  const download = async (kind: "report" | "equipment-list") => {
    if (!version) return;
    const win = window.open("", "_blank");
    if (!win) { toast("Allow pop-ups to download the PDF", "error"); return; }
    win.document.write("<p style='font-family:sans-serif;padding:2em'>Preparing the report…</p>");
    const h = await renderVersion(version, kind);
    const name = `${customer?.name ?? "Customer"} ${kind === "report" ? "Infrared Inspection Report" : "Equipment List"} ${ds.inspection.date}${version.status === "approved" ? "" : " DRAFT"}`;
    printHtml(win, h, name);
  };
  const openMarking = async (imageId: string, label: string) => {
    const pid = photoMap?.byImage[imageId]?.visual;
    const f = files.find((x) => x.id === pid);
    const url = f ? await signedPhotoUrl(f.storage_path) : null;
    if (!url) { toast("This entry has no verified visual photograph yet", "error"); return; }
    setMarking({ imageId, label, url, boxes: settings?.annotations?.[imageId] ?? [] });
  };
  const saveMarking = async () => {
    if (!marking || !settings) return;
    // Keep the scope statements as currently typed: saving a marked area must not drop them.
    const next = { ...settings, scopeNotes: scopeText.split("\n").map((x) => x.trim()).filter(Boolean), annotations: { ...(settings.annotations ?? {}), [marking.imageId]: marking.boxes } };
    try { await saveSettings(id, ds.inspection.organizationId, next); setSettings(next); setMarking(null); toast("Marked areas saved. Generate a new draft to include them."); } catch (e) { toast((e as Error).message, "error"); }
  };

  const review = version?.review ?? [];
  const blockers = review.filter((r) => r.level === "blocker");
  const findings = version ? version.model.entries.filter((e) => !(e.assessment.kind === "severity" && e.assessment.severity === "normal")) : [];
  const approved = versions.find((v) => v.status === "approved");

  return (
    <>
      <PageHeader eyebrow={<><Link href="/reports" className="hover:underline">Reports</Link> / {customer?.name}</>} title={`${facility?.name ?? "Inspection"} report`}
        description={<span className="inline-flex flex-wrap items-center gap-2">{formatDate(ds.inspection.date)} <StatusBadge status={ds.inspection.status} /> {approved ? <Badge tone="green">Approved report: version {approved.number}</Badge> : <Badge tone="amber">No approved report yet</Badge>}</span>}
        actions={<>
          <Link href={`/inspections/${id}/photos`}><Button>Photographs</Button></Link>
          <Button variant="primary" onClick={() => void generate()} disabled={!!busy || !settings} data-testid="generate-draft"><RefreshCw className="h-4 w-4" />{busy ?? (versions.length ? "Generate New Draft" : "Generate Draft")}</Button>
        </>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Versions" />
            <CardBody className="space-y-2">
              {versions.length ? versions.map((v) => (
                <button key={v.id} onClick={() => setSelected(v.id)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${v.id === selected ? "border-thermal-300 bg-thermal-50" : "border-slate-200"}`} data-testid="report-version">
                  <span>Version {v.number} <span className="text-xs text-slate-500">{formatDateTime(v.created_at)}</span></span>
                  {v.status === "approved" ? <Badge tone="green">Approved</Badge> : v.status === "superseded" ? <Badge>Superseded</Badge> : <Badge tone="amber">Draft</Badge>}
                </button>
              )) : <p className="text-sm text-slate-500">No draft yet. Generate one to preview the report.</p>}
              {version ? (
                <div className="grid gap-2 pt-2">
                  {version.status === "draft" ? <Button variant="primary" onClick={() => void approve()} disabled={!!busy || blockers.length > 0} data-testid="approve-report"><ShieldCheck className="h-4 w-4" />Approve Version {version.number}</Button> : null}
                  {blockers.length && version.status === "draft" ? <p className="text-xs text-red-700">Fix the {blockers.length} item{blockers.length === 1 ? "" : "s"} marked Must fix, then generate a new draft.</p> : null}
                  <Button onClick={() => void download("report")} data-testid="download-report"><Download className="h-4 w-4" />Download Report PDF{version.status === "approved" ? "" : " (draft)"}</Button>
                  <Button onClick={() => void download("equipment-list")}><ListChecks className="h-4 w-4" />Download Equipment List</Button>
                  <p className="text-xs text-slate-500">Opens the print dialog: choose Save as PDF. Pages are 10 x 7.5 in landscape.</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
          {version ? (
            <Card>
              <CardHeader title={`To review (${review.length})`} description="Nothing is filled in for you: missing or questionable data is listed here." />
              <CardBody>
                {review.length ? <ul className="space-y-2 text-sm" data-testid="report-review">{review.map((r, i) => (
                  <li key={i} className="flex gap-2">{r.level === "blocker" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                    <span><b className={r.level === "blocker" ? "text-red-700" : "text-amber-800"}>{r.level === "blocker" ? "Must fix: " : "Check: "}</b>{r.message}{r.resultId ? <> <Link className="text-heat-700 underline" href={`/inspections/${id}/entry`}>Open entries</Link></> : null}</span></li>
                ))}</ul> : <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Nothing to review.</p>}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Report settings" description="Saved with the inspection; used by the next draft." />
            <CardBody className="space-y-3 text-sm">
              <label className="block" htmlFor="scope"><span className="mb-1 block font-medium">Scope limitations and statements (one per line)</span>
                <textarea id="scope" rows={4} disabled={!settings} className="w-full rounded-lg border border-slate-300 p-2 text-base" value={scopeText} onChange={(e) => setScopeText(e.target.value)} placeholder="e.g. Equipment downstream of P8 belongs to another tenant and was outside the scope." /></label>
              {ds.inspection.notes ? <p className="text-xs text-slate-500">Inspection notes are included as written: “{ds.inspection.notes.slice(0, 120)}{ds.inspection.notes.length > 120 ? "…" : ""}”</p> : null}
              <div>
                <div className="mb-1 font-medium">Mark the problem area on visual photographs</div>
                {findings.length ? <ul className="space-y-1">{findings.map((e) => (
                  <li key={e.key} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">p. {e.page} {e.equipment}{e.component ? `, ${e.component}` : ""} {e.assessment.kind === "severity" ? <span className="px-1 text-xs" style={{ background: band(e.assessment.severity).color }}>{band(e.assessment.severity).label}</span> : null}</span>
                    <Button size="sm" onClick={() => void openMarking(e.imageId, `${e.equipment} ${e.component}`)} data-testid="mark-area"><Square className="h-3.5 w-3.5" />{settings?.annotations?.[e.imageId]?.length ? `Edit (${settings.annotations[e.imageId].length})` : "Mark"}</Button>
                  </li>
                ))}</ul> : <p className="text-slate-500">Generate a draft first; discrepancies are listed here.</p>}
              </div>
              <p className="text-xs text-slate-500">Photographs: {photoMap?.match.assignments.length ?? 0} matched, {photoMap?.match.missing.length ?? 0} missing, {photoMap?.cover.length ?? 0} for the cover. Corrections to equipment, readings and causes are made in the inspection itself; then generate a new draft.</p>
            </CardBody>
          </Card>
        </div>
        <Card className="min-h-[70vh] overflow-hidden">
          {html ? <PreviewFrame html={html} /> : <EmptyState icon={<FileText className="h-5 w-5" />} title="No preview yet" description="Generate a draft to see the report." />}
        </Card>
      </div>
      <Modal open={!!marking} onClose={() => setMarking(null)} title={marking ? `Mark area: ${marking.label}` : ""} wide
        footer={<><Button onClick={() => setMarking((m) => (m ? { ...m, boxes: [] } : m))}>Clear</Button><Button onClick={() => setMarking(null)}>Cancel</Button><Button variant="primary" onClick={() => void saveMarking()}>Save</Button></>}>
        {marking ? <Annotator url={marking.url} boxes={marking.boxes} onChange={(boxes) => setMarking({ ...marking, boxes })} /> : null}
      </Modal>
    </>
  );
}

/** Drag on the photograph to draw a box around the problem area (stored as fractions of the image). */
function Annotator({ url, boxes, onChange }: { url: string; boxes: Box[]; onChange: (b: Box[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">Drag across the photograph to draw a box. Draw several if needed.</p>
      <div ref={ref} className="relative touch-none select-none" data-testid="annotator"
        onPointerDown={(e) => { start.current = pos(e); setDraft({ ...start.current, w: 0, h: 0 }); (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (!start.current) return; const p = pos(e); setDraft({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y), w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) }); }}
        onPointerUp={() => { if (draft && draft.w > 0.01 && draft.h > 0.01) onChange([...boxes, draft]); start.current = null; setDraft(null); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="block w-full" draggable={false} />
        {[...boxes, ...(draft ? [draft] : [])].map((b, i) => <div key={i} className="absolute border-2 border-[#F26B3A]" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />)}
      </div>
    </div>
  );
}

/** The report at its real page width (10 in), scaled down to fit the panel. */
function PreviewFrame({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / 1000));
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = 820;
  return (
    <div ref={box} className="overflow-hidden bg-slate-200" style={{ height: h }}>
      <iframe title="Report preview" srcDoc={html} data-testid="report-preview" className="border-0 bg-slate-200"
        style={{ width: 1000, height: h / scale, transform: `scale(${scale})`, transformOrigin: "top left" }} />
    </div>
  );
}
