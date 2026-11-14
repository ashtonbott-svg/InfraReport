/**
 * Thermal image entries and inspection progress rules.
 *
 * One permanent Equipment item -> one InspectionResult per inspection ->
 * one or more ThermalImage entries (Top Half, Bottom Half, Section 1...).
 * Each image becomes one Generator row; the equipment still counts once.
 */
import { LIMITED_ACCESS_OPENED, POSSIBLE_CAUSE_NONE } from "./constants";
import { isNumericText, normalizeNumericInput } from "./rules";
import type { InspectionResult, InspectionRoomConditions, ThermalImage } from "./types";

const uid = () => `img-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export function newThermalImage(partial: Partial<ThermalImage> = {}): ThermalImage {
  const ir = (partial.irImageNumber ?? "").trim();
  const overridden = partial.visualOverridden ?? false;
  return {
    id: partial.id ?? uid(),
    component: partial.component ?? "",
    irImageNumber: ir,
    visualOverridden: overridden,
    visualImageNumber: overridden ? (partial.visualImageNumber ?? "").trim() : ir,
    distance: normalizeNumericInput(partial.distance ?? ""),
    possibleCause: partial.possibleCause || POSSIBLE_CAUSE_NONE,
    maxTemp: normalizeNumericInput(partial.maxTemp ?? ""),
    notes: partial.notes ?? "",
  };
}

/**
 * Apply an edit to an image. The Visual number follows the IR number unless
 * the inspector chose "Use Different Visual Number"; switching that off makes
 * it follow IR again.
 */
export function patchThermalImage(img: ThermalImage, patch: Partial<ThermalImage>): ThermalImage {
  const next: ThermalImage = { ...img, ...patch, id: img.id };
  if (patch.irImageNumber !== undefined) next.irImageNumber = patch.irImageNumber.trim();
  if (patch.visualImageNumber !== undefined) next.visualImageNumber = patch.visualImageNumber.trim();
  if (patch.distance !== undefined) next.distance = normalizeNumericInput(patch.distance);
  if (patch.maxTemp !== undefined) next.maxTemp = normalizeNumericInput(patch.maxTemp);
  if (!next.visualOverridden) next.visualImageNumber = next.irImageNumber;
  return next;
}

export const imageHasNumber = (i: ThermalImage) => !!(i.irImageNumber || i.visualImageNumber);
export const imageHasFinding = (i: ThermalImage) => !!i.possibleCause && i.possibleCause !== POSSIBLE_CAUSE_NONE;
export const resultHasFinding = (r: Pick<InspectionResult, "images">) => r.images.some(imageHasFinding);

export type ResultStatus = "todo" | "recorded" | "not-scanned" | "deferred";

/**
 * Only real work counts: an image entry with an image number, or an
 * explicitly documented exception. The default Opened value never does.
 */
export function resultStatus(r: Pick<InspectionResult, "images" | "exception">): ResultStatus {
  if (r.images.some(imageHasNumber)) return "recorded";
  if (r.exception) return r.exception.kind;
  return "todo";
}

export const isAddressed = (r: Pick<InspectionResult, "images" | "exception">) => resultStatus(r) !== "todo";

export const isLimitedAccess = (opened: string) => LIMITED_ACCESS_OPENED.includes(opened);

export interface RoomProgress<T> {
  total: number;
  done: number;
  remaining: T[];
}

export function roomProgress<T extends Pick<InspectionResult, "images" | "exception">>(results: T[]): RoomProgress<T> {
  const remaining = results.filter((r) => !isAddressed(r));
  return { total: results.length, done: results.length - remaining.length, remaining };
}

export function humidityValid(room: Pick<InspectionRoomConditions, "humidity"> | undefined): boolean {
  if (!room) return false;
  const h = room.humidity.trim();
  return isNumericText(h) && Number(h) >= 0 && Number(h) <= 100;
}

export interface ConditionStatus {
  /** Blocks finishing the room / Next Room. */
  humidityMissing: boolean;
  /** Shown clearly but not required. */
  missing: string[];
  copiedFrom: string | null;
  complete: boolean;
}

export function conditionStatus(room: Pick<InspectionRoomConditions, "humidity" | "ambientTemp" | "backgroundTemp" | "conditionsCopiedFrom"> | undefined): ConditionStatus {
  if (!room) return { humidityMissing: true, missing: ["Humidity", "Ambient Temp", "Background Temp"], copiedFrom: null, complete: false };
  const missing: string[] = [];
  const humidityMissing = !humidityValid(room);
  if (humidityMissing) missing.push("Humidity");
  if (!room.ambientTemp.trim()) missing.push("Ambient Temp");
  if (!room.backgroundTemp.trim()) missing.push("Background Temp");
  const copiedFrom = room.conditionsCopiedFrom ?? null;
  return { humidityMissing, missing, copiedFrom, complete: missing.length === 0 && !copiedFrom };
}

export interface RoomCheck {
  canFinish: boolean;
  humidityMissing: boolean;
  needsConditionConfirm: boolean;
  remaining: number;
}

/** Finishing a room needs humidity, confirmed conditions and every item addressed. */
export function checkRoom(room: InspectionRoomConditions | undefined, results: Pick<InspectionResult, "images" | "exception">[]): RoomCheck {
  const c = conditionStatus(room);
  const remaining = roomProgress(results).remaining.length;
  return { canFinish: !c.humidityMissing && !c.copiedFrom && remaining === 0, humidityMissing: c.humidityMissing, needsConditionConfirm: !!c.copiedFrom, remaining };
}

/** Quick component chips for image entries. */
export const IMAGE_COMPONENTS = [
  "Full Panel", "Top Half", "Bottom Half", "Left Side", "Right Side", "Main", "Bus",
  "Section 1", "Section 2", "Section 3", "A Phase", "B Phase", "C Phase", "Line Side", "Load Side", "Circuit ",
];

/** Suggest the next component when adding another image (Top Half -> Bottom Half, Section 1 -> Section 2). */
export function nextComponent(existing: string[]): string {
  const last = existing[existing.length - 1] ?? "";
  const pairs: Record<string, string> = { "top half": "Bottom Half", "left side": "Right Side", "line side": "Load Side", "a phase": "B Phase", "b phase": "C Phase", main: "Bus" };
  const low = last.trim().toLowerCase();
  if (pairs[low] && !existing.some((e) => e.toLowerCase() === pairs[low].toLowerCase())) return pairs[low];
  const m = last.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  return "";
}
