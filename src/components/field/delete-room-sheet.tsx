"use client";

import { useState } from "react";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { MoveToRoomSheet } from "@/components/field/move-room-sheet";
import { conditionSummary } from "@/components/field/room-sheets";
import { isInspectionLocked, useStore } from "@/lib/store/store";
import { locationLabel } from "@/lib/domain/csv";
import { activeRooms, planRoomRemoval, removalSummary } from "@/lib/domain/room-moves";

/**
 * Delete a room (facility inventory and Field Mode). Uninspected equipment goes with it in one
 * confirmation; equipment with inspection work is listed and can be moved from here first.
 * Everything removed can be put back with Undo.
 */
export function DeleteRoomSheet({ open, onClose, locationId, onDeleted }: {
  open: boolean; onClose: () => void; locationId: string; onDeleted?: () => void;
}) {
  const s = useStore();
  const [moving, setMoving] = useState<string | null>(null);
  const location = s.locations.find((l) => l.id === locationId);
  if (!location) return null;
  const label = locationLabel(location);
  const plan = planRoomRemoval({ ...s, isLocked: isInspectionLocked }, locationId);
  const uninspected = plan.kind === "blocked" ? planUninspectedCount(s, locationId, plan.protectedItems.map((p) => p.equipment.id)) : plan.deleteEquipment.length;

  const remove = () => {
    const { plan: done, undo } = s.removeRoom(locationId);
    if (done.kind === "blocked") return; // the list above updates; nothing was changed
    const what = done.kind === "archive" ? "archived" : "deleted";
    const n = done.deleteEquipment.length;
    toast(`${label} ${what}${n ? ` with ${n} uninspected item${n === 1 ? "" : "s"}` : ""}`, "success",
      undo ? { label: "Undo", onClick: () => { useStore.getState().undoRoomRemoval(undo); toast(`${label} restored`); } } : undefined);
    onDeleted?.();
    onClose();
  };

  return (
    <>
      {moving ? <MoveToRoomSheet open onClose={() => setMoving(null)} equipmentId={moving} fromLocationId={locationId} /> : null}
      <Sheet open={open && !moving} onClose={onClose} title={`Delete ${label}`}
        footer={<div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-12 justify-center" onClick={onClose}>Cancel</Button>
          <Button size="lg" variant="danger" className="h-12 justify-center" disabled={plan.kind === "blocked"} onClick={remove} data-testid="confirm-delete-room">
            <Trash2 className="h-4 w-4" />{plan.kind === "archive" ? "Delete (Archive) Room" : "Delete Room"}
          </Button>
        </div>}>
        <div className="space-y-3 text-sm text-slate-700" data-testid="delete-room-dialog">
          {plan.kind === "blocked" ? (
            <>
              <p className="font-medium text-amber-900">{plan.reason}</p>
              <ul className="space-y-1.5" data-testid="protected-items">
                {plan.protectedItems.map((p) => (
                  <li key={p.equipment.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-900">{p.equipment.name}</span>
                      <span className="block truncate text-xs text-slate-600">{p.reasons.join(" · ")}</span>
                    </span>
                    <Button size="sm" className="h-10 shrink-0" onClick={() => setMoving(p.equipment.id)} data-testid="protected-move"><ArrowRightLeft className="h-3.5 w-3.5" />Move</Button>
                  </li>
                ))}
              </ul>
              <MoveAllProtected fromLocationId={locationId} facilityId={location.facilityId} equipmentIds={plan.protectedItems.map((p) => p.equipment.id)} />
              {uninspected ? <p className="text-slate-600">After that, the room and its {uninspected} uninspected item{uninspected === 1 ? "" : "s"} can be deleted together.</p> : null}
            </>
          ) : (
            <>
              <p className="text-base font-medium text-slate-900" data-testid="delete-room-summary">
                {plan.deleteEquipment.length ? removalSummary(plan) : `Delete ${label}? It has no uninspected equipment.`}
              </p>
              {plan.deleteEquipment.length ? (
                <p className="text-xs text-slate-500">{plan.deleteEquipment.slice(0, 12).map((e) => e.name).join(", ")}{plan.deleteEquipment.length > 12 ? ` and ${plan.deleteEquipment.length - 12} more` : ""}</p>
              ) : null}
              {plan.measuredConditions.length ? <p>The room conditions entered for it ({plan.measuredConditions.map((c) => conditionSummary(c)).join("; ")}) are removed too.</p> : null}
              {plan.kind === "archive" ? (
                <p className="text-slate-600">
                  {plan.historicalInspectionCount === 1 ? "An approved report uses" : `${plan.historicalInspectionCount} approved reports use`} this room, so it is archived: those reports keep the room
                  {plan.retireEquipment.length ? ` and ${plan.retireEquipment.length === 1 ? "its equipment" : `${plan.retireEquipment.length} equipment items`} (retired, not deleted)` : ""}.
                </p>
              ) : null}
              <p className="text-xs text-slate-500">You can undo this right after deleting.</p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

/** Items that will go with the room once the protected ones are moved. */
function planUninspectedCount(s: ReturnType<typeof useStore.getState>, locationId: string, protectedIds: string[]): number {
  const keep = new Set(protectedIds);
  const history = new Set(s.results.filter((r) => isInspectionLocked(s.inspections.find((i) => i.id === r.inspectionId))).map((r) => r.equipmentId));
  return s.equipment.filter((e) => e.locationId === locationId && !keep.has(e.id) && !history.has(e.id)).length;
}

const NEW_ROOM = "__new__";
const selectCls = "h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900";

/**
 * Move every protected item to one room in a single step (existing room or a new one). Readings keep
 * the conditions they were measured under, so their exports do not change.
 */
function MoveAllProtected({ fromLocationId, facilityId, equipmentIds }: { fromLocationId: string; facilityId: string; equipmentIds: string[] }) {
  const s = useStore();
  const rooms = activeRooms(s.locations, facilityId).filter((l) => l.id !== fromLocationId);
  const [dest, setDest] = useState(rooms[0]?.id ?? NEW_ROOM);
  const [name, setName] = useState("");
  const n = equipmentIds.length;
  const duplicate = dest === NEW_ROOM && name.trim() ? activeRooms(s.locations, facilityId).find((l) => l.name.trim().toLowerCase() === name.trim().toLowerCase() && !l.building.trim()) : undefined;
  const ready = dest === NEW_ROOM ? !!name.trim() && !duplicate : rooms.some((l) => l.id === dest);
  const moveAll = () => {
    if (!ready) return;
    const st = useStore.getState();
    const to = dest === NEW_ROOM ? st.createLocation({ facilityId, building: "", name: name.trim(), area: "" }) : dest;
    let moved = 0;
    for (const id of equipmentIds) if (useStore.getState().moveEquipmentToRoom(id, to, { keepRecordedConditions: true })) moved++;
    const label = locationLabel(useStore.getState().locations.find((l) => l.id === to));
    toast(`Moved ${moved} item${moved === 1 ? "" : "s"} to ${label}`);
  };
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="move-all">
      <div className="font-semibold text-slate-900">Move {n === 1 ? "this item" : `all ${n} items`} to</div>
      <select aria-label="Destination room" className={selectCls} value={dest} onChange={(e) => setDest(e.target.value)} data-testid="move-all-dest">
        {rooms.map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
        <option value={NEW_ROOM}>New room…</option>
      </select>
      {dest === NEW_ROOM ? (
        <input aria-label="New room name" placeholder="New room name" autoComplete="off" autoCapitalize="words" className={selectCls} value={name} onChange={(e) => setName(e.target.value)} data-testid="move-all-new-name" />
      ) : null}
      {duplicate ? <p className="text-xs text-amber-900">{locationLabel(duplicate)} already exists. Choose it from the list.</p> : null}
      <p className="text-xs text-slate-500">Readings keep the room conditions they were measured under.</p>
      <Button size="lg" className="h-12 w-full justify-center" disabled={!ready} onClick={moveAll} data-testid="move-all-confirm">
        <ArrowRightLeft className="h-4 w-4" />Move {n === 1 ? "Item" : `${n} Items`}
      </Button>
    </div>
  );
}

