/**
 * Severity, recommendations and evaluation status for the Electrical Infrared Inspection Report.
 *
 * Source: the owner's Infinite Infrared Generator workbook (sheets Generator and Validation).
 *   Generator!O  Delta T = Max Temp - Ambient Temp
 *   Generator!P  IF(O<19, Normal, IF(O<62, Potential, IF(O<128, Serious, Critical)))
 *   Generator!Q  XLOOKUP(Possible Cause, Validation!O3:O21, Validation!S3:S21)
 * Two deliberate corrections (the finished Brim equipment list already applied them by hand):
 *   - With no Max Temp the Generator computes Delta T as minus the ambient and reports "Normal".
 *     Here a blank Max Temp is never a temperature: equipment that was not scanned is
 *     "Not Evaluated (reason)", and a recorded cause without a Max Temp is a visual finding that
 *     needs the reviewer's severity, never an automatic "Normal".
 *   - Nothing is inferred from file names or invented: blank stays blank.
 */
import { LIMITED_ACCESS_OPENED, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";

export type Severity = "normal" | "potential" | "serious" | "critical";

export interface SeverityBand {
  key: Severity;
  label: string;
  /** Text used on finding pages (Generator wording). */
  long: string;
  priority: string;
  range: string;
  /** Fill colors from the owner's report and Word list. */
  color: string;
  rank: number;
}

export const SEVERITY_BANDS: SeverityBand[] = [
  { key: "normal", label: "Normal Operation", long: "Normal Operation, No Action Required", priority: "No action required", range: "0 – 19 °F", color: "#92D050", rank: 1 },
  { key: "potential", label: "Potential Discrepancy", long: "Potential Discrepancy, Monitor and repair if needed", priority: "Monitor and repair if needed", range: "19 – 62 °F", color: "#FFFF00", rank: 2 },
  { key: "serious", label: "Serious Discrepancy", long: "Serious Discrepancy, Prioritize repair promptly", priority: "Prioritize repair promptly", range: "62 – 128 °F", color: "#FFC000", rank: 3 },
  { key: "critical", label: "Critical Discrepancy", long: "Critical Discrepancy, Repair Immediately", priority: "Repair immediately", range: "> 128 °F", color: "#FF0000", rank: 4 },
];
export const band = (k: Severity) => SEVERITY_BANDS.find((b) => b.key === k)!;

/** Generator thresholds: below 19 normal, below 62 potential, below 128 serious, otherwise critical. */
export function severityForDeltaT(deltaT: number): Severity {
  if (deltaT < 19) return "normal";
  if (deltaT < 62) return "potential";
  if (deltaT < 128) return "serious";
  return "critical";
}

/** Validation sheet, column O (Possible Cause) to column S (Recommendation), as written by the owner. */
export const CAUSE_RECOMMENDATIONS: Record<string, string> = {
  [POSSIBLE_CAUSE_NONE]: "All components, under load, have no significant discrepancies.",
  "Loose Connection(s)": "Inspect, disassemble, clean and reassemble to proper component torque.",
  "Suspect Overload": "Check component rating versus circuit load. Upgrade or redistribute circuit load.",
  "Suspect Breaker Failure": "Replacement of breaker is suggested.",
  "Poor Contact at Knife Blade and/or Pivot": "Inspect, disassemble, clean and reassemble to proper component torque. Replace component if necessary.",
  "Poor Contact at Fuse Clip(s)": "Remove fuse(s); clean clip(s), tighten clip(s), and reassemble.",
  "Suspect Fuse Failure": "Replacement of fuse(s) is recommended.",
  "Loose Connection(s) at Splice": "Disassemble splice, clean and reassemble splice if possible. Replace splice if needed.",
  "Unbalanced Load": "Redistribute circuits evenly throughout the panel.",
  "Suspect Internal Discrepancy": "Inspect internal issue, replace component if necessary.",
  "Exterior Item Reflection": "NONE, Delta T is high due to external reflection within the item.",
  "Component(s) Load": "NONE, Delta T is high due to heavier load on component(s).",
  "Reflection": "NONE, Delta T is high due to relfection within item.",
  "Exterior Item & Load": "NONE, Delta T is high due to external temperature and component(s) load.",
  "Dust/Debris Accumulation": "Clean component(s) and torque to specification.",
  "Poor Contact at Knife Blade": "Inspect, disassemble, clean and reassemble to proper component torque. Replace component if necessary. Monitor at next inspection if not corrected.",
  "Minor Thermal Anomaly": "No immediate action required. Monitor at next maintenance cycle or next scheduled IR inspection.",
  "Exposed Conductor": "De-energize and repair exposed wiring to meet code. Verify insulation integrity before re-energizing.",
  "Excessive Dust/Debris Accumulation with Wire Rubbing Against Sharp Edge": "Clean component(s) and torque to specification. Reroute or protect conductor at contact point to eliminate chafing; replace wire if insulation is compromised.",
};

export function recommendationFor(cause: string): string | null {
  const c = (cause || POSSIBLE_CAUSE_NONE).trim();
  return CAUSE_RECOMMENDATIONS[c] ?? Object.entries(CAUSE_RECOMMENDATIONS).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1] ?? null;
}

/** Why equipment was not evaluated, from the documented Opened value. */
export function notEvaluatedReason(opened: string): string | null {
  const o = opened.replace(/[‘’]/g, "'");
  if (o === "Item Was Off at Time of Scan") return "Equipment Off";
  if (o === "Can't Open Item") return "Unable to Open";
  if (o === "Item is Locked Out") return "Locked Out";
  if (o.startsWith("Equipment Inaccessible")) return "Inaccessible";
  return LIMITED_ACCESS_OPENED.includes(opened) ? "Limited Access" : null;
}

/**
 * Opened values meaning the equipment was de-energized: an image of it cannot show load-related
 * heating, so it is never rated "Normal" (the owner's finished equipment list: "Not Evaluated
 * (Equipment Off)"). Can't Open / Inaccessible with an image still had a surface scanned.
 */
export function deEnergizedReason(opened: string): string | null {
  const o = opened.replace(/[‘’]/g, "'");
  if (o === "Item Was Off at Time of Scan") return "Equipment Off";
  if (o === "Item is Locked Out") return "Locked Out";
  return null;
}

