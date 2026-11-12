"use client";

import { STORAGE_KEY } from "./domain/constants";
import { downloadText } from "./download";
import { todayISO } from "./format";

/** Downloads all inspection records on this device as JSON (photos are not included). */
export function downloadBackup() {
  let raw = "{}";
  try { raw = localStorage.getItem(STORAGE_KEY) ?? "{}"; } catch { /* ignore */ }
  downloadText(`infrareport-backup-${todayISO()}.json`, raw, "application/json");
}
