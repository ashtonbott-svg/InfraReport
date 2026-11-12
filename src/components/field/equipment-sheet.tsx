"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ImageOff, Loader2, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { allowedCauses, useStore } from "@/lib/store/store";
import { useDraft, useOnOpen } from "@/lib/use-draft";
import { COMPONENT_SUGGESTIONS, DEFAULT_OPENED, EQUIPMENT_PRESETS, LIMITED_ACCESS_OPENED, OPENED_VALUES, OTHER_EQUIPMENT_TYPE, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import { applySinglePhotoConvention, defaultComponentForType, inferTypeFromName, resolveEffective } from "@/lib/domain/rules";
import { applyTypeSuggestion, filterOpened, nameMatches, nextSequentialNames, splitLastToken, typeSuggestions } from "@/lib/domain/suggest";
import { persistPhoto } from "@/lib/photos/capture";
import { deletePhotoBlob } from "@/lib/photos/photo-db";
import { usePhotoUrl } from "@/lib/photos/use-photo-url";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Photo, ResultOverrides } from "@/lib/domain/types";

/** Kept for existing imports: next sequential names in a room. */
export const nameSuggestions = nextSequentialNames;

const big = "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-thermal-500 focus:outline-none focus:ring-2 focus:ring-thermal-500/20";
const lbl = "mb-1 block text-sm font-medium text-slate-700";
const TYPES = [...EQUIPMENT_PRESETS.map((p) => p.type), OTHER_EQUIPMENT_TYPE];
/** Keeps the keyboard open when a suggestion chip is tapped. */
const keepFocus = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

function useCauses() {
  const orgs = useStore((s) => s.organizations);
  const orgId = useStore((s) => s.currentOrgId);
  return useMemo(() => allowedCauses(orgs.find((o) => o.id === orgId)?.settings), [orgs, orgId]);
}

/* -------------------------------------------------------------------------- */
/* Equipment name with type + facility-name + sequence suggestions             */
/* -------------------------------------------------------------------------- */
export function NameField({ id, value, onChange, onPickType, facilityNames, sequence, onCommit, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; onPickType?: (t: string) => void; facilityNames: string[]; sequence: string[];
  onCommit?: () => void; autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const { token } = splitLastToken(value);
  const types = token && !/\d/.test(token) ? typeSuggestions(token).filter((t) => t.toLowerCase() !== token.toLowerCase()) : [];
  const names = nameMatches(value, facilityNames, 4);
  const seq = value.trim() ? sequence.filter((s) => s.toLowerCase().startsWith(value.trim().toLowerCase()) && s.toLowerCase() !== value.trim().toLowerCase()) : sequence;
  const chips: { label: string; kind: "type" | "name" | "seq" }[] = [
    ...types.map((t) => ({ label: t, kind: "type" as const })),
    ...seq.slice(0, 3).map((s) => ({ label: s, kind: "seq" as const })),
    ...names.filter((n) => !seq.includes(n)).map((n) => ({ label: n, kind: "name" as const })),
  ].slice(0, 6);
  return (
    <div>
      <label htmlFor={id} className={lbl}>Equipment</label>
      <input id={id} autoFocus={autoFocus} autoComplete="off" autoCapitalize="words" spellCheck={false} enterKeyHint="next"
        className={cn(big, "text-lg font-medium")} placeholder="Type pa, xfmr, disc…" value={value}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); onCommit?.(); }}
        onChange={(e) => onChange(e.target.value)} />
      {chips.length && (focused || !value) ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="Name suggestions">
          {chips.map((c) => (
            <button key={c.kind + c.label} type="button" role="option" aria-selected="false" onPointerDown={keepFocus} onMouseDown={keepFocus}
              onClick={() => {
                if (c.kind === "type") { onChange(applyTypeSuggestion(value, c.label)); onPickType?.(c.label); }
                else onChange(c.label);
              }}
              className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium active:scale-95",
                c.kind === "type" ? "border-thermal-300 bg-thermal-50 text-thermal-900" : "border-slate-200 bg-slate-50 text-slate-700")}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Opened: searchable list restricted to the 8 approved values                 */
/* -------------------------------------------------------------------------- */
export function OpenedCombobox({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const options = filterOpened(q);
  const limited = LIMITED_ACCESS_OPENED.includes(value);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(""); inputRef.current?.blur(); };
  return (
    <div className="relative">
      <label htmlFor={id} className={lbl}>Opened</label>
      <div className="relative">
        <input id={id} ref={inputRef} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} autoComplete="off" spellCheck={false}
          className={cn(big, "pr-10", !open && (limited ? "border-amber-400 bg-amber-50 font-medium text-amber-900" : "font-medium"))}
          value={open ? q : value} placeholder={open ? `Search: ${value}` : "Select…"}
          onFocus={() => { setOpen(true); setQ(""); }}
          onBlur={() => setTimeout(() => { setOpen(false); setQ(""); }, 120)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (options[0]) pick(options[0]); } if (e.key === "Escape") inputRef.current?.blur(); }} />
        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" />
      </div>
      {open ? (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {options.length ? options.map((o) => (
            <li key={o}>
              <button type="button" role="option" aria-selected={o === value} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => pick(o)}
                className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm", o === value ? "bg-thermal-50 font-semibold text-thermal-900" : "active:bg-slate-100")}>
                <span className="flex-1">{o}</span>{o === value ? <Check className="h-4 w-4" /> : null}
              </button>
            </li>
          )) : <li className="px-3 py-2 text-sm text-slate-500">No approved value matches. Only the 8 approved values can be used.</li>}
        </ul>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Equipment photo: camera first, preview, retake, multiple, delete            */
/* -------------------------------------------------------------------------- */
function Thumb({ photo, onDelete }: { photo: Photo; onDelete?: () => void }) {
  const { url, missing } = usePhotoUrl(photo.id);
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="Equipment photo" className="h-full w-full object-cover" /> : missing ? <ImageOff className="m-auto mt-7 h-5 w-5 text-slate-400" /> : null}
      {onDelete ? <button type="button" onClick={onDelete} aria-label="Delete photo" className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white"><X className="h-3.5 w-3.5" /></button> : null}
    </div>
  );
}

export function EquipmentPhotoPanel({ photos, pending, onPick, onSavePending, onDiscardPending, onDelete, saving }: {
  photos: Photo[]; pending: File | null; onPick: (f: File) => void; onSavePending?: () => void; onDiscardPending: () => void; onDelete: (p: Photo) => void; saving?: boolean;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (pending ? URL.createObjectURL(pending) : null), [pending]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="equipment-camera-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      {pending && preview ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Equipment photo preview" className="max-h-56 w-full rounded-lg bg-slate-900 object-contain" />
          <div className={cn("grid gap-2", onSavePending ? "grid-cols-3" : "grid-cols-2")}>
            <Button className="h-11 justify-center" onClick={() => camRef.current?.click()} disabled={saving}><RotateCcw className="h-4 w-4" />Retake</Button>
            <Button className="h-11 justify-center" onClick={onDiscardPending} disabled={saving}><X className="h-4 w-4" />Discard</Button>
            {onSavePending ? <Button variant="primary" className="h-11 justify-center" onClick={onSavePending} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save</Button> : null}
          </div>
          {!onSavePending ? <p className="text-xs text-emerald-700">Saves with this equipment item.</p> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto">
          <Button variant={photos.length ? "secondary" : "dark"} className="h-20 shrink-0 flex-col justify-center gap-1 px-4 text-sm" onClick={() => camRef.current?.click()}>
            <Camera className="h-6 w-6" />{photos.length ? "Add Photo" : "Take Equipment Photo"}
          </Button>
          {photos.map((p) => <Thumb key={p.id} photo={p} onDelete={() => onDelete(p)} />)}
          {!photos.length ? <span className="text-xs text-slate-500">Optional. A visual photo of the equipment front, separate from the IR / Visual image numbers.</span> : null}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                 */
/* -------------------------------------------------------------------------- */
function TypeSelect({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <select aria-label="Equipment type" className="h-12 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-700" value={TYPES.includes(value) ? value : OTHER_EQUIPMENT_TYPE} onChange={(e) => onChange(e.target.value)}>
      {TYPES.map((t) => <option key={t}>{t}</option>)}
    </select>
  );
}

/** Text input that saves while typing (debounced), on blur, and when the form closes. */
function EditText({ id, labelText, value, onCommit, numeric, placeholder, className, list }: {
  id: string; labelText: string; value: string; onCommit: (v: string) => void; numeric?: "numeric" | "decimal"; placeholder?: string; className?: string; list?: string;
}) {
  const [v, setV] = useDraft(value);
  const latest = useRef({ v, value, onCommit });
  useEffect(() => { latest.current = { v, value, onCommit }; });
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => latest.current.onCommit(latest.current.v), 500);
    return () => clearTimeout(t);
  }, [v, value]);
  // Flush on unmount (Next / Done / close) so the last keystrokes are never lost.
  useEffect(() => () => { const l = latest.current; if (l.v !== l.value) l.onCommit(l.v); }, []);
  return (
    <div className={className}>
      <label htmlFor={id} className={lbl}>{labelText}</label>
      <input id={id} inputMode={numeric} autoComplete="off" placeholder={placeholder} list={list} className={cn(big, numeric && "tabular-nums")} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

function causeChange(current: { cause: string; maxTemp: string }, next: string): { ok: boolean; clearMax: boolean } {
  if (next === POSSIBLE_CAUSE_NONE && current.maxTemp.trim()) {
    const ok = confirm(`Change to NONE and clear the recorded Max Temp (${current.maxTemp}°F)?\n\nCancel keeps the finding and its temperature.`);
    return { ok, clearMax: ok };
  }
  return { ok: true, clearMax: false };
}

interface CreateDefaults { name: string; type: string; component: string }

export interface EquipmentSheetProps {
  open: boolean; onClose: () => void; mode: "create" | "edit"; inspection: Inspection; locationId: string | null;
  room: InspectionRoomConditions | undefined; rows: { result: InspectionResult; equipment: Equipment | undefined }[]; editId: string | null;
  onNavigate: (id: string) => void; defaults: CreateDefaults; suggestions: string[]; facilityNames: string[];
  onEndOfList?: { label: string; go: () => void } | null;
}

/**
 * Full-screen editor for one equipment record on phones and tablets.
 * Field order follows a walk-through: name, component, distance, opened,
 * photo, image numbers, cause, then max temp only when there is a finding.
 */
export function EquipmentSheet(props: EquipmentSheetProps) {
  const { mode, rows, editId } = props;
  if (mode === "create") return <CreateSheet {...props} />;
  const idx = rows.findIndex((r) => r.result.id === editId);
  const row = idx >= 0 ? rows[idx] : null;
  if (!row) return null;
  return <EditSheet key={row.result.id} {...props} row={row} prev={idx > 0 ? rows[idx - 1].result.id : null} next={idx < rows.length - 1 ? rows[idx + 1].result.id : null} position={`${idx + 1} of ${rows.length}`} />;
}

function inheritsLine(room: InspectionRoomConditions | undefined) {
  if (!room) return undefined;
  const parts = [room.humidity && `${room.humidity}% RH`, room.ambientTemp && `${room.ambientTemp}° amb`, room.backgroundTemp && `${room.backgroundTemp}° bg`].filter(Boolean);
  return parts.length ? `Room conditions: ${parts.join(" · ")}` : "Room conditions not entered yet";
}

function CreateSheet({ open, onClose, inspection, locationId, room, defaults, suggestions, facilityNames }: EquipmentSheetProps) {
  const addResult = useStore((s) => s.addResult);
  const causes = useCauses();
  const blank = { name: "", type: "Panel", component: "Full Panel", componentTouched: false, distance: "", ir: "", vis: "", maxTemp: "", opened: DEFAULT_OPENED as string, cause: POSSIBLE_CAUSE_NONE, notes: "" };
  const [v, setV] = useState(blank);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [seq, setSeq] = useState<string[]>(suggestions);
  useOnOpen(open, () => { setV({ ...blank, name: defaults.name, type: defaults.type, component: defaults.component }); setPhoto(null); setSeq(suggestions); });

  const setType = (t: string) => setV((c) => ({ ...c, type: t, component: c.componentTouched ? c.component : (defaultComponentForType(t) || "") }));
  const setName = (n: string) => setV((c) => {
    const t = inferTypeFromName(n);
    return t && t !== c.type ? { ...c, name: n, type: t, component: c.componentTouched ? c.component : defaultComponentForType(t) } : { ...c, name: n };
  });
  const finding = v.cause !== POSSIBLE_CAUSE_NONE;

  const save = async (andNext: boolean) => {
    if (!locationId) { toast("Select a room first", "error"); return; }
    if (!v.name.trim()) { document.getElementById("eq-name-input")?.focus(); return; }
    setSaving(true);
    const photos = applySinglePhotoConvention(v.ir, v.vis);
    const id = addResult(inspection.id, locationId, {
      name: v.name.trim(), equipmentType: v.type, component: v.component.trim(), ...photos, maxTemp: finding ? v.maxTemp : "",
      opened: v.opened, possibleCause: v.cause, problemNotes: finding ? v.notes : "", distance: v.distance,
    });
    if (photo) {
      try { await persistPhoto(photo, { inspectionId: inspection.id, facilityId: inspection.facilityId, kind: "equipment", building: "", resultId: id }); }
      catch (e) { toast(e instanceof Error ? `Item saved, photo not saved: ${e.message}` : "Photo not saved", "error"); }
    }
    setSaving(false);
    toast(`${v.name.trim()} saved`);
    if (andNext) {
      const nextName = nextSequentialNames([v.name.trim()], 1)[0] ?? "";
      setSeq((cur) => [...new Set([nextName, ...cur])].filter(Boolean));
      // Keep type, component and distance pattern; clear everything observed on the last item.
      setV({ ...blank, name: nextName, type: v.type, component: v.componentTouched ? v.component : defaultComponentForType(v.type) || v.component, componentTouched: v.componentTouched });
      setPhoto(null);
      setTimeout(() => { const el = document.getElementById("eq-name-input") as HTMLInputElement | null; el?.focus(); el?.select(); }, 30);
    } else onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add Equipment" size="lg" subtitle={inheritsLine(room)}
      footer={
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button variant="primary" size="lg" className="h-14 justify-center text-base" onClick={() => save(true)} disabled={saving || !v.name.trim()}><Plus className="h-5 w-5" />Save &amp; Add Next</Button>
          <Button size="lg" className="h-14 justify-center text-base" onClick={() => save(false)} disabled={saving || !v.name.trim()}>Save</Button>
        </div>
      }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(true); }}>
        <NameField id="eq-name-input" value={v.name} onChange={setName} onPickType={setType} facilityNames={facilityNames} sequence={seq} />
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <div>
            <label htmlFor="eq-comp" className={lbl}>Component</label>
            <input id="eq-comp" list="eq-comp-list" autoComplete="off" className={big} value={v.component} onChange={(e) => setV({ ...v, component: e.target.value, componentTouched: true })} />
            <datalist id="eq-comp-list">{COMPONENT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <TypeSelect value={v.type} onChange={setType} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="eq-dist" className={lbl}>Distance (ft)</label><input id="eq-dist" inputMode="decimal" autoComplete="off" className={cn(big, "tabular-nums")} value={v.distance} onChange={(e) => setV({ ...v, distance: e.target.value })} /></div>
          <div className="self-end text-xs text-slate-500">Distance is recorded for each item.</div>
        </div>
        <OpenedCombobox id="eq-opened" value={v.opened} onChange={(o) => setV({ ...v, opened: o })} />
        <EquipmentPhotoPanel photos={[]} pending={photo} onPick={setPhoto} onDiscardPending={() => setPhoto(null)} onDelete={() => undefined} />
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="eq-ir" className={lbl}>IR Image #</label><input id="eq-ir" inputMode="numeric" autoComplete="off" className={cn(big, "tabular-nums")} value={v.ir} onChange={(e) => setV({ ...v, ir: e.target.value })} /></div>
          <div><label htmlFor="eq-vis" className={lbl}>Visual Image #</label><input id="eq-vis" inputMode="numeric" autoComplete="off" className={cn(big, "tabular-nums")} value={v.vis} onChange={(e) => setV({ ...v, vis: e.target.value })} /></div>
        </div>
        <p className="-mt-2 text-xs text-slate-500">Only one number? It fills both fields and is flagged for verification.</p>
        <div>
          <label htmlFor="eq-cause" className={lbl}>Possible Cause</label>
          <select id="eq-cause" className={big} value={v.cause} onChange={(e) => { const r = causeChange({ cause: v.cause, maxTemp: v.maxTemp }, e.target.value); if (r.ok) setV({ ...v, cause: e.target.value, maxTemp: r.clearMax ? "" : v.maxTemp }); }}>
            {causes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {finding ? (
          <div className="space-y-3 rounded-xl border border-thermal-200 bg-thermal-50/50 p-3">
            <div><label htmlFor="eq-max" className={lbl}>Max Temp °F (measured)</label><input id="eq-max" inputMode="decimal" autoComplete="off" className={cn(big, "tabular-nums")} value={v.maxTemp} onChange={(e) => setV({ ...v, maxTemp: e.target.value })} /></div>
            <div><label htmlFor="eq-notes" className={lbl}>Problem description</label><textarea id="eq-notes" className={cn(big, "h-20 py-2")} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          </div>
        ) : null}
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  );
}

function EditSheet({ open, onClose, inspection, room, row, prev, next, onNavigate, position, facilityNames, onEndOfList }: EquipmentSheetProps & {
  row: { result: InspectionResult; equipment: Equipment | undefined }; prev: string | null; next: string | null; position: string;
}) {
  const { updateResult, updateEquipment, setOverride, duplicateResult, deleteResult, removePhotoRecord } = useStore();
  const photos = useStore((s) => s.photos);
  const causes = useCauses();
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [nameDraft, setNameDraft] = useDraft(row.equipment?.name ?? "");
  const r = row.result;
  const eq = row.equipment;
  const eff = resolveEffective(r, room, inspection);
  const myPhotos = photos.filter((p) => p.resultId === r.id);
  const commit = (patch: Partial<InspectionResult>) => updateResult(r.id, patch);
  const finding = !!r.possibleCause && r.possibleCause !== POSSIBLE_CAUSE_NONE;
  const commitName = () => { if (eq && nameDraft.trim() && nameDraft.trim() !== eq.name) updateEquipment(eq.id, { name: nameDraft.trim() }); };

  const savePending = async () => {
    if (!pending) return;
    const saved = pending;
    setSavingPhoto(true);
    try {
      await persistPhoto(saved, { inspectionId: inspection.id, facilityId: inspection.facilityId, kind: "equipment", building: "", resultId: r.id });
      setPending((cur) => (cur === saved ? null : cur));
      toast("Equipment photo saved");
    } catch (e) { toast(e instanceof Error ? e.message : "Photo not saved", "error"); }
    setSavingPhoto(false);
  };
  const delPhoto = async (p: Photo) => {
    if (!confirm("Delete this equipment photo?")) return;
    removePhotoRecord(p.id);
    await deletePhotoBlob(p.id).catch(() => undefined);
  };
  const goNext = () => {
    commitName();
    if (pending && !confirm("A photo was taken but not saved. Leave without saving it?")) return;
    if (next) onNavigate(next);
    else if (onEndOfList) onEndOfList.go();
    else onClose();
  };

  return (
    <Sheet open={open} onClose={() => { commitName(); onClose(); }} size="lg" title={eq?.name || "Equipment"} subtitle={`${position} in this room · saves automatically`}
      footer={
        <div className="grid grid-cols-[auto_1fr_auto] gap-2">
          <Button size="lg" className="h-14 w-14 justify-center" disabled={!prev} onClick={() => { commitName(); if (prev) onNavigate(prev); }} aria-label="Previous equipment"><ChevronLeft className="h-6 w-6" /></Button>
          <Button variant="primary" size="lg" className="h-14 justify-center text-base" onClick={goNext}>
            {next ? <>Save &amp; Next<ChevronRight className="h-5 w-5" /></> : onEndOfList ? <>{onEndOfList.label}<ChevronRight className="h-5 w-5" /></> : <>Save &amp; Close</>}
          </Button>
          <Button size="lg" className="h-14 justify-center px-4" onClick={() => { commitName(); onClose(); }}>Done</Button>
        </div>
      }>
      <div className="space-y-4">
        <NameField id="ed-name" value={nameDraft} onChange={setNameDraft} onCommit={commitName} onPickType={(t) => eq && updateEquipment(eq.id, { equipmentType: t })} facilityNames={facilityNames} sequence={[]} />
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <EditText id="ed-comp" labelText="Component" list="eq-comp-list" value={r.component} onCommit={(x) => commit({ component: x })} />
          <TypeSelect value={eq?.equipmentType ?? OTHER_EQUIPMENT_TYPE} onChange={(t) => eq && updateEquipment(eq.id, { equipmentType: t })} />
          <datalist id="eq-comp-list">{COMPONENT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <EditText id="ed-dist" labelText="Distance (ft)" numeric="decimal" value={r.distance ?? ""} onCommit={(x) => commit({ distance: x })} />
          <div className="self-end pb-1 text-xs text-slate-500">{inheritsLine(room)}</div>
        </div>
        <OpenedCombobox id="ed-opened" value={OPENED_VALUES.includes(r.opened as never) ? r.opened : DEFAULT_OPENED} onChange={(o) => commit({ opened: o })} />
        <EquipmentPhotoPanel photos={myPhotos} pending={pending} onPick={setPending} onSavePending={savePending} onDiscardPending={() => setPending(null)} onDelete={delPhoto} saving={savingPhoto} />
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
        <div>
          <label htmlFor="ed-cause" className={lbl}>Possible Cause</label>
          <select id="ed-cause" className={big} value={r.possibleCause || POSSIBLE_CAUSE_NONE}
            onChange={(e) => { const res = causeChange({ cause: r.possibleCause, maxTemp: r.maxTemp }, e.target.value); if (res.ok) commit({ possibleCause: e.target.value, ...(res.clearMax ? { maxTemp: "" } : {}) }); else e.target.value = r.possibleCause || POSSIBLE_CAUSE_NONE; }}>
            {!causes.includes(r.possibleCause) && r.possibleCause ? <option>{r.possibleCause}</option> : null}
            {causes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {finding || r.maxTemp ? (
          <div className="space-y-3 rounded-xl border border-thermal-200 bg-thermal-50/50 p-3">
            <EditText id="ed-max" labelText="Max Temp °F (measured)" numeric="decimal" value={r.maxTemp} onCommit={(x) => commit({ maxTemp: x })} />
            {finding ? <EditText id="ed-notes" labelText="Problem description" value={r.problemNotes} onCommit={(x) => commit({ problemNotes: x })} /> : <p className="text-xs text-slate-500">Max Temp is shown because a value is recorded on this item.</p>}
          </div>
        ) : null}

        <button type="button" onClick={() => setMore(!more)} className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
          Condition overrides, review notes
          <ChevronDown className={cn("h-4 w-4 transition-transform", more && "rotate-180")} />
        </button>
        {more ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {([["humidity", "Humidity", room?.humidity], ["ambientTemp", "Ambient Temp", room?.ambientTemp], ["backgroundTemp", "Background Temp", room?.backgroundTemp], ["emissivity", "Emissivity", inspection.defaultEmissivity]] as [keyof ResultOverrides, string, string | undefined][]).map(([k, l, inh]) => (
                <div key={k}>
                  <EditText id={`ed-${k}`} labelText={l} numeric="decimal" value={r.overrides[k] ?? ""} placeholder={inh ? `${inh} (room)` : "room value"} onCommit={(x) => setOverride(r.id, k, x.trim() === "" ? null : x)} />
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
