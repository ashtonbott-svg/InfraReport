/**
 * Typing helpers for equipment and room names. Suggestions only: nothing here
 * changes what the inspector typed unless a suggestion is tapped.
 */
import { EQUIPMENT_PRESETS, OPENED_VALUES } from "./constants";

/** Short prefixes people actually type, per equipment type. */
const TYPE_PREFIXES: Record<string, string[]> = {
  Panel: ["pa", "pan", "pane", "panel", "pnl", "pn"],
  Switchgear: ["sw", "swg", "swgr", "swi", "switch", "switchgear"],
  Disconnect: ["dis", "disc", "disco", "disconnect", "ds"],
  Transformer: ["tr", "tra", "tran", "trans", "transformer", "xf", "xfmr", "xfrmr"],
  Cabinet: ["cab", "cabi", "cabinet"],
  MCC: ["mc", "mcc"],
  Breaker: ["br", "bre", "brk", "bkr", "breaker"],
  Starter: ["st", "sta", "star", "starter"],
  Contactor: ["con", "cont", "contactor"],
};

/** Equipment types matching the word currently being typed ("pa" -> Panel, "xfmr" -> Transformer). */
export function typeSuggestions(token: string): string[] {
  const t = token.trim().toLowerCase();
  if (!t) return [];
  return EQUIPMENT_PRESETS.map((p) => p.type).filter((type) =>
    type.toLowerCase().startsWith(t) || (TYPE_PREFIXES[type] ?? []).some((p) => p.startsWith(t)));
}

/** The word being typed (last token), and the text before it. */
export function splitLastToken(text: string): { head: string; token: string } {
  const m = text.match(/^([\s\S]*?)(\S*)$/);
  return { head: m?.[1] ?? "", token: m?.[2] ?? "" };
}

/** Replace the word being typed with a chosen type, leaving a trailing space to keep typing. */
export function applyTypeSuggestion(text: string, type: string): string {
  const { head } = splitLastToken(text);
  return `${head}${type} `;
}

/** Existing names that start with (or contain a word starting with) what was typed. */
export function nameMatches(typed: string, names: string[], limit = 4): string[] {
  const q = typed.trim().toLowerCase();
  if (q.length < 1) return [];
  const seen = new Set<string>();
  const starts: string[] = [];
  const words: string[] = [];
  for (const n of names) {
    const low = n.toLowerCase();
    if (!n.trim() || low === q || seen.has(low)) continue;
    seen.add(low);
    if (low.startsWith(q)) starts.push(n);
    else if (low.split(/[\s\-_]+/).some((w) => w.startsWith(q))) words.push(n);
  }
  return [...starts, ...words].slice(0, limit);
}

/** Next sequential names per prefix, most recently used first, e.g. "Panel P4", "Transformer T2". */
export function nextSequentialNames(names: string[], limit = 4): string[] {
  const best = new Map<string, { n: number; width: number; last: number }>();
  names.forEach((name, idx) => {
    const m = name.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return;
    const k = `${m[1]}\u0000${m[3]}`;
    const n = Number(m[2]);
    const cur = best.get(k);
    if (!cur || n >= cur.n) best.set(k, { n, width: m[2].length, last: idx });
  });
  return [...best.entries()]
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, limit)
    .map(([k, v]) => {
      const [head, tail] = k.split("\u0000");
      return `${head}${String(v.n + 1).padStart(v.width, "0")}${tail}`;
    });
}

export const COMMON_ROOMS = [
  "Main Electrical Room",
  "Electrical Room",
  "Mechanical Room",
  "MCC Room",
  "Generator Room",
  "Transformer Room",
  "Switchgear Room",
  "Electrical Closet",
  "Utility Room",
  "Pump Room",
];

const ROOM_PREFIX: Record<string, string[]> = {
  "MCC Room": ["mcc"],
  "Electrical Room": ["elec", "el", "electrical"],
  "Main Electrical Room": ["main", "elec", "electrical"],
  "Electrical Closet": ["elec", "electrical", "clos", "closet"],
  "Mechanical Room": ["mech", "me", "mechanical"],
};

/**
 * Room suggestions: common room names matching the typed words, plus rooms
 * already used at this facility. A numbered common room gets the next free
 * number ("Electrical Room 1" exists -> "Electrical Room 2").
 */
export function roomSuggestions(typed: string, facilityRooms: string[], limit = 5): { label: string; existing: boolean }[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const matchName = (name: string) => {
    const low = name.toLowerCase();
    const extra = ROOM_PREFIX[name] ?? [];
    const nameWords = low.split(/\s+/);
    return words.every((w) => nameWords.some((nw) => nw.startsWith(w)) || extra.some((e) => e.startsWith(w) || w.startsWith(e)));
  };
  const out: { label: string; existing: boolean }[] = [];
  const lowExisting = facilityRooms.map((r) => r.toLowerCase());
  for (const r of facilityRooms) {
    if (r.toLowerCase().startsWith(q) || matchName(r)) out.push({ label: r, existing: true });
  }
  for (const c of COMMON_ROOMS) {
    if (!matchName(c)) continue;
    const numbered = facilityRooms
      .map((r) => r.match(new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d+)$`, "i")))
      .filter(Boolean)
      .map((m) => Number(m![1]));
    if (numbered.length) out.push({ label: `${c} ${Math.max(...numbered) + 1}`, existing: false });
    else if (!lowExisting.includes(c.toLowerCase())) out.push({ label: c, existing: false });
  }
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.label.toLowerCase()) ? false : (seen.add(s.label.toLowerCase()), true))).slice(0, limit);
}

/** Search words for the approved Opened values (the stored value is always the exact approved string). */
const OPENED_KEYWORDS: Record<string, string> = {
  "Yes, Completely": "yes completely opened open full fully",
  "Yes, with Dead-Front on": "yes dead front deadfront dead-front cover",
  "Scanned Surface Only": "scanned surface only outside exterior",
  "Can’t Open Item": "cant can't cannot can not open unable",
  "Item is Locked Out": "locked lock out loto lockout",
  "Only 1 Item": "only one 1 single item",
  "Item Was Off at Time of Scan": "off was off not running de-energized deenergized time of scan",
  "Equipment Inaccessible Due to Obstruction(s) in Front of Panel": "inaccessible obstruction obstructed blocked block access front",
};

export function filterOpened(query: string): string[] {
  const q = query.trim().toLowerCase().replace(/[’']/g, "'");
  if (!q) return [...OPENED_VALUES];
  const words = q.split(/\s+/);
  return OPENED_VALUES.filter((v) => {
    const hay = `${v.toLowerCase().replace(/’/g, "'")} ${OPENED_KEYWORDS[v] ?? ""}`;
    const tokens = hay.split(/[\s,()-]+/);
    return words.every((w) => tokens.some((t) => t.startsWith(w)));
  });
}
