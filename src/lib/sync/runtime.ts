"use client";

import { create } from "zustand";
import { supabase } from "../cloud/client";
import { useStore } from "../store/store";
import { SyncEngine, storageKey, type SyncSnapshot } from "./engine";
import type { Conflict, PendingOp, SyncData } from "./outbox";

export type SyncLabel = "Saved on Device" | "Syncing" | "Synced to Cloud" | "Offline" | "Pending Changes" | "Sync Failed" | "Needs Attention";

interface SyncStatus extends SyncSnapshot {
  active: boolean;
  label: SyncLabel;
  ops: PendingOp[];
  conflictList: Conflict[];
}

export const useSyncStatus = create<SyncStatus>(() => ({
  active: false, label: "Saved on Device", pending: 0, failed: 0, conflicts: 0, phase: "idle", offline: false,
  lastError: null, lastPushOkAt: null, lastPullOkAt: null, ops: [], conflictList: [],
}));

export function labelFor(s: SyncSnapshot, active: boolean): SyncLabel {
  if (!active) return "Saved on Device";
  if (s.conflicts) return "Needs Attention";
  if (s.failed) return "Sync Failed";
  if (s.offline) return "Offline";
  if (s.phase === "pushing" || (s.phase === "pulling" && s.pending)) return "Syncing";
  if (s.pending) return "Pending Changes";
  if (s.lastPullOkAt || s.lastPushOkAt) return "Synced to Cloud";
  return "Syncing";
}

let engine: SyncEngine | null = null;
let unsub: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
const PULL_EVERY_MS = 10_000;
const PUSH_DEBOUNCE_MS = 1200;

function publish() {
  if (!engine) { useSyncStatus.setState({ active: false, label: "Saved on Device", ops: [], conflictList: [], pending: 0, failed: 0, conflicts: 0 }); return; }
  const snap = engine.snapshot();
  useSyncStatus.setState({ ...snap, active: true, label: labelFor(snap, true), ops: Object.values(engine.data.ops), conflictList: engine.data.conflicts });
}

const localStore = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => {
    try { localStorage.setItem(k, v); } catch { /* the device-store save indicator already reports full storage */ }
  },
};

function schedule(delay = PUSH_DEBOUNCE_MS) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { void engine?.sync().catch(() => undefined); }, delay);
}

/** Start syncing for the signed-in member. Safe to call repeatedly. */
export function startSync(userId: string, orgId: string) {
  const sb = supabase();
  if (!sb) return;
  if (engine && engine.userId === userId && engine.orgId === orgId) return;
  stopSync();
  switchPerson(userId, orgId);
  engine = new SyncEngine({
    sb,
    getState: () => useStore.getState(),
    setState: (p) => useStore.setState(p),
    storage: localStore,
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    onChange: publish,
  }, userId, orgId);
  unsub = useStore.subscribe((state) => {
    if (!engine) return;
    const before = engine.data;
    engine.onLocalChange(state);
    if (engine.data !== before) schedule(); // only real local edits trigger an upload
  });
  timer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void engine?.sync().catch(() => undefined);
  }, PULL_EVERY_MS);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", publish);
  document.addEventListener("visibilitychange", onVisible);
  publish();
  void engine.sync().catch(() => undefined);
}

const LAST_USER_KEY = "infrareport-cloud-last-user";

/**
 * A different person signing in on this phone must not see the previous
 * person's cached jobs. Shared records are cleared from the device store and
 * reloaded from the cloud under the new person's permissions, but only when
 * the previous person has nothing waiting to upload (their work is never dropped).
 */
function switchPerson(userId: string, orgId: string) {
  const prev = localStore.get(LAST_USER_KEY);
  if (prev && prev !== userId) {
    let pending = 0;
    try { pending = Object.keys(JSON.parse(localStore.get(storageKey(prev, orgId)) ?? "{}").ops ?? {}).length; } catch { pending = 0; }
    if (pending === 0) {
      const keep = <T extends { organizationId: string }>(list: T[]) => list.filter((x) => x.organizationId !== orgId);
      useStore.setState((s) => ({
        customers: keep(s.customers), facilities: keep(s.facilities), locations: keep(s.locations), equipment: keep(s.equipment),
        inspections: keep(s.inspections), rooms: keep(s.rooms), results: keep(s.results), reviewEvents: keep(s.reviewEvents),
        activeInspectionId: s.inspections.some((i) => i.id === s.activeInspectionId && i.organizationId === orgId) ? null : s.activeInspectionId,
      }));
      // The new person's own sync position no longer matches the store: reload everything they can see.
      try {
        const mine = JSON.parse(localStore.get(storageKey(userId, orgId)) ?? "null");
        if (mine) localStore.set(storageKey(userId, orgId), JSON.stringify({ ...mine, cursors: {}, versions: {}, orphans: {} }));
      } catch { /* ignore */ }
    }
  }
  localStore.set(LAST_USER_KEY, userId);
}

function onOnline() { engine?.wake(); schedule(200); }
function onVisible() { if (document.visibilityState === "visible") schedule(200); }

export function stopSync() {
  unsub?.(); unsub = null;
  if (timer) clearInterval(timer);
  if (debounce) clearTimeout(debounce);
  timer = null; debounce = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", publish);
    document.removeEventListener("visibilitychange", onVisible);
  }
  engine = null;
  publish();
}

export const syncNow = () => { engine?.wake(); return engine?.sync(); };
export const resolveConflict = (id: string, choice: "mine" | "theirs") => { engine?.resolveConflict(id, choice); schedule(200); };
export const retryFailed = () => { engine?.retryFailed(); schedule(200); };
export const fullResync = () => { engine?.resetCursors(); schedule(200); };
export const syncData = (): SyncData | null => engine?.data ?? null;
export const hasUnsyncedWork = () => !!engine && Object.keys(engine.data.ops).length > 0;
export const discardFailed = (key: string) => { engine?.discardFailed(key); schedule(200); };
