import { LIMITED_ACCESS_OPENED, OPENED_VALUES, POSSIBLE_CAUSE_NONE } from "./constants";
import { isNumericText, resolveEffective } from "./rules";
import type { ExportDataset } from "./csv";
import { orderResults } from "./csv";
import type { InspectionResult } from "./types";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  id: string;
  severity: Severity;
  resultId: string | null;
  locationId: string | null;
  field: string;
  message: string;
}

const OPENED_SET = new Set<string>(OPENED_VALUES);

/**
 * Validation never changes data. It flags what an inspector or reviewer must
 * look at before approval. Errors block approval; warnings do not.
 */
export function validateInspection(
  ds: ExportDataset,
  opts: { allowedCauses: string[] },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const causeSet = new Set(opts.allowedCauses);
  const ordered = orderResults(ds);
  const push = (r: InspectionResult | null, severity: Severity, field: string, message: string) =>
    issues.push({
      id: `${r?.id ?? "insp"}:${field}:${issues.length}`,
      severity,
      resultId: r?.id ?? null,
      locationId: r?.locationId ?? null,
      field,
      message,
    });

  if (ordered.length === 0) push(null, "warning", "results", "No equipment has been recorded for this inspection.");

  const eqMap = ds.equipment instanceof Map ? ds.equipment : new Map(Object.entries(ds.equipment));
  const imageUse = new Map<string, string[]>();

  for (const r of ordered) {
    const eq = eqMap.get(r.equipmentId);
    const name = eq?.name || "(unnamed equipment)";
    const room = ds.rooms.find((x) => x.locationId === r.locationId && x.inspectionId === r.inspectionId);
    const eff = resolveEffective(r, room, ds.inspection);

    if (!eq?.name.trim()) push(r, "error", "Equipment", "Equipment name is blank.");
    if (!r.opened) push(r, "error", "Opened", `${name}: Opened value is not selected.`);
    else if (!OPENED_SET.has(r.opened)) push(r, "error", "Opened", `${name}: "${r.opened}" is not an approved Opened value.`);

    if (!r.component.trim()) push(r, "warning", "Component", `${name}: Component is blank.`);

    for (const [label, value] of [
      ["Humidity", eff.humidity],
      ["Background Temp", eff.backgroundTemp],
      ["Ambient Temp", eff.ambientTemp],
      ["Distance", eff.distance],
      ["Emissivity", eff.emissivity],
      ["Max Temp", r.maxTemp],
    ] as const) {
      if (value !== "" && !isNumericText(value)) {
        push(r, "error", label, `${name}: ${label} "${value}" must be a number with no unit text.`);
      }
    }
    if (eff.humidity === "") push(r, "warning", "Humidity", `${name}: Humidity is blank (set it on the room or row).`);
    if (eff.ambientTemp === "") push(r, "warning", "Ambient Temp", `${name}: Ambient Temp is blank.`);
    if (eff.backgroundTemp === "") push(r, "warning", "Background Temp", `${name}: Background Temp is blank.`);
    if (eff.distance === "") push(r, "info", "Distance", `${name}: Distance is blank.`);
    if (isNumericText(eff.humidity) && (Number(eff.humidity) < 0 || Number(eff.humidity) > 100)) {
      push(r, "error", "Humidity", `${name}: Humidity ${eff.humidity} is outside 0 to 100.`);
    }
    if (isNumericText(eff.emissivity) && (Number(eff.emissivity) <= 0 || Number(eff.emissivity) > 1)) {
      push(r, "error", "Emissivity", `${name}: Emissivity ${eff.emissivity} must be greater than 0 and at most 1.`);
    }

    const limited = LIMITED_ACCESS_OPENED.includes(r.opened);
    if (!r.irImageNumber && !r.visualImageNumber && !limited) {
      push(r, "warning", "IR Image Number", `${name}: No image number recorded. Row is kept and exported.`);
    }
    if (r.visualFromSinglePhoto) {
      push(r, "info", "Visual Image Number", `${name}: Visual # copied from the single recorded photo number. Verify.`);
    }
    if (r.maxTemp === "" && !limited && (r.irImageNumber || r.visualImageNumber)) {
      push(r, "info", "Max Temp", `${name}: Max Temp blank. It will export blank (never estimated).`);
    }

    const cause = r.possibleCause || POSSIBLE_CAUSE_NONE;
    if (!causeSet.has(cause)) push(r, "warning", "Possible Cause", `${name}: "${cause}" is not in the controlled cause list.`);
    if (cause !== POSSIBLE_CAUSE_NONE && !r.problemNotes.trim() && !r.reviewNotes.trim()) {
      push(r, "warning", "Possible Cause", `${name}: Problem "${cause}" recorded without a description.`);
    }
    if (cause === POSSIBLE_CAUSE_NONE && r.problemNotes.trim()) {
      push(r, "warning", "Possible Cause", `${name}: Problem notes entered but Possible Cause is NONE.`);
    }

    for (const n of new Set([r.irImageNumber, r.visualImageNumber].filter(Boolean))) {
      const list = imageUse.get(n) ?? [];
      list.push(r.id);
      imageUse.set(n, list);
    }
  }

  for (const [num, ids] of imageUse) {
    if (ids.length > 1) {
      const r = ordered.find((x) => x.id === ids[0]) ?? null;
      push(r, "warning", "IR Image Number", `Image number ${num} is used on ${ids.length} equipment rows.`);
    }
  }

  return issues;
}

export function countBySeverity(issues: ValidationIssue[]): Record<Severity, number> {
  return issues.reduce(
    (acc, i) => ((acc[i.severity] += 1), acc),
    { error: 0, warning: 0, info: 0 } as Record<Severity, number>,
  );
}
