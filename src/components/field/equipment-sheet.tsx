"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ImageOff, Loader2, Plus, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { allowedCauses, useStore } from "@/lib/store/store";
import { useDraft, useOnOpen } from "@/lib/use-draft";
import { DEFAULT_OPENED, EQUIPMENT_PRESETS, LIMITED_ACCESS_OPENED, OPENED_VALUES, OTHER_EQUIPMENT_TYPE, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import { defaultComponentForType, inferTypeFromName, resolveEffective } from "@/lib/domain/rules";
import { IMAGE_COMPONENTS, imageHasFinding, newThermalImage, nextComponent, patchThermalImage, resultStatus, roomProgress } from "@/lib/domain/thermal";
import { applyTypeSuggestion, filterOpened, nameMatches, nextSequentialNames, splitLastToken, typeSuggestions } from "@/lib/domain/suggest";
import { persistPhoto } from "@/lib/photos/capture";
import { deletePhotoBlob } from "@/lib/photos/photo-db";
import { usePhotoUrl } from "@/lib/photos/use-photo-url";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Photo, ResultException, ResultExceptionKind, ResultOverrides, ThermalImage } from "@/lib/domain/types";

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

export function EquipmentPhotoPanel({ photos, pending, onPick, onSavePending, onDiscardPending, onDelete, saving, label = "Take Equipment Photo", hint, testId = "equipment-camera-input", note, onNote }: {
  photos: Photo[]; pending: File | null; onPick: (f: File) => void; onSavePending?: () => void; onDiscardPending: () => void; onDelete: (p: Photo) => void; saving?: boolean;
  label?: string; hint?: string; testId?: string; note?: string; onNote?: (v: string) => void;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (pending ? URL.createObjectURL(pending) : null), [pending]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid={testId}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
      {pending && preview ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Photo preview" className="max-h-56 w-full rounded-lg bg-slate-900 object-contain" />
          {onNote ? <input aria-label="Photo note" placeholder="Note (optional): breaker positions, damage, labels…" className={cn(big, "h-11 text-sm")} value={note ?? ""} onChange={(e) => onNote(e.target.value)} /> : null}
          <div className={cn("grid gap-2", onSavePending ? "grid-cols-3" : "grid-cols-2")}>
            <Button className="h-11 justify-center" onClick={() => camRef.current?.click()} disabled={saving}><RotateCcw className="h-4 w-4" />Retake</Button>
            <Button className="h-11 justify-center" onClick={onDiscardPending} disabled={saving}><X className="h-4 w-4" />Discard</Button>
            {onSavePending ? <Button variant="primary" className="h-11 justify-center" onClick={onSavePending} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save</Button> : null}
          </div>
          {!onSavePending ? <p className="text-xs text-emerald-700">Saves with this equipment item.</p> : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto">
          <Button variant={photos.length ? "secondary" : "dark"} className="h-16 shrink-0 flex-col justify-center gap-1 px-4 text-sm" onClick={() => camRef.current?.click()}>
            <Camera className="h-5 w-5" />{photos.length ? "Add Photo" : label}
          </Button>
          {photos.map((p) => <Thumb key={p.id} photo={p} onDelete={() => onDelete(p)} />)}
          {!photos.length && hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
        </div>
      )}
      {photos.some((p) => p.note) ? <ul className="mt-2 space-y-0.5 text-xs text-slate-600">{photos.filter((p) => p.note).map((p) => <li key={p.id}>{new Date(p.capturedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: {p.note}</li>)}</ul> : null}
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


/* -------------------------------------------------------------------------- */
/* Thermal image entry: Component, IR # | Distance, auto Visual #, finding     */
/* -------------------------------------------------------------------------- */
const numBig = "h-14 w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-2xl font-semibold tabular-nums text-slate-900 shadow-sm placeholder:text-base placeholder:font-normal placeholder:text-slate-400 focus:border-thermal-500 focus:outline-none focus:ring-2 focus:ring-thermal-500/20";

export function ImageEntryEditor({ idPrefix, image, onPatch, causes, autoFocusIr }: {
  idPrefix: string; image: ThermalImage; onPatch: (p: Partial<ThermalImage>) => void; causes: string[]; autoFocusIr?: boolean;
}) {
  const [compFocused, setCompFocused] = useState(false);
  const irId = `${idPrefix}-ir`;
  const distId = `${idPrefix}-dist`;
  const finding = imageHasFinding(image);
  const chips = IMAGE_COMPONENTS.filter((c) => !image.component || c.toLowerCase().startsWith(image.component.toLowerCase())).filter((c) => c.trim().toLowerCase() !== image.component.trim().toLowerCase());
  // Next / Done on the keyboard: IR -> Distance, Distance -> IR, whichever is still empty.
  const hop = (e: React.KeyboardEvent<HTMLInputElement>, other: string, otherEmpty: boolean) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (otherEmpty) document.getElementById(other)?.focus();
    else (e.target as HTMLInputElement).blur();
  };
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-comp`} className={lbl}>Component / view</label>
        <input id={`${idPrefix}-comp`} autoComplete="off" autoCapitalize="words" className={cn(big, "h-11")} value={image.component} placeholder="Full Panel, Top Half, Section 1…"
          onFocus={() => setCompFocused(true)} onBlur={() => setCompFocused(false)} onChange={(e) => onPatch({ component: e.target.value })} />
        {compFocused && chips.length ? (
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="Component suggestions">
            {chips.slice(0, 10).map((c) => (
              <button key={c} type="button" role="option" aria-selected="false" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onPatch({ component: c })}
                className="h-9 shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 active:bg-slate-200">{c.trim()}{c.endsWith(" ") ? "…" : ""}</button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={irId} className="mb-1 block text-sm font-semibold text-slate-800">IR Photo #</label>
          <input id={irId} autoFocus={autoFocusIr} inputMode="numeric" enterKeyHint={image.distance ? "done" : "next"} autoComplete="off" className={numBig}
            value={image.irImageNumber} onChange={(e) => onPatch({ irImageNumber: e.target.value })} onKeyDown={(e) => hop(e, distId, !image.distance)} />
        </div>
        <div>
          <label htmlFor={distId} className="mb-1 block text-sm font-semibold text-slate-800">Distance (ft)</label>
          <input id={distId} inputMode="decimal" enterKeyHint={image.irImageNumber ? "done" : "next"} autoComplete="off" className={numBig}
            value={image.distance} onChange={(e) => onPatch({ distance: e.target.value })} onKeyDown={(e) => hop(e, irId, !image.irImageNumber)} />
        </div>
      </div>
      {image.visualOverridden ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor={`${idPrefix}-vis`} className={lbl}>Visual Photo # (different)</label>
            <input id={`${idPrefix}-vis`} inputMode="numeric" autoComplete="off" className={cn(big, "tabular-nums")} value={image.visualImageNumber} onChange={(e) => onPatch({ visualImageNumber: e.target.value })} />
          </div>
          <Button className="h-12" onClick={() => onPatch({ visualOverridden: false })}>Same as IR</Button>
        </div>
      ) : (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Visual # <strong className="tabular-nums text-slate-800">{image.irImageNumber || "same as IR"}</strong>{image.irImageNumber ? " (same as IR)" : ""}</span>
          <button type="button" className="py-1 font-medium text-thermal-700" onClick={() => onPatch({ visualOverridden: true, visualImageNumber: image.irImageNumber })}>Use Different Visual Number</button>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div>
          <label htmlFor={`${idPrefix}-cause`} className={lbl}>Possible Cause</label>
          <select id={`${idPrefix}-cause`} className={cn(big, "h-11", finding && "border-thermal-400 font-semibold text-thermal-900")} value={image.possibleCause || POSSIBLE_CAUSE_NONE}
            onChange={(e) => { const r = causeChange({ cause: image.possibleCause, maxTemp: image.maxTemp }, e.target.value); if (r.ok) onPatch({ possibleCause: e.target.value, ...(r.clearMax ? { maxTemp: "" } : {}) }); else e.target.value = image.possibleCause || POSSIBLE_CAUSE_NONE; }}>
            {!causes.includes(image.possibleCause) && image.possibleCause ? <option>{image.possibleCause}</option> : null}
            {causes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {finding || image.maxTemp ? (
          <div className="w-28">
            <label htmlFor={`${idPrefix}-max`} className={lbl}>Max °F</label>
            <input id={`${idPrefix}-max`} inputMode="decimal" autoComplete="off" className={cn(big, "h-11 tabular-nums")} value={image.maxTemp} onChange={(e) => onPatch({ maxTemp: e.target.value })} />
          </div>
        ) : null}
      </div>
      {finding ? (
        <div>
          <label htmlFor={`${idPrefix}-notes`} className={lbl}>Finding notes</label>
          <input id={`${idPrefix}-notes`} autoComplete="off" className={cn(big, "h-11")} value={image.notes} onChange={(e) => onPatch({ notes: e.target.value })} placeholder="e.g. Circuit 11 lug 40°F above similar" />
        </div>
      ) : null}
    </div>
  );
}

function ImageSummaryRow({ index, image, onOpen, onRemove }: { index: number; image: ThermalImage; onOpen: () => void; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left" data-testid="image-summary">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">{image.component || "No component"}</span>
          <span className="block truncate text-xs tabular-nums text-slate-500">
            IR {image.irImageNumber || "?"}{image.visualOverridden ? ` · Vis ${image.visualImageNumber || "?"}` : ""} · {image.distance ? `${image.distance} ft` : "no distance"}{imageHasFinding(image) ? ` · ${image.possibleCause}${image.maxTemp ? ` ${image.maxTemp}°F` : ""}` : ""}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
      </button>
      {onRemove ? <button type="button" onClick={onRemove} className="rounded-lg p-2 text-slate-400 hover:text-red-600" aria-label={`Remove image ${index + 1}`}><Trash2 className="h-4 w-4" /></button> : null}
    </div>
  );
}

/** Multiple thermal images for one equipment item, one expanded at a time. */
function ImagesEditor({ images, activeId, setActiveId, onPatch, onAdd, onRemove, causes, idPrefix }: {
  images: ThermalImage[]; activeId: string; setActiveId: (id: string) => void; onPatch: (imageId: string, p: Partial<ThermalImage>) => void;
  onAdd: () => void; onRemove: (imageId: string) => void; causes: string[]; idPrefix: string;
}) {
  const active = images.find((i) => i.id === activeId) ?? images[0];
  const multi = images.length > 1;
  return (
    <div className="space-y-2">
      {images.map((img, idx) => img.id === active.id ? (
        <div key={img.id} className={cn(multi && "rounded-xl border-2 border-thermal-300 bg-thermal-50/30 p-3")} data-testid="active-image">
          {multi ? <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-thermal-800"><span>Image {idx + 1} of {images.length}</span>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-red-600" onClick={() => onRemove(img.id)} aria-label={`Remove image ${idx + 1}`}><Trash2 className="h-4 w-4" /></button></div> : null}
          <ImageEntryEditor idPrefix={`${idPrefix}-${idx}`} image={img} onPatch={(p) => onPatch(img.id, p)} causes={causes} />
        </div>
      ) : (
        <ImageSummaryRow key={img.id} index={idx} image={img} onOpen={() => setActiveId(img.id)} />
      ))}
      <Button className="h-12 w-full justify-center border-dashed text-base" onClick={onAdd}><Plus className="h-5 w-5" />Add Another Image</Button>
    </div>
  );
}

function ExceptionPanel({ opened, exception, onOpened, onException }: {
  opened: string; exception: ResultException | null; onOpened: (v: string) => void; onException: (e: { kind: ResultExceptionKind; note: string } | null) => void;
}) {
  const [open, setOpen] = useState(!!exception);
  const [note, setNote] = useDraft(exception?.note ?? "");
  if (!open && !exception) {
    return <button type="button" onClick={() => setOpen(true)} className="w-full rounded-lg py-2 text-left text-sm font-medium text-slate-600 underline-offset-2 hover:underline">Can&apos;t scan this item? Locked out, off, inaccessible…</button>;
  }
  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <div className="text-sm font-semibold text-amber-950">Not scanned / deferred</div>
      <OpenedCombobox id="exc-opened" value={OPENED_VALUES.includes(opened as never) ? opened : DEFAULT_OPENED} onChange={onOpened} />
      <input aria-label="Exception note" placeholder="Note (optional)" className={cn(big, "h-11")} value={note} onChange={(e) => setNote(e.target.value)}
        onBlur={() => exception && note !== exception.note && onException({ kind: exception.kind, note })} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant={exception?.kind === "not-scanned" ? "dark" : "secondary"} className="h-11 justify-center" onClick={() => onException({ kind: "not-scanned", note })}>Not Scanned</Button>
        <Button variant={exception?.kind === "deferred" ? "dark" : "secondary"} className="h-11 justify-center" onClick={() => onException({ kind: "deferred", note })}>Defer (Come Back)</Button>
      </div>
      {exception ? <Button variant="ghost" className="h-10 w-full justify-center" onClick={() => { onException(null); setOpen(false); }}>Clear: this item will be scanned</Button> : <p className="text-xs text-amber-900">No image numbers are needed. Not Scanned counts as done for the room; Deferred reminds you to come back.</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The sheet                                                                   */
/* -------------------------------------------------------------------------- */
interface CreateDefaults { name: string; type: string; component: string }

export interface EquipmentSheetProps {
  open: boolean; onClose: () => void; mode: "create" | "edit"; inspection: Inspection; locationId: string | null;
  room: InspectionRoomConditions | undefined; rows: { result: InspectionResult; equipment: Equipment | undefined }[]; editId: string | null;
  onNavigate: (id: string) => void; defaults: CreateDefaults; suggestions: string[]; facilityNames: string[];
  /** Save & Next on the last item of the room: open the room checkpoint. */
  onEndOfRoom?: () => void;
  roomName?: string;
}

export function EquipmentSheet(props: EquipmentSheetProps) {
  const { mode, rows, editId } = props;
  if (mode === "create") return <CreateSheet {...props} />;
  const idx = rows.findIndex((r) => r.result.id === editId);
  const row = idx >= 0 ? rows[idx] : null;
  if (!row) return null;
  return <EditSheet key={row.result.id} {...props} row={row} prev={idx > 0 ? rows[idx - 1].result.id : null} next={idx < rows.length - 1 ? rows[idx + 1].result.id : null} index={idx} />;
}

function inheritsLine(room: InspectionRoomConditions | undefined) {
  if (!room) return undefined;
  const parts = [room.humidity && `${room.humidity}% RH`, room.ambientTemp && `${room.ambientTemp}° amb`, room.backgroundTemp && `${room.backgroundTemp}° bg`].filter(Boolean);
  return parts.length ? `Room: ${parts.join(" · ")}` : "Room conditions not entered yet";
}

function progressLine(rows: { result: InspectionResult }[], roomName?: string) {
  const p = roomProgress(rows.map((r) => r.result));
  return `${roomName ? `${roomName} · ` : ""}${p.done} of ${p.total} done · ${p.remaining.length} to do`;
}

function CreateSheet({ open, onClose, inspection, locationId, room, defaults, suggestions, facilityNames, rows, roomName }: EquipmentSheetProps) {
  const addResult = useStore((s) => s.addResult);
  const causes = useCauses();
  const fresh = (component: string) => [newThermalImage({ component })];
  // Initialised from the defaults: the sheet is mounted already open.
  const [name, setName] = useState(defaults.name);
  const [type, setType] = useState(defaults.type);
  const [images, setImages] = useState<ThermalImage[]>(() => fresh(defaults.component));
  const [activeId, setActiveId] = useState("");
  const [componentTouched, setComponentTouched] = useState(false);
  const [seq, setSeq] = useState<string[]>(suggestions);
  const [saving, setSaving] = useState(false);
  useOnOpen(open, () => { setName(defaults.name); setType(defaults.type); const im = fresh(defaults.component); setImages(im); setActiveId(im[0].id); setComponentTouched(false); setSeq(suggestions); });

  const applyType = (t: string) => {
    setType(t);
    if (!componentTouched) setImages((cur) => cur.map((im, i) => (i === 0 ? { ...im, component: defaultComponentForType(t) || im.component } : im)));
  };
  const onName = (n: string) => { setName(n); const t = inferTypeFromName(n); if (t && t !== type) applyType(t); };
  const patch = (imageId: string, p: Partial<ThermalImage>) => {
    if (p.component !== undefined) setComponentTouched(true);
    setImages((cur) => cur.map((im) => (im.id === imageId ? patchThermalImage(im, p) : im)));
  };

  const save = async (andNext: boolean) => {
    if (!locationId) { toast("Select a room first", "error"); return; }
    if (!name.trim()) { document.getElementById("eq-name-input")?.focus(); return; }
    setSaving(true);
    const [first, ...more] = images;
    const id = addResult(inspection.id, locationId, {
      name: name.trim(), equipmentType: type, component: first.component.trim(), irImageNumber: first.irImageNumber,
      visualImageNumber: first.visualOverridden ? first.visualImageNumber : first.irImageNumber,
      distance: first.distance, possibleCause: first.possibleCause, maxTemp: first.maxTemp, problemNotes: first.notes,
    });
    if (first.visualOverridden) useStore.getState().updateThermalImage(id, useStore.getState().results.find((r) => r.id === id)!.images[0].id, { visualOverridden: true, visualImageNumber: first.visualImageNumber });
    for (const im of more) useStore.getState().addThermalImage(id, { ...im, id: undefined });
    setSaving(false);
    toast(`${name.trim()} saved${images.length > 1 ? ` with ${images.length} images` : ""}`);
    if (andNext) {
      const nextName = nextSequentialNames([name.trim()], 1)[0] ?? "";
      setSeq((cur) => [...new Set([nextName, ...cur])].filter(Boolean));
      setName(nextName);
      const im = fresh(componentTouched ? first.component : defaultComponentForType(type) || first.component);
      setImages(im); setActiveId(im[0].id);
      setTimeout(() => (document.getElementById("new-0-ir") as HTMLInputElement | null)?.focus(), 30);
    } else onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add Equipment" size="lg" subtitle={`${progressLine(rows, roomName)} · ${inheritsLine(room) ?? ""}`}
      footer={
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button variant="primary" size="lg" className="h-14 justify-center text-base" onClick={() => save(true)} disabled={saving || !name.trim()}><Plus className="h-5 w-5" />Save &amp; Add Next</Button>
          <Button size="lg" className="h-14 justify-center text-base" onClick={() => save(false)} disabled={saving || !name.trim()}>Save</Button>
        </div>
      }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(true); }}>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <NameField id="eq-name-input" value={name} onChange={onName} onPickType={applyType} facilityNames={facilityNames} sequence={seq} />
          <TypeSelect value={type} onChange={applyType} />
        </div>
        <ImagesEditor idPrefix="new" images={images} activeId={activeId || images[0].id} setActiveId={setActiveId} onPatch={patch} causes={causes}
          onAdd={() => { const im = newThermalImage({ component: nextComponent(images.map((x) => x.component)) }); setImages((cur) => [...cur, im]); setActiveId(im.id); }}
          onRemove={(iid) => setImages((cur) => (cur.length > 1 ? cur.filter((x) => x.id !== iid) : cur))} />
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  );
}

function EditSheet({ open, onClose, inspection, room, row, next, prev, onNavigate, index, rows, roomName, onEndOfRoom }: EquipmentSheetProps & {
  row: { result: InspectionResult; equipment: Equipment | undefined }; prev: string | null; next: string | null; index: number;
}) {
  const { updateResult, updateEquipment, updateThermalImage: updateImage, addThermalImage: addImage, removeThermalImage: removeImage, setException, setOverride, duplicateResult, deleteResult, removePhotoRecord } = useStore();
  const photos = useStore((s) => s.photos);
  const causes = useCauses();
  const r = row.result;
  const eq = row.equipment;
  const [activeId, setActiveId] = useState(r.images[0]?.id ?? "");
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState<{ kind: "equipment" | "before-opening"; file: File; note: string } | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const status = resultStatus(r);
  const eqPhotos = photos.filter((p) => p.resultId === r.id && p.kind === "equipment");
  const beforePhotos = photos.filter((p) => p.resultId === r.id && p.kind === "before-opening");
  const eff = resolveEffective(r, room, inspection);

  const savePending = async () => {
    if (!pending) return;
    const saved = pending;
    setSavingPhoto(true);
    try {
      await persistPhoto(saved.file, { inspectionId: inspection.id, facilityId: inspection.facilityId, kind: saved.kind, building: "", resultId: r.id, note: saved.note.trim() || undefined });
      setPending((cur) => (cur === saved ? null : cur));
      toast(saved.kind === "before-opening" ? "Before-opening photo saved" : "Equipment photo saved");
    } catch (e) { toast(e instanceof Error ? e.message : "Photo not saved", "error"); }
    setSavingPhoto(false);
  };
  const delPhoto = async (p: Photo) => {
    if (!confirm("Delete this photo?")) return;
    removePhotoRecord(p.id);
    await deletePhotoBlob(p.id).catch(() => undefined);
  };
  const goNext = () => {
    if (pending && !confirm("A photo was taken but not saved. Continue without saving it?")) return;
    if (next) onNavigate(next);
    else if (onEndOfRoom) onEndOfRoom();
    else onClose();
  };
  const statusChip = { todo: ["To do", "bg-slate-100 text-slate-600"], recorded: ["Done", "bg-emerald-100 text-emerald-800"], "not-scanned": ["Not scanned", "bg-amber-100 text-amber-900"], deferred: ["Deferred", "bg-amber-100 text-amber-900"] }[status];

  return (
    <Sheet open={open} onClose={onClose} size="lg"
      title={<span className="flex items-center gap-2"><span className="truncate">{eq?.name || "Equipment"}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", statusChip[1])} data-testid="item-status">{statusChip[0]}</span></span>}
      labelledBy={eq?.name}
      subtitle={`Item ${index + 1} · ${progressLine(rows, roomName)}`}
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Button size="lg" className="h-14 w-14 justify-center" disabled={!prev} onClick={() => prev && onNavigate(prev)} aria-label="Previous equipment"><ChevronLeft className="h-6 w-6" /></Button>
          <Button variant="primary" size="lg" className="h-14 justify-center text-lg" onClick={goNext} data-testid="save-next">
            {next ? <>Save &amp; Next<ChevronRight className="h-5 w-5" /></> : onEndOfRoom ? <>Save &amp; Finish Room<ChevronRight className="h-5 w-5" /></> : <>Save &amp; Close</>}
          </Button>
        </div>
      }>
      <div className="space-y-4">
        <ImagesEditor idPrefix="ed" images={r.images} activeId={activeId} setActiveId={setActiveId} causes={causes}
          onPatch={(iid, p) => updateImage(r.id, iid, p)}
          onAdd={() => { const id = addImage(r.id, { component: nextComponent(r.images.map((x) => x.component)) }); setActiveId(id); }}
          onRemove={(iid) => { const img = r.images.find((x) => x.id === iid); if (confirm(`Remove ${img?.component || "this image"}${img?.irImageNumber ? ` (IR ${img.irImageNumber})` : ""}?`)) { removeImage(r.id, iid); if (iid === activeId) setActiveId(r.images.find((x) => x.id !== iid)?.id ?? ""); } }} />

        <ExceptionPanel opened={r.opened} exception={r.exception} onOpened={(o) => updateResult(r.id, { opened: o })} onException={(e) => setException(r.id, e)} />

        <button type="button" onClick={() => setMore(!more)} className="flex min-h-12 w-full items-center justify-between rounded-xl bg-slate-100 px-3 text-sm font-medium text-slate-700" aria-expanded={more}>
          <span>More Details <span className="font-normal text-slate-500">· Opened: {r.opened === DEFAULT_OPENED ? "Yes, Completely" : r.opened} · Photos {eqPhotos.length + beforePhotos.length}</span></span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", more && "rotate-180")} />
        </button>
        {more ? (
          <div className="space-y-4">
            <OpenedCombobox id="ed-opened" value={OPENED_VALUES.includes(r.opened as never) ? r.opened : DEFAULT_OPENED} onChange={(o) => updateResult(r.id, { opened: o })} />
            <div>
              <div className={lbl}>Before Opening Photo <span className="font-normal text-slate-400">(optional)</span></div>
              <EquipmentPhotoPanel testId="before-camera-input" label="Before Opening Photo" hint="Breaker positions, labels or damage before anything is opened or operated."
                photos={beforePhotos} pending={pending?.kind === "before-opening" ? pending.file : null} note={pending?.note} onNote={(v) => setPending((c) => (c ? { ...c, note: v } : c))}
                onPick={(f) => setPending({ kind: "before-opening", file: f, note: "" })} onSavePending={savePending} onDiscardPending={() => setPending(null)} onDelete={delPhoto} saving={savingPhoto} />
            </div>
            <div>
              <div className={lbl}>Equipment Photo <span className="font-normal text-slate-400">(optional)</span></div>
              <EquipmentPhotoPanel testId="equipment-camera-input" hint="A visual photo of the equipment front. Separate from IR / Visual image numbers."
                photos={eqPhotos} pending={pending?.kind === "equipment" ? pending.file : null}
                onPick={(f) => setPending({ kind: "equipment", file: f, note: "" })} onSavePending={savePending} onDiscardPending={() => setPending(null)} onDelete={delPhoto} saving={savingPhoto} />
            </div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <EditText id="ed-name" labelText="Equipment name" value={eq?.name ?? ""} onCommit={(x) => eq && x.trim() && updateEquipment(eq.id, { name: x.trim() })} />
              <TypeSelect value={eq?.equipmentType ?? OTHER_EQUIPMENT_TYPE} onChange={(t) => eq && updateEquipment(eq.id, { equipmentType: t })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([["humidity", "Humidity", room?.humidity], ["ambientTemp", "Ambient Temp", room?.ambientTemp], ["backgroundTemp", "Background Temp", room?.backgroundTemp], ["emissivity", "Emissivity", inspection.defaultEmissivity]] as [keyof ResultOverrides, string, string | undefined][]).map(([k, l, inh]) => (
                <div key={k}>
                  <EditText id={`ed-${k}`} labelText={`${l} override`} numeric="decimal" value={r.overrides[k] ?? ""} placeholder={inh ? `${inh} (room)` : "room value"} onCommit={(x) => setOverride(r.id, k, x.trim() === "" ? null : x)} />
                  {r.overrides[k] !== null ? <button className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-sky-700" onClick={() => setOverride(r.id, k, null)}><Undo2 className="h-3 w-3" />Use room value</button> : null}
                </div>
              ))}
            </div>
            <EditText id="ed-review" labelText="Review Notes (exported)" value={r.reviewNotes} onCommit={(x) => updateResult(r.id, { reviewNotes: x })} />
            <p className="text-xs text-slate-500">Exports as H {eff.humidity || "blank"} · Bg {eff.backgroundTemp || "blank"} · Amb {eff.ambientTemp || "blank"} · ε {eff.emissivity}</p>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
              <Button size="lg" className="h-12 justify-center" onClick={() => { const id = duplicateResult(r.id); if (id) { toast("Duplicated with next number"); onNavigate(id); } }}><Copy className="h-4 w-4" />Duplicate</Button>
              <Button size="lg" variant="danger" className="h-12 justify-center" onClick={() => { if (confirm(`Remove ${eq?.name || "this item"} from this inspection?`)) { const target = next ?? prev; deleteResult(r.id); toast("Removed"); if (target) onNavigate(target); else onClose(); } }}><Trash2 className="h-4 w-4" />Remove</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
