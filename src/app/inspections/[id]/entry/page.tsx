"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AlertTriangle, Camera, ChevronDown, Filter, LayoutGrid, ListPlus, MapPin, Play, Plus, Rows3, Search, SlidersHorizontal, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { InspectionHeader } from "@/components/inspection/inspection-header";
import { RoomConditionsCard, RoomRail, type RoomEntry } from "@/components/inspection/room-panels";
import { EquipmentGrid, QuickAddBar, type GridRow } from "@/components/inspection/equipment-grid";
import { AddRoomSheet, RoomConditionsSheet, RoomPickerSheet, conditionSummary } from "@/components/field/room-sheets";
import { EquipmentSheet, nameSuggestions } from "@/components/field/equipment-sheet";
import { ExteriorReminder, useFieldState } from "@/components/field/exterior-photos";
import { SaveIndicator } from "@/components/field/save-indicator";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useAllowedCauses, useEquipment, useInspectionBundle, useLocations } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { useFieldUi } from "@/lib/store/field-ui";
import { useBeginFieldWork } from "@/lib/store/field-actions";
import { useKeyboardOpen } from "@/lib/use-viewport";
import { countBySeverity } from "@/lib/domain/validation";
import { LIMITED_ACCESS_OPENED } from "@/lib/domain/constants";
import { defaultComponentForType } from "@/lib/domain/rules";
import { locationLabel } from "@/lib/domain/csv";
import { formatDateTime } from "@/lib/format";
import { usePhotoUrl } from "@/lib/photos/use-photo-url";
import { imageHasFinding, resultHasFinding, resultStatus, roomProgress } from "@/lib/domain/thermal";
import { RoomCheckpoint, RoomStatusBanner } from "@/components/field/room-checkpoint";
import type { Equipment, Location } from "@/lib/domain/types";

type RowFilter = "all" | "problems" | "missing-image" | "limited" | "overrides" | "single-photo";
type View = "cards" | "table";

const VIEW_KEY = "infrareport-entry-view";
function subscribeMq(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  window.addEventListener("storage", cb);
  window.addEventListener("infrareport-view", cb);
  return () => { mq.removeEventListener("change", cb); window.removeEventListener("storage", cb); window.removeEventListener("infrareport-view", cb); };
}
/** Cards on phones / portrait tablets, table on wide screens, unless the user picked one on this device. */
function useEntryView(): [View, (v: View) => void] {
  const view = useSyncExternalStore(subscribeMq, () => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch { /* ignore */ }
    if (saved === "cards" || saved === "table") return saved;
    return window.matchMedia("(min-width: 1024px)").matches ? "table" : "cards";
  }, () => "cards" as View) as View;
  const set = useCallback((v: View) => {
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
    window.dispatchEvent(new Event("infrareport-view"));
  }, []);
  return [view, set];
}

const SHORT_OPENED: Record<string, string> = {
  "Yes, Completely": "Opened",
  "Yes, with Dead-Front on": "Dead-front on",
  "Scanned Surface Only": "Surface only",
  "Can’t Open Item": "Can’t open",
  "Item is Locked Out": "Locked out",
  "Only 1 Item": "Only 1 item",
  "Item Was Off at Time of Scan": "Off at scan",
  "Equipment Inaccessible Due to Obstruction(s) in Front of Panel": "Obstructed",
};

function CardThumb({ photoId }: { photoId: string | null }) {
  const { url } = usePhotoUrl(photoId);
  if (!photoId) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">{url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}</div>;
}

const CARD_STATUS = {
  todo: { label: "To do", bar: "bg-slate-200", chip: "text-slate-400" },
  recorded: { label: "Done", bar: "bg-emerald-500", chip: "text-emerald-700" },
  "not-scanned": { label: "Not scanned", bar: "bg-amber-400", chip: "text-amber-800" },
  deferred: { label: "Deferred", bar: "bg-amber-400", chip: "text-amber-800" },
} as const;

function EquipmentCard({ row, onOpen, photoCount, firstPhotoId }: { row: GridRow; onOpen: () => void; photoCount: number; firstPhotoId: string | null }) {
  const r = row.result;
  const status = resultStatus(r);
  const st = CARD_STATUS[status];
  const problem = resultHasFinding(r);
  const limited = LIMITED_ACCESS_OPENED.includes(r.opened);
  const maxT = r.images.map((i) => Number(i.maxTemp)).filter((n) => !Number.isNaN(n) && n > 0);
  return (
    <button onClick={onOpen} data-result-id={r.id} data-status={status}
      className={cn("flex w-full items-stretch gap-3 rounded-xl border bg-white p-3 text-left shadow-xs active:bg-slate-50",
        problem ? "border-thermal-300 ring-1 ring-thermal-200" : "border-slate-200")}>
      <div className={cn("w-1 shrink-0 rounded-full", problem ? "bg-thermal-500" : st.bar)} />
      <CardThumb photoId={firstPhotoId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-base font-semibold text-slate-900">{row.equipment?.name || "(unnamed)"}</span>
          {maxT.length ? <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{Math.max(...maxT)}°F</span>
            : status === "recorded" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Done" /> : <span className={cn("shrink-0 text-[11px] font-medium", st.chip)}>{st.label}</span>}
        </div>
        <div className="mt-1 space-y-0.5">
          {r.images.map((img, i) => (
            <div key={img.id} className="flex items-center gap-1.5 text-xs">
              <span className="truncate text-slate-600">{r.images.length > 1 ? `${i + 1}. ` : ""}{img.component || "No component"}</span>
              <span className={cn("shrink-0 rounded px-1 tabular-nums", img.irImageNumber ? "bg-slate-100 text-slate-700" : "text-slate-400")}>IR {img.irImageNumber || "?"}{img.visualOverridden ? ` / V ${img.visualImageNumber || "?"}` : ""}</span>
              {img.distance ? <span className="shrink-0 rounded bg-slate-100 px-1 tabular-nums text-slate-700">{img.distance} ft</span> : null}
              {imageHasFinding(img) ? <span className="truncate rounded bg-thermal-100 px-1 font-medium text-thermal-800">{img.possibleCause}</span> : null}
            </div>
          ))}
        </div>
        {limited || r.exception || photoCount ? (
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            {limited ? <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900">{SHORT_OPENED[r.opened] ?? r.opened}</span> : null}
            {r.exception ? <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">{r.exception.kind === "deferred" ? "Deferred" : "Not scanned"}</span> : null}
            {photoCount ? <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-sky-700"><Camera className="h-3 w-3" />{photoCount}</span> : null}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function EntryWorkspace() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const bundle = useInspectionBundle(id);
  const field = useFieldState(id);
  const locations = useLocations();
  const allEquipment = useEquipment();
  const causes = useAllowedCauses();
  const photos = useStore((s) => s.photos);
  const activeId = useStore((s) => s.activeInspectionId);
  const addExistingEquipment = useStore((s) => s.addExistingEquipment);
  const addRoomToInspection = useStore((s) => s.addRoomToInspection);
  const setLastActiveRoom = useStore((s) => s.setLastActiveRoom);
  const openExterior = useFieldUi((s) => s.openExterior);
  const exteriorOpen = useFieldUi((s) => s.exteriorSheet !== null);
  const checkpointOpen = useFieldUi((s) => s.checkpointOpen);
  const begin = useBeginFieldWork();
  const keyboardOpen = useKeyboardOpen();
  const [view, setView] = useEntryView();

  const [selectedRaw, setSelectedRaw] = useState(params.get("room") ?? "");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sheet, setSheet] = useState<null | "add-room" | "pick-room" | "conditions" | "add-eq" | "edit-eq" | "checkpoint">(null);
  const [editId, setEditId] = useState<string | null>(null);

  const rooms: RoomEntry[] = useMemo(() => {
    if (!bundle) return [];
    const locMap = bundle.dataset.locations as Map<string, Location>;
    return bundle.dataset.rooms
      .map((room) => ({ room, location: locMap.get(room.locationId)!, count: bundle.dataset.results.filter((r) => r.locationId === room.locationId).length }))
      .filter((r) => r.location)
      .sort((a, b) => a.location.sortOrder - b.location.sortOrder);
  }, [bundle]);

  const lastActive = bundle?.dataset.inspection.siteVisit.lastActiveLocationId ?? "";
  const want = selectedRaw || lastActive;
  const selected = want === "all" || rooms.some((r) => r.location.id === want) ? want : rooms[0]?.location.id ?? "";
  const selectRoom = useCallback((locId: string) => {
    setSelectedRaw(locId);
    if (locId !== "all") setLastActiveRoom(id, locId);
  }, [id, setLastActiveRoom]);
  // Remember the room on first open so Resume returns here.
  useEffect(() => {
    if (selected && selected !== "all" && selected !== lastActive) setLastActiveRoom(id, selected);
  }, [selected, lastActive, id, setLastActiveRoom]);

  // Jump target from Review: open the card editor or highlight the table row.
  const focusId = params.get("focus");
  const [focusHandled, setFocusHandled] = useState<string | null>(null);
  if (focusId && focusHandled !== focusId && view === "cards") { setFocusHandled(focusId); setEditId(focusId); setSheet("edit-eq"); }
  useEffect(() => {
    if (!focusId || view !== "table") return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-result-id="${focusId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("ring-2", "ring-thermal-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-thermal-400"), 2400);
    }, 150);
    return () => clearTimeout(t);
  }, [focusId, view]);

  const gridRows: GridRow[] = useMemo(() => {
    if (!bundle) return [];
    const { dataset } = bundle;
    const eqMap = dataset.equipment as Map<string, Equipment>;
    const locMap = dataset.locations as Map<string, Location>;
    const s = q.trim().toLowerCase();
    return dataset.results
      .filter((r) => selected === "all" || r.locationId === selected)
      .map((r) => ({ result: r, equipment: eqMap.get(r.equipmentId), location: locMap.get(r.locationId), room: dataset.rooms.find((x) => x.locationId === r.locationId) }))
      .filter(({ result: r, equipment: e }) => {
        if (s && ![e?.name ?? "", ...r.images.flatMap((i) => [i.component, i.irImageNumber, i.visualImageNumber, i.notes])].some((x) => x.toLowerCase().includes(s))) return false;
        switch (filter) {
          case "problems": return resultHasFinding(r);
          case "missing-image": return resultStatus(r) === "todo";
          case "limited": return LIMITED_ACCESS_OPENED.includes(r.opened) || !!r.exception;
          case "overrides": return Object.values(r.overrides).some((v) => v !== null);
          case "single-photo": return r.images.some((i) => i.visualOverridden);
          default: return true;
        }
      })
      .sort((a, b) => (a.location?.sortOrder ?? 0) - (b.location?.sortOrder ?? 0) || a.result.sortOrder - b.result.sortOrder);
  }, [bundle, selected, q, filter]);

  if (!bundle || !field) return <EmptyState title="Inspection not found" action={<Link href="/inspections"><Button>Back</Button></Link>} />;
  const { dataset, issues } = bundle;
  const inspection = dataset.inspection;
  const counts = countBySeverity(issues);
  const current = rooms.find((r) => r.location.id === selected) ?? null;
  const roomResults = dataset.results.filter((r) => r.locationId === selected);
  const usedLocationIds = new Set(rooms.map((r) => r.location.id));
  const otherRooms = locations.filter((l) => l.facilityId === inspection.facilityId && !usedLocationIds.has(l.id));
  const isActive = activeId === inspection.id;
  const visit = inspection.siteVisit;

  const inspectedEq = new Set(dataset.results.map((r) => r.equipmentId));
  const missingInventory = allEquipment.filter((e) => e.facilityId === inspection.facilityId && e.active && !inspectedEq.has(e.id) && (selected === "all" || e.locationId === selected));
  const filtered = q.trim() !== "" || filter !== "all";

  // Defaults for the next new item: continue the last sequence in this room.
  const eqMap = dataset.equipment as Map<string, Equipment>;
  const roomNames = [...roomResults].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => eqMap.get(r.equipmentId)?.name ?? "");
  const lastEq = roomResults.length ? eqMap.get([...roomResults].sort((a, b) => b.sortOrder - a.sortOrder)[0].equipmentId) : undefined;
  const suggestions = nameSuggestions(roomNames);
  const lastType = lastEq?.equipmentType ?? "Panel";
  const createDefaults = { name: suggestions[0] ?? "", type: lastType, component: defaultComponentForType(lastType) || (lastEq ? dataset.results.find((r) => r.equipmentId === lastEq.id)?.images[0]?.component ?? "" : "Full Panel") };
  const photoCount = (rid: string) => photos.filter((p) => p.resultId === rid).length;
  const firstPhoto = (rid: string) => photos.find((p) => p.resultId === rid)?.id ?? null;
  const facilityNames = allEquipment.filter((e) => e.facilityId === inspection.facilityId).map((e) => e.name);
  const progress = roomProgress(roomResults);
  // Walk-through: rooms in order; the next room is the next one not yet finished.
  const roomIdx = rooms.findIndex((r) => r.location.id === selected);
  const nextRoom = roomIdx >= 0 ? (rooms.slice(roomIdx + 1).find((r) => !r.room.completedAt) ?? rooms.slice(roomIdx + 1)[0]) : undefined;
  const checkpointItems = [...roomResults].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ result: r, equipment: eqMap.get(r.equipmentId) }));
  const goToNextRoom = () => {
    if (!nextRoom) { setSheet(null); return; }
    selectRoom(nextRoom.location.id);
    setSheet(null);
    toast(`Now in ${nextRoom.location.name}`);
  };

  const onRoomCreated = (locationId: string, building: string) => {
    const wasRequired = field.required.includes(building);
    selectRoom(locationId);
    setSheet(null);
    toast("Room added. Start adding equipment.");
    const st = useStore.getState();
    const missing = st.exitCheck(inspection.id).missing;
    // Prompt only when this room introduces a building that needs its own photo.
    if (isActive && !wasRequired && missing.includes(building) && field.exit.allowed) setTimeout(() => openExterior("start"), 250);
  };
  const addExistingRoom = (locId: string) => {
    addRoomToInspection(inspection.id, locId);
    selectRoom(locId);
    setSheet("conditions");
  };

  const startBanner = !isActive && visit.state !== "completed" ? (
    <div className="flex flex-col gap-3 rounded-xl border border-thermal-200 bg-thermal-50 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{visit.state === "paused" ? "Site visit paused" : "Ready to inspect on site?"}</div>
        <div className="text-xs text-slate-600">
          {visit.state === "paused" ? `Day ${new Set(visit.sessions.map((s) => new Date(s.startedAt).toDateString())).size} so far. Last saved ${formatDateTime(inspection.updatedAt)}.` : "Starting makes this the active job and asks for the building exterior photo."}
        </div>
      </div>
      <Button variant="primary" size="lg" className="h-12 justify-center text-base" onClick={() => begin(inspection.id)}><Play className="h-5 w-5" />{visit.state === "paused" ? "Resume Inspection" : "Start Site Visit"}</Button>
    </div>
  ) : visit.state === "completed" && !isActive ? (
    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" />Site visit completed. Edits here are review corrections.</div>
  ) : null;

  const reminder = isActive ? <ExteriorReminder field={field} onTakePhoto={() => openExterior("manage")} /> : null;

  const viewToggle = (
    <div className="hidden items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium sm:flex">
      <button onClick={() => setView("cards")} className={cn("flex items-center gap-1 rounded-md px-2 py-1.5", view === "cards" ? "bg-slate-900 text-white" : "text-slate-600")} aria-pressed={view === "cards"}><LayoutGrid className="h-3.5 w-3.5" />Field</button>
      <button onClick={() => setView("table")} className={cn("flex items-center gap-1 rounded-md px-2 py-1.5", view === "table" ? "bg-slate-900 text-white" : "text-slate-600")} aria-pressed={view === "table"}><Rows3 className="h-3.5 w-3.5" />Table</button>
    </div>
  );

  const sheets = (
    <>
      <AddRoomSheet open={sheet === "add-room"} onClose={() => setSheet(null)} inspectionId={inspection.id} previous={current ?? rooms[rooms.length - 1] ?? null} knownBuildings={field.knownBuildings} onCreated={onRoomCreated}
        facilityRooms={locations.filter((l) => l.facilityId === inspection.facilityId).map((l) => ({ id: l.id, name: l.name, building: l.building, inInspection: usedLocationIds.has(l.id) }))}
        onUseExisting={(locId) => { addExistingRoom(locId); toast("Existing room added. Enter its conditions."); }} />
      <RoomPickerSheet open={sheet === "pick-room"} onClose={() => setSheet(null)} rooms={rooms} selected={selected} total={dataset.results.length}
        onSelect={(l) => { selectRoom(l); setSheet(null); }} onAddRoom={() => setSheet("add-room")} otherRooms={otherRooms} onAddExisting={addExistingRoom} />
      <RoomConditionsSheet open={sheet === "conditions"} onClose={() => setSheet(null)} info={current} inspectionDate={inspection.date} knownBuildings={field.knownBuildings} />
      {sheet === "add-eq" || sheet === "edit-eq" ? (
        <EquipmentSheet open mode={sheet === "add-eq" ? "create" : "edit"} onClose={() => setSheet(null)} inspection={inspection}
          locationId={current?.location.id ?? null} room={current?.room ?? (editId ? dataset.rooms.find((x) => x.locationId === dataset.results.find((r) => r.id === editId)?.locationId) : undefined)}
          rows={gridRows} editId={editId} onNavigate={(rid) => setEditId(rid)} defaults={createDefaults} suggestions={suggestions}
          facilityNames={facilityNames} roomName={current?.location.name}
          onEndOfRoom={selected !== "all" && !filtered ? () => setSheet("checkpoint") : undefined} />
      ) : null}
      {current && sheet === "checkpoint" ? (
        <RoomCheckpoint open onClose={() => setSheet(null)} room={current.room} location={current.location} items={checkpointItems} nextRoom={nextRoom?.location ?? null}
          onGoToItem={(rid) => { setEditId(rid); setSheet("edit-eq"); }} onNextRoom={goToNextRoom} />
      ) : null}
    </>
  );

  /* ---------------------------- Field (cards) view --------------------------- */
  if (view === "cards") {
    const barHidden = keyboardOpen || sheet !== null || exteriorOpen || checkpointOpen;
    return (
      <div className="mx-auto max-w-3xl pb-28">
        <div className={cn(isActive ? "hidden lg:block" : "")}><InspectionHeader inspection={inspection} errorCount={counts.error} /></div>
        <div className="space-y-3">
          {startBanner}
          {reminder}

          {/* Current room: one tap to switch, one tap to add */}
          {rooms.length === 0 ? (
            <Card className="p-5 text-center">
              <ListPlus className="mx-auto h-8 w-8 text-slate-400" />
              <div className="mt-2 text-base font-semibold">Add the first room</div>
              <p className="mt-1 text-sm text-slate-500">Enter humidity and temperatures once. Every item in the room inherits them.</p>
              <Button variant="primary" size="lg" className="mt-4 h-12 w-full justify-center text-base" onClick={() => setSheet("add-room")}><Plus className="h-5 w-5" />Add Room</Button>
            </Card>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current Room</span>
                <SaveIndicator className="max-w-[60%]" />
              </div>
              <div className="mt-1 flex items-stretch gap-2">
                <button onClick={() => setSheet("pick-room")} className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-lg bg-slate-100 px-3 text-left active:bg-slate-200" aria-label="Switch room">
                  <MapPin className="h-5 w-5 shrink-0 text-thermal-600" />
                  <span className="min-w-0 flex-1 leading-tight">
                    {current?.location.building ? <span className="block truncate text-[11px] font-medium text-slate-500">{current.location.building}</span> : null}
                    <span className="block truncate text-base font-semibold text-slate-900">{current ? current.location.name : `All rooms (${dataset.results.length})`}</span>
                  </span>
                  <ChevronDown className="h-5 w-5 shrink-0 text-slate-500" />
                </button>
                <Button variant="primary" className="h-auto min-h-12 shrink-0 px-4 text-base" onClick={() => setSheet("add-room")}><Plus className="h-5 w-5" />Add Room</Button>
              </div>
              {current ? (
                <>
                  <div className="mt-2"><RoomStatusBanner room={current.room} onEdit={() => setSheet("conditions")} /></div>
                  <button onClick={() => setSheet("conditions")} className="mt-1 flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm text-slate-600 active:bg-slate-100">
                    <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="flex-1 truncate">{conditionSummary(current.room)}</span>
                    <span className="text-xs font-medium text-thermal-700">Edit</span>
                  </button>
                  {progress.total ? (
                    <div className="mt-2 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2" data-testid="room-progress">
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between text-xs font-medium text-slate-700">
                          <span>Equipment {progress.total} · Done {progress.done}</span>
                          <span className={progress.remaining.length ? "font-semibold text-slate-900" : "text-emerald-700"}>{progress.remaining.length ? `${progress.remaining.length} remaining` : current.room.completedAt ? "Room finished" : "All addressed"}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
                      </div>
                      <Button className="h-10 shrink-0" variant={progress.remaining.length || current.room.completedAt ? "secondary" : "dark"} onClick={() => setSheet("checkpoint")}>{current.room.completedAt ? "Next Room" : "Finish Room"}</Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}

          {rooms.length ? (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input className="h-10 pl-9 text-base" placeholder="Search equipment or image #" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Button className={cn("h-10", filter !== "all" && "border-thermal-400 text-thermal-800")} onClick={() => setShowFilters(!showFilters)} aria-label="Filters"><Filter className="h-4 w-4" /></Button>
                {viewToggle}
              </div>
              {showFilters ? (
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  {([["all", "All"], ["missing-image", "To do"], ["problems", "Findings"], ["limited", "Not scanned / limited"], ["single-photo", "Different Vis #"], ["overrides", "Overrides"]] as [RowFilter, string][]).map(([k, l]) => (
                    <button key={k} onClick={() => setFilter(k)} className={cn("h-9 shrink-0 rounded-full border px-3 text-sm", filter === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700")}>{l}</button>
                  ))}
                </div>
              ) : null}

              {gridRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  {filtered ? "No equipment matches." : "No equipment in this room yet. Tap Add Equipment below."}
                </div>
              ) : (
                <div className="space-y-2">
                  {gridRows.map((row, i) => {
                    const header = selected === "all" && (i === 0 || gridRows[i - 1].result.locationId !== row.result.locationId);
                    return (
                      <div key={row.result.id}>
                        {header ? <div className="px-1 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{locationLabel(row.location)}</div> : null}
                        <EquipmentCard row={row} photoCount={photoCount(row.result.id)} firstPhotoId={firstPhoto(row.result.id)} onOpen={() => { setEditId(row.result.id); setSheet("edit-eq"); }} />
                      </div>
                    );
                  })}
                </div>
              )}
              {missingInventory.length ? (
                <Button className="h-11 w-full justify-center" onClick={() => { missingInventory.forEach((e) => addExistingEquipment(inspection.id, e.id)); toast(`${missingInventory.length} inventory items added`); }}>
                  Add {missingInventory.length} item{missingInventory.length === 1 ? "" : "s"} from facility inventory
                </Button>
              ) : null}
              {counts.error ? (
                <Link href={`/inspections/${id}/review`} className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="h-4 w-4" />{counts.error} validation error{counts.error === 1 ? "" : "s"}. Review</Link>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Thumb-reach action bar */}
        {!barHidden ? (
          <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:left-60">
            <div className="mx-auto grid max-w-3xl grid-cols-[auto_1fr_auto] gap-2">
              <Button size="lg" className="h-14 flex-col justify-center gap-0.5 px-4 text-xs" onClick={() => setSheet("pick-room")}><MapPin className="h-5 w-5" />Rooms</Button>
              <Button variant="primary" size="lg" className="h-14 justify-center text-lg" disabled={!current} onClick={() => setSheet("add-eq")}><Plus className="h-6 w-6" />Add Equipment</Button>
              <Button size="lg" className={cn("relative h-14 flex-col justify-center gap-0.5 px-4 text-xs", !field.exit.allowed && "border-amber-400")} onClick={() => openExterior("manage")}>
                <Camera className="h-5 w-5" />Exterior
                {!field.exit.allowed ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-500" /> : null}
              </Button>
            </div>
          </div>
        ) : null}
        {sheets}
      </div>
    );
  }

  /* ---------------------------- Desktop table view --------------------------- */
  return (
    <>
      <InspectionHeader inspection={inspection} errorCount={counts.error} />
      <div className="mb-4 space-y-3">{startBanner}{reminder}</div>
      <div className="grid gap-4 2xl:grid-cols-[240px_minmax(0,1fr)]">
        <RoomRail rooms={rooms} selected={selected} onSelect={selectRoom} onAdd={() => setSheet("add-room")} total={dataset.results.length} />
        <div className="min-w-0 space-y-4">
          {rooms.length === 0 ? (
            <Card><EmptyState icon={<ListPlus className="h-5 w-5" />} title="Add the first room" description="Create a room, enter humidity and temperatures once, then add equipment rapidly." action={<Button variant="primary" onClick={() => setSheet("add-room")}>Add room</Button>} /></Card>
          ) : (
            <>
              {current ? <><RoomStatusBanner room={current.room} onEdit={() => setSheet("conditions")} /><RoomConditionsCard entry={current} results={roomResults} inspectionDate={inspection.date} />
                {progress.total ? <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm" data-testid="room-progress"><span>Equipment {progress.total} · Done {progress.done} · <strong>{progress.remaining.length} remaining</strong>{current.room.completedAt ? " · Room finished" : ""}</span><Button size="sm" onClick={() => setSheet("checkpoint")}>{current.room.completedAt ? "Next Room" : "Finish Room"}</Button></div> : null}</> : (
                <Card className="px-4 py-3 text-sm text-slate-600">Showing all {dataset.results.length} items across {rooms.length} rooms. Select a room to edit its conditions or quick add equipment.</Card>
              )}
              <QuickAddBar inspectionId={inspection.id} locationId={current ? current.location.id : null} disabled={!current} />
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input className="pl-9" placeholder="Search name, component, image #" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="relative">
                  <Filter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Select className="w-52 pl-9" value={filter} onChange={(e) => setFilter(e.target.value as RowFilter)} aria-label="Filter rows">
                    <option value="all">All rows</option>
                    <option value="problems">Problems documented</option>
                    <option value="missing-image">To do (not inspected)</option>
                    <option value="limited">Not scanned / limited access</option>
                    <option value="single-photo">Different Visual #</option>
                    <option value="overrides">Rows with overrides</option>
                  </Select>
                </div>
                <span className="text-xs text-slate-500">{gridRows.length} shown{filtered ? " (filtered)" : ""}</span>
                <div className="ml-auto flex items-center gap-2">
                  <SaveIndicator />
                  {viewToggle}
                  {missingInventory.length ? (
                    <Button size="sm" onClick={() => missingInventory.forEach((e) => addExistingEquipment(inspection.id, e.id))} title="Add facility inventory items that are not yet in this inspection">
                      Add {missingInventory.length} inventory item{missingInventory.length === 1 ? "" : "s"}
                    </Button>
                  ) : null}
                  <Link href={`/inspections/${id}/review`}><Button size="sm" variant={counts.error ? "danger" : "secondary"}>{counts.error ? `${counts.error} errors · Review` : "Review & export"}</Button></Link>
                </div>
              </div>
              {gridRows.length === 0 ? (
                <Card><EmptyState title={filtered ? "No rows match" : "No equipment in this room yet"} description={filtered ? "Clear the search or filter." : "Use Quick add above. Press Enter to add each item."} /></Card>
              ) : (
                <EquipmentGrid rows={gridRows} inspection={inspection} causes={causes} showRoomHeaders={selected === "all"} locations={locations} />
              )}
              <p className="text-xs text-slate-500">
                Tips: Enter moves down a column, Shift+Enter moves up, Esc cancels a cell edit. Each thermal image is its own row; use + on a row to add another image (Top Half, Section 2...). Visual # follows IR # unless you type a different one. Expand a row (›) for overrides, notes and Not scanned.
              </p>
            </>
          )}
        </div>
      </div>
      {sheets}
    </>
  );
}

export default function EntryPage() {
  return <Suspense fallback={null}><EntryWorkspace /></Suspense>;
}
