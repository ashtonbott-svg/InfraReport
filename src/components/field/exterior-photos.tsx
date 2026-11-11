"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, ImageOff, PauseCircle, Flag, Trash2, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { PhotoCapture } from "./photo-capture";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store/store";
import { useCustomers, useFacilities, useInspections, useLocations, useResults, useRooms } from "@/lib/store/hooks";
import { ANY_BUILDING, buildingLabel, checkExit, exteriorPhotosFor, requiredBuildings } from "@/lib/domain/site-visit";
import { persistPhoto } from "@/lib/photos/capture";
import { deletePhotoBlob } from "@/lib/photos/photo-db";
import { usePhotoUrl } from "@/lib/photos/use-photo-url";
import { formatDateTime } from "@/lib/format";
import type { Photo } from "@/lib/domain/types";

/** Everything the field workflow needs to know about one inspection. */
export function useFieldState(inspectionId: string | null) {
  const inspections = useInspections();
  const customers = useCustomers();
  const facilities = useFacilities();
  const rooms = useRooms();
  const locations = useLocations();
  const results = useResults();
  const photos = useStore((s) => s.photos);
  return useMemo(() => {
    const inspection = inspections.find((i) => i.id === inspectionId);
    if (!inspection) return null;
    const facility = facilities.find((f) => f.id === inspection.facilityId);
    const customer = customers.find((c) => c.id === inspection.customerId);
    const locMap = new Map(locations.map((l) => [l.id, l]));
    const inspRooms = rooms.filter((r) => r.inspectionId === inspection.id);
    const required = requiredBuildings(inspRooms, locMap);
    const exit = checkExit(required, photos, inspection.id);
    const exterior = exteriorPhotosFor(photos, inspection.id).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    const lastRoom = inspection.siteVisit.lastActiveLocationId ? locMap.get(inspection.siteVisit.lastActiveLocationId) : undefined;
    const knownBuildings = [...new Set(locations.filter((l) => l.facilityId === inspection.facilityId).map((l) => l.building.trim()).filter(Boolean))].sort();
    return {
      inspection, facility, customer, required, exit, exterior, lastRoom, knownBuildings,
      roomCount: inspRooms.length,
      equipmentCount: results.filter((r) => r.inspectionId === inspection.id).length,
    };
  }, [inspections, customers, facilities, rooms, locations, results, photos, inspectionId]);
}

export type FieldState = NonNullable<ReturnType<typeof useFieldState>>;

function Thumb({ photo, className }: { photo: Photo; className?: string }) {
  const { url, missing } = usePhotoUrl(photo.id);
  return (
    <div className={cn("flex items-center justify-center overflow-hidden rounded-lg bg-slate-100", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt={`Exterior photo, ${buildingLabel(photo.building)}`} className="h-full w-full object-cover" /> : missing ? <ImageOff className="h-5 w-5 text-slate-400" /> : null}
    </div>
  );
}

/** Building picker + camera for one exterior photo. */
export function ExteriorCapture({ field, takeLabel, onSaved, autoOpen }: { field: FieldState; takeLabel?: string; onSaved?: () => void; autoOpen?: boolean }) {
  const firstMissing = field.exit.missing[0];
  const defaultBuilding = firstMissing === undefined || firstMissing === ANY_BUILDING ? (field.required.find((b) => b !== ANY_BUILDING) ?? "") : firstMissing;
  const [building, setBuilding] = useState<string | null>(null);
  const chosen = building ?? defaultBuilding;
  const options = [...new Set(["", ...field.knownBuildings, ...field.required.filter((b) => b !== ANY_BUILDING)])];
  const save = async (file: File) => {
    await persistPhoto(file, { inspectionId: field.inspection.id, facilityId: field.inspection.facilityId, kind: "exterior", building: chosen, resultId: null });
    toast("Exterior photo saved on this device");
    setBuilding(null);
    onSaved?.();
  };
  return (
    <div className="space-y-3">
      {options.length > 1 ? (
        <label className="block text-sm font-medium text-slate-700">
          This photo shows
          <Select className="mt-1 h-11 text-base" value={chosen} onChange={(e) => setBuilding(e.target.value)} aria-label="Building for this photo">
            {options.map((b) => <option key={b || "main"} value={b}>{buildingLabel(b)}{field.exit.missing.includes(b) ? " (required)" : ""}</option>)}
          </Select>
        </label>
      ) : null}
      <PhotoCapture onSave={save} takeLabel={takeLabel} autoOpen={autoOpen} />
    </div>
  );
}

/** Per-building checklist with thumbnails and building reassignment. */
export function ExteriorChecklist({ field, editable = true }: { field: FieldState; editable?: boolean }) {
  const setPhotoBuilding = useStore((s) => s.setPhotoBuilding);
  const removePhotoRecord = useStore((s) => s.removePhotoRecord);
  const reqs = field.required;
  const options = [...new Set(["", ...field.knownBuildings, ...reqs.filter((b) => b !== ANY_BUILDING)])];
  const remove = async (p: Photo) => {
    if (!confirm("Delete this exterior photo from this device?")) return;
    removePhotoRecord(p.id);
    await deletePhotoBlob(p.id).catch(() => undefined);
    toast("Photo deleted");
  };
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {reqs.map((b) => {
          const missing = field.exit.missing.includes(b);
          return (
            <li key={b} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", missing ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")}>
              {missing ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
              <span className="font-medium">{buildingLabel(b)}</span>
              <span className="ml-auto text-xs">{missing ? "Photo required" : "Photo saved"}</span>
            </li>
          );
        })}
      </ul>
      {field.exterior.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {field.exterior.map((p) => (
            <div key={p.id} className="space-y-1">
              <Thumb photo={p} className="aspect-[4/3] w-full" />
              {editable ? (
                <div className="flex items-center gap-1">
                  <select aria-label="Building shown in photo" className="h-8 min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 text-xs" value={p.building} onChange={(e) => setPhotoBuilding(p.id, e.target.value)}>
                    {[...new Set([...options, p.building])].map((b) => <option key={b || "main"} value={b}>{buildingLabel(b)}</option>)}
                  </select>
                  <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Delete photo" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ) : <div className="truncate text-xs text-slate-500">{buildingLabel(p.building)}</div>}
              <div className="text-[11px] text-slate-400">{formatDateTime(p.savedAt)}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Exterior photo sheet.
 *  - "start": shown when a site visit begins (Take Photo / Skip for Now)
 *  - "manage": view, add, reassign photos
 */
export function ExteriorPhotoSheet({ open, mode, field, onClose, onSkip }: {
  open: boolean; mode: "start" | "manage"; field: FieldState; onClose: () => void; onSkip?: () => void;
}) {
  const start = mode === "start";
  return (
    <Sheet open={open} onClose={start ? () => onSkip?.() : onClose} dismissible={!start}
      title={start ? "Building Exterior Photo" : "Building exterior photos"}
      subtitle={start ? "Take a photo of the front of the building before beginning your inspection." : `${field.facility?.name ?? ""}: one saved photo is required per building.`}
      footer={start ? (
        <Button size="lg" className="h-12 w-full justify-center text-base" onClick={onSkip}>Skip for Now</Button>
      ) : (
        <Button size="lg" className="h-12 w-full justify-center text-base" onClick={onClose}>Done</Button>
      )}>
      <div className="space-y-4">
        {!start || field.exterior.length ? <ExteriorChecklist field={field} /> : null}
        <ExteriorCapture field={field} takeLabel={start ? "Take Photo" : field.exit.allowed ? "Add Another Photo" : "Take Photo Now"} onSaved={start ? onClose : undefined} />
        <p className="text-xs text-slate-500">Photos are saved only on this device (IndexedDB) until secure cloud storage is connected.</p>
      </div>
    </Sheet>
  );
}

/**
 * Exit checkpoint: the only way out of an active inspection. Pause and Finish
 * are both blocked until every required building has a saved exterior photo.
 * Inspection data is always saved, so nothing here can lose work.
 */
export function ExitCheckpoint({ open, field, onClose, onExited }: { open: boolean; field: FieldState; onClose: () => void; onExited: (kind: "paused" | "finished") => void }) {
  const pause = useStore((s) => s.pauseSiteVisit);
  const finish = useStore((s) => s.finishSiteVisit);
  const blocked = !field.exit.allowed;
  const doExit = (kind: "paused" | "finished") => {
    const r = kind === "paused" ? pause(field.inspection.id) : finish(field.inspection.id);
    if (!r.allowed) { toast("Exterior photo still required", "error"); return; }
    toast(kind === "paused" ? "Inspection saved. Resume any time." : "Site visit completed");
    onExited(kind);
  };
  return (
    <Sheet open={open} onClose={onClose} title={blocked ? "Building Exterior Photo Required" : "Leave this inspection?"}
      subtitle={blocked ? "Before leaving this site, please take or upload a photograph of the building exterior." : `${field.facility?.name}: ${field.equipmentCount} equipment items in ${field.roomCount} rooms. All changes are saved on this device.`}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" className="h-12 justify-center text-base" disabled={blocked} onClick={() => doExit("paused")}><PauseCircle className="h-5 w-5" />Pause and Return Later</Button>
          <Button size="lg" variant="dark" className="h-12 justify-center text-base" disabled={blocked} onClick={() => doExit("finished")}><Flag className="h-5 w-5" />Finish Site Visit</Button>
          <Button size="lg" variant="ghost" className="h-11 justify-center sm:col-span-2" onClick={onClose}>Keep Working</Button>
        </div>
      }>
      <div className="space-y-4">
        <ExteriorChecklist field={field} editable={false} />
        {blocked ? <ExteriorCapture field={field} takeLabel="Take Photo Now" /> : (
          <p className="text-sm text-slate-600">
            <strong>Pause</strong> keeps the inspection In Progress so you can resume tomorrow on this device. <strong>Finish</strong> ends the site visit and sends it to review.
          </p>
        )}
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <LifeBuoy className="h-3.5 w-3.5 shrink-0" />
          Your inspection data is already saved. Need a backup or recovery?{" "}
          <Link href="/settings" className="font-medium text-slate-700 underline" onClick={onClose}>Settings &amp; data recovery</Link>
        </div>
      </div>
    </Sheet>
  );
}

export function ExteriorReminder({ field, onTakePhoto }: { field: FieldState; onTakePhoto: () => void }) {
  if (field.exit.allowed) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950">
      <Building2 className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm leading-tight">
        <div className="font-semibold">Exterior photo required</div>
        <div className="truncate text-xs">{field.exit.missing.map(buildingLabel).join(", ")}</div>
      </div>
      <Button variant="primary" className="h-10 shrink-0" onClick={onTakePhoto}>Take Photo</Button>
    </div>
  );
}
