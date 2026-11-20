"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Check, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useOnOpen } from "@/lib/use-draft";
import { isInspectionLocked, useStore } from "@/lib/store/store";
import { locationLabel } from "@/lib/domain/csv";
import { activeRooms, planEquipmentMove } from "@/lib/domain/room-moves";
import type { Location } from "@/lib/domain/types";

const bigInput = "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-heat-500 focus:outline-none focus:ring-2 focus:ring-heat-500/20";
const NEW = "__new__";
const LABEL: Record<string, string> = { humidity: "Humidity", ambientTemp: "Ambient", backgroundTemp: "Background", imageDate: "Image date" };
const unit = (k: string) => (k === "humidity" ? "%" : k === "imageDate" ? "" : "°");
const norm = (v: string) => v.trim().toLowerCase();

/**
 * Move an item of equipment to another room of the same facility (or a new room).
 * Shows what moves with it and asks, when readings were already taken, which room
 * conditions belong to them. Nothing changes until "Move" is pressed.
 */
export function MoveToRoomSheet({ open, onClose, equipmentId, onMoved }: {
  open: boolean; onClose: () => void; equipmentId: string; onMoved?: (toLocationId: string) => void;
}) {
  const s = useStore();
  const equipment = s.equipment.find((e) => e.id === equipmentId);
  const current = s.locations.find((l) => l.id === equipment?.locationId);
  const rooms = useMemo(() => (equipment ? activeRooms(s.locations, equipment.facilityId).filter((l) => l.id !== equipment.locationId) : []), [s.locations, equipment]);
  const [dest, setDest] = useState("");
  const [room, setRoom] = useState({ name: "", building: "" });
  const [keep, setKeep] = useState<boolean | null>(null);
  useOnOpen(open, () => { setDest(""); setRoom({ name: "", building: current?.building ?? "" }); setKeep(null); });
  if (!equipment) return null;

  const duplicate = dest === NEW && room.name.trim()
    ? activeRooms(s.locations, equipment.facilityId).find((l) => norm(l.name) === norm(room.name) && norm(l.building) === norm(room.building))
    : undefined;
  const draft: Location | null = dest === NEW
    ? (room.name.trim() && !duplicate ? { id: NEW, organizationId: equipment.organizationId, facilityId: equipment.facilityId, building: room.building.trim(), name: room.name.trim(), area: "", sortOrder: 0 } : null)
    : rooms.find((l) => l.id === dest) ?? null;
  const plan = draft ? planEquipmentMove({ ...s, locations: draft.id === NEW ? [...s.locations, draft] : s.locations, isLocked: isInspectionLocked }, equipment.id, draft.id) : null;
  const differs = plan?.lines.filter((l) => l.changedConditions.length > 0) ?? [];
  const fromName = current ? locationLabel(current) : "the current room";
  const toName = draft ? locationLabel(draft) : "";
  const ready = !!plan && (differs.length === 0 || keep !== null);

  const move = () => {
    if (!plan || !ready || !draft) return;
    const toId = draft.id === NEW ? s.createLocation({ facilityId: equipment.facilityId, building: draft.building, name: draft.name, area: "" }) : draft.id;
    const res = s.moveEquipmentToRoom(equipment.id, toId, { keepRecordedConditions: keep === true });
    if (!res) { toast("Equipment could not be moved", "error"); return; }
    toast(`${equipment.name} moved to ${toName}`);
    onMoved?.(toId);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Move to Room" subtitle={equipment.name}
      footer={<Button variant="primary" size="lg" className="h-12 w-full justify-center text-base" disabled={!ready} onClick={move} data-testid="move-confirm">
        <ArrowRightLeft className="h-5 w-5" />{draft ? `Move to ${toName}` : "Choose a room"}
      </Button>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="text-slate-600">Current room</span>
          <span className="min-w-0 flex-1 truncate text-right font-semibold text-slate-900" data-testid="move-current-room">{fromName}</span>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">Move to</div>
          <ul className="-mx-1 space-y-1" role="radiogroup" aria-label="Destination room">
            {rooms.map((l) => (
              <li key={l.id}>
                <button type="button" role="radio" aria-checked={dest === l.id} onClick={() => { setDest(l.id); setKeep(null); }}
                  className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left", dest === l.id ? "bg-thermal-50 ring-1 ring-thermal-300" : "hover:bg-slate-50 active:bg-slate-100")}>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", dest === l.id ? "border-thermal-600 bg-thermal-600 text-white" : "border-slate-300")}>{dest === l.id ? <Check className="h-3.5 w-3.5" /> : null}</span>
                  <span className="min-w-0 flex-1 truncate text-base text-slate-900">{locationLabel(l)}</span>
                  <span className="text-xs tabular-nums text-slate-400">{((n) => `${n} item${n === 1 ? "" : "s"}`)(s.equipment.filter((e) => e.locationId === l.id).length)}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" role="radio" aria-checked={dest === NEW} onClick={() => { setDest(NEW); setKeep(null); }} data-testid="move-new-room"
                className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left", dest === NEW ? "bg-thermal-50 ring-1 ring-thermal-300" : "hover:bg-slate-50 active:bg-slate-100")}>
                <Plus className="h-5 w-5 shrink-0 text-slate-500" /><span className="flex-1 text-base font-medium text-slate-800">New room</span>
              </button>
            </li>
          </ul>
          {rooms.length === 0 ? <p className="mt-1 text-xs text-slate-500">This facility has no other rooms yet. Create one.</p> : null}
        </div>

        {dest === NEW ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="move-room-name" className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Room name</span>
              <input id="move-room-name" autoFocus autoComplete="off" autoCapitalize="words" className={bigInput} value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
            </label>
            <label htmlFor="move-room-bldg" className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Building <span className="font-normal text-slate-400">(optional)</span></span>
              <input id="move-room-bldg" autoComplete="off" className={bigInput} value={room.building} onChange={(e) => setRoom({ ...room, building: e.target.value })} />
            </label>
            {duplicate ? (
              <p className="text-sm text-amber-900 sm:col-span-2">
                {duplicate.id === equipment.locationId ? `${locationLabel(duplicate)} is the current room.` : <>{locationLabel(duplicate)} already exists. <button type="button" className="font-semibold underline" onClick={() => setDest(duplicate.id)}>Choose it</button> instead of creating a second room with the same name.</>}
              </p>
            ) : null}
          </div>
        ) : null}

        {plan ? (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700" data-testid="move-summary">
            <p>The equipment keeps its readings, thermal images, notes, findings and photos.</p>
            {plan.lines.length ? <p>Its line in {plan.lines.length === 1 ? "the open inspection" : `${plan.lines.length} open inspections`} moves to {toName} and goes to the end of that room.</p> : null}
            {plan.lockedCount ? <p className="text-slate-500">{plan.lockedCount === 1 ? "An approved report keeps" : `${plan.lockedCount} approved reports keep`} {fromName}, where the item was inspected.</p> : null}
          </div>
        ) : null}

        {differs.length ? (
          <fieldset className="space-y-2" data-testid="move-conditions">
            <legend className="mb-1 text-sm font-semibold text-slate-900">Readings were already taken in {fromName}. Which room conditions belong to them?</legend>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              {differs[0].changedConditions.map((c) => (
                <div key={c.key} className="flex justify-between gap-2 tabular-nums"><span>{LABEL[c.key]}</span><span>{fromName}: {c.from}{unit(c.key)} · {toName}: {c.to ? `${c.to}${unit(c.key)}` : "not entered"}</span></div>
              ))}
            </div>
            {([[true, `Keep the conditions measured in ${fromName} for this item`, "Saved on the item as overrides, so its export does not change."],
              [false, `Use the ${toName} conditions`, "Choose this when the readings were really taken in the new room."]] as const).map(([v, title, hint]) => (
              <button key={String(v)} type="button" role="radio" aria-checked={keep === v} onClick={() => setKeep(v)} data-testid={v ? "move-keep-conditions" : "move-use-destination"}
                className={cn("flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left", keep === v ? "border-thermal-300 bg-thermal-50" : "border-slate-200")}>
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", keep === v ? "border-thermal-600 bg-thermal-600 text-white" : "border-slate-300")}>{keep === v ? <Check className="h-3.5 w-3.5" /> : null}</span>
                <span><span className="block text-sm font-medium text-slate-900">{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>
    </Sheet>
  );
}
