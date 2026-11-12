import type { InspectionStatus } from "./types";

/**
 * Approved "Opened" values. These strings are exported verbatim to the
 * Generator CSV. Do not normalize punctuation: "Can’t Open Item" uses a
 * typographic apostrophe (U+2019) exactly as specified.
 */
export const OPENED_VALUES = [
  "Yes, Completely",
  "Yes, with Dead-Front on",
  "Scanned Surface Only",
  "Can’t Open Item",
  "Item is Locked Out",
  "Only 1 Item",
  "Item Was Off at Time of Scan",
  "Equipment Inaccessible Due to Obstruction(s) in Front of Panel",
] as const;

export type OpenedValue = (typeof OPENED_VALUES)[number];

/** Opened values meaning the item was not fully scanned. Never discard these rows. */
export const LIMITED_ACCESS_OPENED: readonly string[] = [
  "Can’t Open Item",
  "Item is Locked Out",
  "Item Was Off at Time of Scan",
  "Equipment Inaccessible Due to Obstruction(s) in Front of Panel",
];

export const DEFAULT_OPENED: OpenedValue = "Yes, Completely";

export const POSSIBLE_CAUSE_NONE = "NONE";

export const BUILT_IN_POSSIBLE_CAUSES = [
  POSSIBLE_CAUSE_NONE,
  "Loose Connection(s)",
  "Suspect Overload",
  "Poor Contact at Knife Blade and/or Pivot",
] as const;

export const DEFAULT_EMISSIVITY = "0.95";

export const INSPECTION_STATUSES: InspectionStatus[] = [
  "Draft",
  "In Progress",
  "Needs Review",
  "Approved",
  "Report Generated",
  "Delivered",
];

export interface EquipmentPreset {
  type: string;
  defaultComponent: string;
  /** Lower-case name prefixes / abbreviations that imply this type. */
  aliases: string[];
}

/**
 * Component presets. The inspector can override every default; these only
 * prefill the Component field when an equipment row is created.
 */
export const EQUIPMENT_PRESETS: EquipmentPreset[] = [
  { type: "Panel", defaultComponent: "Full Panel", aliases: ["panel", "pnl", "lp", "pp", "rp"] },
  { type: "Transformer", defaultComponent: "Full Transformer", aliases: ["transformer", "xfmr", "xfrmr", "xformer", "tx"] },
  { type: "Disconnect", defaultComponent: "Full Disconnect", aliases: ["disconnect", "disc", "ds"] },
  { type: "Cabinet", defaultComponent: "Full Cabinet", aliases: ["cabinet", "cab"] },
  { type: "Starter", defaultComponent: "Full Starter", aliases: ["starter", "mstr"] },
  { type: "Breaker", defaultComponent: "Full Breaker", aliases: ["breaker", "cb", "bkr"] },
  { type: "Contactor", defaultComponent: "Full Contactor", aliases: ["contactor", "cont"] },
  // Switchgear uses Full Panel unless a more specific component is recorded.
  { type: "Switchgear", defaultComponent: "Full Panel", aliases: ["switchgear", "swgr", "swg"] },
  // No established component default for MCC yet; the inspector enters it.
  { type: "MCC", defaultComponent: "", aliases: ["mcc"] },
];

export const OTHER_EQUIPMENT_TYPE = "Other";

/** Common specific component entries offered as suggestions (free text is always allowed). */
export const COMPONENT_SUGGESTIONS = [
  "Full Panel",
  "Full Transformer",
  "Full Disconnect",
  "Full Cabinet",
  "Full Starter",
  "Full Breaker",
  "Full Contactor",
  "Main Breaker",
  "Main Lugs",
  "Top Half",
  "Bottom Half",
  "A Phase",
  "B Phase",
  "C Phase",
  "Section 1",
  "Section 2",
  "Section 3",
  "Circuit 1",
  "Circuit 11",
  "Primary",
  "Secondary",
  "Line Side",
  "Load Side",
];

export const STORAGE_KEY = "infrareport-demo-v1";
