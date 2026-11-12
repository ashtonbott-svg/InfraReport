"use client";

import { Fragment, useRef, useState, type KeyboardEvent } from "react";
import { useDraft } from "@/lib/use-draft";
import { ChevronDown, ChevronRight, Copy, CornerDownLeft, Trash2, Undo2, AlertTriangle, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  COMPONENT_SUGGESTIONS, DEFAULT_OPENED, EQUIPMENT_PRESETS, LIMITED_ACCESS_OPENED, OPENED_VALUES, OTHER_EQUIPMENT_TYPE, POSSIBLE_CAUSE_NONE,
} from "@/lib/domain/constants";
import { applySinglePhotoConvention, defaultComponentForType, incrementName, inferTypeFromName, resolveEffective } from "@/lib/domain/rules";
import { locationLabel } from "@/lib/domain/csv";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Location, ResultOverrides } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { toast } from "@/components/ui/toast";

/* ------------------------------------------------------------------ */
/* Keyboard navigation: Enter = next row same column, Shift+Enter = up */
/* ------------------------------------------------------------------ */
function focusCell(row: number, col: string) {
  const el = document.querySelector<HTMLElement>(`[data-grid-row="${row}"][data-grid-col="${col}"]`);
  if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select(); return true; }
  return false;
}
function gridKeyDown(e: KeyboardEvent<HTMLElement>, row: number, col: string, commit?: () => void) {
  if (e.key === "Enter" && !e.altKey && !(e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault();
    commit?.();
    const next = e.shiftKey ? row - 1 : row + 1;
    if (!focusCell(next, col) && !e.shiftKey) document.getElementById("quick-add-name")?.focus();
  }
}

function TextCell({ value, onCommit, row, col, placeholder, inherited, className, list, numeric, label }: {
  value: string; onCommit: (v: string) => void; row: number; col: string; placeholder?: string; inherited?: boolean;
  className?: string; list?: string; numeric?: boolean; label: string;
}) {
  const [v, setV] = useDraft(value);
  const commit = () => { if (v !== value) onCommit(v); };
  return (
    <input
      className={cn("grid-input", inherited && v === "" && "placeholder:italic placeholder:text-slate-400", numeric && "tabular-nums", className)}
      value={v} placeholder={placeholder} list={list} aria-label={label}
      inputMode={numeric ? "decimal" : undefined}
      data-grid-row={row} data-grid-col={col}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Escape") { setV(value); (e.target as HTMLInputElement).blur(); } else gridKeyDown(e, row, col, commit); }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Quick add                                                           */
/* ------------------------------------------------------------------ */
export function QuickAddBar({ inspectionId, locationId, disabled }: { inspectionId: string; locationId: string | null; disabled?: boolean }) {
  const addResult = useStore((s) => s.addResult);
  const [type, setType] = useState("Panel");
  const [name, setName] = useState("");
  const [component, setComponent] = useState("Full Panel");
  const [componentTouched, setComponentTouched] = useState(false);
  const [ir, setIr] = useState("");
  const [vis, setVis] = useState("");
  const [dist, setDist] = useState("");
  const [opened, setOpened] = useState<string>(DEFAULT_OPENED);
  const nameRef = useRef<HTMLInputElement>(null);

  const changeType = (t: string) => {
    setType(t);
    if (!componentTouched) setComponent(defaultComponentForType(t));
  };
  const changeName = (n: string) => {
    setName(n);
    const t = inferTypeFromName(n);
    if (t && t !== type) changeType(t);
  };

  const submit = () => {
    if (!locationId) { toast("Select or add a room first", "error"); return; }
    if (!name.trim()) { nameRef.current?.focus(); return; }
    const photos = applySinglePhotoConvention(ir, vis);
    addResult(inspectionId, locationId, { name: name.trim(), equipmentType: type, component: component.trim(), ...photos, opened, distance: dist });
    // Ready for the next item: increment the name, keep type/component/opened, clear photos.
    setName(incrementName(name.trim()));
    setIr(""); setVis(""); setDist("");
    setTimeout(() => { nameRef.current?.focus(); nameRef.current?.select(); }, 0);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-900 p-3 text-white shadow-sm">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-300">Quick add equipment</span>
        <span className="hidden items-center gap-1 text-slate-400 sm:flex"><CornerDownLeft className="h-3 w-3" />Enter adds and prepares the next number</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-12">
        <select aria-label="Equipment type" className="h-9 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm md:col-span-2" value={type} onChange={(e) => changeType(e.target.value)} disabled={disabled}>
          {EQUIPMENT_PRESETS.map((p) => <option key={p.type}>{p.type}</option>)}
          <option>{OTHER_EQUIPMENT_TYPE}</option>
        </select>
        <input id="quick-add-name" ref={nameRef} aria-label="Equipment name" placeholder="Equipment (e.g. Panel P1)" className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm placeholder:text-slate-500 focus:border-thermal-500 focus:outline-none md:col-span-2" value={name} onChange={(e) => changeName(e.target.value)} onKeyDown={onKey} disabled={disabled} />
        <input aria-label="Component" list="component-suggestions" placeholder="Component" className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm placeholder:text-slate-500 focus:border-thermal-500 focus:outline-none md:col-span-2" value={component} onChange={(e) => { setComponent(e.target.value); setComponentTouched(true); }} onKeyDown={onKey} disabled={disabled} />
        <input aria-label="Distance" placeholder="Dist ft" inputMode="decimal" className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm tabular-nums placeholder:text-slate-500 focus:border-thermal-500 focus:outline-none md:col-span-1" value={dist} onChange={(e) => setDist(e.target.value)} onKeyDown={onKey} disabled={disabled} />
        <input aria-label="IR image number" placeholder="IR #" className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm tabular-nums placeholder:text-slate-500 focus:border-thermal-500 focus:outline-none md:col-span-1" value={ir} onChange={(e) => setIr(e.target.value)} onKeyDown={onKey} disabled={disabled} />
        <input aria-label="Visual image number" placeholder="Visual #" className="h-9 rounded-md border border-slate-700 bg-slate-800 px-3 text-sm tabular-nums placeholder:text-slate-500 focus:border-thermal-500 focus:outline-none md:col-span-1" value={vis} onChange={(e) => setVis(e.target.value)} onKeyDown={onKey} disabled={disabled} />
        <select aria-label="Opened" className="col-span-2 h-9 rounded-md border border-slate-700 bg-slate-800 px-2 text-sm md:col-span-2" value={opened} onChange={(e) => setOpened(e.target.value)} disabled={disabled}>
          {OPENED_VALUES.map((o) => <option key={o}>{o}</option>)}
        </select>
        <Button variant="primary" className="col-span-2 justify-center md:col-span-1" onClick={submit} disabled={disabled}>Add</Button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">One photo number only? Enter it in either field and it fills both IR and Visual, flagged for verification. Component resets to the preset when you change type, unless you typed your own.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */
export interface GridRow {
  result: InspectionResult;
  equipment: Equipment | undefined;
  location: Location | undefined;
  room: InspectionRoomConditions | undefined;
}

const cell = "border-b border-slate-100 px-1 py-1 align-middle";
const head = "sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500";

export function EquipmentGrid({ rows, inspection, causes, showRoomHeaders, locations }: {
  rows: GridRow[]; inspection: Inspection; causes: string[]; showRoomHeaders: boolean; locations: Location[];
}) {
  const { updateResult, updateEquipment, duplicateResult, deleteResult } = useStore();
  const [expanded, setExpanded] = useState<string | null>(null);

  const headerAt = rows.map((row, i) => showRoomHeaders && (i === 0 || rows[i - 1].result.locationId !== row.result.locationId));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
      <datalist id="component-suggestions">{COMPONENT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
      <table className="w-full min-w-[1040px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={cn(head, "w-8")} />
            <th className={cn(head, "sticky left-0 z-20 w-48 bg-slate-50")}>Equipment</th>
            <th className={cn(head, "w-32")}>Component</th>
            <th className={cn(head, "w-14")}>Dist</th>
            <th className={cn(head, "w-16")}>IR #</th>
            <th className={cn(head, "w-16")}>Visual #</th>
            <th className={cn(head, "w-16")}>Max °F</th>
            <th className={cn(head, "w-52")}>Opened</th>
            <th className={cn(head, "w-44")}>Possible Cause</th>
            <th className={cn(head, "w-20 text-right")}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { result: r, equipment: eq, location, room } = row;
            const eff = resolveEffective(r, room, inspection);
            const problem = r.possibleCause && r.possibleCause !== POSSIBLE_CAUSE_NONE;
            const limited = LIMITED_ACCESS_OPENED.includes(r.opened);
            const overrideCount = Object.values(r.overrides).filter((v) => v !== null).length;
            const header = headerAt[i];
            const isOpen = expanded === r.id;
            return (
              <Fragment key={r.id}>
                {header ? (
                  <tr><td colSpan={10} className="border-b border-slate-200 bg-slate-100/70 px-3 py-1.5 text-xs font-semibold text-slate-600">{locationLabel(location)}</td></tr>
                ) : null}
                <tr className={cn("group", problem ? "bg-thermal-50/50" : "hover:bg-slate-50/70", isOpen && "bg-slate-50")} data-result-id={r.id}>
                  <td className={cn(cell, "pl-2 text-center", problem ? "border-l-2 border-l-thermal-500" : "border-l-2 border-l-transparent")}>
                    <button onClick={() => setExpanded(isOpen ? null : r.id)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={isOpen ? "Collapse details" : "Expand details"} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className={cn(cell, "sticky left-0 z-[5]", problem ? "bg-thermal-50" : "bg-white group-hover:bg-slate-50")}>
                    <div className="flex items-center gap-1">
                      <TextCell label="Equipment" row={i} col="name" value={eq?.name ?? ""} onCommit={(v) => eq && updateEquipment(eq.id, { name: v })} className="font-medium" />
                      {overrideCount ? <span title={`${overrideCount} room value override(s)`} className="shrink-0 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">OVR</span> : null}
                      {r.visualFromSinglePhoto ? <span title="Visual # copied from single photo number" className="shrink-0 text-amber-500"><Camera className="h-3.5 w-3.5" /></span> : null}
                    </div>
                  </td>
                  <td className={cell}><TextCell label="Component" row={i} col="component" list="component-suggestions" value={r.component} onCommit={(v) => updateResult(r.id, { component: v })} /></td>
                  <td className={cell}>
                    <TextCell label="Distance" row={i} col="distance" numeric value={r.distance ?? ""} onCommit={(v) => updateResult(r.id, { distance: v })} />
                  </td>
                  <td className={cell}><TextCell label="IR image number" row={i} col="ir" numeric value={r.irImageNumber} onCommit={(v) => updateResult(r.id, { irImageNumber: v.trim(), visualFromSinglePhoto: false })} /></td>
                  <td className={cell}><TextCell label="Visual image number" row={i} col="vis" numeric value={r.visualImageNumber} onCommit={(v) => updateResult(r.id, { visualImageNumber: v.trim(), visualFromSinglePhoto: false })} className={r.visualFromSinglePhoto ? "text-amber-700" : ""} /></td>
                  <td className={cell}><TextCell label="Max temp" row={i} col="max" numeric value={r.maxTemp} placeholder={limited ? "n/a" : ""} onCommit={(v) => updateResult(r.id, { maxTemp: v })} /></td>
                  <td className={cell}>
                    <select className={cn("grid-input", limited && "text-amber-800")} value={r.opened} aria-label="Opened" data-grid-row={i} data-grid-col="opened"
                      onChange={(e) => updateResult(r.id, { opened: e.target.value })} onKeyDown={(e) => gridKeyDown(e, i, "opened")}>
                      {!OPENED_VALUES.includes(r.opened as never) ? <option value={r.opened}>{r.opened || "Select…"}</option> : null}
                      {OPENED_VALUES.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <select className={cn("grid-input", problem && "font-medium text-thermal-800")} value={r.possibleCause || POSSIBLE_CAUSE_NONE} aria-label="Possible cause" data-grid-row={i} data-grid-col="cause"
                      onChange={(e) => { updateResult(r.id, { possibleCause: e.target.value }); if (e.target.value !== POSSIBLE_CAUSE_NONE) setExpanded(r.id); }}
                      onKeyDown={(e) => gridKeyDown(e, i, "cause")}>
                      {!causes.includes(r.possibleCause) && r.possibleCause ? <option>{r.possibleCause}</option> : null}
                      {causes.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className={cn(cell, "pr-2 text-right")}>
                    <div className="flex justify-end gap-0.5">
                      <Button size="icon" variant="ghost" title="Duplicate (next number)" aria-label="Duplicate row" onClick={() => { duplicateResult(r.id); toast("Row duplicated"); }}><Copy className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" title="Remove from this inspection" aria-label="Delete row" onClick={() => { if (confirm(`Remove ${eq?.name || "this row"} from this inspection?`)) { deleteResult(r.id); toast("Row removed"); } }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="bg-slate-50">
                    <td colSpan={10} className="border-b border-slate-200 px-4 py-4">
                      <RowDetails row={row} inspection={inspection} eff={eff} locations={locations} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OverrideField({ label, k, row, inherited, type = "text" }: { label: string; k: keyof ResultOverrides; row: GridRow; inherited: string; type?: string }) {
  const setOverride = useStore((s) => s.setOverride);
  const val = row.result.overrides[k];
  const [v, setV] = useDraft(val ?? "");
  const isOver = val !== null;
  return (
    <Field label={label} htmlFor={`ov-${k}-${row.result.id}`}
      hint={isOver ? <button type="button" className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline" onClick={() => setOverride(row.result.id, k, null)}><Undo2 className="h-3 w-3" />Reset to {inherited || "blank"}</button> : <span>Inherited{inherited ? `: ${inherited}` : " (blank)"}</span>}>
      <Input id={`ov-${k}-${row.result.id}`} type={type} inputMode={type === "date" ? undefined : "decimal"} value={v} placeholder={inherited}
        className={cn(isOver && "border-sky-300 bg-sky-50/50")}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== (val ?? "")) setOverride(row.result.id, k, v === "" ? null : v); }} />
    </Field>
  );
}

function RowDetails({ row, inspection, eff, locations }: { row: GridRow; inspection: Inspection; eff: ReturnType<typeof resolveEffective>; locations: Location[] }) {
  const { updateResult, updateEquipment } = useStore();
  const r = row.result;
  const room = row.room;
  const [notes, setNotes] = useDraft(r.problemNotes);
  const [review, setReview] = useDraft(r.reviewNotes);
  const [conf, setConf] = useDraft(r.confidence);
  const facilityLocations = locations.filter((l) => l.facilityId === inspection.facilityId);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Condition overrides for this item</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <OverrideField label="Humidity" k="humidity" row={row} inherited={room?.humidity ?? ""} />
          <OverrideField label="Ambient Temp" k="ambientTemp" row={row} inherited={room?.ambientTemp ?? ""} />
          <OverrideField label="Background Temp" k="backgroundTemp" row={row} inherited={room?.backgroundTemp ?? ""} />
          <OverrideField label="Emissivity" k="emissivity" row={row} inherited={inspection.defaultEmissivity} />
          <OverrideField label="Image Date" k="imageDate" row={row} type="date" inherited={room?.imageDate || inspection.date} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Equipment type" htmlFor={`t-${r.id}`}>
            <Select id={`t-${r.id}`} value={row.equipment?.equipmentType ?? OTHER_EQUIPMENT_TYPE}
              onChange={(e) => row.equipment && updateEquipment(row.equipment.id, { equipmentType: e.target.value })}>
              {EQUIPMENT_PRESETS.map((p) => <option key={p.type}>{p.type}</option>)}
              <option>{OTHER_EQUIPMENT_TYPE}</option>
            </Select>
          </Field>
          <Field label="Room" htmlFor={`rm-${r.id}`}>
            <Select id={`rm-${r.id}`} value={r.locationId} onChange={(e) => {
              const loc = e.target.value;
              useStore.getState().addRoomToInspection(inspection.id, loc);
              updateResult(r.id, { locationId: loc });
              if (row.equipment) updateEquipment(row.equipment.id, { locationId: loc });
            }}>
              {facilityLocations.map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Exports as: {eff.imageDate} · H {eff.humidity || "blank"} · Bg {eff.backgroundTemp || "blank"} · Amb {eff.ambientTemp || "blank"} · Dist {eff.distance || "blank"} · ε {eff.emissivity}
        </p>
      </div>
      <div className="space-y-3">
        {r.visualFromSinglePhoto ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Only one photo number was recorded, so it was copied to both IR and Visual. Confirm or correct it.</span>
            <Button size="sm" onClick={() => updateResult(r.id, { visualFromSinglePhoto: false })}>Mark verified</Button>
          </div>
        ) : null}
        <Field label="Problem description" htmlFor={`pn-${r.id}`} hint="Required when Possible Cause is not NONE.">
          <Textarea id={`pn-${r.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== r.problemNotes && updateResult(r.id, { problemNotes: notes })} placeholder="e.g. Circuit 11 lug 40°F above similar connections" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <Field label="Review Notes (exported)" htmlFor={`rn-${r.id}`}>
            <Input id={`rn-${r.id}`} value={review} onChange={(e) => setReview(e.target.value)} onBlur={() => review !== r.reviewNotes && updateResult(r.id, { reviewNotes: review })} />
          </Field>
          <Field label="Confidence" htmlFor={`cf-${r.id}`} hint="Extraction support field">
            <Input id={`cf-${r.id}`} value={conf} onChange={(e) => setConf(e.target.value)} onBlur={() => conf !== r.confidence && updateResult(r.id, { confidence: conf })} />
          </Field>
        </div>
        <p className="text-[11px] text-slate-400">Source: {r.source === "carried-forward" ? "carried forward from facility inventory" : r.source === "field-notes" ? "field notes extraction" : "manual entry"}</p>
      </div>
    </div>
  );
}
