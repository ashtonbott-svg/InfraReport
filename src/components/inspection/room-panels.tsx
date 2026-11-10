"use client";

import { useRef, useState } from "react";
import { useDraft, useOnOpen } from "@/lib/use-draft";
import { Plus, Thermometer, Droplets, Ruler, CalendarDays, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { locationLabel } from "@/lib/domain/csv";
import { isNumericText } from "@/lib/domain/rules";
import type { InspectionResult, InspectionRoomConditions, Location } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";

export interface RoomEntry {
  room: InspectionRoomConditions;
  location: Location;
  count: number;
}

export function RoomRail({ rooms, selected, onSelect, onAdd, total }: {
  rooms: RoomEntry[]; selected: string; onSelect: (id: string) => void; onAdd: () => void; total: number;
}) {
  const groups = new Map<string, RoomEntry[]>();
  for (const r of rooms) {
    const k = r.location.building || "Rooms";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const complete = (r: InspectionRoomConditions) => r.humidity !== "" && r.ambientTemp !== "" && r.backgroundTemp !== "";
  return (
    <>
      {/* Mobile / tablet: compact selector */}
      <div className="flex gap-2 2xl:hidden">
        <Select value={selected} onChange={(e) => onSelect(e.target.value)} aria-label="Select room">
          <option value="all">All rooms ({total})</option>
          {rooms.map((r) => <option key={r.location.id} value={r.location.id}>{locationLabel(r.location)} ({r.count})</option>)}
        </Select>
        <Button onClick={onAdd}><Plus className="h-4 w-4" />Room</Button>
      </div>
      {/* Desktop rail */}
      <Card className="hidden h-fit 2xl:block">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rooms</span>
          <Button size="sm" variant="ghost" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add</Button>
        </div>
        <div className="p-2">
          <button onClick={() => onSelect("all")} className={cn("flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm", selected === "all" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100")}>
            <span className="font-medium">All rooms</span><span className="text-xs tabular-nums opacity-70">{total}</span>
          </button>
          {[...groups.entries()].map(([g, list]) => (
            <div key={g} className="mt-2">
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</div>
              {list.map((r) => (
                <button key={r.location.id} onClick={() => onSelect(r.location.id)}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm", selected === r.location.id ? "bg-thermal-50 text-thermal-900 ring-1 ring-inset ring-thermal-200" : "text-slate-700 hover:bg-slate-100")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", complete(r.room) ? "bg-emerald-500" : "bg-amber-400")} title={complete(r.room) ? "Conditions entered" : "Conditions incomplete"} />
                    <span className="truncate">{r.location.name}</span>
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">{r.count}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function CondInput({ label, icon, value, onCommit, suffix, id, type = "text" }: {
  label: string; icon: React.ReactNode; value: string; onCommit: (v: string) => void; suffix?: string; id: string; type?: string;
}) {
  const [v, setV] = useDraft(value);
  const bad = type !== "date" && v !== "" && !isNumericText(v.replace(/\s*(%|ft|°f|f)$/i, ""));
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">{icon}{label}</label>
      <div className="relative">
        <Input id={id} type={type} inputMode={type === "date" ? undefined : "decimal"} value={v}
          className={cn("pr-8 tabular-nums", bad && "border-red-400 focus:border-red-500 focus:ring-red-500/20")}
          onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
        {suffix ? <span className="pointer-events-none absolute right-2.5 top-2 text-xs text-slate-400">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function RoomConditionsCard({ entry, results, inspectionDate }: { entry: RoomEntry; results: InspectionResult[]; inspectionDate: string }) {
  const update = useStore((s) => s.updateRoomConditions);
  const { room, location } = entry;
  const overrides = results.filter((r) => Object.values(r.overrides).some((v) => v !== null)).length;
  const commit = (key: keyof InspectionRoomConditions) => (v: string) => update(room.id, { [key]: v });
  return (
    <Card className="border-l-4 border-l-thermal-500">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{locationLabel(location)}</h2>
          <p className="text-xs text-slate-500">Room conditions carry down to {results.length} item{results.length === 1 ? "" : "s"}{overrides ? ` · ${overrides} with row overrides` : ""}.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-3 sm:grid-cols-3 xl:grid-cols-5">
        <CondInput id={`h-${room.id}`} label="Humidity" icon={<Droplets className="h-3.5 w-3.5" />} suffix="%" value={room.humidity} onCommit={commit("humidity")} />
        <CondInput id={`a-${room.id}`} label="Ambient Temp" icon={<Thermometer className="h-3.5 w-3.5" />} suffix="°F" value={room.ambientTemp} onCommit={commit("ambientTemp")} />
        <CondInput id={`b-${room.id}`} label="Background Temp" icon={<Wind className="h-3.5 w-3.5" />} suffix="°F" value={room.backgroundTemp} onCommit={commit("backgroundTemp")} />
        <CondInput id={`d-${room.id}`} label="Default Distance" icon={<Ruler className="h-3.5 w-3.5" />} suffix="ft" value={room.distance} onCommit={commit("distance")} />
        <CondInput id={`i-${room.id}`} label={`Image Date${room.imageDate ? "" : " (insp. date)"}`} icon={<CalendarDays className="h-3.5 w-3.5" />} type="date" value={room.imageDate || inspectionDate} onCommit={(v) => update(room.id, { imageDate: v === inspectionDate ? "" : v })} />
      </div>
    </Card>
  );
}

export function AddRoomModal({ open, onClose, inspectionId, facilityId, usedLocationIds, onAdded }: {
  open: boolean; onClose: () => void; inspectionId: string; facilityId: string; usedLocationIds: Set<string>; onAdded: (locationId: string) => void;
}) {
  const locations = useStore((s) => s.locations);
  const addRoomToInspection = useStore((s) => s.addRoomToInspection);
  const createRoom = useStore((s) => s.createRoomForInspection);
  const available = locations.filter((l) => l.facilityId === facilityId && !usedLocationIds.has(l.id));
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existing, setExisting] = useState("");
  const [v, setV] = useState({ name: "", building: "", area: "", humidity: "", ambientTemp: "", backgroundTemp: "", distance: "" });
  const nameRef = useRef<HTMLInputElement>(null);
  useOnOpen(open, () => {
    setMode("new");
    setExisting("");
    setV((p) => ({ name: "", building: p.building, area: "", humidity: "", ambientTemp: "", backgroundTemp: "", distance: "" }));
  });

  const valid = mode === "new" ? v.name.trim() !== "" : existing !== "";
  const submit = () => {
    if (!valid) return;
    let locationId = existing;
    const cond = { humidity: v.humidity, ambientTemp: v.ambientTemp, backgroundTemp: v.backgroundTemp, distance: v.distance };
    if (mode === "new") {
      locationId = createRoom(inspectionId, { name: v.name.trim(), building: v.building.trim(), area: v.area.trim() }, cond);
    } else {
      const rcId = addRoomToInspection(inspectionId, existing);
      useStore.getState().updateRoomConditions(rcId, cond);
    }
    toast("Room added");
    onAdded(locationId);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add room to inspection" description="Enter the environmental conditions once. Every item in the room inherits them."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!valid}>Add room</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        {available.length > 0 ? (
          <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-sm">
            {(["new", "existing"] as const).map((m) => (
              <button type="button" key={m} onClick={() => setMode(m)} className={cn("flex-1 rounded px-3 py-1.5 font-medium", mode === m ? "bg-white shadow-sm" : "text-slate-500")}>
                {m === "new" ? "New room" : `Existing room (${available.length})`}
              </button>
            ))}
          </div>
        ) : null}
        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Room name *" className="sm:col-span-2" htmlFor="ar-name"><Input ref={nameRef} id="ar-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Electrical Room 1" /></Field>
            <Field label="Building" htmlFor="ar-b"><Input id="ar-b" value={v.building} onChange={(e) => setV({ ...v, building: e.target.value })} placeholder="Optional" /></Field>
            <Field label="Area / floor" htmlFor="ar-a"><Input id="ar-a" value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })} placeholder="Optional" /></Field>
          </div>
        ) : (
          <Field label="Facility room" htmlFor="ar-ex">
            <Select id="ar-ex" value={existing} onChange={(e) => setExisting(e.target.value)}>
              <option value="">Select…</option>
              {available.map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Humidity" htmlFor="ar-h"><Input id="ar-h" inputMode="decimal" value={v.humidity} onChange={(e) => setV({ ...v, humidity: e.target.value })} placeholder="%" /></Field>
          <Field label="Ambient" htmlFor="ar-am"><Input id="ar-am" inputMode="decimal" value={v.ambientTemp} onChange={(e) => setV({ ...v, ambientTemp: e.target.value })} placeholder="°F" /></Field>
          <Field label="Background" htmlFor="ar-bg"><Input id="ar-bg" inputMode="decimal" value={v.backgroundTemp} onChange={(e) => setV({ ...v, backgroundTemp: e.target.value })} placeholder="°F" /></Field>
          <Field label="Distance" htmlFor="ar-d"><Input id="ar-d" inputMode="decimal" value={v.distance} onChange={(e) => setV({ ...v, distance: e.target.value })} placeholder="ft" /></Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
