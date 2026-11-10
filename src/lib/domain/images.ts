import type { ImageKind } from "./types";

/** "IR_001023.jpg" -> "1023"; "FLIR1023.jpg" -> "1023"; "DC_1024.JPG" -> "1024". */
export function imageNumberFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const groups = base.match(/\d+/g);
  if (!groups) return "";
  return String(Number(groups[groups.length - 1]));
}

export function kindFromFileName(name: string): ImageKind {
  const n = name.toLowerCase();
  if (/^(ir|flir|th|thermal)[_\-\s]?/.test(n)) return "thermal";
  if (/^(dc|vis|visual|img|dsc|photo)[_\-\s]?/.test(n)) return "visual";
  return "unknown";
}

/** Compare image numbers ignoring leading zeros ("01023" == "1023"). */
export function normalizeImageNumber(n: string): string {
  const t = n.trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t.toLowerCase();
}
