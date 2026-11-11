import type { Inspection, InspectionRoomConditions, Location, Photo, SiteVisit } from "./types";

export const MAIN_BUILDING = "";
/** Requirement used before any room exists: any exterior photo satisfies it. */
export const ANY_BUILDING = "*";

export function buildingLabel(key: string): string {
  if (key === ANY_BUILDING) return "Building exterior";
  return key.trim() ? key.trim() : "Main building";
}

export function newSiteVisit(): SiteVisit {
  return { state: "not-started", sessions: [], lastActiveLocationId: null, skippedExteriorPrompt: false, completedAt: null };
}

/**
 * Buildings that need an exterior photo for this inspection: one per distinct
 * building used by the inspection's rooms. Rooms without a building name count
 * as the main building. An inspection with no rooms yet needs the main building.
 */
export function requiredBuildings(
  rooms: Pick<InspectionRoomConditions, "locationId">[],
  locations: Map<string, Pick<Location, "building">> | Record<string, Pick<Location, "building">>,
): string[] {
  const get = (id: string) => (locations instanceof Map ? locations.get(id) : locations[id]);
  const keys = new Set<string>();
  for (const r of rooms) {
    const loc = get(r.locationId);
    if (loc) keys.add(loc.building.trim());
  }
  if (keys.size === 0) keys.add(ANY_BUILDING);
  return [...keys].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

export function exteriorPhotosFor(photos: Photo[], inspectionId: string): Photo[] {
  return photos.filter((p) => p.inspectionId === inspectionId && p.kind === "exterior");
}

/** Buildings still missing a saved exterior photo. */
export function missingExteriorBuildings(required: string[], photos: Photo[], inspectionId: string): string[] {
  const ext = exteriorPhotosFor(photos, inspectionId);
  const have = new Set(ext.map((p) => p.building.trim()));
  return required.filter((b) => (b === ANY_BUILDING ? ext.length === 0 : !have.has(b)));
}

export interface ExitCheck {
  allowed: boolean;
  missing: string[];
}

/** Pause / finish are only allowed once every required building has a saved photo. */
export function checkExit(required: string[], photos: Photo[], inspectionId: string): ExitCheck {
  const missing = missingExteriorBuildings(required, photos, inspectionId);
  return { allowed: missing.length === 0, missing };
}

export function visitDayCount(inspection: Pick<Inspection, "siteVisit">): number {
  const days = new Set(inspection.siteVisit.sessions.map((s) => new Date(s.startedAt).toDateString()));
  return days.size;
}

export function lastSessionEnd(inspection: Pick<Inspection, "siteVisit">): string | null {
  const s = inspection.siteVisit.sessions;
  return s.length ? s[s.length - 1].endedAt : null;
}
