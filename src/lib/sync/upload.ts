/**
 * Copy existing device-only records into the cloud organization.
 *
 * - The originals are never changed or removed. Copies get new, deterministic
 *   ids ("up-" + original id), so running the upload twice (or on two phones
 *   holding the same backup) never creates duplicates: an id that already
 *   exists is skipped locally and recognised by the database.
 * - Thermographer names are matched to cloud accounts by name.
 * - Photos are NOT copied: they stay with the device copy of the inspection.
 */
import type { DataState } from "../store/store";
import { migrateState, SCHEMA_VERSION } from "../store/store";
import type { Customer, Equipment, Facility, Inspection, InspectionResult, InspectionRoomConditions, Location, ReviewEvent, User } from "../domain/types";

export const UPLOAD_PREFIX = "up-";
const up = (id: string) => (id.startsWith(UPLOAD_PREFIX) ? id : `${UPLOAD_PREFIX}${id}`);

type Source = Pick<DataState, "customers" | "facilities" | "locations" | "equipment" | "inspections" | "rooms" | "results" | "reviewEvents" | "users">;

export interface UploadCustomer { id: string; name: string; facilities: number; equipment: number; inspections: number; results: number; alreadyUploaded: boolean }

/** Device-only records (any organization other than the cloud one). */
export function legacyCustomers(src: Source, cloudOrgId: string, existingIds: Set<string>): UploadCustomer[] {
  return src.customers.filter((c) => c.organizationId !== cloudOrgId).map((c) => {
    const fac = new Set(src.facilities.filter((f) => f.customerId === c.id).map((f) => f.id));
    const insp = new Set(src.inspections.filter((i) => i.customerId === c.id || fac.has(i.facilityId)).map((i) => i.id));
    return {
      id: c.id, name: c.name, facilities: fac.size,
      equipment: src.equipment.filter((e) => fac.has(e.facilityId)).length,
      inspections: insp.size, results: src.results.filter((r) => insp.has(r.inspectionId)).length,
      alreadyUploaded: existingIds.has(up(c.id)),
    };
  });
}

export interface UploadPlan {
  customers: Customer[]; facilities: Facility[]; locations: Location[]; equipment: Equipment[]; inspections: Inspection[];
  rooms: InspectionRoomConditions[]; results: InspectionResult[]; reviewEvents: ReviewEvent[];
  unmatchedThermographers: string[];
}

export function planUpload(src: Source, customerIds: string[], cloudOrgId: string, cloudUsers: User[], existingIds: Set<string>): UploadPlan {
  const want = new Set(customerIds);
  const keep = <T extends { id: string }>(x: T) => !existingIds.has(up(x.id));
  const customers = src.customers.filter((c) => want.has(c.id));
  const fac = new Set(src.facilities.filter((f) => want.has(f.customerId)).map((f) => f.id));
  const inspections = src.inspections.filter((i) => want.has(i.customerId) || fac.has(i.facilityId));
  const insp = new Set(inspections.map((i) => i.id));
  const byName = new Map(cloudUsers.map((u) => [u.name.trim().toLowerCase(), u.id]));
  const unmatched = new Set<string>();
  const mapUser = (id: string) => {
    const u = src.users.find((x) => x.id === id);
    const hit = u ? byName.get(u.name.trim().toLowerCase()) : undefined;
    if (!hit && u) unmatched.add(u.name);
    return hit;
  };
  const org = cloudOrgId;
  return {
    customers: customers.filter(keep).map((c) => ({ ...c, id: up(c.id), organizationId: org })),
    facilities: src.facilities.filter((f) => fac.has(f.id)).filter(keep).map((f) => ({ ...f, id: up(f.id), customerId: up(f.customerId), organizationId: org })),
    locations: src.locations.filter((l) => fac.has(l.facilityId)).filter(keep).map((l) => ({ ...l, id: up(l.id), facilityId: up(l.facilityId), organizationId: org })),
    equipment: src.equipment.filter((e) => fac.has(e.facilityId)).filter(keep).map((e) => ({ ...e, id: up(e.id), facilityId: up(e.facilityId), locationId: up(e.locationId), organizationId: org })),
    inspections: inspections.filter(keep).map((i) => ({
      ...i, id: up(i.id), customerId: up(i.customerId), facilityId: up(i.facilityId), organizationId: org,
      inspectorIds: [...new Set(i.inspectorIds.map(mapUser).filter((x): x is string => !!x))],
      siteVisit: { ...i.siteVisit, state: i.siteVisit.state === "active" ? "paused" as const : i.siteVisit.state },
    })),
    rooms: src.rooms.filter((r) => insp.has(r.inspectionId)).filter(keep).map((r) => ({ ...r, id: up(r.id), inspectionId: up(r.inspectionId), locationId: up(r.locationId), organizationId: org })),
    results: src.results.filter((r) => insp.has(r.inspectionId)).filter(keep).map((r) => ({
      ...r, id: up(r.id), inspectionId: up(r.inspectionId), equipmentId: up(r.equipmentId), locationId: up(r.locationId), organizationId: org,
      images: r.images.map((img) => ({ ...img, id: up(img.id) })),
    })),
    reviewEvents: src.reviewEvents.filter((e) => insp.has(e.inspectionId)).filter(keep).map((e) => ({ ...e, id: up(e.id), inspectionId: up(e.inspectionId), organizationId: org })),
    unmatchedThermographers: [...unmatched],
  };
}

export const planCounts = (p: UploadPlan) => ({
  customers: p.customers.length, facilities: p.facilities.length, rooms: p.locations.length, equipment: p.equipment.length,
  inspections: p.inspections.length, results: p.results.length, images: p.results.reduce((n, r) => n + r.images.length, 0),
});

/** Every id already present on this device (to skip what was uploaded before). */
export function existingIdSet(s: Source): Set<string> {
  const ids = new Set<string>();
  for (const list of [s.customers, s.facilities, s.locations, s.equipment, s.inspections, s.rooms, s.results, s.reviewEvents]) for (const x of list) ids.add(x.id);
  return ids;
}

/** Read an InfraReport "Download JSON backup" file (from any earlier version) without touching this device's data. */
export function parseBackup(text: string): Source {
  const parsed = JSON.parse(text);
  const state = parsed?.state;
  if (!state || !Array.isArray(state.organizations)) throw new Error("This is not an InfraReport backup file.");
  const migrated = migrateState(state, typeof parsed.version === "number" ? parsed.version : SCHEMA_VERSION) as DataState;
  return {
    customers: migrated.customers ?? [], facilities: migrated.facilities ?? [], locations: migrated.locations ?? [], equipment: migrated.equipment ?? [],
    inspections: migrated.inspections ?? [], rooms: migrated.rooms ?? [], results: migrated.results ?? [], reviewEvents: migrated.reviewEvents ?? [], users: migrated.users ?? [],
  };
}
