import { describe, expect, it } from "vitest";
import { applySinglePhotoConvention, defaultComponentForType, EMPTY_OVERRIDES, incrementName, inferTypeFromName, normalizeNumericInput, resolveEffective } from "@/lib/domain/rules";

describe("numeric normalization", () => {
  it("strips percent and distance units", () => {
    expect(normalizeNumericInput("45%")).toBe("45");
    expect(normalizeNumericInput(" 45 % ")).toBe("45");
    expect(normalizeNumericInput("10 ft")).toBe("10");
    expect(normalizeNumericInput("10'")).toBe("10");
    expect(normalizeNumericInput("6 feet")).toBe("6");
    expect(normalizeNumericInput("74°F")).toBe("74");
    expect(normalizeNumericInput(".95")).toBe("0.95");
  });
  it("never invents values", () => {
    expect(normalizeNumericInput("")).toBe("");
    expect(normalizeNumericInput(undefined)).toBe("");
    expect(normalizeNumericInput("approx")).toBe("approx"); // left for validation to flag
    expect(normalizeNumericInput("23C")).toBe("23C"); // Celsius is not silently converted
  });
});

describe("component presets", () => {
  it.each([
    ["Panel", "Full Panel"], ["Transformer", "Full Transformer"], ["Disconnect", "Full Disconnect"], ["Cabinet", "Full Cabinet"],
    ["Starter", "Full Starter"], ["Breaker", "Full Breaker"], ["Contactor", "Full Contactor"], ["Switchgear", "Full Panel"],
  ])("%s -> %s", (type, comp) => expect(defaultComponentForType(type)).toBe(comp));
  it("returns no default for unknown types", () => expect(defaultComponentForType("Other")).toBe(""));
  it("infers type from names and abbreviations", () => {
    expect(inferTypeFromName("Panel P1")).toBe("Panel");
    expect(inferTypeFromName("XFMR T1")).toBe("Transformer");
    expect(inferTypeFromName("SWGR-1")).toBe("Switchgear");
    expect(inferTypeFromName("Pump 4")).toBeUndefined();
  });
});

describe("room inheritance", () => {
  const room = { humidity: "45", ambientTemp: "74", backgroundTemp: "73", distance: "4", imageDate: "" };
  const insp = { date: "2026-03-10", defaultEmissivity: "0.95" };
  it("inherits all room values by default", () => {
    const e = resolveEffective({ overrides: { ...EMPTY_OVERRIDES } }, room, insp, { distance: "6" });
    // Distance comes from the thermal image, never from the room
    expect([e.humidity, e.ambientTemp, e.backgroundTemp, e.distance, e.imageDate, e.emissivity]).toEqual(["45", "74", "73", "6", "2026-03-10", "0.95"]);
    expect(e.overridden).toEqual({});
  });
  it("uses individual overrides", () => {
    const e = resolveEffective({ overrides: { ...EMPTY_OVERRIDES, ambientTemp: "90", emissivity: "0.9" } }, room, insp);
    expect(e.ambientTemp).toBe("90");
    expect(e.emissivity).toBe("0.9");
    expect(e.humidity).toBe("45");
    expect(e.overridden).toEqual({ ambientTemp: true, emissivity: true });
  });
  it("a blank image distance stays blank (a legacy room distance is not used)", () => {
    expect(resolveEffective({ overrides: { ...EMPTY_OVERRIDES } }, room, insp, { distance: "" }).distance).toBe("");
  });
});

describe("single photo convention", () => {
  it("copies a lone IR number to Visual and flags it", () => {
    expect(applySinglePhotoConvention("1025", "")).toEqual({ irImageNumber: "1025", visualImageNumber: "1025", visualFromSinglePhoto: true });
  });
  it("leaves two numbers alone", () => {
    expect(applySinglePhotoConvention("1", "2")).toEqual({ irImageNumber: "1", visualImageNumber: "2", visualFromSinglePhoto: false });
  });
  it("leaves no numbers blank", () => {
    expect(applySinglePhotoConvention("", "")).toEqual({ irImageNumber: "", visualImageNumber: "", visualFromSinglePhoto: false });
  });
});

describe("incrementName", () => {
  it("bumps trailing numbers", () => {
    expect(incrementName("Panel P1")).toBe("Panel P2");
    expect(incrementName("LP-09")).toBe("LP-10");
    expect(incrementName("Main")).toBe("Main");
  });
});
