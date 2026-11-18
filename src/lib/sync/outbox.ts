/**
 * The persistent sync queue ("outbox"). Pure data + functions, no network.
 *
 * Every local change to a shared record becomes (or merges into) ONE pending
 * operation per record. An operation remembers:
 *   - the values this device wants (row),
 *   - which fields this device changed (changed),
 *   - what those fields were before the change (base) and the server version
 *     they were based on (baseVersion).
 * That is exactly what is needed to tell "the server already has my change",
 * "nobody else touched this field, apply it" and "someone else changed the
 * same field: ask the person" apart, so nothing is ever silently overwritten.
 */
import { TABLE_ORDER, sameValue, type Row, type SyncRecord, type TableName } from "./mapping";

export interface PendingOp {
  key: string;
  table: TableName;
  id: string;
  kind: "upsert" | "delete";
  row: Row;
  changed: string[];
  base: Row;
  /** Server version the change was made on; null = the record is not on the server yet. */
  baseVersion: number | null;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  /** Permanent failure (e.g. not allowed). Not retried automatically. */
  failed: string | null;
  lastError: string | null;
  /** A write was attempted at least once (its answer may have been lost). */
  sentOnce?: boolean;
}

export interface Conflict {
  id: string;
  key: string;
  table: TableName;
  recordId: string;
  /** Field name, or "__deleted" when the record was deleted on another device. */
  field: string;
  mine: unknown;
  theirs: unknown;
  theirsVersion: number;
  theirsBy: string | null;
  at: number;
}

export interface SyncData {
  version: 1;
  userId: string;
  orgId: string;
  ops: Record<string, PendingOp>;
  /** Last server version seen per record ("table:id"). */
  versions: Record<string, number>;
  /** Pull cursor per table (server timestamp). */
  cursors: Partial<Record<TableName, string>>;
  conflicts: Conflict[];
  /** Thermal image rows received before their result (applied when it arrives). */
  orphans: Record<string, Row>;
  lastPushOkAt: number | null;
  lastPullOkAt: number | null;
  /** Last unsent-change counts this device reported per inspection ("pending|failed"). */
  reported?: Record<string, string>;
  reportedAt?: number;
}

export function emptySyncData(userId: string, orgId: string): SyncData {
  return { version: 1, userId, orgId, ops: {}, versions: {}, cursors: {}, conflicts: [], orphans: {}, lastPushOkAt: null, lastPullOkAt: null };
}

const ID_FIELDS = new Set(["id", "organization_id"]);

/** Fields of a row that differ between two snapshots. */
export function diffFields(a: Row, b: Row): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !ID_FIELDS.has(k) && !sameValue(a[k], b[k]));
}

/**
 * Record local edits: compare the previous and next snapshots of the shared
 * records and merge the differences into the outbox. Returns a new SyncData.
 */
export function recordChanges(data: SyncData, prev: Map<string, SyncRecord>, next: Map<string, SyncRecord>, nowMs = Date.now()): SyncData {
  const ops = { ...data.ops };
  let touched = false;
  for (const [key, rec] of next) {
    const before = prev.get(key);
    if (before && diffFields(before.row, rec.row).length === 0) continue;
    touched = true;
    const existing = ops[key];
    if (!before) {
      // Created on this device (or restored after a local delete).
      ops[key] = existing
        ? { ...existing, kind: "upsert", row: rec.row, changed: union(existing.changed, fieldsOf(rec.row)), attempts: 0, nextAttemptAt: 0, failed: null }
        : newOp(key, rec, fieldsOf(rec.row), {}, data.versions[key] ?? null, nowMs);
      continue;
    }
    const changed = diffFields(before.row, rec.row);
    if (existing) {
      const base = { ...existing.base };
      for (const f of changed) if (!existing.changed.includes(f)) base[f] = before.row[f];
      ops[key] = { ...existing, kind: "upsert", row: rec.row, changed: union(existing.changed, changed), base, attempts: 0, nextAttemptAt: 0, failed: null };
    } else {
      const base: Row = {};
      for (const f of changed) base[f] = before.row[f];
      ops[key] = newOp(key, rec, changed, base, data.versions[key] ?? null, nowMs);
    }
  }
  for (const [key, rec] of prev) {
    if (next.has(key)) continue;
    touched = true;
    const existing = ops[key];
    if (existing && existing.baseVersion === null && !existing.sentOnce && !(key in data.versions) && rec.table !== "inspection_assignments") {
      delete ops[key]; // never reached the server: nothing to delete there
      continue;
    }
    ops[key] = { ...(existing ?? newOp(key, rec, [], {}, data.versions[key] ?? null, nowMs)), kind: "delete", row: rec.row, attempts: 0, nextAttemptAt: 0, failed: null };
  }
  return touched ? { ...data, ops } : data;
}

function newOp(key: string, rec: SyncRecord, changed: string[], base: Row, baseVersion: number | null, nowMs: number): PendingOp {
  return { key, table: rec.table, id: rec.id, kind: "upsert", row: rec.row, changed, base, baseVersion, createdAt: nowMs, attempts: 0, nextAttemptAt: 0, failed: null, lastError: null };
}

const fieldsOf = (row: Row) => Object.keys(row).filter((k) => !ID_FIELDS.has(k));
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** Push order: parents first, then oldest first. */
export function orderedOps(data: SyncData): PendingOp[] {
  const rank = (t: TableName) => TABLE_ORDER.indexOf(t);
  return Object.values(data.ops).sort((a, b) => {
    // Deletes of children before parents; inserts/updates of parents before children.
    const da = a.kind === "delete" ? -rank(a.table) : rank(a.table);
    const db = b.kind === "delete" ? -rank(b.table) : rank(b.table);
    const ka = a.kind === "delete" ? 1 : 0, kb = b.kind === "delete" ? 1 : 0;
    return ka - kb || da - db || a.createdAt - b.createdAt;
  });
}

export type FieldDecision = "applied" | "apply" | "conflict";

/**
 * Compare my pending field against the current server value.
 * - equal to mine: already applied (maybe a retry whose answer was lost)
 * - equal to the value my edit started from: nobody else changed it, apply mine
 * - anything else: another device changed the same field -> conflict
 */
export function decideField(op: PendingOp, field: string, server: Row, baseKnown = true): FieldDecision {
  if (sameValue(server[field], op.row[field])) return "applied";
  if (baseKnown && field in op.base && sameValue(server[field], op.base[field])) return "apply";
  return "conflict";
}

/** After a successful write: drop the fields that the server now has, keep anything edited meanwhile. */
export function settleOp(data: SyncData, key: string, sent: Row, serverRow: Row | null, newVersion: number | null): SyncData {
  const op = data.ops[key];
  const ops = { ...data.ops };
  const versions = { ...data.versions };
  if (newVersion !== null) versions[key] = newVersion;
  if (!op) return { ...data, ops, versions };
  const remaining = op.changed.filter((f) => !(f in sent) || !sameValue(op.row[f], sent[f]));
  if (op.kind === "delete" || remaining.length === 0) {
    delete ops[key];
  } else {
    const base: Row = {};
    for (const f of remaining) base[f] = f in sent ? sent[f] : serverRow?.[f] ?? op.base[f];
    ops[key] = { ...op, changed: remaining, base, baseVersion: newVersion ?? op.baseVersion, attempts: 0, nextAttemptAt: 0, lastError: null };
  }
  return { ...data, ops, versions };
}

export function backoffMs(attempts: number) {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
}

/** Ops touching an inspection (by row field or own id). Used for export warnings. */
export function opsForInspection(data: SyncData | null, inspectionId: string): PendingOp[] {
  if (!data) return [];
  return Object.values(data.ops).filter((o) => o.row.inspection_id === inspectionId || (o.table === "inspections" && o.id === inspectionId));
}
