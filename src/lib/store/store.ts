"use client";

/**
 * PROTOTYPE PERSISTENCE: browser localStorage.
 * This is NOT a secure or shared database. Data lives only in this browser,
 * is readable by anyone with access to this device, and is lost if site data
 * is cleared. The action surface below mirrors the repository layer that will
 * be backed by Postgres/Supabase with row-level security per organization.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  BUILT_IN_POSSIBLE_CAUSES,
  DEFAULT_EMISSIVITY,
  DEFAULT_OPENED,
  POSSIBLE_CAUSE_NONE,
  STORAGE_KEY,
} from "../domain/constants";
import {
  EMPTY_OVERRIDES,
  defaultComponentForType,
  incrementName,
  normalizeNumericInput,
  resolveEquipmentType,
} from "../domain/rules";
import type {
  Customer,
  DocumentAsset,
  Equipment,
  Facility,
  ID,
  ImageAsset,
  Inspection,
  InspectionResult,
  InspectionRoomConditions,
  InspectionStatus,
  Location,
  Organization,
  OrganizationSettings,
  Photo,
  ResultOverrides,
  ReviewEvent,
  User,
} from "../domain/types";
import { DEMO_ORG_ID, buildSeed } from "./seed";
import { checkExit, newSiteVisit, requiredBuildings, type ExitCheck } from "../domain/site-visit";
import { trackedLocalStorage } from "./save-status";

export const SCHEMA_VERSION = 2;

export interface DataState {
  schemaVersion: number;
  currentOrgId: ID;
  currentUserId: ID;
  organizations: Organization[];
  users: User[];
  customers: Customer[];
  facilities: Facility[];
  locations: Location[];
  equipment: Equipment[];
  inspections: Inspection[];
  rooms: InspectionRoomConditions[];
  results: InspectionResult[];
  images: ImageAsset[];
  documents: DocumentAsset[];
  reviewEvents: ReviewEvent[];
  /** Photo metadata only. Binaries live in IndexedDB (see lib/photos/photo-db). */
  photos: Photo[];
  /** The inspection currently being worked on site, if any. */
  activeInspectionId: ID | null;
}

export interface NewEquipmentRow {
  name: string;
  equipmentType: string;
  component?: string;
  irImageNumber?: string;
  visualImageNumber?: string;
  visualFromSinglePhoto?: boolean;
  maxTemp?: string;
  opened?: string;
  possibleCause?: string;
  problemNotes?: string;
  distance?: string | null;
}

export interface Actions {
  createCustomer(input: Omit<Customer, "id" | "organizationId" | "createdAt">): ID;
  updateCustomer(id: ID, patch: Partial<Customer>): void;
  deleteCustomer(id: ID): boolean;
  createFacility(input: Omit<Facility, "id" | "organizationId" | "createdAt">): ID;
  updateFacility(id: ID, patch: Partial<Facility>): void;
  createLocation(input: Omit<Location, "id" | "organizationId" | "sortOrder">): ID;
  updateLocation(id: ID, patch: Partial<Location>): void;
  deleteLocation(id: ID): boolean;
  createEquipment(input: Omit<Equipment, "id" | "organizationId" | "createdAt" | "sortOrder" | "active">): ID;
  updateEquipment(id: ID, patch: Partial<Equipment>): void;
  createInspection(input: {
    customerId: ID; facilityId: ID; date: string; inspectorId: ID; carryForward: boolean; notes?: string;
  }): ID;
  updateInspection(id: ID, patch: Partial<Inspection>): void;
  /** Returns false (and changes nothing) when the transition is blocked. */
  setInspectionStatus(id: ID, status: InspectionStatus, detail?: string): boolean;
  exitCheck(inspectionId: ID): ExitCheck;
  startSiteVisit(inspectionId: ID): void;
  pauseSiteVisit(inspectionId: ID): ExitCheck;
  finishSiteVisit(inspectionId: ID): ExitCheck;
  skipExteriorPrompt(inspectionId: ID): void;
  setLastActiveRoom(inspectionId: ID, locationId: ID): void;
  /** Call only after the binary has been verified in IndexedDB. */
  addPhotoRecord(photo: Omit<Photo, "organizationId" | "savedAt">): void;
  removePhotoRecord(id: ID): void;
  setPhotoBuilding(id: ID, building: string): void;
  logEvent(inspectionId: ID, action: string, detail: string): void;
  addRoomToInspection(inspectionId: ID, locationId: ID): ID;
  createRoomForInspection(inspectionId: ID, room: { building: string; name: string; area: string }, conditions?: Partial<InspectionRoomConditions>): ID;
  updateRoomConditions(id: ID, patch: Partial<InspectionRoomConditions>): void;
  removeRoomFromInspection(inspectionId: ID, locationId: ID): boolean;
  addResult(inspectionId: ID, locationId: ID, row: NewEquipmentRow): ID;
  addExistingEquipment(inspectionId: ID, equipmentId: ID): ID;
  updateResult(id: ID, patch: Partial<InspectionResult>): void;
  setOverride(id: ID, key: keyof ResultOverrides, value: string | null): void;
  duplicateResult(id: ID): ID | null;
  deleteResult(id: ID): void;
  addDocument(doc: Omit<DocumentAsset, "id" | "organizationId" | "uploadedAt">): ID;
  removeDocument(id: ID): void;
  upsertImages(inspectionId: ID, images: Omit<ImageAsset, "id" | "organizationId" | "inspectionId">[]): void;
  updateImage(id: ID, patch: Partial<ImageAsset>): void;
  clearImages(inspectionId: ID): void;
  updateOrgSettings(patch: Partial<OrganizationSettings>): void;
  resetDemoData(): void;
}

export type Store = DataState & Actions;

const uid = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const now = () => new Date().toISOString();

function initialState(): DataState {
  const seed = buildSeed();
  return {
    schemaVersion: SCHEMA_VERSION,
    currentOrgId: DEMO_ORG_ID,
    currentUserId: "user-1",
    ...seed,
    images: [],
    documents: [],
    photos: [],
    activeInspectionId: null,
  };
}

const numericKeys = new Set(["humidity", "ambientTemp", "backgroundTemp", "distance", "emissivity", "maxTemp", "defaultEmissivity"]);
function normalizePatch<T extends object>(patch: T): T {
  const out: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  for (const k of Object.keys(out)) {
    if (numericKeys.has(k) && typeof out[k] === "string") out[k] = normalizeNumericInput(out[k] as string);
  }
  return out as T;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const org = () => get().currentOrgId;
      const touch = (inspectionId: ID) =>
        set((s) => ({ inspections: s.inspections.map((i) => (i.id === inspectionId ? { ...i, updatedAt: now() } : i)) }));
      const nextResultOrder = (inspectionId: ID) =>
        Math.max(0, ...get().results.filter((r) => r.inspectionId === inspectionId).map((r) => r.sortOrder)) + 1;

      return {
        ...initialState(),

        createCustomer(input) {
          const id = uid("cust");
          set((s) => ({ customers: [...s.customers, { ...input, id, organizationId: org(), createdAt: now() }] }));
          return id;
        },
        updateCustomer(id, patch) {
          set((s) => ({ customers: s.customers.map((c) => (c.id === id && c.organizationId === org() ? { ...c, ...patch, id, organizationId: c.organizationId } : c)) }));
        },
        deleteCustomer(id) {
          const s = get();
          if (s.facilities.some((f) => f.customerId === id) || s.inspections.some((i) => i.customerId === id)) return false;
          set({ customers: s.customers.filter((c) => c.id !== id) });
          return true;
        },

        createFacility(input) {
          const id = uid("fac");
          set((s) => ({ facilities: [...s.facilities, { ...input, id, organizationId: org(), createdAt: now() }] }));
          return id;
        },
        updateFacility(id, patch) {
          set((s) => ({ facilities: s.facilities.map((f) => (f.id === id && f.organizationId === org() ? { ...f, ...patch, id, organizationId: f.organizationId } : f)) }));
        },

        createLocation(input) {
          const id = uid("loc");
          const sortOrder = Math.max(0, ...get().locations.filter((l) => l.facilityId === input.facilityId).map((l) => l.sortOrder)) + 1;
          set((s) => ({ locations: [...s.locations, { ...input, id, organizationId: org(), sortOrder }] }));
          return id;
        },
        updateLocation(id, patch) {
          set((s) => ({ locations: s.locations.map((l) => (l.id === id ? { ...l, ...patch, id } : l)) }));
        },
        deleteLocation(id) {
          const s = get();
          if (s.equipment.some((e) => e.locationId === id) || s.results.some((r) => r.locationId === id)) return false;
          set({ locations: s.locations.filter((l) => l.id !== id), rooms: s.rooms.filter((r) => r.locationId !== id) });
          return true;
        },

        createEquipment(input) {
          const id = uid("eq");
          const sortOrder = Math.max(0, ...get().equipment.filter((e) => e.facilityId === input.facilityId).map((e) => e.sortOrder)) + 1;
          set((s) => ({ equipment: [...s.equipment, { ...input, id, organizationId: org(), active: true, sortOrder, createdAt: now() }] }));
          return id;
        },
        updateEquipment(id, patch) {
          set((s) => ({ equipment: s.equipment.map((e) => (e.id === id ? { ...e, ...patch, id } : e)) }));
        },

        createInspection({ customerId, facilityId, date, inspectorId, carryForward, notes }) {
          const id = uid("insp");
          const s = get();
          const orgSettings = s.organizations.find((o) => o.id === org())?.settings;
          const inspection: Inspection = {
            id, organizationId: org(), customerId, facilityId, date, inspectorId, status: "Draft",
            defaultEmissivity: orgSettings?.defaultEmissivity || DEFAULT_EMISSIVITY,
            notes: notes ?? "", createdAt: now(), updatedAt: now(), siteVisit: newSiteVisit(),
          };
          const rooms: InspectionRoomConditions[] = [];
          const results: InspectionResult[] = [];
          if (carryForward) {
            const locs = s.locations.filter((l) => l.facilityId === facilityId).sort((a, b) => a.sortOrder - b.sortOrder);
            for (const l of locs) {
              rooms.push({ id: uid("rc"), organizationId: org(), inspectionId: id, locationId: l.id, humidity: "", ambientTemp: "", backgroundTemp: "", distance: "", imageDate: "" });
            }
            const eqs = s.equipment.filter((e) => e.facilityId === facilityId && e.active).sort((a, b) => a.sortOrder - b.sortOrder);
            eqs.forEach((e, i) => {
              results.push({
                id: uid("res"), organizationId: org(), inspectionId: id, equipmentId: e.id, locationId: e.locationId,
                component: e.defaultComponent, irImageNumber: "", visualImageNumber: "", visualFromSinglePhoto: false,
                maxTemp: "", opened: DEFAULT_OPENED, possibleCause: POSSIBLE_CAUSE_NONE, problemNotes: "",
                confidence: "", reviewNotes: "", overrides: { ...EMPTY_OVERRIDES }, source: "carried-forward",
                sortOrder: i + 1, createdAt: now(), updatedAt: now(),
              });
            });
          }
          set((st) => ({
            inspections: [...st.inspections, inspection],
            rooms: [...st.rooms, ...rooms],
            results: [...st.results, ...results],
          }));
          get().logEvent(id, "Inspection created", carryForward ? `${results.length} equipment items carried forward from facility inventory` : "Started with an empty equipment list");
          return id;
        },
        updateInspection(id, patch) {
          set((s) => ({ inspections: s.inspections.map((i) => (i.id === id ? { ...i, ...normalizePatch(patch), id, updatedAt: now() } : i)) }));
        },
        setInspectionStatus(id, status, detail) {
          const insp = get().inspections.find((i) => i.id === id);
          const prev = insp?.status;
          if (!insp || !prev || prev === status) return false;
          // Leaving the field stage (review or later) requires the exterior photos.
          const fieldStage: InspectionStatus[] = ["Draft", "In Progress"];
          if (fieldStage.includes(prev) && !fieldStage.includes(status) && insp.siteVisit.state !== "completed" && !get().exitCheck(id).allowed) {
            return false;
          }
          set((s) => ({ inspections: s.inspections.map((i) => (i.id === id ? { ...i, status, updatedAt: now() } : i)) }));
          get().logEvent(id, "Status changed", `${prev} → ${status}${detail ? ` (${detail})` : ""}`);
          return true;
        },

        exitCheck(inspectionId) {
          const s = get();
          const rooms = s.rooms.filter((r) => r.inspectionId === inspectionId);
          const locs = new Map(s.locations.map((l) => [l.id, l]));
          return checkExit(requiredBuildings(rooms, locs), s.photos, inspectionId);
        },
        startSiteVisit(inspectionId) {
          const insp = get().inspections.find((i) => i.id === inspectionId);
          if (!insp) return;
          const sessions = insp.siteVisit.sessions;
          const open = sessions.length > 0 && sessions[sessions.length - 1].endedAt === null;
          const resumed = insp.siteVisit.state === "paused";
          set((s) => ({
            activeInspectionId: inspectionId,
            inspections: s.inspections.map((i) => i.id === inspectionId ? {
              ...i,
              updatedAt: now(),
              siteVisit: { ...i.siteVisit, state: "active", completedAt: null, sessions: open ? sessions : [...sessions, { startedAt: now(), endedAt: null }] },
            } : i),
          }));
          if (!open) get().logEvent(inspectionId, resumed ? "Site visit resumed" : "Site visit started", `Visit day ${new Set([...sessions.map((x) => new Date(x.startedAt).toDateString()), new Date().toDateString()]).size}`);
          if (insp.status === "Draft") get().setInspectionStatus(inspectionId, "In Progress", "site visit started");
        },
        pauseSiteVisit(inspectionId) {
          const check = get().exitCheck(inspectionId);
          if (!check.allowed) return check;
          set((s) => ({
            activeInspectionId: s.activeInspectionId === inspectionId ? null : s.activeInspectionId,
            inspections: s.inspections.map((i) => i.id === inspectionId ? {
              ...i, updatedAt: now(),
              siteVisit: { ...i.siteVisit, state: "paused", sessions: i.siteVisit.sessions.map((x) => (x.endedAt === null ? { ...x, endedAt: now() } : x)) },
            } : i),
          }));
          get().logEvent(inspectionId, "Site visit paused", "Saved to return later");
          return check;
        },
        finishSiteVisit(inspectionId) {
          const check = get().exitCheck(inspectionId);
          if (!check.allowed) return check;
          set((s) => ({
            activeInspectionId: s.activeInspectionId === inspectionId ? null : s.activeInspectionId,
            inspections: s.inspections.map((i) => i.id === inspectionId ? {
              ...i, updatedAt: now(),
              siteVisit: { ...i.siteVisit, state: "completed", completedAt: now(), sessions: i.siteVisit.sessions.map((x) => (x.endedAt === null ? { ...x, endedAt: now() } : x)) },
            } : i),
          }));
          get().logEvent(inspectionId, "Site visit completed", "Exterior photos verified");
          const st = get().inspections.find((i) => i.id === inspectionId)?.status;
          if (st === "Draft" || st === "In Progress") get().setInspectionStatus(inspectionId, "Needs Review", "site visit completed");
          return check;
        },
        skipExteriorPrompt(inspectionId) {
          set((s) => ({ inspections: s.inspections.map((i) => (i.id === inspectionId ? { ...i, siteVisit: { ...i.siteVisit, skippedExteriorPrompt: true } } : i)) }));
          get().logEvent(inspectionId, "Exterior photo skipped", "Reminder will show until a photo is saved");
        },
        setLastActiveRoom(inspectionId, locationId) {
          const insp = get().inspections.find((i) => i.id === inspectionId);
          if (!insp || insp.siteVisit.lastActiveLocationId === locationId) return;
          set((s) => ({ inspections: s.inspections.map((i) => (i.id === inspectionId ? { ...i, siteVisit: { ...i.siteVisit, lastActiveLocationId: locationId } } : i)) }));
        },
        addPhotoRecord(photo) {
          set((s) => ({ photos: [...s.photos.filter((p) => p.id !== photo.id), { ...photo, organizationId: org(), savedAt: now() }] }));
          touch(photo.inspectionId);
          if (photo.kind === "exterior") get().logEvent(photo.inspectionId, "Exterior photo saved", photo.building ? `Building: ${photo.building}` : "Main building");
        },
        removePhotoRecord(id) {
          const p = get().photos.find((x) => x.id === id);
          set((s) => ({ photos: s.photos.filter((x) => x.id !== id) }));
          if (p) touch(p.inspectionId);
        },
        setPhotoBuilding(id, building) {
          set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, building: building.trim() } : p)) }));
        },
        logEvent(inspectionId, action, detail) {
          set((s) => ({
            reviewEvents: [...s.reviewEvents, { id: uid("ev"), organizationId: org(), inspectionId, at: now(), actorId: s.currentUserId, action, detail }],
          }));
        },

        addRoomToInspection(inspectionId, locationId) {
          const existing = get().rooms.find((r) => r.inspectionId === inspectionId && r.locationId === locationId);
          if (existing) return existing.id;
          const id = uid("rc");
          set((s) => ({ rooms: [...s.rooms, { id, organizationId: org(), inspectionId, locationId, humidity: "", ambientTemp: "", backgroundTemp: "", distance: "", imageDate: "" }] }));
          return id;
        },
        createRoomForInspection(inspectionId, room, conditions) {
          const insp = get().inspections.find((i) => i.id === inspectionId);
          if (!insp) return "";
          const locationId = get().createLocation({ facilityId: insp.facilityId, ...room });
          const rcId = get().addRoomToInspection(inspectionId, locationId);
          if (conditions) get().updateRoomConditions(rcId, conditions);
          touch(inspectionId);
          return locationId;
        },
        updateRoomConditions(id, patch) {
          set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...normalizePatch(patch), id } : r)) }));
        },
        removeRoomFromInspection(inspectionId, locationId) {
          if (get().results.some((r) => r.inspectionId === inspectionId && r.locationId === locationId)) return false;
          set((s) => ({ rooms: s.rooms.filter((r) => !(r.inspectionId === inspectionId && r.locationId === locationId)) }));
          return true;
        },

        addResult(inspectionId, locationId, row) {
          const insp = get().inspections.find((i) => i.id === inspectionId);
          if (!insp) return "";
          const type = resolveEquipmentType(row.equipmentType, row.name);
          const component = row.component !== undefined && row.component !== "" ? row.component : defaultComponentForType(type);
          const equipmentId = get().createEquipment({
            facilityId: insp.facilityId, locationId, name: row.name.trim(), equipmentType: type, defaultComponent: component,
          });
          const id = uid("res");
          const result: InspectionResult = {
            id, organizationId: org(), inspectionId, equipmentId, locationId, component,
            irImageNumber: (row.irImageNumber ?? "").trim(), visualImageNumber: (row.visualImageNumber ?? "").trim(),
            visualFromSinglePhoto: !!row.visualFromSinglePhoto,
            maxTemp: normalizeNumericInput(row.maxTemp ?? ""), opened: row.opened || DEFAULT_OPENED,
            possibleCause: row.possibleCause || POSSIBLE_CAUSE_NONE, problemNotes: row.problemNotes ?? "",
            confidence: "", reviewNotes: "",
            overrides: { ...EMPTY_OVERRIDES, distance: row.distance != null && row.distance !== "" ? normalizeNumericInput(row.distance) : null },
            source: "manual", sortOrder: nextResultOrder(inspectionId), createdAt: now(), updatedAt: now(),
          };
          set((s) => ({ results: [...s.results, result] }));
          touch(inspectionId);
          if (insp.status === "Draft") get().setInspectionStatus(inspectionId, "In Progress", "first equipment recorded");
          return id;
        },
        addExistingEquipment(inspectionId, equipmentId) {
          const e = get().equipment.find((x) => x.id === equipmentId);
          if (!e) return "";
          get().addRoomToInspection(inspectionId, e.locationId);
          const id = uid("res");
          set((s) => ({
            results: [...s.results, {
              id, organizationId: org(), inspectionId, equipmentId, locationId: e.locationId, component: e.defaultComponent,
              irImageNumber: "", visualImageNumber: "", visualFromSinglePhoto: false, maxTemp: "", opened: DEFAULT_OPENED,
              possibleCause: POSSIBLE_CAUSE_NONE, problemNotes: "", confidence: "", reviewNotes: "",
              overrides: { ...EMPTY_OVERRIDES }, source: "carried-forward", sortOrder: nextResultOrder(inspectionId),
              createdAt: now(), updatedAt: now(),
            }],
          }));
          touch(inspectionId);
          return id;
        },
        updateResult(id, patch) {
          const r = get().results.find((x) => x.id === id);
          if (!r) return;
          set((s) => ({ results: s.results.map((x) => (x.id === id ? { ...x, ...normalizePatch(patch), id, updatedAt: now() } : x)) }));
          touch(r.inspectionId);
        },
        setOverride(id, key, value) {
          const r = get().results.find((x) => x.id === id);
          if (!r) return;
          const v = value === null ? null : key === "imageDate" ? value : normalizeNumericInput(value);
          set((s) => ({ results: s.results.map((x) => (x.id === id ? { ...x, overrides: { ...x.overrides, [key]: v }, updatedAt: now() } : x)) }));
          touch(r.inspectionId);
        },
        duplicateResult(id) {
          const s = get();
          const r = s.results.find((x) => x.id === id);
          const e = r && s.equipment.find((x) => x.id === r.equipmentId);
          if (!r || !e) return null;
          // Copies type, component, opened, and overrides. Image numbers, temps and
          // problems are NOT copied, because they belong to the original item.
          const newId = get().addResult(r.inspectionId, r.locationId, {
            name: incrementName(e.name), equipmentType: e.equipmentType, component: r.component, opened: r.opened,
          });
          set((st) => ({
            results: st.results.map((x) => (x.id === newId ? { ...x, overrides: { ...r.overrides } } : x)),
          }));
          // place directly after the source row
          const list = get().results.filter((x) => x.inspectionId === r.inspectionId).sort((a, b) => a.sortOrder - b.sortOrder);
          const src = list.findIndex((x) => x.id === id);
          const moved = list.filter((x) => x.id !== newId);
          const created = list.find((x) => x.id === newId)!;
          moved.splice(src + 1, 0, created);
          const order = new Map(moved.map((x, i) => [x.id, i + 1]));
          set((st) => ({ results: st.results.map((x) => (order.has(x.id) ? { ...x, sortOrder: order.get(x.id)! } : x)) }));
          return newId;
        },
        deleteResult(id) {
          const r = get().results.find((x) => x.id === id);
          if (!r) return;
          // Remove the inspection row. If the equipment was created in this
          // inspection and never inspected elsewhere, remove it from inventory too.
          const others = get().results.some((x) => x.equipmentId === r.equipmentId && x.id !== id);
          set((s) => ({
            results: s.results.filter((x) => x.id !== id),
            equipment: others || r.source !== "manual" ? s.equipment : s.equipment.filter((e) => e.id !== r.equipmentId),
            images: s.images.map((im) => (im.matchedResultId === id ? { ...im, matchedResultId: null, verified: false } : im)),
          }));
          touch(r.inspectionId);
        },

        addDocument(doc) {
          const id = uid("doc");
          set((s) => ({ documents: [...s.documents, { ...doc, id, organizationId: org(), uploadedAt: now() }] }));
          return id;
        },
        removeDocument(id) {
          set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
        },
        upsertImages(inspectionId, images) {
          set((s) => {
            const existing = new Set(s.images.filter((i) => i.inspectionId === inspectionId).map((i) => i.fileName));
            const added = images
              .filter((i) => !existing.has(i.fileName))
              .map((i) => ({ ...i, id: uid("img"), organizationId: org(), inspectionId }));
            return { images: [...s.images, ...added] };
          });
        },
        updateImage(id, patch) {
          set((s) => ({ images: s.images.map((i) => (i.id === id ? { ...i, ...patch, id } : i)) }));
        },
        clearImages(inspectionId) {
          set((s) => ({ images: s.images.filter((i) => i.inspectionId !== inspectionId) }));
        },

        updateOrgSettings(patch) {
          set((s) => ({
            organizations: s.organizations.map((o) =>
              o.id === s.currentOrgId ? { ...o, settings: { ...o.settings, ...normalizePatch(patch) } } : o),
          }));
        },
        resetDemoData() {
          set(initialState());
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => trackedLocalStorage),
      migrate: (persisted, version) => migrateState(persisted as Partial<DataState>, version) as unknown as Store,
      skipHydration: true,
      partialize: (s) => {
        const out: Partial<DataState> = {};
        for (const k of Object.keys(initialState()) as (keyof DataState)[]) {
          (out as Record<string, unknown>)[k] = s[k];
        }
        return out;
      },
    },
  ),
);

export function allowedCauses(settings: OrganizationSettings | undefined): string[] {
  return [...BUILT_IN_POSSIBLE_CAUSES, ...(settings?.customPossibleCauses ?? [])];
}

/**
 * Upgrade older saved data in place. Never discards inspection records.
 * v1 -> v2: adds site visit state, photo list and the active inspection.
 */
export function migrateState(state: Partial<DataState>, version: number): Partial<DataState> {
  const out: Partial<DataState> = { ...state };
  if (version < 2) {
    out.inspections = (state.inspections ?? []).map((i) => ({
      ...i,
      siteVisit: i.siteVisit ?? (["Draft", "In Progress"].includes(i.status) ? newSiteVisit() : { ...newSiteVisit(), state: "completed" as const }),
    }));
    out.photos = state.photos ?? [];
    out.activeInspectionId = state.activeInspectionId ?? null;
  }
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}
