import { POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
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

export type RoomRemoval =
  | { kind: "blocked"; reason: string; equipmentCount: number; openInspectionCount: number }
  | { kind: "delete"; blankConditionIds: string[] }
  | { kind: "archive"; blankConditionIds: string[]; historicalInspectionCount: number };

const blankConditions = (c: InspectionRoomConditions) => !c.humidity && !c.ambientTemp && !c.backgroundTemp && !c.imageDate;

/**
 * Whether a room can be removed, and how.
 * Equipment is never deleted with a room, and open inspections must not lose a room they use.
 * A room that only approved inspections use is archived so their reports stay intact.
 */
export function planRoomRemoval(s: RoomData, locationId: string): RoomRemoval {
  const equipmentCount = s.equipment.filter((e) => e.locationId === locationId).length;
  const openIds = new Set<string>();
  const lockedIds = new Set<string>();
  const blankConditionIds: string[] = [];
  let measuredOpen = false;
  const locked = (inspectionId: string) => s.isLocked(s.inspections.find((i) => i.id === inspectionId));
  for (const r of s.results) {
    if (r.locationId !== locationId) continue;
    (locked(r.inspectionId) ? lockedIds : openIds).add(r.inspectionId);
  }
  for (const c of s.rooms) {
    if (c.locationId !== locationId) continue;
    if (locked(c.inspectionId)) lockedIds.add(c.inspectionId);
    else if (blankConditions(c)) blankConditionIds.push(c.id);
    else { measuredOpen = true; openIds.add(c.inspectionId); }
  }
  if (equipmentCount > 0) {
    return { kind: "blocked", equipmentCount, openInspectionCount: openIds.size,
      reason: `This room has ${equipmentCount} equipment item${equipmentCount === 1 ? "" : "s"}. Move ${equipmentCount === 1 ? "it" : "them"} to another room first. Equipment is never deleted with a room.` };
  }
  if (openIds.size > 0) {
    return { kind: "blocked", equipmentCount, openInspectionCount: openIds.size,
      reason: measuredOpen
        ? `This room has conditions recorded in ${openIds.size} open inspection${openIds.size === 1 ? "" : "s"}. Remove the room from ${openIds.size === 1 ? "that inspection" : "those inspections"} first.`
        : `This room is still used by ${openIds.size} open inspection${openIds.size === 1 ? "" : "s"}. Move ${openIds.size === 1 ? "its" : "their"} equipment to another room first.` };
  }
  if (lockedIds.size > 0) return { kind: "archive", blankConditionIds, historicalInspectionCount: lockedIds.size };
  return { kind: "delete", blankConditionIds };
}
