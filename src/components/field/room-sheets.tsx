"use client";

import { useState, type FormEvent } from "react";
import { Check, ChevronRight, Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store/store";
import { useOnOpen } from "@/lib/use-draft";
import { locationLabel } from "@/lib/domain/csv";
import { isNumericText, normalizeNumericInput } from "@/lib/domain/rules";
import { roomSuggestions } from "@/lib/domain/suggest";
import type { InspectionRoomConditions, Location } from "@/lib/domain/types";

export interface RoomInfo {
  room: InspectionRoomConditions;
  location: Location;
  count: number;
}

const bigInput = "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-thermal-500 focus:outline-none focus:ring-2 focus:ring-thermal-500/20";

function NumField({ id, label, unit, value, onChange }: { id: string; label: string; unit: string; value: string; onChange: (v: string) => void }) {
  const bad = value !== "" && !isNumericText(normalizeNumericInput(value));
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <span className="relative block">
        <input id={id} inputMode="decimal" enterKeyHint="next" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)}
          className={cn(bigInput, "pr-10 tabular-nums", bad && "border-red-400")} />
        <span className="pointer-events-none absolute right-3 top-3.5 text-sm text-slate-400">{unit}</span>
      </span>
    </label>
  );
}

export function conditionSummary(r: Pick<InspectionRoomConditions, "humidity" | "ambientTemp" | "backgroundTemp">): string {
  const parts = [
    r.humidity ? `${r.humidity}% RH` : null,
    r.ambientTemp ? `${r.ambientTemp}° amb` : null,
    r.backgroundTemp ? `${r.backgroundTemp}° bg` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Conditions not entered";
}

const conditionsComplete = (r: InspectionRoomConditions) => r.humidity !== "" && r.ambientTemp !== "" && r.backgroundTemp !== "";

/**
 * Quick room creation without leaving the inspection. Room name first,
 * conditions directly below, optionally copied from the previous room.
 */
export function AddRoomSheet({ open, onClose, inspectionId, previous, knownBuildings, onCreated, facilityRooms = [], onUseExisting }: {
  open: boolean; onClose: () => void; inspectionId: string; previous: RoomInfo | null; knownBuildings: string[];
  onCreated: (locationId: string, building: string) => void;
  /** Rooms already defined at this facility (name + id) for suggestions. */
  facilityRooms?: { id: string; name: string; building: string; inInspection: boolean }[];
  onUseExisting?: (locationId: string) => void;
}) {
  const createRoom = useStore((s) => s.createRoomForInspection);
  const [nameFocused, setNameFocused] = useState(false);
  const blank = { name: "", building: "", humidity: "", ambientTemp: "", backgroundTemp: "" };
  const [v, setV] = useState(blank);
  const [copy, setCopy] = useState(true);
  const fill = (withCopy: boolean) => ({
    ...blank,
    building: previous?.location.building ?? "",
    ...(withCopy && previous ? { humidity: previous.room.humidity, ambientTemp: previous.room.ambientTemp, backgroundTemp: previous.room.backgroundTemp } : {}),
  });
  useOnOpen(open, () => { setCopy(!!previous); setV(fill(!!previous)); });
  const toggleCopy = () => {
    const next = !copy;
    setCopy(next);
    setV((cur) => ({ ...cur, ...(next && previous
      ? { humidity: previous.room.humidity, ambientTemp: previous.room.ambientTemp, backgroundTemp: previous.room.backgroundTemp }
      : { humidity: "", ambientTemp: "", backgroundTemp: "" }) }));
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!v.name.trim()) return;
    const building = v.building.trim();
    const locationId = createRoom(inspectionId, { name: v.name.trim(), building, area: "" },
      { humidity: v.humidity, ambientTemp: v.ambientTemp, backgroundTemp: v.backgroundTemp });
    onCreated(locationId, building);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add Room"
      footer={<Button variant="primary" size="lg" className="h-12 w-full justify-center text-base" onClick={() => submit()} disabled={!v.name.trim()}><Check className="h-5 w-5" />Save Room &amp; Start Entry</Button>}>
      <form onSubmit={submit} className="space-y-4">
        <label htmlFor="room-name" className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Room Name</span>
          <input id="room-name" autoFocus enterKeyHint="next" autoComplete="off" autoCapitalize="words" placeholder="Type elec, mech, mcc…" value={v.name}
            onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)}
            onChange={(e) => setV({ ...v, name: e.target.value })} className={cn(bigInput, "text-lg font-medium")} />
        </label>
        {(() => {
          const sugg = nameFocused ? roomSuggestions(v.name, facilityRooms.map((r) => r.name)) : [];
          const exact = facilityRooms.find((r) => r.name.trim().toLowerCase() === v.name.trim().toLowerCase() && r.building.trim().toLowerCase() === v.building.trim().toLowerCase());
          return (
            <>
              {sugg.length ? (
                <div className="-mt-2 flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label="Room suggestions">
                  {sugg.map((sg) => {
                    const existingRoom = sg.existing ? facilityRooms.find((r) => r.name === sg.label) : undefined;
                    return (
                      <button key={sg.label} type="button" role="option" aria-selected="false" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (existingRoom && onUseExisting && !existingRoom.inInspection) { onUseExisting(existingRoom.id); return; }
                          setV({ ...v, name: `${sg.label}${/\d$/.test(sg.label) || sg.existing ? "" : " "}` });
                        }}
                        className={cn("h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium", existingRoom ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-200 bg-slate-50 text-slate-700")}>
                        {sg.label}{existingRoom ? (existingRoom.inInspection ? " (in use)" : " (existing room)") : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {exact ? <p className="-mt-2 text-xs text-sky-800">A room named {exact.name} already exists at this facility{exact.inInspection ? " and is in this inspection" : ""}. Saving creates a separate room with the same name; use a number (e.g. {exact.name} 2) if it is a different room.</p> : null}
            </>
          );
        })()}
        {previous ? (
          <button type="button" onClick={toggleCopy} className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm", copy ? "border-thermal-300 bg-thermal-50 text-thermal-900" : "border-slate-200 text-slate-600")}>
            <Copy className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1"><span className="font-medium">Copy conditions from {previous.location.name}</span><br /><span className="text-xs opacity-80">{conditionSummary(previous.room)}</span></span>
            <span className={cn("flex h-5 w-5 items-center justify-center rounded border", copy ? "border-thermal-600 bg-thermal-600 text-white" : "border-slate-300")}>{copy ? <Check className="h-3.5 w-3.5" /> : null}</span>
          </button>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <NumField id="room-h" label="Humidity" unit="%" value={v.humidity} onChange={(x) => setV({ ...v, humidity: x })} />
          <NumField id="room-amb" label="Ambient" unit="°F" value={v.ambientTemp} onChange={(x) => setV({ ...v, ambientTemp: x })} />
          <NumField id="room-bg" label="Background" unit="°F" value={v.backgroundTemp} onChange={(x) => setV({ ...v, backgroundTemp: x })} />
        </div>
        <label htmlFor="room-bldg" className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Building <span className="font-normal text-slate-400">(optional, for multi-building sites)</span></span>
          <input id="room-bldg" list="room-buildings" autoComplete="off" placeholder="e.g. Building A" value={v.building} onChange={(e) => setV({ ...v, building: e.target.value })} className={bigInput} />
          <datalist id="room-buildings">{knownBuildings.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  );
}

/** Room switcher: inspection rooms first, then other facility rooms not yet visited. */
export function RoomPickerSheet({ open, onClose, rooms, selected, onSelect, onAddRoom, otherRooms, onAddExisting, total }: {
  open: boolean; onClose: () => void; rooms: RoomInfo[]; selected: string; onSelect: (id: string) => void; onAddRoom: () => void;
  otherRooms: Location[]; onAddExisting: (locationId: string) => void; total: number;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Switch Room" subtitle={`${rooms.length} rooms in this inspection`}
      footer={<Button variant="primary" size="lg" className="h-12 w-full justify-center text-base" onClick={onAddRoom}><Plus className="h-5 w-5" />Add Room</Button>}>
      <ul className="-mx-2 space-y-1">
        {rooms.map((r) => (
          <li key={r.location.id}>
            <button onClick={() => onSelect(r.location.id)} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left", selected === r.location.id ? "bg-thermal-50 ring-1 ring-thermal-300" : "hover:bg-slate-50 active:bg-slate-100")}>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", conditionsComplete(r.room) ? "bg-emerald-500" : "bg-amber-400")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium text-slate-900">{locationLabel(r.location)}</span>
                <span className="block truncate text-xs text-slate-500">{conditionSummary(r.room)}</span>
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{r.count}</span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </button>
          </li>
        ))}
        <li>
          <button onClick={() => onSelect("all")} className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm", selected === "all" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}>
            <span className="flex-1 font-medium">All rooms</span><span className="tabular-nums">{total}</span>
          </button>
        </li>
      </ul>
      {otherRooms.length ? (
        <div className="mt-5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Other rooms at this facility</div>
          <ul className="-mx-2 space-y-1">
            {otherRooms.map((l) => (
              <li key={l.id}>
                <button onClick={() => onAddExisting(l.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-slate-50">
                  <Plus className="h-4 w-4 text-slate-400" /><span className="flex-1 truncate text-sm text-slate-700">{locationLabel(l)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Edit the current room's conditions and name. Changes save as you type. */
export function RoomConditionsSheet({ open, onClose, info, inspectionDate, knownBuildings }: {
  open: boolean; onClose: () => void; info: RoomInfo | null; inspectionDate: string; knownBuildings: string[];
}) {
  const update = useStore((s) => s.updateRoomConditions);
  const updateLocation = useStore((s) => s.updateLocation);
  const [v, setV] = useState({ humidity: "", ambientTemp: "", backgroundTemp: "", name: "", building: "", imageDate: "" });
  useOnOpen(open, () => info && setV({ humidity: info.room.humidity, ambientTemp: info.room.ambientTemp, backgroundTemp: info.room.backgroundTemp, name: info.location.name, building: info.location.building, imageDate: info.room.imageDate || inspectionDate }));
  if (!info) return null;
  const setCond = (k: "humidity" | "ambientTemp" | "backgroundTemp", x: string) => { setV({ ...v, [k]: x }); update(info.room.id, { [k]: x }); };
  return (
    <Sheet open={open} onClose={onClose} title="Room Conditions" subtitle={`Carries down to ${info.count} item${info.count === 1 ? "" : "s"} unless a row overrides it`}
      footer={<Button variant="primary" size="lg" className="h-12 w-full justify-center text-base" onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <NumField id="rc-h" label="Humidity" unit="%" value={v.humidity} onChange={(x) => setCond("humidity", x)} />
          <NumField id="rc-amb" label="Ambient" unit="°F" value={v.ambientTemp} onChange={(x) => setCond("ambientTemp", x)} />
          <NumField id="rc-bg" label="Background" unit="°F" value={v.backgroundTemp} onChange={(x) => setCond("backgroundTemp", x)} />
        </div>
        <label className="block" htmlFor="rc-date">
          <span className="mb-1 block text-sm font-medium text-slate-700">Image Date</span>
          <input id="rc-date" type="date" className={bigInput} value={v.imageDate} onChange={(e) => { setV({ ...v, imageDate: e.target.value }); update(info.room.id, { imageDate: e.target.value === inspectionDate ? "" : e.target.value }); }} />
        </label>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
          <label className="block" htmlFor="rc-name">
            <span className="mb-1 block text-sm font-medium text-slate-700">Room name</span>
            <input id="rc-name" className={bigInput} value={v.name} onChange={(e) => { setV({ ...v, name: e.target.value }); if (e.target.value.trim()) updateLocation(info.location.id, { name: e.target.value }); }} />
          </label>
          <label className="block" htmlFor="rc-bldg">
            <span className="mb-1 block text-sm font-medium text-slate-700">Building</span>
            <input id="rc-bldg" list="rc-buildings" className={bigInput} value={v.building} onChange={(e) => { setV({ ...v, building: e.target.value }); updateLocation(info.location.id, { building: e.target.value }); }} />
            <datalist id="rc-buildings">{knownBuildings.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
        </div>
      </div>
    </Sheet>
  );
}
