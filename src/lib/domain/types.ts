/**
 * InfraReport domain model.
 *
 * Every tenant-owned record carries `organizationId`. In the prototype the
 * browser store filters by the active organization; in production the same
 * field becomes the row-level-security key (Postgres RLS / Supabase policies)
 * so one company can never read another company's customers or inspections.
 *
 * Permanent identity (Equipment, Location) is deliberately separate from
 * per-visit data (InspectionResult, InspectionRoomConditions). Panel P1 keeps
 * the same Equipment id year after year; each annual inspection creates a new
 * InspectionResult that references it.
 */

export type ID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

/**
 * Numeric field values are stored as normalized strings rather than numbers so
 * that "blank" (never measured) is distinguishable from 0 and the inspector's
 * entered precision (e.g. "0.95", "74.0") is preserved for export.
 */
export type NumericText = string;

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  isDemo: boolean;
  createdAt: ISODateTime;
  settings: OrganizationSettings;
}

export interface OrganizationSettings {
  defaultEmissivity: NumericText;
  /** Org-extendable controlled vocabulary. Built-ins are always present. */
  customPossibleCauses: string[];
  csvIncludeBom: boolean;
}

export type UserRole = "owner" | "admin" | "inspector" | "reviewer";

export interface User {
  id: ID;
  organizationId: ID;
  name: string;
  email: string;
  role: UserRole;
  certification?: string;
}

export interface Customer {
  id: ID;
  organizationId: ID;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  createdAt: ISODateTime;
}

export interface Facility {
  id: ID;
  organizationId: ID;
  customerId: ID;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
  createdAt: ISODateTime;
}

/** A permanent room / electrical area inside a facility. */
export interface Location {
  id: ID;
  organizationId: ID;
  facilityId: ID;
  building: string;
  name: string;
  area: string; // electrical area / floor / wing
  sortOrder: number;
}

/** Permanent equipment identity. Survives across inspections. */
export interface Equipment {
  id: ID;
  organizationId: ID;
  facilityId: ID;
  locationId: ID;
  name: string; // e.g. "Panel P1"
  equipmentType: string; // preset key or free text
  defaultComponent: string;
  /** Permanent identifiers from an imported list (asset tag, serial, etc.). */
  identifiers?: string;
  /** File the record was imported from, if any. */
  importedFrom?: string;
  active: boolean;
  sortOrder: number;
  createdAt: ISODateTime;
}

export type InspectionStatus =
  | "Draft"
  | "In Progress"
  | "Needs Review"
  | "Approved"
  | "Report Generated"
  | "Delivered";

export interface Inspection {
  id: ID;
  organizationId: ID;
  customerId: ID;
  facilityId: ID;
  date: ISODate;
  /** Thermographers on this inspection (one or more). */
  inspectorIds: ID[];
  status: InspectionStatus;
  defaultEmissivity: NumericText;
  notes: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Field workflow state. Separate from the review status above. */
  siteVisit: SiteVisit;
}

export type SiteVisitState = "not-started" | "active" | "paused" | "completed";

/** One on-site work period (a day, or part of a day). */
export interface VisitSession {
  startedAt: ISODateTime;
  endedAt: ISODateTime | null;
}

export interface SiteVisit {
  state: SiteVisitState;
  sessions: VisitSession[];
  lastActiveLocationId: ID | null;
  /** True once the inspector chose "Skip for Now" on the initial exterior photo prompt. */
  skippedExteriorPrompt: boolean;
  completedAt: ISODateTime | null;
}

/** Environmental defaults for one room during one inspection. */
export interface InspectionRoomConditions {
  id: ID;
  organizationId: ID;
  inspectionId: ID;
  locationId: ID;
  humidity: NumericText;
  ambientTemp: NumericText;
  backgroundTemp: NumericText;
  /** Legacy (schema v2). Distance is now recorded per equipment; always "". */
  distance: NumericText;
  imageDate: ISODate | ""; // blank = inspection date
  /** Name of the room the conditions were copied from, until the inspector confirms or edits them here. */
  conditionsCopiedFrom: string | null;
  /** Set when the inspector finishes the room (humidity present, all equipment addressed). */
  completedAt: ISODateTime | null;
}

/**
 * Overrides: `null` means "inherit from room / inspection". Any string,
 * including "", is an explicit inspector value for this row only.
 */
export interface ResultOverrides {
  humidity: NumericText | null;
  ambientTemp: NumericText | null;
  backgroundTemp: NumericText | null;
  /** Legacy (schema v2). Distance moved to InspectionResult.distance; always null. */
  distance: NumericText | null;
  imageDate: ISODate | null;
  emissivity: NumericText | null;
}

export type ResultSource = "manual" | "field-notes" | "carried-forward";

/** One equipment item as found during one inspection. */
export interface InspectionResult {
  id: ID;
  organizationId: ID;
  inspectionId: ID;
  equipmentId: ID;
  locationId: ID; // where it was inspected this time
  /**
   * Thermal image / measurement entries for this equipment during this
   * inspection (e.g. Top Half, Bottom Half). Always at least one. Each entry
   * becomes one Generator row; the equipment still counts once.
   */
  images: ThermalImage[];
  /** Access status for the whole item (approved Opened value). */
  opened: string;
  /** Item documented as not scanned or deferred (no fake image numbers needed). */
  exception: ResultException | null;
  confidence: string;
  reviewNotes: string;
  overrides: ResultOverrides;
  source: ResultSource;
  sortOrder: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ThermalImage {
  id: ID;
  /** Component or area photographed: Full Panel, Top Half, Section 2, Circuit 11... */
  component: string;
  irImageNumber: string;
  /** Follows irImageNumber unless visualOverridden. Always stored as exported. */
  visualImageNumber: string;
  visualOverridden: boolean;
  /** Distance in feet for this image. */
  distance: NumericText;
  possibleCause: string;
  /** Measured problem temperature; only when a finding is documented. */
  maxTemp: NumericText;
  notes: string;
}

export type ResultExceptionKind = "not-scanned" | "deferred";

export interface ResultException {
  kind: ResultExceptionKind;
  note: string;
  at: ISODateTime;
}

export type ImageKind = "thermal" | "visual" | "unknown";

/** Metadata only in the prototype; binary storage arrives with secure storage. */
export interface ImageAsset {
  id: ID;
  organizationId: ID;
  inspectionId: ID;
  fileName: string;
  imageNumber: string;
  kind: ImageKind;
  matchedResultId: ID | null;
  verified: boolean;
}

export type PhotoKind = "exterior" | "equipment" | "before-opening";

/**
 * A photo captured or uploaded from the inspector's device. The binary lives in
 * IndexedDB (never localStorage); this record is only created after the binary
 * write has been verified, so a Photo row always means "saved on this device".
 */
export interface Photo {
  id: ID;
  organizationId: ID;
  inspectionId: ID;
  facilityId: ID;
  kind: PhotoKind;
  /** Building key for exterior photos ("" = main building / no building name). */
  building: string;
  resultId: ID | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: ISODateTime;
  savedAt: ISODateTime;
  /** Optional note (used for before-opening condition photos). */
  note?: string;
}

export type DocumentKind = "field-notes" | "report" | "workbook" | "other";

export interface DocumentAsset {
  id: ID;
  organizationId: ID;
  inspectionId: ID | null;
  kind: DocumentKind;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  pageCount: number | null;
  uploadedAt: ISODateTime;
  extractionStatus: "not-started" | "unavailable" | "queued" | "complete";
}

export interface ReviewEvent {
  id: ID;
  organizationId: ID;
  inspectionId: ID;
  at: ISODateTime;
  actorId: ID;
  action: string;
  detail: string;
}
