/**
 * FICTIONAL DEMONSTRATION DATA.
 * Every company, person, address, and reading below is invented for the
 * prototype. Do not replace with real customer records in this demo build.
 */
import { DEFAULT_EMISSIVITY, DEFAULT_OPENED, POSSIBLE_CAUSE_NONE } from "../domain/constants";
import { EMPTY_OVERRIDES, defaultComponentForType } from "../domain/rules";
import type {
  Customer,
  Equipment,
  Facility,
  Inspection,
  InspectionResult,
  InspectionRoomConditions,
  Location,
  Organization,
  ReviewEvent,
  User,
} from "../domain/types";

export const DEMO_ORG_ID = "org-demo";
const ORG = DEMO_ORG_ID;
const T0 = "2026-01-05T15:00:00.000Z";

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
  const organizations: Organization[] = [
    {
      id: ORG,
      name: "Demo Thermography Co. (Fictional)",
      slug: "demo",
      isDemo: true,
      createdAt: T0,
      settings: { defaultEmissivity: DEFAULT_EMISSIVITY, customPossibleCauses: [], csvIncludeBom: true },
    },
  ];

  const users: User[] = [
    { id: "user-1", organizationId: ORG, name: "Jordan Reyes", email: "jordan@example.com", role: "owner", certification: "Level II Thermographer" },
    { id: "user-2", organizationId: ORG, name: "Sam Okafor", email: "sam@example.com", role: "inspector", certification: "Level I Thermographer" },
  ];

  const customers: Customer[] = [
    { id: "cust-1", organizationId: ORG, name: "Northwind Cold Storage", contactName: "Alex Morgan", contactEmail: "facilities@northwind.example", contactPhone: "(555) 010-2200", notes: "Annual inspection every March.", createdAt: T0 },
    { id: "cust-2", organizationId: ORG, name: "Riverbend Medical Center", contactName: "Priya Natarajan", contactEmail: "engineering@riverbend.example", contactPhone: "(555) 010-3300", notes: "Escort required in patient areas.", createdAt: T0 },
    { id: "cust-3", organizationId: ORG, name: "Apex Plastics Manufacturing", contactName: "Chris Delaney", contactEmail: "maint@apexplastics.example", contactPhone: "(555) 010-4400", notes: "", createdAt: T0 },
  ];

  const facilities: Facility[] = [
    { id: "fac-1", organizationId: ORG, customerId: "cust-1", name: "Distribution Center 4", address: "1200 Example Parkway", city: "Springfield", state: "TX", postalCode: "75000", notes: "", createdAt: T0 },
    { id: "fac-2", organizationId: ORG, customerId: "cust-2", name: "Main Hospital Campus", address: "45 Sample Avenue", city: "Riverbend", state: "TX", postalCode: "75001", notes: "Generator room keyed by security.", createdAt: T0 },
    { id: "fac-3", organizationId: ORG, customerId: "cust-3", name: "Plant 2", address: "800 Industrial Way", city: "Lakeside", state: "TX", postalCode: "75002", notes: "", createdAt: T0 },
  ];

  const locations: Location[] = [
    { id: "loc-1", organizationId: ORG, facilityId: "fac-1", building: "Building A", name: "Electrical Room 1", area: "Ground floor", sortOrder: 1 },
    { id: "loc-2", organizationId: ORG, facilityId: "fac-1", building: "Building A", name: "Mezzanine MCC", area: "Mezzanine", sortOrder: 2 },
    { id: "loc-3", organizationId: ORG, facilityId: "fac-1", building: "Building B", name: "Main Switchgear Room", area: "", sortOrder: 3 },
    { id: "loc-4", organizationId: ORG, facilityId: "fac-2", building: "Tower 1", name: "Basement Electrical", area: "B1", sortOrder: 1 },
    { id: "loc-5", organizationId: ORG, facilityId: "fac-3", building: "", name: "Production Floor", area: "Line 3", sortOrder: 1 },
  ];

  let eqOrder = 0;
  const eq = (id: string, facilityId: string, locationId: string, name: string, type: string, component?: string): Equipment => ({
    id, organizationId: ORG, facilityId, locationId, name, equipmentType: type,
    defaultComponent: component ?? defaultComponentForType(type), active: true, sortOrder: ++eqOrder, createdAt: T0,
  });

  const equipment: Equipment[] = [
    eq("eq-1", "fac-1", "loc-1", "Panel P1", "Panel"),
    eq("eq-2", "fac-1", "loc-1", "Panel P2", "Panel"),
    eq("eq-3", "fac-1", "loc-1", "Transformer T1", "Transformer"),
    eq("eq-4", "fac-1", "loc-1", "Disconnect D1", "Disconnect"),
    eq("eq-5", "fac-1", "loc-2", "MCC-1 Starter 3", "Starter"),
    eq("eq-6", "fac-1", "loc-2", "MCC-1 Starter 4", "Starter"),
    eq("eq-7", "fac-1", "loc-2", "Control Cabinet CC-2", "Cabinet"),
    eq("eq-8", "fac-1", "loc-3", "Main Switchgear MSG", "Switchgear"),
    eq("eq-9", "fac-1", "loc-3", "Main Breaker MB-1", "Breaker"),
    eq("eq-10", "fac-1", "loc-3", "Lighting Contactor LC-1", "Contactor"),
    eq("eq-11", "fac-2", "loc-4", "Panel EM-1", "Panel"),
    eq("eq-12", "fac-2", "loc-4", "ATS Disconnect", "Disconnect"),
    eq("eq-13", "fac-3", "loc-5", "Line 3 Panel LP-3", "Panel"),
  ];

  const inspections: Inspection[] = [
    { id: "insp-1", organizationId: ORG, customerId: "cust-1", facilityId: "fac-1", date: "2025-03-11", inspectorId: "user-1", status: "Delivered", defaultEmissivity: DEFAULT_EMISSIVITY, notes: "Prior year inspection (fictional).", createdAt: "2025-03-11T14:00:00.000Z", updatedAt: "2025-03-20T14:00:00.000Z" },
    { id: "insp-2", organizationId: ORG, customerId: "cust-1", facilityId: "fac-1", date: "2026-03-10", inspectorId: "user-1", status: "In Progress", defaultEmissivity: DEFAULT_EMISSIVITY, notes: "", createdAt: "2026-03-10T13:00:00.000Z", updatedAt: "2026-03-10T19:00:00.000Z" },
    { id: "insp-3", organizationId: ORG, customerId: "cust-2", facilityId: "fac-2", date: "2026-04-02", inspectorId: "user-2", status: "Draft", defaultEmissivity: DEFAULT_EMISSIVITY, notes: "", createdAt: "2026-03-28T13:00:00.000Z", updatedAt: "2026-03-28T13:00:00.000Z" },
  ];

  const room = (id: string, inspectionId: string, locationId: string, humidity: string, ambient: string, background: string, distance: string): InspectionRoomConditions => ({
    id, organizationId: ORG, inspectionId, locationId, humidity, ambientTemp: ambient, backgroundTemp: background, distance, imageDate: "",
  });

  const rooms: InspectionRoomConditions[] = [
    room("rc-1", "insp-1", "loc-1", "42", "72", "71", "4"),
    room("rc-2", "insp-1", "loc-3", "40", "75", "74", "5"),
    room("rc-3", "insp-2", "loc-1", "45", "74", "73", "4"),
    room("rc-4", "insp-2", "loc-2", "48", "81", "79", "3"),
    room("rc-5", "insp-2", "loc-3", "", "", "", ""),
  ];

  let rOrder = 0;
  const res = (
    id: string, inspectionId: string, equipmentId: string, locationId: string,
    patch: Partial<InspectionResult> = {},
  ): InspectionResult => {
    const e = equipment.find((x) => x.id === equipmentId)!;
    return {
      id, organizationId: ORG, inspectionId, equipmentId, locationId,
      component: e.defaultComponent, irImageNumber: "", visualImageNumber: "", visualFromSinglePhoto: false,
      maxTemp: "", opened: DEFAULT_OPENED, possibleCause: POSSIBLE_CAUSE_NONE, problemNotes: "",
      confidence: "", reviewNotes: "", overrides: { ...EMPTY_OVERRIDES }, source: "manual",
      sortOrder: ++rOrder, createdAt: T0, updatedAt: T0, ...patch,
    };
  };

  const results: InspectionResult[] = [
    // Prior year (delivered)
    res("r-1", "insp-1", "eq-1", "loc-1", { irImageNumber: "0101", visualImageNumber: "0102", maxTemp: "88.4" }),
    res("r-2", "insp-1", "eq-2", "loc-1", { irImageNumber: "0103", visualImageNumber: "0104", maxTemp: "79.0" }),
    res("r-3", "insp-1", "eq-8", "loc-3", { irImageNumber: "0110", visualImageNumber: "0111", maxTemp: "92.1" }),
    // Current year, in progress
    res("r-10", "insp-2", "eq-1", "loc-1", { irImageNumber: "1021", visualImageNumber: "1022", maxTemp: "86.2" }),
    res("r-11", "insp-2", "eq-2", "loc-1", { component: "Circuit 11", irImageNumber: "1023", visualImageNumber: "1024", maxTemp: "131.7", possibleCause: "Loose Connection(s)", problemNotes: "Circuit 11 lug 57°F above similar. Recommend re-torque." }),
    res("r-12", "insp-2", "eq-3", "loc-1", { irImageNumber: "1025", visualImageNumber: "1025", visualFromSinglePhoto: true, maxTemp: "104.5", overrides: { ...EMPTY_OVERRIDES, distance: "6" } }),
    res("r-13", "insp-2", "eq-4", "loc-1", { opened: "Item is Locked Out" }),
    res("r-14", "insp-2", "eq-5", "loc-2", { irImageNumber: "1030", visualImageNumber: "1031", maxTemp: "97.3" }),
    res("r-15", "insp-2", "eq-6", "loc-2", { opened: "Item Was Off at Time of Scan" }),
    res("r-16", "insp-2", "eq-7", "loc-2", { opened: "Yes, with Dead-Front on", irImageNumber: "1032", visualImageNumber: "1033", maxTemp: "" }),
  ];

  const reviewEvents: ReviewEvent[] = [
    { id: "ev-1", organizationId: ORG, inspectionId: "insp-1", at: "2025-03-20T14:00:00.000Z", actorId: "user-1", action: "Status changed", detail: "Report Generated → Delivered" },
    { id: "ev-2", organizationId: ORG, inspectionId: "insp-2", at: "2026-03-10T13:00:00.000Z", actorId: "user-1", action: "Inspection created", detail: "Equipment carried forward from facility inventory" },
  ];

  return { organizations, users, customers, facilities, locations, equipment, inspections, rooms, results, reviewEvents };
}
