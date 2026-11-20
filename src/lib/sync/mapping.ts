/**
 * Mapping between the local store (what the UI edits, saved on the device)
 * and the shared Supabase tables.
 *
 * Device-only state is never synced: site visit / pause state, the active
 * room, the active inspection, photos and their requirement. Each phone keeps
 * its own place in the inspection.
 */
import type { DataState } from "../store/store";
import { newSiteVisit } from "../domain/site-visit";
import { newThermalImage } from "../domain/thermal";
import type { Customer, Equipment, ExteriorCheck, Facility, Inspection, InspectionResult, InspectionRoomConditions, Location, ReviewEvent, ThermalImage } from "../domain/types";
import { EMPTY_OVERRIDES } from "../domain/rules";

export type TableName =
  | "customers" | "facilities" | "locations" | "equipment" | "inspections"
  | "inspection_assignments" | "room_conditions" | "results" | "thermal_images" | "review_events" | "exterior_checks";

/** Push order: parents before children so foreign keys always resolve. */
export const TABLE_ORDER: TableName[] = [
  "customers", "facilities", "locations", "equipment", "inspections", "inspection_assignments",
  "room_conditions", "results", "thermal_images", "review_events", "exterior_checks",
];

/** Tables added by later migrations: a database without them yet is not an error (nothing to sync). */
export const OPTIONAL_TABLES = new Set<TableName>(["exterior_checks"]);
/** First write wins on the same id (an acknowledgment by either phone is enough; no conflict prompt). */
export const FIRST_WINS = new Set<TableName>(["exterior_checks"]);

export type Row = Record<string, unknown>;

/** A syncable record extracted from the local store, already in database shape (minus server columns). */
export interface SyncRecord { table: TableName; id: string; row: Row }

const S = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/* ----------------------------- local -> rows ----------------------------- */

export function customerRow(c: Customer): Row {
  return { id: c.id, organization_id: c.organizationId, name: c.name, contact_name: c.contactName, contact_email: c.contactEmail, contact_phone: c.contactPhone, notes: c.notes };
}
export function facilityRow(f: Facility): Row {
  return { id: f.id, organization_id: f.organizationId, customer_id: f.customerId, name: f.name, address: f.address, city: f.city, state: f.state, postal_code: f.postalCode, notes: f.notes };
}
export function locationRow(l: Location): Row {
  return { id: l.id, organization_id: l.organizationId, facility_id: l.facilityId, building: l.building, name: l.name, area: l.area, sort_order: l.sortOrder, archived_at: l.archivedAt ?? null };
}
export function equipmentRow(e: Equipment): Row {
  return { id: e.id, organization_id: e.organizationId, facility_id: e.facilityId, location_id: e.locationId, name: e.name, equipment_type: e.equipmentType, default_component: e.defaultComponent, identifiers: S(e.identifiers), imported_from: S(e.importedFrom), active: e.active, sort_order: e.sortOrder };
}
export function inspectionRow(i: Inspection): Row {
  return { id: i.id, organization_id: i.organizationId, customer_id: i.customerId, facility_id: i.facilityId, date: i.date, status: i.status, default_emissivity: i.defaultEmissivity, notes: i.notes, reopen_reason: i.reopenReason ?? "",
    primary_thermographer: i.primaryThermographerId ?? null, primary_locked: i.primaryLocked ?? false };
}
export function roomRow(r: InspectionRoomConditions): Row {
  return { id: r.id, organization_id: r.organizationId, inspection_id: r.inspectionId, location_id: r.locationId, humidity: r.humidity, ambient_temp: r.ambientTemp, background_temp: r.backgroundTemp, image_date: r.imageDate, conditions_copied_from: r.conditionsCopiedFrom ?? null, completed_at: r.completedAt ?? null };
}
export function resultRow(r: InspectionResult): Row {
  return { id: r.id, organization_id: r.organizationId, inspection_id: r.inspectionId, equipment_id: r.equipmentId, location_id: r.locationId, opened: r.opened, exception: r.exception ?? null, confidence: r.confidence, review_notes: r.reviewNotes, overrides: r.overrides, source: r.source, sort_order: r.sortOrder, photo_notes: r.photoNotes ?? [] };
}
export function imageRow(r: InspectionResult, img: ThermalImage, index: number): Row {
  return { id: img.id, organization_id: r.organizationId, inspection_id: r.inspectionId, result_id: r.id, sort_order: index, component: img.component, ir_image_number: img.irImageNumber, visual_image_number: img.visualImageNumber, visual_overridden: img.visualOverridden, distance: img.distance, possible_cause: img.possibleCause, max_temp: img.maxTemp, notes: img.notes };
}
export function exteriorRow(c: ExteriorCheck): Row {
  return { id: c.id, organization_id: c.organizationId, inspection_id: c.inspectionId, building: c.building, status: c.status, note: c.note, acknowledged_by: c.acknowledgedBy, acknowledged_at: c.acknowledgedAt };
}
export function toExteriorCheck(r: Row): ExteriorCheck {
  return { id: S(r.id), organizationId: S(r.organization_id), inspectionId: S(r.inspection_id), building: S(r.building), status: S(r.status) as ExteriorCheck["status"], note: S(r.note), acknowledgedBy: (r.acknowledged_by as string | null) ?? null, acknowledgedAt: S(r.acknowledged_at) };
}
export function eventRow(e: ReviewEvent): Row {
  return { id: e.id, organization_id: e.organizationId, inspection_id: e.inspectionId, action: e.action, detail: e.detail, at: e.at };
}

/** Every syncable record of one organization, keyed "table:id". */
export function extractRecords(s: Pick<DataState, "customers" | "facilities" | "locations" | "equipment" | "inspections" | "rooms" | "results" | "reviewEvents"> & Partial<Pick<DataState, "exteriorChecks">>, orgId: string): Map<string, SyncRecord> {
  const out = new Map<string, SyncRecord>();
  const add = (table: TableName, id: string, row: Row) => out.set(`${table}:${id}`, { table, id, row });
  for (const c of s.customers) if (c.organizationId === orgId) add("customers", c.id, customerRow(c));
  for (const f of s.facilities) if (f.organizationId === orgId) add("facilities", f.id, facilityRow(f));
  for (const l of s.locations) if (l.organizationId === orgId) add("locations", l.id, locationRow(l));
  for (const e of s.equipment) if (e.organizationId === orgId) add("equipment", e.id, equipmentRow(e));
  for (const i of s.inspections) {
    if (i.organizationId !== orgId) continue;
    add("inspections", i.id, inspectionRow(i));
    for (const uid of i.inspectorIds) add("inspection_assignments", `${i.id}|${uid}`, { inspection_id: i.id, user_id: uid, organization_id: orgId });
  }
  for (const r of s.rooms) if (r.organizationId === orgId) add("room_conditions", r.id, roomRow(r));
  for (const r of s.results) {
    if (r.organizationId !== orgId) continue;
    add("results", r.id, resultRow(r));
    r.images.forEach((img, i) => add("thermal_images", img.id, imageRow(r, img, i)));
  }
  for (const e of s.reviewEvents) if (e.organizationId === orgId) add("review_events", e.id, eventRow(e));
  for (const c of s.exteriorChecks ?? []) if (c.organizationId === orgId) add("exterior_checks", c.id, exteriorRow(c));
  return out;
}

/* ----------------------------- rows -> local ----------------------------- */

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export function toCustomer(r: Row): Customer {
  return { id: S(r.id), organizationId: S(r.organization_id), name: S(r.name), contactName: S(r.contact_name), contactEmail: S(r.contact_email), contactPhone: S(r.contact_phone), notes: S(r.notes), createdAt: S(r.created_at) };
}
export function toFacility(r: Row): Facility {
  return { id: S(r.id), organizationId: S(r.organization_id), customerId: S(r.customer_id), name: S(r.name), address: S(r.address), city: S(r.city), state: S(r.state), postalCode: S(r.postal_code), notes: S(r.notes), createdAt: S(r.created_at) };
}
export function toLocation(r: Row): Location {
  return { id: S(r.id), organizationId: S(r.organization_id), facilityId: S(r.facility_id), building: S(r.building), name: S(r.name), area: S(r.area), sortOrder: num(r.sort_order), archivedAt: (r.archived_at as string | null | undefined) ?? null };
}
export function toEquipment(r: Row): Equipment {
  return { id: S(r.id), organizationId: S(r.organization_id), facilityId: S(r.facility_id), locationId: S(r.location_id), name: S(r.name), equipmentType: S(r.equipment_type), defaultComponent: S(r.default_component), identifiers: S(r.identifiers) || undefined, importedFrom: S(r.imported_from) || undefined, active: r.active !== false, sortOrder: num(r.sort_order), createdAt: S(r.created_at) };
}
export function toInspection(r: Row, existing?: Inspection): Inspection {
  return {
    id: S(r.id), organizationId: S(r.organization_id), customerId: S(r.customer_id), facilityId: S(r.facility_id), date: S(r.date).slice(0, 10),
    inspectorIds: existing?.inspectorIds ?? [], status: S(r.status) as Inspection["status"], defaultEmissivity: S(r.default_emissivity) || "0.95",
    notes: S(r.notes), createdAt: S(r.created_at), updatedAt: S(r.updated_at),
    siteVisit: existing?.siteVisit ?? newSiteVisit(), // device-local
    submittedAt: (r.submitted_at as string | null) ?? null, approvedAt: (r.approved_at as string | null) ?? null,
    firstApprovedAt: (r.first_approved_at as string | null) ?? null, reopenedAt: (r.reopened_at as string | null) ?? null,
    reopenCount: num(r.reopen_count), reopenReason: S(r.reopen_reason),
    approvalSnapshot: (r.approval_snapshot as Inspection["approvalSnapshot"]) ?? null,
    primaryThermographerId: (r.primary_thermographer as string | null) ?? null,
    primaryLocked: r.primary_locked === true,
    submittedBy: (r.submitted_by as string | null) ?? null,
  };
}
export function toRoom(r: Row): InspectionRoomConditions {
  return { id: S(r.id), organizationId: S(r.organization_id), inspectionId: S(r.inspection_id), locationId: S(r.location_id), humidity: S(r.humidity), ambientTemp: S(r.ambient_temp), backgroundTemp: S(r.background_temp), distance: "", imageDate: S(r.image_date) as InspectionRoomConditions["imageDate"], conditionsCopiedFrom: (r.conditions_copied_from as string | null) ?? null, completedAt: (r.completed_at as string | null) ?? null };
}
export function toResult(r: Row, images: ThermalImage[]): InspectionResult {
  return {
    id: S(r.id), organizationId: S(r.organization_id), inspectionId: S(r.inspection_id), equipmentId: S(r.equipment_id), locationId: S(r.location_id),
    images: images.length ? images : [newThermalImage()], opened: S(r.opened) || "Yes, Completely", exception: (r.exception as InspectionResult["exception"]) ?? null,
    confidence: S(r.confidence), reviewNotes: S(r.review_notes),
    ...(Array.isArray(r.photo_notes) && r.photo_notes.length ? { photoNotes: r.photo_notes as InspectionResult["photoNotes"] } : {}),
    overrides: { ...EMPTY_OVERRIDES, ...((r.overrides as object) ?? {}) },
    source: (S(r.source) || "manual") as InspectionResult["source"], sortOrder: num(r.sort_order), createdAt: S(r.created_at), updatedAt: S(r.updated_at),
  };
}
export function toImage(r: Row): ThermalImage {
  return { id: S(r.id), component: S(r.component), irImageNumber: S(r.ir_image_number), visualImageNumber: S(r.visual_image_number), visualOverridden: r.visual_overridden === true, distance: S(r.distance), possibleCause: S(r.possible_cause) || "NONE", maxTemp: S(r.max_temp), notes: S(r.notes) };
}
export function toEvent(r: Row): ReviewEvent {
  return { id: S(r.id), organizationId: S(r.organization_id), inspectionId: S(r.inspection_id), at: S(r.at), actorId: S(r.actor), action: S(r.action), detail: S(r.detail) };
}

/** Columns that the database owns; never sent by clients. */
export const SERVER_COLUMNS = new Set(["version", "created_at", "created_by", "updated_at", "updated_by", "deleted_at", "submitted_at", "submitted_by", "approved_at", "approved_by",
  "first_approved_at", "reopened_at", "reopened_by", "reopen_count", "approval_snapshot", "submission_count"]);

/** Natural keys: a second phone creating "the same" row gets folded into the existing one. */
export const NATURAL_KEYS: Partial<Record<TableName, string[]>> = {
  room_conditions: ["inspection_id", "location_id"],
  results: ["inspection_id", "equipment_id"],
};

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined || a === "") && (b === null || b === undefined || b === "")) return true;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}
