"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, Copy, ImageOff, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { allowedCauses, useStore } from "@/lib/store/store";
import { useDraft, useOnOpen } from "@/lib/use-draft";
import {
  COMPONENT_SUGGESTIONS, DEFAULT_OPENED, EQUIPMENT_PRESETS, LIMITED_ACCESS_OPENED, OPENED_VALUES, OTHER_EQUIPMENT_TYPE, POSSIBLE_CAUSE_NONE,
} from "@/lib/domain/constants";
import { applySinglePhotoConvention, defaultComponentForType, inferTypeFromName, resolveEffective } from "@/lib/domain/rules";
import { persistPhoto } from "@/lib/photos/capture";
import { usePhotoUrl } from "@/lib/photos/use-photo-url";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Photo, ResultOverrides } from "@/lib/domain/types";

const big = "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-thermal-500 focus:outline-none focus:ring-2 focus:ring-thermal-500/20";
const label = "mb-1 block text-sm font-medium text-slate-700";
const TYPES = [...EQUIPMENT_PRESETS.map((p) => p.type), OTHER_EQUIPMENT_TYPE];

/** Next sequential names per prefix in the room, e.g. "Panel P4", "Transformer T2". */
export function nameSuggestions(names: string[], limit = 4): string[] {
  const best = new Map<string, { n: number; width: number; tail: string; last: number }>();
  names.forEach((name, idx) => {
    const m = name.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return;
    const [, head, digits, tail] = m;
    const cur = best.get(head + "\u0000" + tail);
    const n = Number(digits);
    if (!cur || n > cur.n) best.set(head + "\u0000" + tail, { n, width: digits.length, tail, last: idx });
    else cur.last = Math.max(cur.last, idx);
  });
  return [...best.entries()]
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, limit)
    .map(([k, v]) => `${k.split("\u0000")[0]}${String(v.n + 1).padStart(v.width, "0")}${v.tail}`);
}

function OpenedPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Opened" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {OPENED_VALUES.map((o) => {
        const on = value === o;
        const limited = LIMITED_ACCESS_OPENED.includes(o);
        return (
          <button key={o} type="button" role="radio" aria-checked={on} onClick={() => onChange(o)}
            className={cn("min-h-11 rounded-lg border px-3 py-2 text-left text-sm leading-snug transition-colors",
              on ? (limited ? "border-amber-500 bg-amber-50 font-semibold text-amber-900 ring-1 ring-amber-500" : "border-thermal-600 bg-thermal-50 font-semibold text-thermal-900 ring-1 ring-thermal-600")
                : "border-slate-200 bg-white text-slate-700 active:bg-slate-100")}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function PhotoThumb({ photo }: { photo: Photo }) {
  const { url, missing } = usePhotoUrl(photo.id);
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Equipment photo" className="h-full w-full object-cover" /> : missing ? <ImageOff className="h-4 w-4 text-slate-400" /> : null}
    </div>
  );
}

function CameraButton({ onFile, label: text = "Photo" }: { onFile: (f: File) => void; label?: string }) {
  return (
    <label className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm active:bg-slate-100">
      <Camera className="h-5 w-5" />{text}
      <input type="file" accept="image/*" capture="environment" className="hidden" data-testid="equipment-camera-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

interface CreateDefaults { name: string; type: string; component: string }

/**
 * Full-screen editor for one equipment record on phones and tablets.
 * Create mode: "Save & Add Next" keeps the sheet open with the next number.
 * Edit mode: every change saves immediately; Prev / Next walk the room.
 */
export function EquipmentSheet({ open, onClose, mode, inspection, locationId, room, rows, editId, onNavigate, defaults, suggestions }: {
  open: boolean; onClose: () => void; mode: "create" | "edit"; inspection: Inspection; locationId: string | null;
  room: InspectionRoomConditions | undefined; rows: { result: InspectionResult; equipment: Equipment | undefined }[]; editId: string | null;
  onNavigate: (id: string) => void; defaults: CreateDefaults; suggestions: string[];
}) {
  if (mode === "create") return <CreateSheet open={open} onClose={onClose} inspection={inspection} locationId={locationId} room={room} defaults={defaults} suggestions={suggestions} />;
  const idx = rows.findIndex((r) => r.result.id === editId);
  const row = idx >= 0 ? rows[idx] : null;
  if (!row) return null;
  return <EditSheet key={row.result.id} open={open} onClose={onClose} inspection={inspection} room={room} row={row}
    prev={idx > 0 ? rows[idx - 1].result.id : null} next={idx < rows.length - 1 ? rows[idx + 1].result.id : null} onNavigate={onNavigate} position={`${idx + 1} of ${rows.length}`} />;
}

function CreateSheet({ open, onClose, inspection, locationId, room, defaults, suggestions }: {
  open: boolean; onClose: () => void; inspection: Inspection; locationId: string | null; room: InspectionRoomConditions | undefined; defaults: CreateDefaults; suggestions: string[];
}) {
  const addResult = useStore((s) => s.addResult);
  const blank = { name: "", type: "Panel", component: "Full Panel", componentTouched: false, ir: "", vis: "", maxTemp: "", distance: "", opened: DEFAULT_OPENED as string, cause: POSSIBLE_CAUSE_NONE, notes: "" };
  const [v, setV] = useState(blank);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const causes = useCauses();
  useOnOpen(open, () => { setV({ ...blank, name: defaults.name, type: defaults.type, component: defaults.component }); setPhoto(null); });

  const setType = (t: string) => setV((c) => ({ ...c, type: t, component: c.componentTouched ? c.component : (defaultComponentForType(t) || c.component) }));
  const setName = (n: string) => setV((c) => {
    const t = inferTypeFromName(n);
    return t && t !== c.type ? { ...c, name: n, type: t, component: c.componentTouched ? c.component : defaultComponentForType(t) } : { ...c, name: n };
  });

  const save = async (andNext: boolean) => {
    if (!locationId) { toast("Select a room first", "error"); return; }
    if (!v.name.trim()) { document.getElementById("eq-name-input")?.focus(); return; }
    setSaving(true);
    const photos = applySinglePhotoConvention(v.ir, v.vis);
    const id = addResult(inspection.id, locationId, {
      name: v.name.trim(), equipmentType: v.type, component: v.component.trim(), ...photos, maxTemp: v.maxTemp,
      opened: v.opened, possibleCause: v.cause, problemNotes: v.notes, distance: v.distance || null,
    });
    if (photo) {
      try { await persistPhoto(photo, { inspectionId: inspection.id, facilityId: inspection.facilityId, kind: "equipment", building: "", resultId: id }); }
      catch (e) { toast(e instanceof Error ? e.message : "Photo not saved", "error"); }
    }
    setSaving(false);
    toast(`${v.name.trim()} saved`);
    if (andNext) {
      const nextName = nameSuggestions([v.name.trim()], 1)[0] ?? "";
      setV({ ...blank, name: nextName, type: v.type, component: v.componentTouched ? v.component : defaultComponentForType(v.type) || v.component, componentTouched: v.componentTouched });
      setPhoto(null);
      setTimeout(() => { const el = document.getElementById("eq-name-input") as HTMLInputElement | null; el?.focus(); el?.select(); }, 30);
    } else onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add Equipment" size="lg"
      subtitle={room ? `Inherits ${[room.humidity && `${room.humidity}% RH`, room.ambientTemp && `${room.ambientTemp}° amb`, room.backgroundTemp && `${room.backgroundTemp}° bg`, room.distance && `${room.distance} ft`].filter(Boolean).join(" · ") || "room conditions (not entered yet)"}` : undefined}
      footer={
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button variant="primary" size="lg" className="h-12 justify-center text-base" onClick={() => save(true)} disabled={saving || !v.name.trim()}><Plus className="h-5 w-5" />Save &amp; Add Next</Button>
          <Button size="lg" className="h-12 justify-center text-base" onClick={() => save(false)} disabled={saving || !v.name.trim()}>Save</Button>
        </div>
      }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(true); }}>
        <div>
          <label htmlFor="eq-name-input" className={label}>Equipment</label>
          <input id="eq-name-input" autoComplete="off" enterKeyHint="done" className={cn(big, "text-lg font-medium")} placeholder="Panel P1" value={v.name} onChange={(e) => setName(e.target.value)} />
          {suggestions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => <button type="button" key={s} onClick={() => setName(s)} className="h-9 rounded-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 active:bg-slate-200">{s}</button>)}
            </div>
          ) : null}
        </div>
        <TypeChips value={v.type} onChange={setType} />
        <div>
          <label htmlFor="eq-comp" className={label}>Component</label>
          <input id="eq-comp" list="eq-comp-list" autoComplete="off" className={big} value={v.component} onChange={(e) => setV({ ...v, component: e.target.value, componentTouched: true })} />
          <datalist id="eq-comp-list">{COMPONENT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="eq-ir" className={label}>IR Image #</label><input id="eq-ir" inputMode="numeric" autoComplete="off" className={cn(big, "tabular-nums")} value={v.ir} onChange={(e) => setV({ ...v, ir: e.target.value })} /></div>
          <div><label htmlFor="eq-vis" className={label}>Visual Image #</label><input id="eq-vis" inputMode="numeric" autoComplete="off" className={cn(big, "tabular-nums")} value={v.vis} onChange={(e) => setV({ ...v, vis: e.target.value })} /></div>
        </div>
        <p className="-mt-2 text-xs text-slate-500">Only one number? It fills both fields and is flagged for verification.</p>
        <div className="flex items-center gap-3">
          <CameraButton onFile={setPhoto} label={photo ? "Retake" : "Equipment photo"} />
          {photo ? <span className="text-xs text-emerald-700">Photo attached. Saves with this item.</span> : null}
        </div>
        <div><span className={label}>Opened</span><OpenedPicker value={v.opened} onChange={(o) => setV({ ...v, opened: o })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="eq-max" className={label}>Max Temp °F</label><input id="eq-max" inputMode="decimal" autoComplete="off" className={cn(big, "tabular-nums")} value={v.maxTemp} onChange={(e) => setV({ ...v, maxTemp: e.target.value })} /></div>
          <div><label htmlFor="eq-dist" className={label}>Distance ft</label><input id="eq-dist" inputMode="decimal" autoComplete="off" className={cn(big, "tabular-nums")} placeholder={room?.distance ? `${room.distance} (room)` : ""} value={v.distance} onChange={(e) => setV({ ...v, distance: e.target.value })} /></div>
        </div>
        <div>
          <label htmlFor="eq-cause" className={label}>Possible Cause</label>
          <select id="eq-cause" className={big} value={v.cause} onChange={(e) => setV({ ...v, cause: e.target.value })}>{causes.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        {v.cause !== POSSIBLE_CAUSE_NONE ? (
          <div><label htmlFor="eq-notes" className={label}>Problem description</label><textarea id="eq-notes" className={cn(big, "h-24 py-2")} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
        ) : null}
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  );
}

function useCauses() {
  const orgs = useStore((s) => s.organizations);
  const orgId = useStore((s) => s.currentOrgId);
  return useMemo(() => allowedCauses(orgs.find((o) => o.id === orgId)?.settings), [orgs, orgId]);
}

function TypeChips({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <div>
      <span className={label}>Type</span>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TYPES.map((t) => (
          <button type="button" key={t} onClick={() => onChange(t)} aria-pressed={value === t}
            className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium", value === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 active:bg-slate-100")}>{t}</button>
        ))}
      </div>
    </div>
  );
}

function EditText({ id, labelText, value, onCommit, numeric, placeholder, className }: { id: string; labelText: string; value: string; onCommit: (v: string) => void; numeric?: "numeric" | "decimal"; placeholder?: string; className?: string }) {
  const [v, setV] = useDraft(value);
  // Save shortly after typing stops, not only on blur, so a crash or a closed
  // browser loses at most the last half second of typing.
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onCommit(v), 500);
    return () => clearTimeout(t);
  }, [v, value, onCommit]);
  return (
    <div className={className}>
      <label htmlFor={id} className={label}>{labelText}</label>
      <input id={id} inputMode={numeric} autoComplete="off" placeholder={placeholder} className={cn(big, numeric && "tabular-nums")} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

function EditSheet({ open, onClose, inspection, room, row, prev, next, onNavigate, position }: {
  open: boolean; onClose: () => void; inspection: Inspection; room: InspectionRoomConditions | undefined;
  row: { result: InspectionResult; equipment: Equipment | undefined }; prev: string | null; next: string | null; onNavigate: (id: string) => void; position: string;
}) {
  const { updateResult, updateEquipment, setOverride, duplicateResult, deleteResult } = useStore();
  const photos = useStore((s) => s.photos);
  const causes = useCauses();
  const [more, setMore] = useState(false);
  const r = row.result;
  const eq = row.equipment;
  const eff = resolveEffective(r, room, inspection);
  const myPhotos = photos.filter((p) => p.resultId === r.id);
  const commit = (patch: Partial<InspectionResult>) => updateResult(r.id, patch);
  const addPhoto = async (f: File) => {
    try { await persistPhoto(f, { inspectionId: inspection.id, facilityId: inspection.facilityId, kind: "equipment", building: "", resultId: r.id }); toast("Photo saved"); }
    catch (e) { toast(e instanceof Error ? e.message : "Photo not saved", "error"); }
  };

  return (
    <Sheet open={open} onClose={onClose} size="lg" title={eq?.name || "Equipment"} subtitle={`${position} in this room · changes save automatically`}
      footer={
        <div className="grid grid-cols-[auto_1fr_auto] gap-2">
          <Button size="lg" className="h-12 w-14 justify-center" disabled={!prev} onClick={() => prev && onNavigate(prev)} aria-label="Previous equipment"><ChevronLeft className="h-6 w-6" /></Button>
          <Button variant="primary" size="lg" className="h-12 justify-center text-base" onClick={onClose}>Done</Button>
          <Button size="lg" className="h-12 w-14 justify-center" disabled={!next} onClick={() => next && onNavigate(next)} aria-label="Next equipment"><ChevronRight className="h-6 w-6" /></Button>
        </div>
      }>
      <div className="space-y-4">
        <EditText id="ed-name" labelText="Equipment" value={eq?.name ?? ""} onCommit={(x) => eq && x.trim() && updateEquipment(eq.id, { name: x.trim() })} />
        <TypeChips value={eq?.equipmentType ?? OTHER_EQUIPMENT_TYPE} onChange={(t) => eq && updateEquipment(eq.id, { equipmentType: t })} />
        <EditText id="ed-comp" labelText="Component" value={r.component} onCommit={(x) => commit({ component: x })} />
        <div className="grid grid-cols-2 gap-3">
          <EditText id="ed-ir" labelText="IR Image #" numeric="numeric" value={r.irImageNumber} onCommit={(x) => commit({ irImageNumber: x.trim(), visualFromSinglePhoto: false })} />
          <EditText id="ed-vis" labelText="Visual Image #" numeric="numeric" value={r.visualImageNumber} onCommit={(x) => commit({ visualImageNumber: x.trim(), visualFromSinglePhoto: false })} />
        </div>
        {r.visualFromSinglePhoto ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Visual # was copied from the single photo number.
            <Button size="sm" onClick={() => commit({ visualFromSinglePhoto: false })}>Verified</Button>
          </div>
        ) : null}
        <div className="flex items-center gap-2 overflow-x-auto">
          <CameraButton onFile={addPhoto} label={myPhotos.length ? "Add photo" : "Take equipment photo"} />
          {myPhotos.map((p) => <PhotoThumb key={p.id} photo={p} />)}
        </div>
        <div><span className={label}>Opened</span><OpenedPicker value={r.opened} onChange={(o) => commit({ opened: o })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <EditText id="ed-max" labelText="Max Temp °F" numeric="decimal" value={r.maxTemp} onCommit={(x) => commit({ maxTemp: x })} />
          <EditText id="ed-dist" labelText="Distance ft" numeric="decimal" value={r.overrides.distance ?? ""} placeholder={room?.distance ? `${room.distance} (room)` : ""} onCommit={(x) => setOverride(r.id, "distance", x.trim() === "" ? null : x)} />
        </div>
        <div>
          <label htmlFor="ed-cause" className={label}>Possible Cause</label>
          <select id="ed-cause" className={big} value={r.possibleCause || POSSIBLE_CAUSE_NONE} onChange={(e) => commit({ possibleCause: e.target.value })}>
            {!causes.includes(r.possibleCause) && r.possibleCause ? <option>{r.possibleCause}</option> : null}
            {causes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {r.possibleCause && r.possibleCause !== POSSIBLE_CAUSE_NONE ? <ProblemNotes value={r.problemNotes} onCommit={(x) => commit({ problemNotes: x })} /> : null}

        <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
          Room overrides, review notes
          <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} />
        </button>
        {more ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {([["humidity", "Humidity", room?.humidity], ["ambientTemp", "Ambient Temp", room?.ambientTemp], ["backgroundTemp", "Background Temp", room?.backgroundTemp], ["emissivity", "Emissivity", inspection.defaultEmissivity]] as [keyof ResultOverrides, string, string | undefined][]).map(([k, l, inh]) => (
                <div key={k}>
                  <EditText id={`ed-${k}`} labelText={l} numeric="decimal" value={r.overrides[k] ?? ""} placeholder={inh ? `${inh} (inherited)` : "inherited"} onCommit={(x) => setOverride(r.id, k, x.trim() === "" ? null : x)} />
                  {r.overrides[k] !== null ? <button className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-sky-700" onClick={() => setOverride(r.id, k, null)}><Undo2 className="h-3 w-3" />Use room value</button> : null}
                </div>
              ))}
            </div>
            <EditText id="ed-review" labelText="Review Notes (exported)" value={r.reviewNotes} onCommit={(x) => commit({ reviewNotes: x })} />
            <p className="text-xs text-slate-500">Exports as H {eff.humidity || "blank"} · Bg {eff.backgroundTemp || "blank"} · Amb {eff.ambientTemp || "blank"} · Dist {eff.distance || "blank"} · ε {eff.emissivity}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
          <Button size="lg" className="h-12 justify-center" onClick={() => { const id = duplicateResult(r.id); if (id) { toast("Duplicated with next number"); onNavigate(id); } }}><Copy className="h-4 w-4" />Duplicate</Button>
          <Button size="lg" variant="danger" className="h-12 justify-center" onClick={() => { if (confirm(`Remove ${eq?.name || "this item"} from this inspection?`)) { const target = next ?? prev; deleteResult(r.id); toast("Removed"); if (target) onNavigate(target); else onClose(); } }}><Trash2 className="h-4 w-4" />Remove</Button>
        </div>
      </div>
    </Sheet>
  );
}

function ProblemNotes({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useDraft(value);
  return (
    <div>
      <label htmlFor="ed-notes" className={label}>Problem description</label>
      <textarea id="ed-notes" className={cn(big, "h-24 py-2")} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} />
    </div>
  );
}
