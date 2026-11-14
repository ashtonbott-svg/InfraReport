"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Copy, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useStore } from "@/lib/store/store";
import { useOnOpen } from "@/lib/use-draft";
import { checkRoom, conditionStatus, resultStatus, roomProgress } from "@/lib/domain/thermal";
import { isNumericText, normalizeNumericInput } from "@/lib/domain/rules";
import type { Equipment, InspectionResult, InspectionRoomConditions, Location } from "@/lib/domain/types";

export interface CheckpointItem { result: InspectionResult; equipment: Equipment | undefined }

/**
 * Prominent room conditions status, shown under the current room.
 * Humidity is required; ambient and background are shown when missing.
 */
export function RoomStatusBanner({ room, onEdit }: { room: InspectionRoomConditions; onEdit: () => void }) {
  const confirm = useStore((s) => s.confirmRoomConditions);
  const c = conditionStatus(room);
  if (c.complete) return null;
  if (c.humidityMissing) {
    return (
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 rounded-xl border-2 border-red-400 bg-red-50 px-3 py-3 text-left" data-testid="room-status">
        <Droplets className="h-6 w-6 shrink-0 text-red-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-red-900">Room Conditions Incomplete</span>
          <span className="block text-sm font-medium text-red-800">Humidity required{c.missing.length > 1 ? ` · ${c.missing.slice(1).join(", ")} missing` : ""}</span>
        </span>
        <span className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white">Enter</span>
      </button>
    );
  }
  if (c.copiedFrom) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-3" data-testid="room-status">
        <Copy className="h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-bold text-amber-950">Conditions copied from {c.copiedFrom}</div>
          <div className="text-amber-900">{room.humidity}% RH · {room.ambientTemp || "?"}° amb · {room.backgroundTemp || "?"}° bg. Confirm they were measured here.</div>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button variant="dark" className="h-9" onClick={() => { confirm(room.id); toast("Conditions confirmed for this room"); }}>Confirm</Button>
          <Button className="h-9" onClick={onEdit}>Update</Button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-left" data-testid="room-status">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
      <span className="flex-1 text-sm"><span className="font-semibold text-amber-950">{c.missing.join(" and ")} missing</span><span className="text-amber-900"> · humidity recorded</span></span>
      <span className="text-sm font-semibold text-amber-900">Enter</span>
    </button>
  );
}

function CondField({ id, label, value, missing, required, onChange }: { id: string; label: string; value: string; missing: boolean; required?: boolean; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} className="block">
      <span className={cn("mb-1 block text-xs font-semibold", missing ? (required ? "text-red-800" : "text-amber-800") : "text-slate-700")}>{label}{missing ? (required ? " *" : " (missing)") : ""}</span>
      <input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)}
        className={cn("h-12 w-full rounded-lg border-2 bg-white px-2 text-lg font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-thermal-500/20", missing && required ? "border-red-400" : "border-slate-300")} />
    </label>
  );
}

const STATUS_TEXT = { todo: "To do", recorded: "Done", "not-scanned": "Not scanned", deferred: "Deferred" } as const;

/**
 * Room completion checkpoint: humidity (enter it right here), copied
 * conditions confirmation, and every equipment item addressed.
 */
export function RoomCheckpoint({ open, onClose, room, location, items, nextRoom, onGoToItem, onNextRoom }: {
  open: boolean; onClose: () => void; room: InspectionRoomConditions; location: Location; items: CheckpointItem[];
  nextRoom: Location | null; onGoToItem: (resultId: string) => void; onNextRoom: () => void;
}) {
  const update = useStore((s) => s.updateRoomConditions);
  const confirmConditions = useStore((s) => s.confirmRoomConditions);
  const finishRoom = useStore((s) => s.finishRoom);
  // Start from the saved values (this sheet is usually mounted already open).
  const [h, setH] = useState(room.humidity);
  const [amb, setAmb] = useState(room.ambientTemp);
  const [bg, setBg] = useState(room.backgroundTemp);
  useOnOpen(open, () => { setH(room.humidity); setAmb(room.ambientTemp); setBg(room.backgroundTemp); });

  const results = items.map((i) => i.result);
  const progress = roomProgress(results);
  const deferred = items.filter((i) => resultStatus(i.result) === "deferred");
  const c = conditionStatus(room);
  const hValid = isNumericText(normalizeNumericInput(h)) && Number(normalizeNumericInput(h)) >= 0 && Number(normalizeNumericInput(h)) <= 100;

  // Each field saves as it is typed; nothing is written from stale local state.
  const saveConditions = () => undefined;
  const finish = (goNext: boolean) => {
    saveConditions();
    if (!finishRoom(room.id)) { toast("Room is not ready to finish yet", "error"); return; }
    toast(`${location.name} finished`);
    if (goNext && nextRoom) onNextRoom(); else onClose();
  };
  const leaveUnfinished = () => { saveConditions(); onNextRoom(); };
  const finishedAlready = !!room.completedAt;

  return (
    <Sheet open={open} onClose={() => { saveConditions(); onClose(); }} title={finishedAlready ? `${location.name} finished` : `Finish ${location.name}?`}
      subtitle={`${progress.total} equipment · ${progress.done} done · ${progress.remaining.length} remaining`}
      footer={
        <div className="grid gap-2">
          {finishedAlready ? (
            nextRoom ? <Button variant="primary" size="lg" className="h-14 justify-center text-base" onClick={onNextRoom}>Next Room: {nextRoom.name}<ArrowRight className="h-5 w-5" /></Button>
              : <Button variant="primary" size="lg" className="h-14 justify-center text-base" onClick={onClose}>Done</Button>
          ) : (
            <Button variant="primary" size="lg" className="h-14 justify-center text-base" data-testid="finish-room"
              disabled={!(hValid && !c.copiedFrom && progress.remaining.length === 0)} onClick={() => finish(true)}>
              <CheckCircle2 className="h-5 w-5" />{nextRoom ? `Finish Room & Go to ${nextRoom.name}` : "Finish Room"}
            </Button>
          )}
          {!finishedAlready && nextRoom && progress.remaining.length > 0 ? (
            <Button size="lg" className="h-12 justify-center" disabled={!hValid} onClick={leaveUnfinished} data-testid="leave-unfinished">
              Leave Room Unfinished, Go to {nextRoom.name}
            </Button>
          ) : null}
          <Button variant="ghost" className="h-11 justify-center" onClick={() => { saveConditions(); onClose(); }}>Keep Working Here</Button>
        </div>
      }>
      <div className="space-y-4">
        {/* Conditions */}
        <section className={cn("rounded-xl border-2 p-3", !hValid ? "border-red-400 bg-red-50" : c.copiedFrom ? "border-amber-400 bg-amber-50" : "border-emerald-300 bg-emerald-50")}>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold">
            {!hValid ? <><Droplets className="h-5 w-5 text-red-600" /><span className="text-red-900">Humidity required for this room</span></>
              : c.copiedFrom ? <><Copy className="h-5 w-5 text-amber-700" /><span className="text-amber-950">Copied from {c.copiedFrom}: confirm or update</span></>
              : <><CheckCircle2 className="h-5 w-5 text-emerald-600" /><span className="text-emerald-900">Room conditions recorded</span></>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <CondField id="cp-h" label="Humidity %" value={h} missing={!hValid} required onChange={(v) => { setH(v); update(room.id, { humidity: v }); }} />
            <CondField id="cp-amb" label="Ambient °F" value={amb} missing={!amb.trim()} onChange={(v) => { setAmb(v); update(room.id, { ambientTemp: v }); }} />
            <CondField id="cp-bg" label="Background °F" value={bg} missing={!bg.trim()} onChange={(v) => { setBg(v); update(room.id, { backgroundTemp: v }); }} />
          </div>
          {c.copiedFrom && hValid ? <Button variant="dark" className="mt-3 h-11 w-full justify-center" onClick={() => { saveConditions(); confirmConditions(room.id); }}>Confirm: Measured in {location.name}</Button> : null}
        </section>

        {/* Equipment */}
        <section>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-bold text-slate-900">{progress.remaining.length ? `${progress.remaining.length} Equipment Item${progress.remaining.length === 1 ? "" : "s"} Remaining` : "All equipment addressed"}</span>
            <span className="tabular-nums text-slate-500">{progress.done} of {progress.total}</span>
          </div>
          {progress.remaining.length ? (
            <ul className="space-y-1.5" data-testid="remaining-items">
              {items.filter((i) => resultStatus(i.result) === "todo").map((i) => (
                <li key={i.result.id}>
                  <button type="button" onClick={() => onGoToItem(i.result.id)} className="flex min-h-12 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left active:bg-slate-50">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                    <span className="flex-1 truncate text-base font-medium text-slate-900">{i.equipment?.name ?? "(unnamed)"}</span>
                    <span className="text-xs text-slate-500">{STATUS_TEXT.todo}</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Every item has an image number or is documented as not scanned. Finishing also confirms this room&apos;s equipment list is complete.</p>
          )}
          {deferred.length ? (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Deferred (come back): {deferred.map((d) => d.equipment?.name).join(", ")}
            </div>
          ) : null}
          {progress.remaining.length ? <p className="mt-2 text-xs text-slate-500">Items that cannot be scanned: open them and use &quot;Can&apos;t scan this item?&quot; No fake image numbers needed.</p> : null}
        </section>
      </div>
    </Sheet>
  );
}

export { checkRoom };
