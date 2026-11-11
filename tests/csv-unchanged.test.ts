import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { useStore } from "@/lib/store/store";
import { buildGeneratorRows, toCsv } from "@/lib/domain/csv";

describe("Generator CSV is unchanged by the mobile workflow release", () => {
  it("demo inspection export is byte-identical to the pre-release reference", () => {
    useStore.getState().resetDemoData();
    const st = useStore.getState();
    const id = "insp-2";
    const ds = { inspection: st.inspections.find((i) => i.id === id)!, results: st.results.filter((r) => r.inspectionId === id), equipment: new Map(st.equipment.map((e) => [e.id, e])), locations: new Map(st.locations.map((l) => [l.id, l])), rooms: st.rooms.filter((r) => r.inspectionId === id) };
    const csv = toCsv(buildGeneratorRows(ds), { includeBom: true });
    expect(csv).toBe(readFileSync("tests/fixtures/insp-2.golden.csv", "utf8"));
  });
});
