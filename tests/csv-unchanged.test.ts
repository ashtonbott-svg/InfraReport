import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrateState, type DataState } from "@/lib/store/store";
import { buildGeneratorRows, toCsv } from "@/lib/domain/csv";
import { buildSeed as buildV2Demo } from "./fixtures/demo-seed-v2";

/**
 * Saved data from earlier releases must keep exporting exactly the same CSV
 * after the upgrade (distance moved from rooms to each equipment record,
 * thermographer list replaced, demo seed removed).
 */
describe("Generator CSV compatibility across upgrades", () => {
  it("v2 demo inspection exports byte-identically after migrating to the current schema", () => {
    const v2 = { ...buildV2Demo(), images: [], documents: [], photos: [], activeInspectionId: null, currentOrgId: "org-demo", currentUserId: "user-1" } as unknown as Partial<DataState>;
    const st = migrateState(v2, 2) as DataState;
    const id = "insp-2";
    const ds = {
      inspection: st.inspections.find((i) => i.id === id)!,
      results: st.results.filter((r) => r.inspectionId === id),
      equipment: new Map(st.equipment.map((e) => [e.id, e])),
      locations: new Map(st.locations.map((l) => [l.id, l])),
      rooms: st.rooms.filter((r) => r.inspectionId === id),
    };
    expect(st.rooms.every((r) => r.distance === "")).toBe(true);
    expect(st.results.every((r) => r.overrides.distance === null)).toBe(true);
    const csv = toCsv(buildGeneratorRows(ds), { includeBom: true });
    expect(csv).toBe(readFileSync("tests/fixtures/insp-2.golden.csv", "utf8"));
  });

  it("migration keeps records, maps thermographers and leaves sample data in place until cleared", () => {
    const v2 = { ...buildV2Demo(), images: [], documents: [], photos: [], activeInspectionId: null } as unknown as Partial<DataState>;
    const st = migrateState(v2, 2) as DataState;
    expect(st.customers).toHaveLength(3);
    expect(st.results).toHaveLength(10);
    expect(st.users.map((u) => u.name)).toEqual(["Ashton Bott", "Justice Thompson"]);
    expect(st.inspections.every((i) => Array.isArray(i.inspectorIds) && i.inspectorIds.length === 0)).toBe(true);
    expect(st.inspections.some((i) => "inspectorId" in i)).toBe(false);
  });
});
