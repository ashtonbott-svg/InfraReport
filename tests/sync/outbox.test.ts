import { describe, expect, it } from "vitest";
import { decideField, emptySyncData, orderedOps, recordChanges, settleOp, type SyncData } from "@/lib/sync/outbox";
import { customerRow, extractRecords, imageRow, resultRow, toImage, toResult, type SyncRecord } from "@/lib/sync/mapping";
import { upsertImage } from "@/lib/sync/engine";
import { newThermalImage } from "@/lib/domain/thermal";
import type { InspectionResult } from "@/lib/domain/types";

const rec = (table: SyncRecord["table"], id: string, row: Record<string, unknown>): [string, SyncRecord] => [`${table}:${id}`, { table, id, row: { id, organization_id: "o", ...row } }];
const map = (...r: [string, SyncRecord][]) => new Map(r);

describe("outbox", () => {
  it("a new record becomes an insert (no base version)", () => {
    const d = recordChanges(emptySyncData("u", "o"), map(), map(rec("customers", "c1", { name: "A" })));
    expect(d.ops["customers:c1"]).toMatchObject({ kind: "upsert", baseVersion: null, changed: ["name"] });
  });

  it("edits merge into one op per record and remember the value they started from", () => {
    let d: SyncData = { ...emptySyncData("u", "o"), versions: { "customers:c1": 3 } };
    d = recordChanges(d, map(rec("customers", "c1", { name: "A", notes: "" })), map(rec("customers", "c1", { name: "B", notes: "" })));
    d = recordChanges(d, map(rec("customers", "c1", { name: "B", notes: "" })), map(rec("customers", "c1", { name: "C", notes: "x" })));
    const op = d.ops["customers:c1"];
    expect(Object.keys(d.ops)).toHaveLength(1);
    expect(op).toMatchObject({ baseVersion: 3, row: { name: "C", notes: "x" }, base: { name: "A", notes: "" } });
    expect(op.changed.sort()).toEqual(["name", "notes"]);
  });

  it("deleting a record that never reached the server just drops it", () => {
    let d = recordChanges(emptySyncData("u", "o"), map(), map(rec("customers", "c1", { name: "A" })));
    d = recordChanges(d, map(rec("customers", "c1", { name: "A" })), map());
    expect(d.ops).toEqual({});
  });

  it("deleting after a send attempt still deletes on the server (the insert may have landed)", () => {
    let d = recordChanges(emptySyncData("u", "o"), map(), map(rec("customers", "c1", { name: "A" })));
    d = { ...d, ops: { "customers:c1": { ...d.ops["customers:c1"], sentOnce: true } } };
    d = recordChanges(d, map(rec("customers", "c1", { name: "A" })), map());
    expect(d.ops["customers:c1"].kind).toBe("delete");
  });

  it("field decisions: already applied / safe to apply / conflict", () => {
    const op = { ...recordChanges({ ...emptySyncData("u", "o"), versions: { "thermal_images:i": 1 } }, map(rec("thermal_images", "i", { max_temp: "" })), map(rec("thermal_images", "i", { max_temp: "141" }))).ops["thermal_images:i"] };
    expect(decideField(op, "max_temp", { max_temp: "141" })).toBe("applied");
    expect(decideField(op, "max_temp", { max_temp: "" })).toBe("apply");
    expect(decideField(op, "max_temp", { max_temp: "147" })).toBe("conflict");
  });

  it("settling keeps a field that was edited again while the upload was in flight", () => {
    let d: SyncData = { ...emptySyncData("u", "o"), versions: { "customers:c1": 1 } };
    d = recordChanges(d, map(rec("customers", "c1", { name: "A" })), map(rec("customers", "c1", { name: "B" })));
    const sent = { name: "B" };
    d = recordChanges(d, map(rec("customers", "c1", { name: "B" })), map(rec("customers", "c1", { name: "BC" })));
    d = settleOp(d, "customers:c1", sent, { name: "B", version: 2 }, 2);
    expect(d.ops["customers:c1"]).toMatchObject({ changed: ["name"], base: { name: "B" }, baseVersion: 2, row: { name: "BC" } });
    expect(d.versions["customers:c1"]).toBe(2);
  });

  it("parents upload before children; children are deleted before parents", () => {
    let d = recordChanges(emptySyncData("u", "o"), map(), map(rec("thermal_images", "i", { result_id: "r" }), rec("results", "r", {}), rec("inspections", "x", {})));
    expect(orderedOps(d).map((o) => o.table)).toEqual(["inspections", "results", "thermal_images"]);
    d = { ...d, versions: { "results:r": 1, "thermal_images:i": 1, "inspections:x": 1 }, ops: {} };
    d = recordChanges(d, map(rec("thermal_images", "i", { result_id: "r" }), rec("results", "r", {}), rec("inspections", "x", {})), map());
    expect(orderedOps(d).map((o) => o.table)).toEqual(["thermal_images", "results", "inspections"]);
  });
});

describe("mapping", () => {
  it("a result and its images survive the round trip to database rows unchanged", () => {
    const r: InspectionResult = {
      id: "r1", organizationId: "o", inspectionId: "i1", equipmentId: "e1", locationId: "l1",
      images: [newThermalImage({ id: "a", component: "Lugs", irImageNumber: "0101", distance: "4", possibleCause: "Loose Connection(s)", maxTemp: "131.7", notes: "hot" }), newThermalImage({ id: "b", irImageNumber: "102", visualImageNumber: "900", visualOverridden: true })],
      opened: "Can’t Open Item", exception: { kind: "deferred", note: "locked", at: "2026-11-18T00:00:00Z" }, confidence: "", reviewNotes: "x",
      overrides: { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: "0.9" }, source: "manual", sortOrder: 3, createdAt: "c", updatedAt: "u",
    };
    const back = toResult({ ...resultRow(r), created_at: "c", updated_at: "u" }, r.images.map((img, i) => toImage(imageRow(r, img, i))));
    expect(back).toEqual(r);
  });

  it("only records of the cloud organization are synced; device-only records are never touched", () => {
    const recs = extractRecords({ customers: [{ id: "c1", organizationId: "org-demo", name: "Old", contactName: "", contactEmail: "", contactPhone: "", notes: "", createdAt: "" }, { id: "c2", organizationId: "cloud", name: "New", contactName: "", contactEmail: "", contactPhone: "", notes: "", createdAt: "" }], facilities: [], locations: [], equipment: [], inspections: [], rooms: [], results: [], reviewEvents: [] }, "cloud");
    expect([...recs.keys()]).toEqual(["customers:c2"]);
    expect(customerRow({ id: "c2", organizationId: "cloud", name: "New", contactName: "", contactEmail: "", contactPhone: "", notes: "", createdAt: "" })).not.toHaveProperty("created_at");
  });

  it("a real image from another phone replaces this phone's blank placeholder, never a typed one", () => {
    const blank = newThermalImage({ id: "ph" });
    const typed = newThermalImage({ id: "t", irImageNumber: "5" });
    const incoming = newThermalImage({ id: "srv", irImageNumber: "9" });
    expect(upsertImage([blank], incoming, 0, () => true).map((i) => i.id)).toEqual(["srv"]);
    expect(upsertImage([typed], incoming, 1, () => true).map((i) => i.id)).toEqual(["t", "srv"]);
  });
});
