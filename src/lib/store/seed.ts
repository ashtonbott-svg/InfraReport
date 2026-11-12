/**
 * Initial application data: an empty workspace for Infinite Infrared with the
 * two thermographers who can be assigned to inspections. No sample customers,
 * facilities, equipment or inspections are created.
 *
 * The thermographers are selectable names, not authenticated user accounts.
 */
import { DEFAULT_EMISSIVITY } from "../domain/constants";
import type {
  Customer, Equipment, Facility, Inspection, InspectionResult, InspectionRoomConditions, Location, Organization, ReviewEvent, User,
} from "../domain/types";

export const DEFAULT_ORG_ID = "org-demo"; // id kept stable so existing saved data stays attached
export const ASHTON_ID = "user-ashton";
export const JUSTICE_ID = "user-justice";

export const THERMOGRAPHERS: User[] = [
  { id: ASHTON_ID, organizationId: DEFAULT_ORG_ID, name: "Ashton Bott", email: "", role: "owner", certification: "Level III Certified Master Thermographer" },
  { id: JUSTICE_ID, organizationId: DEFAULT_ORG_ID, name: "Justice Thompson", email: "", role: "inspector", certification: "Level I Thermographer" },
];

/** Ids of the fictional records shipped in earlier prototype releases. */
export const LEGACY_DEMO_IDS = {
  customers: ["cust-1", "cust-2", "cust-3"],
  facilities: ["fac-1", "fac-2", "fac-3"],
  inspections: ["insp-1", "insp-2", "insp-3"],
  users: ["user-1", "user-2"],
};

export interface SeedData {
  organizations: Organization[];
  users: User[];
  customers: Customer[];
  facilities: Facility[];
  locations: Location[];
  equipment: Equipment[];
  inspections: Inspection[];
  rooms: InspectionRoomConditions[];
  results: InspectionResult[];
  reviewEvents: ReviewEvent[];
}

export function buildSeed(): SeedData {
  return {
    organizations: [{
      id: DEFAULT_ORG_ID,
      name: "Infinite Infrared LLC",
      slug: "infinite-infrared",
      isDemo: false,
      createdAt: "2026-11-12T00:00:00.000Z",
      settings: { defaultEmissivity: DEFAULT_EMISSIVITY, customPossibleCauses: [], csvIncludeBom: true },
    }],
    users: THERMOGRAPHERS.map((u) => ({ ...u })),
    customers: [],
    facilities: [],
    locations: [],
    equipment: [],
    inspections: [],
    rooms: [],
    results: [],
    reviewEvents: [],
  };
}
