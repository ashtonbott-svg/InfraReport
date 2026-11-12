import { describe, expect, it } from "vitest";
import { applyTypeSuggestion, filterOpened, nameMatches, nextSequentialNames, roomSuggestions, typeSuggestions } from "@/lib/domain/suggest";
import { defaultComponentForType, inferTypeFromName } from "@/lib/domain/rules";
import { OPENED_VALUES } from "@/lib/domain/constants";

describe("equipment name autocomplete", () => {
  it.each([
    ["pa", "Panel"], ["pnl", "Panel"], ["sw", "Switchgear"], ["dis", "Disconnect"], ["disc", "Disconnect"],
    ["tr", "Transformer"], ["xfmr", "Transformer"], ["cab", "Cabinet"], ["mcc", "MCC"], ["br", "Breaker"], ["st", "Starter"],
  ])("%s suggests %s", (typed, type) => expect(typeSuggestions(typed)).toContain(type));

  it("inserts the type and lets you keep typing; never rewrites on its own", () => {
    const afterTap = applyTypeSuggestion("pa", "Panel");
    expect(afterTap).toBe("Panel ");
    expect(`${afterTap}P1`).toBe("Panel P1");
    expect(applyTypeSuggestion("Line 3 xfmr", "Transformer")).toBe("Line 3 Transformer ");
  });

  it("suggests the next number after Save & Add Next", () => {
    expect(nextSequentialNames(["Panel P1"])).toEqual(["Panel P2"]);
    expect(nextSequentialNames(["Panel P1", "Transformer T1", "Panel P2"])).toEqual(["Panel P3", "Transformer T2"]);
    expect(nextSequentialNames(["LP-09"])).toEqual(["LP-10"]);
  });

  it("uses existing facility equipment names", () => {
    expect(nameMatches("lp", ["LP-1", "LP-2", "Panel P1", "Main LP"])).toEqual(["LP-1", "LP-2", "Main LP"]);
  });

  it("name, type and component defaults agree", () => {
    for (const [name, type, comp] of [["Panel P1", "Panel", "Full Panel"], ["Main Switchgear", "Switchgear", "Full Panel"], ["MCC-1 Starter 3", "Starter", "Full Starter"], ["MCC-2", "MCC", ""]]) {
      expect(inferTypeFromName(name)).toBe(type);
      expect(defaultComponentForType(type)).toBe(comp);
    }
  });
});

describe("Opened search", () => {
  it("finds approved values from partial words", () => {
    expect(filterOpened("dead")).toEqual(["Yes, with Dead-Front on"]);
    expect(filterOpened("off")).toEqual(["Item Was Off at Time of Scan"]);
    expect(filterOpened("lock")).toEqual(["Item is Locked Out"]);
    expect(filterOpened("obstr")).toEqual(["Equipment Inaccessible Due to Obstruction(s) in Front of Panel"]);
    expect(filterOpened("cant")).toEqual(["Can’t Open Item"]);
    expect(filterOpened("")).toEqual([...OPENED_VALUES]);
  });
  it("only ever returns the eight approved strings", () => {
    for (const q of ["yes", "open", "item", "x", "zzz"]) for (const v of filterOpened(q)) expect(OPENED_VALUES).toContain(v);
    expect(filterOpened("zzz")).toEqual([]);
  });
});

describe("room autocomplete", () => {
  const labels = (q: string, rooms: string[] = []) => roomSuggestions(q, rooms).map((s) => s.label);
  it("suggests common room names", () => {
    expect(labels("elec")).toContain("Electrical Room");
    expect(labels("mech")).toContain("Mechanical Room");
    expect(labels("mcc")).toContain("MCC Room");
    expect(labels("gen")).toContain("Generator Room");
  });
  it("offers the next number and existing facility rooms without merging", () => {
    const s = roomSuggestions("elec", ["Electrical Room 1"]);
    expect(s).toEqual(expect.arrayContaining([{ label: "Electrical Room 1", existing: true }, { label: "Electrical Room 2", existing: false }]));
  });
});
