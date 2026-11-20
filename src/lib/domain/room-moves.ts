import { DEFAULT_OPENED, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import type { Equipment, Inspection, InspectionResult, InspectionRoomConditions, Location } from "@/lib/domain/types";

/** The part of the device store these plans read. */
export interface RoomData {
  /** Approved inspections are read only (isInspectionLocked from the store). */
  isLocked: (i: Inspection | undefined) => boolean;
  locations: Location[];
  equipment: Equipment[];
  inspections: Inspection[];
  rooms: InspectionRoomConditions[];
  results: InspectionResult[];
}

export const isArchived = (l: Pick<Location, "archivedAt"> | undefined) => !!l?.archivedAt;

/** Rooms of a facility that belong to the active inventory (archived rooms are only kept for history). */
export function activeRooms(locations: Location[], facilityId: string): Location[] {
  return locations.filter((l) => l.facilityId === facilityId && !isArchived(l)).sort((a, b) => a.sortOrder - b.sortOrder);
}

type ConditionKey = "humidity" | "ambientTemp" | "backgroundTemp" | "imageDate";
export const CONDITION_KEYS: ConditionKey[] = ["humidity", "ambientTemp", "backgroundTemp", "imageDate"];

/** Anything recorded on an equipment line in this inspection. */
export function hasInspectionData(r: InspectionResult): boolean {
  return !!r.exception || r.reviewNotes.trim() !== "" || (r.photoNotes?.length ?? 0) > 0
    || r.images.some((i) => i.irImageNumber || i.visualImageNumber || i.maxTemp || i.notes || (i.possibleCause && i.possibleCause !== POSSIBLE_CAUSE_NONE));
}

export interface MoveLine {
  inspection: Inspection;
  result: InspectionResult;
  fromRoom: InspectionRoomConditions | undefined;
  toRoom: InspectionRoomConditions | undefined;
  hasData: boolean;
  /**
   * Room condition values this line was recorded under that would change by the move
   * (only values the line does not already override). Empty when nothing changes.
   */
  changedConditions: { key: ConditionKey; from: string; to: string }[];
}

export interface MovePlan {
  equipment: Equipment;
  from: Location | undefined;
  to: Location;
  /** Open inspections whose equipment line moves with the equipment. */
  lines: MoveLine[];
  /** Approved inspections: their report keeps the room the item was inspected in. */
  lockedCount: number;
}

/** What moving an item of equipment to another room changes. Null when the move is not possible. */
export function planEquipmentMove(s: RoomData, equipmentId: string, toLocationId: string): MovePlan | null {
  const equipment = s.equipment.find((e) => e.id === equipmentId);
  const to = s.locations.find((l) => l.id === toLocationId);
  if (!equipment || !to || to.facilityId !== equipment.facilityId || isArchived(to)) return null;
  const from = s.locations.find((l) => l.id === equipment.locationId);
  const lines: MoveLine[] = [];
  let lockedCount = 0;
  for (const result of s.results) {
    if (result.equipmentId !== equipmentId) continue;
    const inspection = s.inspections.find((i) => i.id === result.inspectionId);
    if (!inspection) continue;
    if (s.isLocked(inspection)) { lockedCount++; continue; }
    if (result.locationId === toLocationId) continue;
    const fromRoom = s.rooms.find((r) => r.inspectionId === inspection.id && r.locationId === result.locationId);
    const toRoom = s.rooms.find((r) => r.inspectionId === inspection.id && r.locationId === toLocationId);
    const hasData = hasInspectionData(result);
    const changedConditions = hasData
      ? CONDITION_KEYS.flatMap((key) => {
        if (result.overrides[key] !== null && result.overrides[key] !== undefined) return [];
        const a = fromRoom?.[key] ?? "", b = toRoom?.[key] ?? "";
        return a !== "" && a !== b ? [{ key, from: a, to: b }] : [];
      })
      : [];
    lines.push({ inspection, result, fromRoom, toRoom, hasData, changedConditions });
  }
  return { equipment, from, to, lines, lockedCount };
}

/** A photo saved on this device for an equipment line (photos stay on the phone). */
export interface PhotoRef { resultId?: string | null }

/**
 * The saved inspection work on one equipment line, as short reasons. Empty means the line
 * holds nothing an inspector recorded (a carried-forward or imported line still To Do).
 * Never decided by the Done / To Do label: every saved field is checked.
 */
export function inspectionWork(r: InspectionResult, photos: PhotoRef[] = []): string[] {
  const out = new Set<string>();
  for (const i of r.images) {
    if (i.irImageNumber) out.add(`IR ${i.irImageNumber}`);
    else if (i.visualImageNumber) out.add(`Visual ${i.visualImageNumber}`);
    if (i.distance || i.maxTemp) out.add("measurements");
    if (i.possibleCause && i.possibleCause !== POSSIBLE_CAUSE_NONE) out.add("finding");
    if (i.notes.trim()) out.add("notes");
  }
  if (r.reviewNotes.trim() || (r.photoNotes?.length ?? 0) > 0 || (r.confidence ?? "").trim()) out.add("notes");
  if (r.exception) out.add(r.exception.kind === "deferred" ? "deferred" : "not scanned");
  if (r.opened && r.opened !== DEFAULT_OPENED) out.add(`Opened: ${r.opened}`);
  if (Object.values(r.overrides ?? {}).some((v) => v !== null && v !== undefined)) out.add("measurements");
  if (photos.some((p) => p.resultId === r.id)) out.add("photo");
  return [...out];
}

export interface ProtectedItem { equipment: Equipment; reasons: string[] }

export type RoomRemoval =
  | { kind: "blocked"; reason: string; protectedItems: ProtectedItem[] }
  | {
    kind: "delete" | "archive";
    /** Uninspected equipment removed from the inventory (recoverable soft delete). */
    deleteEquipment: Equipment[];
    /** Equipment that approved reports use: kept for history, retired, stays in the archived room. */
    retireEquipment: Equipment[];
    /** Blank lines removed from open inspections. */
    deleteResultIds: string[];
    /** This room's conditions in open inspections (removed with the room). */
    conditionIds: string[];
    /** Of those, the ones with values recorded. */
    measuredConditions: InspectionRoomConditions[];
    historicalInspectionCount: number;
  };

const blankConditions = (c: InspectionRoomConditions) => !c.humidity && !c.ambientTemp && !c.backgroundTemp && !c.imageDate;

/**
 * Whether a room can be removed, and what goes with it.
 * - Equipment with inspection work in any open inspection is protected: it must be moved first.
 * - Uninspected equipment (imported or carried forward, nothing recorded) is deleted with the room.
 * - Equipment that approved reports use is never deleted: it is retired and the room is archived,
 *   so those reports keep their original room and equipment.
 */
export function planRoomRemoval(s: RoomData & { photos?: PhotoRef[] }, locationId: string): RoomRemoval {
  const photos = s.photos ?? [];
  const locked = (inspectionId: string) => s.isLocked(s.inspections.find((i) => i.id === inspectionId));
  const resultsOf = (equipmentId: string) => s.results.filter((r) => r.equipmentId === equipmentId);
  const protectedItems: ProtectedItem[] = [];
  const deleteEquipment: Equipment[] = [];
  const retireEquipment: Equipment[] = [];
  const deleteResultIds = new Set<string>();
  const lockedIds = new Set<string>();
  const addProtected = (equipment: Equipment, reasons: string[]) => {
    const cur = protectedItems.find((p) => p.equipment.id === equipment.id);
    if (cur) cur.reasons = [...new Set([...cur.reasons, ...reasons])];
    else protectedItems.push({ equipment, reasons });
  };

  for (const e of s.equipment.filter((x) => x.locationId === locationId)) {
    const lines = resultsOf(e.id);
    const open = lines.filter((r) => !locked(r.inspectionId));
    const work = open.flatMap((r) => inspectionWork(r, photos));
    if (work.length) { addProtected(e, work); continue; }
    const history = lines.filter((r) => locked(r.inspectionId));
    for (const r of history) lockedIds.add(r.inspectionId);
    for (const r of open) deleteResultIds.add(r.id);
    (history.length ? retireEquipment : deleteEquipment).push(e);
  }
  // Lines in this room whose equipment now belongs to another room.
  for (const r of s.results.filter((x) => x.locationId === locationId && !deleteResultIds.has(x.id))) {
    const e = s.equipment.find((x) => x.id === r.equipmentId);
    if (!e || e.locationId === locationId) continue;
    if (locked(r.inspectionId)) { lockedIds.add(r.inspectionId); continue; }
    const work = inspectionWork(r, photos);
    if (work.length) addProtected(e, work);
    else deleteResultIds.add(r.id);
  }
  if (protectedItems.length) {
    const names = protectedItems.map((p) => p.equipment.name).join(", ");
    return { kind: "blocked", protectedItems,
      reason: `${protectedItems.length === 1 ? "This item has" : "These items have"} inspection work and must be moved to another room before the room is deleted: ${names}.` };
  }
  const conditions = s.rooms.filter((c) => c.locationId === locationId);
  for (const c of conditions) if (locked(c.inspectionId)) lockedIds.add(c.inspectionId);
  const open = conditions.filter((c) => !locked(c.inspectionId));
  const base = {
    deleteEquipment, retireEquipment, deleteResultIds: [...deleteResultIds],
    conditionIds: open.map((c) => c.id), measuredConditions: open.filter((c) => !blankConditions(c)),
    historicalInspectionCount: lockedIds.size,
  };
  return lockedIds.size || retireEquipment.length ? { kind: "archive", ...base } : { kind: "delete", ...base };
}

/** The confirmation sentence for a removable room. */
export function removalSummary(plan: Extract<RoomRemoval, { kind: "delete" | "archive" }>): string {
  const n = plan.deleteEquipment.length;
  if (n === 0) return "This room has no uninspected equipment to delete. Delete the room?";
  return `This room contains ${n} uninspected equipment item${n === 1 ? "" : "s"}. Delete the room and ${n === 1 ? "the item" : `all ${n} items`}?`;
}
