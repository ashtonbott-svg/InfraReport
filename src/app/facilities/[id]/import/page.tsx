"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, Loader2, Plus, ScanLine, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useCustomers, useEquipment, useFacilities, useLocations } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { EQUIPMENT_PRESETS, OTHER_EQUIPMENT_TYPE } from "@/lib/domain/constants";
import { defaultComponentForType, inferTypeFromName } from "@/lib/domain/rules";
import { ACCEPTED, readImportFile, type ImportSource } from "@/lib/import/load-file";
import { makeRow, markDuplicates, type ProposedRow } from "@/lib/import/table";
import type { PdfStrategy } from "@/lib/import/pdf-parse";

const TYPES = [...EQUIPMENT_PRESETS.map((p) => p.type), OTHER_EQUIPMENT_TYPE];
const STRATEGY_LABEL: Record<PdfStrategy, string> = {
  table: "Equipment table (columns)",
  labeled: "Labeled fields (Location: / Equipment:)",
  lines: "Text lines that look like equipment (uncertain)",
};
const roomKey = (r: { building: string; room: string }) => `${r.building}\u0000${r.room}`;

export default function ImportInventoryPage() {
  const { id } = useParams<{ id: string }>();
  const facility = useFacilities().find((f) => f.id === id);
  const customer = useCustomers().find((c) => c.id === facility?.customerId);
  const locations = useLocations();
  const equipment = useEquipment();
  const importInventory = useStore((s) => s.importInventory);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [rows, setRows] = useState<ProposedRow[]>([]);
  const [view, setView] = useState<"all" | "flagged" | "excluded">("all");
  const [done, setDone] = useState<{ rooms: number; equipment: number } | null>(null);
  const [showText, setShowText] = useState(false);

  const existing = useMemo(() => {
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return equipment.filter((e) => e.facilityId === id).map((e) => ({ building: locMap.get(e.locationId)?.building ?? "", room: locMap.get(e.locationId)?.name ?? "", name: e.name }));
  }, [equipment, locations, id]);

  if (!facility) return <EmptyState title="Facility not found" action={<Link href="/facilities"><Button>Back</Button></Link>} />;

  const loadRows = (r: ProposedRow[]) => { setRows(markDuplicates(r, existing)); setView("all"); };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null); setSource(null); setRows([]); setDone(null);
    try {
      const src = await readImportFile(file);
      setSource(src);
      if (src.kind === "pdf") {
        const best = src.pdf.best;
        setChoice(best ?? "table");
        loadRows(best ? src.pdf.strategies[best] : []);
      } else {
        const best = src.sheets.reduce((a, s, i) => (s.rows.length > src.sheets[a].rows.length ? i : a), 0);
        setChoice(String(best));
        loadRows(src.sheets[best]?.rows ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "This file could not be read.");
    } finally {
      setBusy(false);
    }
  };
  const switchChoice = (c: string) => {
    if (!source) return;
    if (rows.length && !confirm("Switching the method replaces the rows below, including your edits. Continue?")) return;
    setChoice(c);
    loadRows(source.kind === "pdf" ? source.pdf.strategies[c as PdfStrategy] : source.sheets[Number(c)].rows);
  };

  const update = (rid: string, patch: Partial<ProposedRow>) => setRows((cur) => markDuplicates(cur.map((r) => {
    if (r.id !== rid) return r;
    const next = { ...r, ...patch };
    // Typing a name on a row with no type yet: suggest type and its default component (still editable).
    if (patch.name !== undefined && r.type === OTHER_EQUIPMENT_TYPE && !r.component) {
      const t = inferTypeFromName(patch.name);
      if (t) { next.type = t; next.component = defaultComponentForType(t); }
    }
    return next;
  }), existing));
  const included = rows.filter((r) => r.include);
  const roomGroups = (() => {
    const m = new Map<string, { building: string; room: string; count: number }>();
    for (const r of included) {
      const k = roomKey(r);
      const g = m.get(k) ?? { building: r.building, room: r.room, count: 0 };
      g.count++;
      m.set(k, g);
    }
    return [...m.values()];
  })();
  const renameRoom = (g: { building: string; room: string }, patch: { building?: string; room?: string }) =>
    setRows((cur) => markDuplicates(cur.map((r) => (roomKey(r) === roomKey(g) ? { ...r, ...patch } : r)), existing));
  const blockers = included.filter((r) => !r.name.trim() || !r.room.trim());
  const visible = rows.filter((r) => view === "all" || (view === "flagged" ? r.flags.length > 0 : !r.include));
  const roomOptions = [...new Set(rows.map((r) => r.room).filter(Boolean))];
  const buildingOptions = [...new Set(rows.map((r) => r.building).filter(Boolean))];

  const addRow = () => {
    const last = rows[rows.length - 1];
    const r = makeRow({ building: last?.building ?? "", room: last?.room ?? "", name: "", source: "Added during review" });
    setRows((cur) => [...cur, r]);
    setTimeout(() => document.getElementById(`imp-name-${r.id}`)?.focus(), 30);
  };

  const approve = () => {
    if (!included.length) { toast("Nothing selected to import", "error"); return; }
    if (blockers.length) { toast(`${blockers.length} row(s) need an equipment name and room`, "error"); setView("all"); return; }
    if (!confirm(`Save ${included.length} equipment items in ${roomGroups.length} rooms to ${facility.name}'s permanent inventory?`)) return;
    const res = importInventory(facility.id, included.map((r) => ({ building: r.building, room: r.room, name: r.name, type: r.type, component: r.component, identifiers: r.identifiers })), source?.fileName ?? "manual list");
    setDone({ rooms: res.rooms, equipment: res.equipment });
    toast(`${res.equipment} items saved to inventory`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (done) {
    return (
      <>
        <PageHeader eyebrow={<><Link href="/facilities" className="hover:underline">Facilities</Link> / {customer?.name}</>} title={facility.name} />
        <Card className="mx-auto max-w-xl">
          <CardBody className="space-y-4 py-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <div className="text-lg font-semibold">Inventory saved</div>
            <p className="text-sm text-slate-600">{done.equipment} equipment items in {done.rooms} rooms are now part of {facility.name}. No temperatures, findings, photos or access conditions were copied. A new inspection starts as a fresh scan.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Link href={`/inspections/new?customer=${facility.customerId}&facility=${facility.id}`}><Button variant="primary" size="lg" className="h-12 w-full justify-center text-base"><ClipboardList className="h-5 w-5" />Create New Inspection</Button></Link>
              <Link href={`/facilities/${facility.id}`}><Button size="lg" className="h-12 w-full justify-center text-base">View Inventory</Button></Link>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  const pdf = source?.kind === "pdf" ? source.pdf : null;
  return (
    <>
      <PageHeader eyebrow={<><Link href="/facilities" className="hover:underline">Facilities</Link> / <Link href={`/facilities/${facility.id}`} className="hover:underline">{facility.name}</Link></>}
        title="Import Equipment List" description="Bring in the equipment list from a previous inspection. Only permanent equipment identity is imported: building, room, equipment name, type, component and identifiers." />

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 text-sm text-slate-600">
            <div className="font-medium text-slate-900">{source ? source.fileName : "PDF, Excel (.xlsx, .xlsm) or CSV"}</div>
            Files are read on this device and are not uploaded anywhere. Old temperatures, image numbers, possible causes and Opened values in the file are ignored.
          </div>
          <Button variant="primary" size="lg" className="h-12 justify-center text-base" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}{busy ? "Reading file…" : source ? "Choose a different file" : "Choose file"}
          </Button>
          <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden" data-testid="import-file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </CardBody>
        {error ? <div className="flex items-start gap-2 border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
      </Card>

      {pdf?.scanned ? (
        <Card className="mb-6 border-amber-300">
          <CardBody className="flex gap-3 text-sm text-amber-950">
            <ScanLine className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <div className="font-semibold">This PDF is a scanned image with no text layer.</div>
              <p>InfraReport reads text-based PDFs. Reading scanned pages needs OCR (optical character recognition), which is not connected yet, so nothing was imported and nothing was guessed.</p>
              <p>Options: import the original Excel or CSV list, or a PDF exported directly from the report (not scanned), or add the equipment below by hand.</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {source ? (
        <Card className="mb-6">
          <CardBody className="space-y-3">
            {pdf ? (
              <>
                <div className="text-sm font-medium text-slate-800">How to read this PDF ({pdf.pages} page{pdf.pages === 1 ? "" : "s"})</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(STRATEGY_LABEL) as PdfStrategy[]).map((k) => (
                    <button key={k} onClick={() => switchChoice(k)} className={cn("rounded-lg border px-3 py-2 text-left text-sm", choice === k ? "border-thermal-500 bg-thermal-50 ring-1 ring-thermal-500" : "border-slate-200 hover:bg-slate-50")}>
                      <div className="font-medium">{STRATEGY_LABEL[k]}</div>
                      <div className="text-xs text-slate-500">{pdf.strategies[k].length} rows found</div>
                    </button>
                  ))}
                </div>
                {pdf.lines.length ? (
                  <div>
                    <button className="text-xs font-medium text-thermal-700 hover:underline" onClick={() => setShowText(!showText)}>{showText ? "Hide" : "Show"} extracted PDF text</button>
                    {showText ? <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">{pdf.lines.map((l) => `p${l.page}  ${l.text}`).join("\n")}</pre> : null}
                  </div>
                ) : null}
              </>
            ) : source.kind === "sheet" && source.sheets.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Worksheet:</span>
                {source.sheets.map((s, i) => (
                  <button key={s.name} onClick={() => switchChoice(String(i))} className={cn("rounded-full border px-3 py-1", choice === String(i) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200")}>{s.name} ({s.rows.length})</button>
                ))}
              </div>
            ) : null}
            {source.kind === "sheet" && !source.sheets[Number(choice)]?.found ? (
              <p className="flex items-start gap-2 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />No header row with an Equipment column was found. The first rows should include headings such as Location / Room, Equipment, Component.</p>
            ) : null}
            {source.kind === "sheet" && source.sheets[Number(choice)]?.ignoredColumns.length ? (
              <p className="text-xs text-slate-500">Ignored columns (observations or unrecognized): {source.sheets[Number(choice)].ignoredColumns.join(", ")}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {source || rows.length ? (
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title={`${roomGroups.length} rooms`} description="Rename a room here to change every row in it. Order is kept." />
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {roomGroups.map((g) => (
                <li key={roomKey(g)} className="space-y-1 px-4 py-2">
                  <input className="grid-input font-medium" defaultValue={g.room} aria-label="Room name" placeholder="Room (required)" onBlur={(e) => e.target.value.trim() !== g.room && renameRoom(g, { room: e.target.value.trim() })} />
                  <div className="flex items-center gap-2">
                    <input className="grid-input text-xs" defaultValue={g.building} aria-label="Building" placeholder="Building (optional)" onBlur={(e) => e.target.value.trim() !== g.building && renameRoom(g, { building: e.target.value.trim() })} />
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{g.count}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="min-w-0">
            <CardHeader title={`${included.length} equipment items ready`} description={`${rows.length - included.length} excluded · ${rows.filter((r) => r.flags.length).length} flagged for review`}
              actions={<>
                {(["all", "flagged", "excluded"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-2 py-1 text-xs font-medium", view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{v[0].toUpperCase() + v.slice(1)}</button>
                ))}
                <Button size="sm" onClick={addRow}><Plus className="h-3.5 w-3.5" />Add equipment</Button>
              </>} />
            <datalist id="imp-rooms">{roomOptions.map((r) => <option key={r} value={r} />)}</datalist>
            <datalist id="imp-buildings">{buildingOptions.map((r) => <option key={r} value={r} />)}</datalist>
            {visible.length === 0 ? <EmptyState icon={<FileText className="h-5 w-5" />} title={rows.length ? "Nothing in this view" : "No equipment rows"} description={rows.length ? undefined : "Choose another reading method above, or add equipment by hand."} action={<Button onClick={addRow}><Plus className="h-4 w-4" />Add equipment</Button>} /> : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-10 border-b px-2 py-2">Use</th>
                      <th className="w-10 border-b px-2 py-2">#</th>
                      <th className="w-32 border-b px-2 py-2">Building</th>
                      <th className="w-44 border-b px-2 py-2">Room</th>
                      <th className="w-52 border-b px-2 py-2">Equipment</th>
                      <th className="w-32 border-b px-2 py-2">Type</th>
                      <th className="w-36 border-b px-2 py-2">Component</th>
                      <th className="w-28 border-b px-2 py-2">Identifiers</th>
                      <th className="border-b px-2 py-2">Review</th>
                      <th className="w-10 border-b px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const bad = r.include && (!r.name.trim() || !r.room.trim());
                      return (
                        <tr key={r.id} className={cn(!r.include && "bg-slate-50 text-slate-400", bad && "bg-red-50")} data-testid="import-row">
                          <td className="border-b border-slate-100 px-2 text-center"><input type="checkbox" className="h-4 w-4 accent-thermal-600" checked={r.include} onChange={(e) => update(r.id, { include: e.target.checked })} aria-label="Include row" /></td>
                          <td className="border-b border-slate-100 px-2 text-xs tabular-nums text-slate-400" title={r.source}>{rows.indexOf(r) + 1}</td>
                          <td className="border-b border-slate-100 px-1"><input className="grid-input" list="imp-buildings" value={r.building} onChange={(e) => update(r.id, { building: e.target.value })} aria-label="Building" /></td>
                          <td className="border-b border-slate-100 px-1"><input className="grid-input" list="imp-rooms" value={r.room} onChange={(e) => update(r.id, { room: e.target.value })} aria-label="Room" /></td>
                          <td className="border-b border-slate-100 px-1"><input id={`imp-name-${r.id}`} className="grid-input font-medium" value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} aria-label="Equipment name" /></td>
                          <td className="border-b border-slate-100 px-1">
                            <select className="grid-input" value={TYPES.includes(r.type) ? r.type : OTHER_EQUIPMENT_TYPE} aria-label="Type"
                              onChange={(e) => update(r.id, { type: e.target.value, component: r.component || defaultComponentForType(e.target.value) })}>
                              {TYPES.map((t) => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td className="border-b border-slate-100 px-1"><input className="grid-input" value={r.component} onChange={(e) => update(r.id, { component: e.target.value, flags: r.flags.filter((f) => !f.startsWith("Component may")) })} aria-label="Component" /></td>
                          <td className="border-b border-slate-100 px-1"><input className="grid-input" value={r.identifiers} onChange={(e) => update(r.id, { identifiers: e.target.value })} aria-label="Identifiers" /></td>
                          <td className="border-b border-slate-100 px-2 py-1 text-xs">
                            {bad ? <div className="text-red-700">Needs {!r.name.trim() ? "an equipment name" : "a room"}.</div> : null}
                            {r.flags.map((f) => <div key={f} className="text-amber-800">{f}</div>)}
                            <div className="text-[10px] text-slate-400">{r.source}</div>
                          </td>
                          <td className="border-b border-slate-100 px-1 text-center"><button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Remove row" onClick={() => setRows((cur) => markDuplicates(cur.filter((x) => x.id !== r.id), existing))}><Trash2 className="h-3.5 w-3.5" /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex-1 text-sm">
                <strong>{included.length}</strong> equipment in <strong>{roomGroups.length}</strong> rooms will be added to {facility.name}.
                {existing.length ? <span className="text-slate-500"> The facility already has {existing.length} items; matches are excluded.</span> : null}
                {blockers.length ? <div className="text-red-700">{blockers.length} row(s) need a name and room.</div> : null}
              </div>
              <Button variant="primary" size="lg" className="h-12 justify-center text-base" onClick={approve} disabled={!included.length}>
                <CheckCircle2 className="h-5 w-5" />Approve &amp; Save Inventory
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <CardBody className="py-10 text-center text-sm text-slate-500">
            <Badge tone="slate">Tip</Badge>
            <p className="mt-2">Prefer the original Excel or CSV list when you have it. PDFs work when their text can be selected; scanned PDFs need OCR, which is not connected yet.</p>
            <Button className="mt-4" onClick={addRow}><Plus className="h-4 w-4" />Or type the list in by hand</Button>
          </CardBody>
        </Card>
      )}
    </>
  );
}
