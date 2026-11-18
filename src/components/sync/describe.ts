import type { DataState } from "@/lib/store/store";
import type { TableName } from "@/lib/sync/mapping";
import { locationLabel } from "@/lib/domain/csv";

const TABLE_LABEL: Record<TableName, string> = {
  customers: "Customer", facilities: "Facility", locations: "Room", equipment: "Equipment", inspections: "Inspection",
  inspection_assignments: "Assignment", room_conditions: "Room conditions", results: "Equipment line", thermal_images: "Thermal image", review_events: "History entry", exterior_checks: "Front photo reminder",
};

const FIELD_LABEL: Record<string, string> = {
  name: "Name", building: "Building", area: "Area", equipment_type: "Type", default_component: "Component",
  humidity: "Humidity", ambient_temp: "Ambient Temp", background_temp: "Background Temp", image_date: "Image Date", completed_at: "Room finished",
  conditions_copied_from: "Copied conditions", opened: "Opened", exception: "Not scanned / deferred", confidence: "Confidence", review_notes: "Review Notes",
  overrides: "Overrides", component: "Component", ir_image_number: "IR Image Number", visual_image_number: "Visual Image Number", distance: "Distance",
  possible_cause: "Possible Cause", max_temp: "Max Temp", notes: "Notes", status: "Status", date: "Date", address: "Address",
  __deleted: "Record", __delete: "Record",
};

export const tableLabel = (t: TableName) => TABLE_LABEL[t] ?? t;
export const fieldLabel = (f: string) => FIELD_LABEL[f] ?? f.replace(/_/g, " ");

export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(blank)";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("kind" in o) return `${o.kind === "not-scanned" ? "Not scanned" : "Deferred"}${o.note ? `: ${o.note}` : ""}`;
    return JSON.stringify(v);
  }
  return String(v);
}

/** Plain-language name of a record, e.g. "Panel P1 · Electrical Room". */
export function describeRecord(s: DataState, table: TableName, id: string): string {
  const loc = (lid: string) => { const l = s.locations.find((x) => x.id === lid); return l ? locationLabel(l) : ""; };
  const eqName = (eid: string) => s.equipment.find((e) => e.id === eid)?.name ?? "";
  switch (table) {
    case "customers": return s.customers.find((x) => x.id === id)?.name ?? "";
    case "facilities": return s.facilities.find((x) => x.id === id)?.name ?? "";
    case "locations": return loc(id);
    case "equipment": return eqName(id);
    case "inspections": { const i = s.inspections.find((x) => x.id === id); return i ? `${s.facilities.find((f) => f.id === i.facilityId)?.name ?? ""} ${i.date}` : ""; }
    case "room_conditions": { const r = s.rooms.find((x) => x.id === id); return r ? loc(r.locationId) : ""; }
    case "results": { const r = s.results.find((x) => x.id === id); return r ? [eqName(r.equipmentId), loc(r.locationId)].filter(Boolean).join(" · ") : ""; }
    case "thermal_images": {
      const r = s.results.find((x) => x.images.some((i) => i.id === id));
      const n = r ? r.images.findIndex((i) => i.id === id) + 1 : 0;
      return r ? `${eqName(r.equipmentId)} · image ${n}` : "";
    }
    default: return "";
  }
}
