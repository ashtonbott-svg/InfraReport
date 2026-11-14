import { beforeEach, describe, expect, it } from "vitest";
import { useStore, migrateState, type DataState } from "@/lib/store/store";
import { buildGeneratorRows, parseCsv, toCsv, type ExportDataset } from "@/lib/domain/csv";
import { checkRoom, conditionStatus, newThermalImage, nextComponent, patchThermalImage, resultStatus, roomProgress } from "@/lib/domain/thermal";

const S = () => useStore.getState();
function job() {
  const customerId = S().createCustomer({ name: "TopGolf Canton (test)", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
  const facilityId = S().createFacility({ customerId, name: "Venue", address: "", city: "", state: "", postalCode: "", notes: "" });
  S().importInventory(facilityId, [
    { building: "", room: "Electrical Room 1", name: "Panel P1", type: "Panel", component: "Full Panel" },
    { building: "", room: "Electrical Room 1", name: "Switchboard MSB", type: "Other", component: "Main" },
    { building: "", room: "Electrical Room 1", name: "Disconnect D2", type: "Disconnect", component: "Full Disconnect" },
    { building: "", room: "Electrical Room 2", name: "Panel P11", type: "Panel", component: "Full Panel" },
  ], "list.pdf");
  const id = S().createInspection({ customerId, facilityId, date: "2026-11-13", inspectorIds: ["user-ashton"], carryForward: true });
  const byName = (n: string) => S().results.find((r) => r.inspectionId === id && S().equipment.find((e) => e.id === r.equipmentId)?.name === n)!;
  return { id, facilityId, byName };
}
const ds = (inspectionId: string): ExportDataset => {
  const s = S();
  return { inspection: s.inspections.find((i) => i.id === inspectionId)!, results: s.results.filter((r) => r.inspectionId === inspectionId), equipment: new Map(s.equipment.map((e) => [e.id, e])), locations: new Map(s.locations.map((l) => [l.id, l])), rooms: s.rooms.filter((r) => r.inspectionId === inspectionId) };
};

describe("visual image number follows IR", () => {
  it("auto-fills, can be overridden, and follows again when switched back", () => {
    let img = newThermalImage({ component: "Top Half" });
    img = patchThermalImage(img, { irImageNumber: "104" });
    expect(img.visualImageNumber).toBe("104");
    img = patchThermalImage(img, { irImageNumber: "1045" });
    expect(img.visualImageNumber).toBe("1045");
    img = patchThermalImage(img, { visualOverridden: true, visualImageNumber: "2001" });
    img = patchThermalImage(img, { irImageNumber: "105" });
    expect([img.irImageNumber, img.visualImageNumber]).toEqual(["105", "2001"]);
    img = patchThermalImage(img, { visualOverridden: false });
    expect(img.visualImageNumber).toBe("105");
  });
  it("normalizes distance and never invents a max temp", () => {
    const img = patchThermalImage(newThermalImage(), { distance: "4 ft", irImageNumber: " 104 " });
    expect([img.distance, img.irImageNumber, img.maxTemp]).toEqual(["4", "104", ""]);
  });
  it("suggests the next component", () => {
    expect(nextComponent(["Top Half"])).toBe("Bottom Half");
    expect(nextComponent(["Left Side"])).toBe("Right Side");
    expect(nextComponent(["Distribution Section 1"])).toBe("Distribution Section 2");
    expect(nextComponent(["Full Panel"])).toBe("");
  });
});

describe("multiple thermal images per equipment", () => {
  beforeEach(() => S().resetDemoData());

  it("keeps one equipment record and exports one Generator row per image", () => {
    const { id, facilityId, byName } = job();
    const p1 = byName("Panel P1");
    S().updateThermalImage(p1.id, p1.images[0].id, { component: "Top Half", irImageNumber: "104", distance: "4" });
    S().addThermalImage(p1.id, { component: "Bottom Half", irImageNumber: "105", distance: "3" });
    const msb = byName("Switchboard MSB");
    S().updateThermalImage(msb.id, msb.images[0].id, { component: "Main", irImageNumber: "201", distance: "6" });
    for (const [c, n] of [["Bus", "202"], ["Distribution Section 1", "203"], ["Distribution Section 2", "204"]]) S().addThermalImage(msb.id, { component: c, irImageNumber: n, distance: "6" });
    const d2 = byName("Disconnect D2");
    S().updateThermalImage(d2.id, d2.images[0].id, { irImageNumber: "301", distance: "5" });
    S().updateThermalImage(d2.id, d2.images[0].id, { visualOverridden: true, visualImageNumber: "302" });

    expect(S().equipment.filter((e) => e.facilityId === facilityId)).toHaveLength(4); // still 4 physical items
    expect(byName("Panel P1").images).toHaveLength(2);
    const rows = parseCsv(toCsv(buildGeneratorRows(ds(id)))).slice(1);
    expect(rows.every((r) => r.length === 16)).toBe(true);
    expect(rows.map((r) => `${r[4]}|${r[5]}|${r[6]}|${r[8]}|${r[9]}`)).toEqual([
      "Panel P1|Top Half|4|104|104",
      "Panel P1|Bottom Half|3|105|105",
      "Switchboard MSB|Main|6|201|201",
      "Switchboard MSB|Bus|6|202|202",
      "Switchboard MSB|Distribution Section 1|6|203|203",
      "Switchboard MSB|Distribution Section 2|6|204|204",
      "Disconnect D2|Full Disconnect|5|301|302",
      "Panel P11|Full Panel|||",
    ]);
  });

  it("removing images: extra ones are removed, the last one is cleared not deleted", () => {
    const { byName } = job();
    const p1 = byName("Panel P1");
    const extra = S().addThermalImage(p1.id, { component: "Bottom Half", irImageNumber: "105" });
    S().removeThermalImage(p1.id, extra);
    expect(byName("Panel P1").images).toHaveLength(1);
    S().updateThermalImage(p1.id, p1.images[0].id, { irImageNumber: "104" });
    S().removeThermalImage(p1.id, p1.images[0].id);
    const after = byName("Panel P1").images;
    expect(after).toHaveLength(1);
    expect([after[0].component, after[0].irImageNumber]).toEqual(["Full Panel", ""]);
  });

  it("duplicating copies image components but no numbers", () => {
    const { byName } = job();
    const msb = byName("Switchboard MSB");
    S().updateThermalImage(msb.id, msb.images[0].id, { irImageNumber: "201" });
    S().addThermalImage(msb.id, { component: "Bus", irImageNumber: "202" });
    const dupId = S().duplicateResult(msb.id);
    const dup = S().results.find((r) => r.id === dupId)!;
    expect(dup.images.map((i) => [i.component, i.irImageNumber])).toEqual([["Main", ""], ["Bus", ""]]);
  });
});

describe("To Do, recorded and exceptions", () => {
  beforeEach(() => S().resetDemoData());

  it("imported items start To Do; default Opened never counts as inspected", () => {
    const { byName } = job();
    const p11 = byName("Panel P11");
    expect(p11.opened).toBe("Yes, Completely");
    expect(resultStatus(p11)).toBe("todo");
    S().updateThermalImage(p11.id, p11.images[0].id, { distance: "4" });
    expect(resultStatus(byName("Panel P11"))).toBe("todo"); // distance alone is not an inspection
    S().updateThermalImage(p11.id, p11.images[0].id, { irImageNumber: "410" });
    expect(resultStatus(byName("Panel P11"))).toBe("recorded");
  });

  it("not scanned / deferred are explicit and need no image numbers", () => {
    const { byName } = job();
    const d2 = byName("Disconnect D2");
    S().updateResult(d2.id, { opened: "Item is Locked Out" });
    expect(resultStatus(byName("Disconnect D2"))).toBe("todo"); // access status alone does not count
    S().setException(d2.id, { kind: "not-scanned", note: "LOTO" });
    expect(resultStatus(byName("Disconnect D2"))).toBe("not-scanned");
    S().setException(d2.id, { kind: "deferred", note: "" });
    expect(resultStatus(byName("Disconnect D2"))).toBe("deferred");
    S().updateThermalImage(d2.id, d2.images[0].id, { irImageNumber: "500" });
    expect(byName("Disconnect D2").exception).toBeNull(); // scanning it later clears "deferred"
  });
});

describe("room completion", () => {
  beforeEach(() => S().resetDemoData());

  it("needs humidity, confirmed copied conditions and every item addressed", () => {
    const { id, byName } = job();
    const room = () => S().rooms.find((r) => r.inspectionId === id && S().locations.find((l) => l.id === r.locationId)?.name === "Electrical Room 1")!;
    const items = () => S().results.filter((r) => r.locationId === room().locationId && r.inspectionId === id);
    expect(roomProgress(items())).toMatchObject({ total: 3, done: 0 });
    expect(checkRoom(room(), items())).toMatchObject({ canFinish: false, humidityMissing: true, remaining: 3 });
    expect(conditionStatus(room()).missing).toEqual(["Humidity", "Ambient Temp", "Background Temp"]);
    expect(S().finishRoom(room().id)).toBe(false);

    for (const n of ["Panel P1", "Switchboard MSB"]) { const r = byName(n); S().updateThermalImage(r.id, r.images[0].id, { irImageNumber: "1", distance: "4" }); }
    S().setException(byName("Disconnect D2").id, { kind: "not-scanned", note: "" });
    expect(checkRoom(room(), items())).toMatchObject({ canFinish: false, humidityMissing: true, remaining: 0 });

    S().updateRoomConditions(room().id, { humidity: "abc" });
    expect(checkRoom(room(), items()).humidityMissing).toBe(true);
    S().updateRoomConditions(room().id, { humidity: "45", conditionsCopiedFrom: "Electrical Room 0" });
    expect(checkRoom(room(), items())).toMatchObject({ canFinish: false, needsConditionConfirm: true });
    S().confirmRoomConditions(room().id);
    expect(checkRoom(room(), items()).canFinish).toBe(true);
    expect(S().finishRoom(room().id)).toBe(true);
    expect(room().completedAt).not.toBeNull();
  });

  it("editing a copied value counts as measured here", () => {
    const { id } = job();
    const r = S().rooms.find((x) => x.inspectionId === id)!;
    S().updateRoomConditions(r.id, { humidity: "45", ambientTemp: "74", backgroundTemp: "73", conditionsCopiedFrom: "Room A" });
    expect(S().rooms.find((x) => x.id === r.id)!.conditionsCopiedFrom).toBe("Room A");
    S().updateRoomConditions(r.id, { humidity: "47" });
    expect(S().rooms.find((x) => x.id === r.id)!.conditionsCopiedFrom).toBeNull();
  });
});

describe("upgrade of saved field-test data (schema v3 -> v4)", () => {
  it("turns each saved result into one image entry without changing its export", () => {
    const v3 = {
      currentOrgId: "org-demo",
      inspections: [{ id: "i", organizationId: "org-demo", customerId: "c", facilityId: "f", date: "2026-11-12", inspectorIds: ["user-ashton"], status: "In Progress", defaultEmissivity: "0.95", notes: "", createdAt: "", updatedAt: "", siteVisit: { state: "paused", sessions: [], lastActiveLocationId: "l", skippedExteriorPrompt: false, completedAt: null } }],
      equipment: [{ id: "e1", organizationId: "org-demo", facilityId: "f", locationId: "l", name: "Panel P1", equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: 1, createdAt: "" }, { id: "e2", organizationId: "org-demo", facilityId: "f", locationId: "l", name: "Panel P2", equipmentType: "Panel", defaultComponent: "Full Panel", active: true, sortOrder: 2, createdAt: "" }],
      locations: [{ id: "l", organizationId: "org-demo", facilityId: "f", building: "", name: "Electrical Room 1", area: "", sortOrder: 1 }],
      rooms: [{ id: "rc", organizationId: "org-demo", inspectionId: "i", locationId: "l", humidity: "45", ambientTemp: "74", backgroundTemp: "73", distance: "", imageDate: "" }],
      results: [
        { id: "r1", organizationId: "org-demo", inspectionId: "i", equipmentId: "e1", locationId: "l", component: "Full Panel", distance: "4", irImageNumber: "104", visualImageNumber: "104", visualFromSinglePhoto: true, maxTemp: "", opened: "Yes, Completely", possibleCause: "NONE", problemNotes: "", confidence: "", reviewNotes: "", overrides: { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: null }, source: "carried-forward", sortOrder: 1, createdAt: "", updatedAt: "" },
        { id: "r2", organizationId: "org-demo", inspectionId: "i", equipmentId: "e2", locationId: "l", component: "Circuit 11", distance: "6", irImageNumber: "105", visualImageNumber: "", visualFromSinglePhoto: false, maxTemp: "131.7", opened: "Yes, with Dead-Front on", possibleCause: "Loose Connection(s)", problemNotes: "hot lug", confidence: "", reviewNotes: "x", overrides: { humidity: null, ambientTemp: null, backgroundTemp: null, distance: null, imageDate: null, emissivity: null }, source: "carried-forward", sortOrder: 2, createdAt: "", updatedAt: "" },
      ],
      photos: [{ id: "p", organizationId: "org-demo", inspectionId: "i", facilityId: "f", kind: "equipment", building: "", resultId: "r1", fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1, capturedAt: "", savedAt: "" }],
    } as unknown as Partial<DataState>;
    const out = migrateState(v3, 3) as DataState;
    const [a, b] = out.results;
    expect(a.images).toHaveLength(1);
    expect(a.images[0]).toMatchObject({ component: "Full Panel", irImageNumber: "104", visualImageNumber: "104", visualOverridden: false, distance: "4", possibleCause: "NONE", maxTemp: "" });
    expect(b.images[0]).toMatchObject({ component: "Circuit 11", irImageNumber: "105", visualImageNumber: "", visualOverridden: true, distance: "6", possibleCause: "Loose Connection(s)", maxTemp: "131.7", notes: "hot lug" });
    expect("component" in a).toBe(false);
    expect(a.exception).toBeNull();
    expect(out.rooms[0]).toMatchObject({ humidity: "45", conditionsCopiedFrom: null, completedAt: null });
    expect(out.photos).toHaveLength(1);
    const csv = parseCsv(toCsv(buildGeneratorRows({ inspection: out.inspections[0], results: out.results, equipment: new Map(out.equipment.map((e) => [e.id, e])), locations: new Map(out.locations.map((l) => [l.id, l])), rooms: out.rooms })));
    expect(csv.slice(1)).toEqual([
      ["11/12/2026", "Electrical Room 1", "45", "73", "Panel P1", "Full Panel", "4", "NONE", "104", "104", "0.95", "", "74", "Yes, Completely", "", ""],
      ["11/12/2026", "Electrical Room 1", "45", "73", "Panel P2", "Circuit 11", "6", "Loose Connection(s)", "105", "", "0.95", "131.7", "74", "Yes, with Dead-Front on", "", "x"],
    ]);
  });
});
