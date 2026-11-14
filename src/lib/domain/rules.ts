import {
  DEFAULT_EMISSIVITY,
  EQUIPMENT_PRESETS,
  OTHER_EQUIPMENT_TYPE,
  type EquipmentPreset,
} from "./constants";
import type {
  Inspection,
  InspectionResult,
  InspectionRoomConditions,
  ResultOverrides,
} from "./types";

/**
 * Normalize a numeric entry for Generator compatibility.
 * Strips unit text (%, ft, feet, ', °F, F) and surrounding whitespace but never
 * fabricates a number: blank stays blank and unparseable text is returned
 * unchanged so validation can flag it rather than silently dropping it.
 */
export function normalizeNumericInput(raw: string | null | undefined): string {
  if (raw == null) return "";
  let v = String(raw).trim();
  if (v === "") return "";
  v = v
    .replace(/\s*(percent|pct|%)\s*$/i, "")
    .replace(/\s*(feet|foot|ft\.?|')\s*$/i, "")
    .replace(/\s*(°\s*f?|deg(rees)?\s*f?|f)\s*$/i, "") // °F only; °C is left for validation to flag
    .trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^-?\.\d+$/.test(v)) return v.replace(/^(-?)\./, "$10.");
  return String(raw).trim();
}

export function isNumericText(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v);
}

export function presetForType(type: string): EquipmentPreset | undefined {
  const t = type.trim().toLowerCase();
  return EQUIPMENT_PRESETS.find((p) => p.type.toLowerCase() === t);
}

/** Guess an equipment type from a name like "Panel P1", "XFMR T1" or "DISC D1". */
export function inferTypeFromName(name: string): string | undefined {
  const tokens = name.trim().toLowerCase().split(/[\s\-_#/,()]+/).filter(Boolean);
  if (!tokens.length) return undefined;
  const byAlias = (t: string) => EQUIPMENT_PRESETS.find((p) => p.aliases.includes(t))?.type;
  const first = byAlias(tokens[0]);
  if (first && first !== "MCC") return first;
  // "Main Switchgear MSG", "Lighting Contactor LC-1", "MCC-1 Starter 3": use a
  // full type word later in the name (not short abbreviations like "lp" or "cb").
  const FULL = new Set(["panel", "transformer", "xfmr", "disconnect", "cabinet", "starter", "breaker", "contactor", "switchgear", "swgr"]);
  for (const t of tokens.slice(1).reverse()) if (FULL.has(t)) return byAlias(t);
  return first;
}

export function defaultComponentForType(type: string): string {
  return presetForType(type)?.defaultComponent ?? "";
}

export function resolveEquipmentType(type: string, name: string): string {
  if (type && type !== OTHER_EQUIPMENT_TYPE) return type;
  return inferTypeFromName(name) ?? (type || OTHER_EQUIPMENT_TYPE);
}

/** "Panel P1" -> "Panel P2", "LP-9" -> "LP-10", "Main" -> "Main". */
export function incrementName(name: string): string {
  const m = name.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return name;
  const [, head, digits, tail] = m;
  const next = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${head}${next}${tail}`;
}

export const EMPTY_OVERRIDES: ResultOverrides = {
  humidity: null,
  ambientTemp: null,
  backgroundTemp: null,
  distance: null,
  imageDate: null,
  emissivity: null,
};

export interface EffectiveValues {
  imageDate: string;
  humidity: string;
  backgroundTemp: string;
  ambientTemp: string;
  distance: string;
  emissivity: string;
  /** Which fields are row-level overrides (for UI indicators). */
  overridden: Partial<Record<keyof ResultOverrides, true>>;
}

/**
 * Room conditions carry down to each equipment row unless the row overrides
 * them. Image Date falls back to the room's image date, then the inspection
 * date. Emissivity falls back to the inspection default, then 0.95.
 */
export function resolveEffective(
  result: Pick<InspectionResult, "overrides">,
  room: Pick<InspectionRoomConditions, "humidity" | "ambientTemp" | "backgroundTemp" | "imageDate"> | undefined,
  inspection: Pick<Inspection, "date" | "defaultEmissivity">,
  /** The thermal image this row is for; distance is recorded per image. */
  image?: { distance: string },
): EffectiveValues {
  const o = result.overrides;
  const overridden: EffectiveValues["overridden"] = {};
  const pick = (key: keyof ResultOverrides, inherited: string): string => {
    const v = o[key];
    if (v !== null && v !== undefined) {
      overridden[key] = true;
      return v;
    }
    return inherited;
  };
  return {
    imageDate: pick("imageDate", room?.imageDate || inspection.date),
    humidity: pick("humidity", room?.humidity ?? ""),
    backgroundTemp: pick("backgroundTemp", room?.backgroundTemp ?? ""),
    ambientTemp: pick("ambientTemp", room?.ambientTemp ?? ""),
    // Distance belongs to each thermal image (release 5). Older room / row
    // distances are moved onto images by the store migration.
    distance: image?.distance ?? "",
    emissivity: pick("emissivity", inspection.defaultEmissivity || DEFAULT_EMISSIVITY),
    overridden,
  };
}

/**
 * Single photo number convention: when only one photo number was recorded,
 * populate both IR and Visual with it and mark the Visual value for
 * verification. Returns the values to store.
 */
export function applySinglePhotoConvention(ir: string, visual: string): {
  irImageNumber: string;
  visualImageNumber: string;
  visualFromSinglePhoto: boolean;
} {
  const i = ir.trim();
  const v = visual.trim();
  if (i && !v) return { irImageNumber: i, visualImageNumber: i, visualFromSinglePhoto: true };
  if (!i && v) return { irImageNumber: v, visualImageNumber: v, visualFromSinglePhoto: true };
  return { irImageNumber: i, visualImageNumber: v, visualFromSinglePhoto: false };
}
