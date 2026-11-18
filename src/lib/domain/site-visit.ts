import type { ExteriorCheck, Inspection, InspectionRoomConditions, Location, Photo, SiteVisit } from "./types";

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

/** Deterministic id: two phones acknowledging the same building write the same record. */
export function exteriorCheckId(inspectionId: string, building: string): string {
  const key = building === ANY_BUILDING ? "any" : building.trim() ? building.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "b" : "main";
  return `xc-${inspectionId}-${key}`;
}

/** The acknowledgment that covers a required building, if any. */
export function checkFor<C extends Pick<ExteriorCheck, "building" | "inspectionId">>(required: string[], building: string, checks: C[], inspectionId: string): C | undefined {
  const mine = checks.filter((c) => c.inspectionId === inspectionId);
  const exact = mine.find((c) => c.building.trim() === building.trim());
  if (exact) return exact;
  // Acknowledged before any room existed: counts for the main building, or for the only building.
  const any = mine.find((c) => c.building === ANY_BUILDING);
  if (any && (building === MAIN_BUILDING || required.filter((b) => b !== ANY_BUILDING).length <= 1)) return any;
  if (building === ANY_BUILDING && mine.length) return mine[0];
  return undefined;
}

/** Buildings still missing an exterior photo on this device and, for shared inspections, any acknowledgment. */
export function missingExteriorBuildings(required: string[], photos: Photo[], inspectionId: string, checks: ExteriorCheck[] = []): string[] {
  const ext = exteriorPhotosFor(photos, inspectionId);
  const have = new Set(ext.map((p) => p.building.trim()));
  return required.filter((b) => !(b === ANY_BUILDING ? ext.length > 0 : have.has(b)) && !checkFor(required, b, checks, inspectionId));
}

export interface ExitCheck {
  allowed: boolean;
  missing: string[];
}

/**
 * Pause / finish need every building's front photo dealt with: a photo saved on
 * this device, or (shared inspections) a teammate's photo, "already taken with
 * the camera", or a documented exception. Nobody is ever permanently blocked:
 * the exception path is always available.
 */
export function checkExit(required: string[], photos: Photo[], inspectionId: string, checks: ExteriorCheck[] = []): ExitCheck {
  const missing = missingExteriorBuildings(required, photos, inspectionId, checks);
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

/** Shared (cloud) inspections offer "Already Taken With Camera" and exceptions, synced between phones. */
export const isSharedInspection = (inspection: Pick<Inspection, "organizationId">) => inspection.organizationId !== "org-demo";
