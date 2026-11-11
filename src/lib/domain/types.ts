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
  inspectorId: ID;
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
  distance: NumericText;
  imageDate: ISODate | ""; // blank = inspection date
}

/**
 * Overrides: `null` means "inherit from room / inspection". Any string,
 * including "", is an explicit inspector value for this row only.
 */
export interface ResultOverrides {
  humidity: NumericText | null;
  ambientTemp: NumericText | null;
  backgroundTemp: NumericText | null;
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
  component: string;
  irImageNumber: string;
  visualImageNumber: string;
  /** True when the Visual number was copied from a single recorded photo number. */
  visualFromSinglePhoto: boolean;
  maxTemp: NumericText;
  opened: string;
  possibleCause: string;
  problemNotes: string;
  confidence: string;
  reviewNotes: string;
  overrides: ResultOverrides;
  source: ResultSource;
  sortOrder: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
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

export type PhotoKind = "exterior" | "equipment";

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
