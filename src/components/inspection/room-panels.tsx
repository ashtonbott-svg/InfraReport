"use client";

import { useDraft } from "@/lib/use-draft";
import { Plus, Thermometer, Droplets, Ruler, CalendarDays, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
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
