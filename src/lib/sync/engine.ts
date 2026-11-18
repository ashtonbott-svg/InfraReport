/**
 * Sync engine: pushes the outbox to Supabase and pulls other devices' changes.
 *
 * Rules that protect inspection data:
 * - The device store stays the source of the screen; saving locally is never
 *   blocked by the network.
 * - Every write is conditional on the record version it was based on. When
 *   another device changed the record, fields are compared one by one and only
 *   genuinely competing edits become a visible conflict for the person.
 * - A record is reported "synced" only after the database answered with it.
 * - The outbox is written to device storage synchronously with every change,
 *   so refreshes, crashes and closed tabs do not lose queued changes.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { DataState } from "../store/store";
import type { InspectionResult, ThermalImage } from "../domain/types";
import { newThermalImage } from "../domain/thermal";
import {
  NATURAL_KEYS, SERVER_COLUMNS, TABLE_ORDER, extractRecords, sameValue, toCustomer, toEquipment, toEvent, toFacility, toImage,
  toInspection, toLocation, toResult, toRoom, type Row, type SyncRecord, type TableName,
} from "./mapping";
import {
  backoffMs, decideField, emptySyncData, orderedOps, recordChanges, settleOp, type Conflict, type PendingOp, type SyncData,
} from "./outbox";

type Shared = Pick<DataState, "customers" | "facilities" | "locations" | "equipment" | "inspections" | "rooms" | "results" | "reviewEvents">;
const SHARED_KEYS: (keyof Shared)[] = ["customers", "facilities", "locations", "equipment", "inspections", "rooms", "results", "reviewEvents"];

export interface EngineDeps {
  sb: SupabaseClient;
  getState: () => DataState;
  /** Writes pulled data into the device store. */
  setState: (partial: Partial<DataState>) => void;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  online?: () => boolean;
  now?: () => number;
  /** Called after outbox / status changes. */
  onChange?: () => void;
}

export type SyncPhase = "idle" | "pushing" | "pulling";

export interface SyncSnapshot {
  pending: number;
  failed: number;
  conflicts: number;
  phase: SyncPhase;
  offline: boolean;
  lastError: string | null;
  lastPushOkAt: number | null;
  lastPullOkAt: number | null;
}

export const storageKey = (userId: string, orgId: string) => `infrareport-sync-v1:${orgId}:${userId}`;
const PAGE = 500;
const OVERLAP_MS = 30_000;
const IGNORE_ON_MERGE = new Set(["sort_order", "source", "location_id"]);
const cursorColumn = (t: TableName) => (t === "review_events" ? "received_at" : "updated_at");

const isEmptyish = (v: unknown) => v === null || v === undefined || v === "" || (typeof v === "object" && v !== null && Object.keys(v).length === 0);

type ErrKind = "network" | "auth" | "denied" | "parent_missing" | "duplicate" | "other";
function classify(err: PostgrestError | null, status?: number): ErrKind {
  if (!err) return "other";
  const code = err.code ?? "";
  if (!code && (status === 0 || status === undefined || /fetch|network|Failed to fetch|load failed/i.test(err.message))) return "network";
  if (status === 401 || code === "PGRST301" || code === "PGRST303" || /JWT/i.test(err.message)) return "auth";
  if (code === "42501" || status === 403) return "denied";
  if (code === "23503") return "parent_missing";
  if (code === "23505") return "duplicate";
  if (status !== undefined && status >= 500) return "network";
  return "other";
}

export class SyncEngine {
  data: SyncData;
  private last: Map<string, SyncRecord>;
  private lastRefs: unknown[] = [];
  private applying = false;
  private running: Promise<void> | null = null;
  phase: SyncPhase = "idle";
  offline = false;
  lastError: string | null = null;
  readonly key: string;

  constructor(private d: EngineDeps, readonly userId: string, readonly orgId: string) {
    this.key = storageKey(userId, orgId);
    let loaded: SyncData | null = null;
    try { loaded = JSON.parse(d.storage.get(this.key) ?? "null"); } catch { loaded = null; }
    this.data = loaded && loaded.version === 1 && loaded.userId === userId ? { ...emptySyncData(userId, orgId), ...loaded } : emptySyncData(userId, orgId);
    const s = d.getState();
    this.last = extractRecords(s, orgId);
    this.lastRefs = SHARED_KEYS.map((k) => s[k]);
  }

  private now() { return this.d.now ? this.d.now() : Date.now(); }

  private save(next: SyncData) {
    this.data = next;
    this.d.storage.set(this.key, JSON.stringify(next));
    this.d.onChange?.();
  }

  snapshot(): SyncSnapshot {
    const ops = Object.values(this.data.ops);
    return {
      pending: ops.filter((o) => !o.failed).length,
      failed: ops.filter((o) => o.failed).length,
      conflicts: this.data.conflicts.length,
      phase: this.phase,
      offline: this.offline || (this.d.online ? !this.d.online() : false),
      lastError: this.lastError,
      lastPushOkAt: this.data.lastPushOkAt,
      lastPullOkAt: this.data.lastPullOkAt,
    };
  }

  /* ------------------------------ local changes ------------------------------ */

  /** Call on every device-store change (synchronously). */
  onLocalChange(state: DataState) {
    const refs = SHARED_KEYS.map((k) => state[k]);
    if (refs.every((r, i) => r === this.lastRefs[i])) return;
    this.lastRefs = refs;
    const next = extractRecords(state, this.orgId);
    if (this.applying) { this.last = next; return; }
    const prev = this.last;
    this.last = next;
    const updated = recordChanges(this.data, prev, next, this.now());
    if (updated !== this.data) this.save(updated);
  }

  /** Apply changes to the device store without queueing them for upload. */
  private applyLocal(partial: Partial<DataState>) {
    this.applying = true;
    try { this.d.setState(partial); } finally { this.applying = false; }
    const s = this.d.getState();
    this.last = extractRecords(s, this.orgId);
    this.lastRefs = SHARED_KEYS.map((k) => s[k]);
  }

  /* ---------------------------------- sync ---------------------------------- */

  /** Push then pull. Concurrent calls share one run. */
  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await this.push();
        await this.pull();
      } finally {
        this.phase = "idle";
        this.running = null;
        this.d.onChange?.();
      }
    })();
    return this.running;
  }

  private setPhase(p: SyncPhase) { this.phase = p; this.d.onChange?.(); }

  async push(): Promise<void> {
    const due = orderedOps(this.data).filter((o) => !o.failed && o.nextAttemptAt <= this.now());
    if (!due.length) return;
    this.setPhase("pushing");
    let networkDown = false;
    for (const op0 of due) {
      const op = this.data.ops[op0.key];
      if (!op || op.failed || op.nextAttemptAt > this.now()) continue;
      // Parents go first; when the network drops, stop and keep the order for the retry.
      if ((await this.pushOp(op)) === "network") { networkDown = true; break; }
    }
    if (!networkDown) {
      this.offline = false;
      if (!Object.values(this.data.ops).some((o) => !o.failed)) this.save({ ...this.data, lastPushOkAt: this.now() });
    }
  }

  private markSent(op: PendingOp) {
    if (op.sentOnce) return;
    this.save({ ...this.data, ops: { ...this.data.ops, [op.key]: { ...op, sentOnce: true } } });
  }

  private fail(op: PendingOp, kind: ErrKind, message: string): ErrKind {
    const cur = this.data.ops[op.key];
    if (!cur) return kind;
    const transient = kind === "network" || kind === "auth" || kind === "parent_missing";
    const attempts = cur.attempts + 1;
    const permanent = !transient || (kind === "parent_missing" && attempts > 12);
    const failed = permanent ? (kind === "denied" ? "Not allowed for your account" : message) : null;
    this.save({ ...this.data, ops: { ...this.data.ops, [op.key]: { ...cur, attempts, nextAttemptAt: this.now() + backoffMs(attempts), lastError: message, failed } } });
    if (kind === "network") { this.offline = true; this.lastError = "Offline. Changes are saved on this device and will upload automatically."; }
    else if (kind === "auth") { this.lastError = "Session expired. Sign in again to upload changes."; void this.d.sb.auth.refreshSession().catch(() => undefined); }
    else this.lastError = message;
    return kind;
  }

  private payload(op: PendingOp, fields?: string[]): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(op.row)) {
      if (SERVER_COLUMNS.has(k) || k.startsWith("__")) continue;
      if (fields && !fields.includes(k) && k !== "id" && k !== "organization_id") continue;
      out[k] = v;
    }
    if (op.row.__restore) out.deleted_at = null;
    return out;
  }

  /** Returns the error kind on failure, or "ok". */
  async pushOp(op: PendingOp): Promise<ErrKind | "ok"> {
    const sb = this.d.sb;
    this.markSent(op);
    op = this.data.ops[op.key];

    if (op.table === "inspection_assignments") {
      const [inspectionId, userId] = op.id.split("|");
      const res = op.kind === "delete"
        ? await sb.from("inspection_assignments").delete().eq("inspection_id", inspectionId).eq("user_id", userId)
        : await sb.from("inspection_assignments").insert({ inspection_id: inspectionId, user_id: userId, organization_id: this.orgId });
      if (res.error && classify(res.error, res.status) !== "duplicate") return this.fail(op, classify(res.error, res.status), res.error.message);
      this.save(settleOp(this.data, op.key, op.row, null, null));
      return "ok";
    }
    if (op.table === "review_events") {
      if (op.kind === "delete") { this.save(settleOp(this.data, op.key, {}, null, null)); return "ok"; }
      const res = await sb.from("review_events").insert(this.payload(op));
      if (res.error && classify(res.error, res.status) !== "duplicate") return this.fail(op, classify(res.error, res.status), res.error.message);
      this.save(settleOp(this.data, op.key, op.row, null, null));
      return "ok";
    }

    if (op.kind === "delete") return this.pushDelete(op);
    if (op.baseVersion === null) return this.pushInsert(op);
    return this.pushUpdate(op);
  }

  private async fetchRow(table: TableName, id: string): Promise<{ row: Row | null; err: PostgrestError | null; status: number }> {
    const r = await this.d.sb.from(table).select("*").eq("id", id).maybeSingle();
    return { row: (r.data as Row | null) ?? null, err: r.error, status: r.status };
  }

  private async pushInsert(op: PendingOp): Promise<ErrKind | "ok"> {
    const sent = this.payload(op);
    const res = await this.d.sb.from(op.table).insert(sent).select().maybeSingle();
    if (!res.error && res.data) {
      this.save(settleOp(this.data, op.key, sent, res.data as Row, (res.data as Row).version as number));
      return "ok";
    }
    const kind = classify(res.error, res.status);
    if (kind !== "duplicate") return this.fail(op, kind, res.error?.message ?? "Insert failed");

    const natural = NATURAL_KEYS[op.table];
    const isPk = /_pkey/.test(res.error?.message ?? "") || !natural;
    if (isPk) {
      // Usually our own earlier insert whose answer was lost.
      const got = await this.fetchRow(op.table, op.id);
      if (got.err) return this.fail(op, classify(got.err, got.status), got.err.message);
      if (!got.row) return this.fail(op, "denied", "A record with this id exists but is not visible to you");
      const mineUntouched = got.row.version === 1 && got.row.created_by === this.userId;
      this.rebase(op.key, got.row, mineUntouched ? "server-is-base" : "empty-only");
      return this.pushAgain(op.key);
    }
    // Another device already created the same room / equipment line for this inspection: fold into theirs.
    let q = this.d.sb.from(op.table).select("*").is("deleted_at", null);
    for (const k of natural!) q = q.eq(k, op.row[k] as string);
    const theirs = await q.maybeSingle();
    if (theirs.error || !theirs.data) return this.fail(op, theirs.error ? classify(theirs.error, theirs.status) : "other", theirs.error?.message ?? "Matching record not found");
    const serverRow = theirs.data as Row;
    this.remapId(op.table, op.id, String(serverRow.id));
    this.rebase(`${op.table}:${serverRow.id}`, serverRow, "empty-only");
    return this.pushAgain(`${op.table}:${serverRow.id}`);
  }

  private async pushAgain(key: string, depth = 1): Promise<ErrKind | "ok"> {
    const op = this.data.ops[key];
    if (!op || op.baseVersion === null || depth > 3) return "ok"; // anything left is retried next cycle
    return this.pushUpdate(op, depth);
  }

  private async pushUpdate(op: PendingOp, depth = 0): Promise<ErrKind | "ok"> {
    if (!op.changed.length) { this.save(settleOp(this.data, op.key, {}, null, op.baseVersion)); return "ok"; }
    const sent = this.payload(op, op.changed);
    const res = await this.d.sb.from(op.table).update(sent).eq("id", op.id).eq("version", op.baseVersion!).select();
    if (res.error) return this.fail(op, classify(res.error, res.status), res.error.message);
    const rows = (res.data ?? []) as Row[];
    if (rows.length) {
      this.save(settleOp(this.data, op.key, sent, rows[0], rows[0].version as number));
      return "ok";
    }
    // Version moved (another device saved first) or the record is gone.
    const got = await this.fetchRow(op.table, op.id);
    if (got.err) return this.fail(op, classify(got.err, got.status), got.err.message);
    if (!got.row) return this.fail(op, "denied", "This record was removed or you no longer have access to it");
    if (got.row.deleted_at && !op.row.__restore) {
      this.addConflicts([{ key: op.key, table: op.table, recordId: op.id, field: "__deleted", mine: "Keep my version", theirs: "Deleted on another device", theirsVersion: got.row.version as number, theirsBy: (got.row.updated_by as string) ?? null }]);
      const ops = { ...this.data.ops };
      delete ops[op.key];
      this.save({ ...this.data, ops });
      return "ok";
    }
    if (depth > 0 && got.row.version === op.baseVersion) return this.fail(op, "other", "Update was not accepted");
    this.rebase(op.key, got.row, "known");
    return this.pushAgain(op.key, depth + 1);
  }

  private async pushDelete(op: PendingOp): Promise<ErrKind | "ok"> {
    let q = this.d.sb.from(op.table).update({ deleted_at: new Date(this.now()).toISOString() }).eq("id", op.id).is("deleted_at", null);
    if (op.baseVersion !== null && !op.row.__force) q = q.eq("version", op.baseVersion);
    const res = await q.select();
    if (res.error) return this.fail(op, classify(res.error, res.status), res.error.message);
    if ((res.data ?? []).length) { this.save(settleOp(this.data, op.key, {}, null, (res.data as Row[])[0].version as number)); return "ok"; }
    const got = await this.fetchRow(op.table, op.id);
    if (got.err) return this.fail(op, classify(got.err, got.status), got.err.message);
    if (!got.row || got.row.deleted_at) { this.save(settleOp(this.data, op.key, {}, null, null)); return "ok"; }
    // Someone else edited the record after I last saw it: do not delete their work silently.
    this.addConflicts([{ key: op.key, table: op.table, recordId: op.id, field: "__delete", mine: "Delete it", theirs: "Keep it (changed on another device)", theirsVersion: got.row.version as number, theirsBy: (got.row.updated_by as string) ?? null }]);
    const ops = { ...this.data.ops };
    delete ops[op.key];
    this.save({ ...this.data, ops, versions: { ...this.data.versions, [op.key]: got.row.version as number } });
    return "ok";
  }

  /**
   * Re-base a pending change on the server's current row: fields already equal
   * are dropped, safe fields are kept for upload, competing fields become conflicts.
   */
  private rebase(key: string, server: Row, mode: "known" | "server-is-base" | "empty-only") {
    const op = this.data.ops[key];
    if (!op) return;
    const apply: string[] = [];
    const conflicts: Omit<Conflict, "id" | "at">[] = [];
    for (const f of op.changed) {
      if (SERVER_COLUMNS.has(f) || f === "id" || f === "organization_id") continue;
      if (sameValue(server[f], op.row[f])) continue;
      let decision: "apply" | "conflict" | "applied";
      if (mode === "server-is-base") decision = "apply";
      else if (mode === "empty-only") decision = isEmptyish(server[f]) ? "apply" : IGNORE_ON_MERGE.has(f) ? "applied" : "conflict";
      else decision = decideField(op, f, server);
      if (decision === "apply") apply.push(f);
      else if (decision === "conflict") {
        if (IGNORE_ON_MERGE.has(f)) continue;
        conflicts.push({ key, table: op.table, recordId: op.id, field: f, mine: op.row[f], theirs: server[f], theirsVersion: server.version as number, theirsBy: (server.updated_by as string) ?? null });
      }
    }
    const base: Row = {};
    for (const f of apply) base[f] = server[f];
    const ops = { ...this.data.ops };
    const version = server.version as number;
    if (apply.length) ops[key] = { ...op, kind: "upsert", changed: apply, base, baseVersion: version, attempts: 0, nextAttemptAt: 0, failed: null };
    else delete ops[key];
    this.save({ ...this.data, ops, versions: { ...this.data.versions, [key]: version } });
    if (conflicts.length) this.addConflicts(conflicts);
    // Fields we are not uploading take the server's value locally (except conflicts, which wait for the person).
    const conflictFields = new Set(conflicts.map((c) => c.field));
    const localRow = this.last.get(key)?.row;
    if (localRow) {
      const merged: Row = { ...localRow };
      for (const [f, v] of Object.entries(server)) if (!apply.includes(f) && !conflictFields.has(f)) merged[f] = v;
      this.writeRows([{ table: op.table, row: merged }]);
    }
  }

  private addConflicts(list: Omit<Conflict, "id" | "at">[]) {
    const existing = this.data.conflicts.filter((c) => !list.some((n) => n.key === c.key && n.field === c.field));
    const added = list.map((c) => ({ ...c, id: `${c.key}#${c.field}`, at: this.now() }));
    this.save({ ...this.data, conflicts: [...existing, ...added] });
  }

  /** Local record id L becomes the server's id S (room / equipment line created on two phones). */
  private remapId(table: TableName, from: string, to: string) {
    const s = this.d.getState();
    const partial: Partial<DataState> = {};
    if (table === "room_conditions") {
      const dupe = s.rooms.some((r) => r.id === to);
      partial.rooms = dupe ? s.rooms.filter((r) => r.id !== from) : s.rooms.map((r) => (r.id === from ? { ...r, id: to } : r));
    } else if (table === "results") {
      const theirs = s.results.find((r) => r.id === to);
      const mine = s.results.find((r) => r.id === from);
      partial.results = theirs && mine
        ? s.results.filter((r) => r.id !== from).map((r) => (r.id === to ? { ...r, images: mergeImages(r.images, mine.images) } : r))
        : s.results.map((r) => (r.id === from ? { ...r, id: to } : r));
      partial.images = s.images.map((im) => (im.matchedResultId === from ? { ...im, matchedResultId: to } : im));
    }
    this.applyLocal(partial);
    const ops: Record<string, PendingOp> = {};
    for (const [k, op] of Object.entries(this.data.ops)) {
      if (k === `${table}:${from}`) {
        const nk = `${table}:${to}`;
        ops[nk] = { ...op, key: nk, id: to, row: { ...op.row, id: to } };
      } else if (table === "results" && op.row.result_id === from) {
        ops[k] = { ...op, row: { ...op.row, result_id: to } };
      } else ops[k] = op;
    }
    this.save({ ...this.data, ops });
  }

  async pull(): Promise<void> {
    this.setPhase("pulling");
    const sb = this.d.sb;
    const fetched: Partial<Record<TableName, Row[]>> = {};
    const cursors = { ...this.data.cursors };
    try {
      for (const t of TABLE_ORDER) {
        if (t === "inspection_assignments") continue;
        const col = cursorColumn(t);
        const since = cursors[t] ? new Date(new Date(cursors[t]!).getTime() - OVERLAP_MS).toISOString() : "1970-01-01T00:00:00Z";
        const rows: Row[] = [];
        for (let offset = 0; ; offset += PAGE) {
          const r = await sb.from(t).select("*").eq("organization_id", this.orgId).gte(col, since).order(col).order("id").range(offset, offset + PAGE - 1);
          if (r.error) throw Object.assign(new Error(r.error.message), { kind: classify(r.error, r.status) });
          rows.push(...((r.data ?? []) as Row[]));
          if ((r.data ?? []).length < PAGE) break;
        }
        fetched[t] = rows;
        const max = rows.reduce((m, x) => (String(x[col]) > m ? String(x[col]) : m), cursors[t] ?? "");
        if (max) cursors[t] = max;
      }
      const assignments = await sb.from("inspection_assignments").select("inspection_id, user_id, created_at").eq("organization_id", this.orgId).order("created_at");
      if (assignments.error) throw Object.assign(new Error(assignments.error.message), { kind: classify(assignments.error, assignments.status) });
      const visible = await sb.from("inspections").select("id").eq("organization_id", this.orgId).is("deleted_at", null);
      if (visible.error) throw Object.assign(new Error(visible.error.message), { kind: classify(visible.error, visible.status) });

      this.applyPulled(fetched, (assignments.data ?? []) as Row[], new Set(((visible.data ?? []) as Row[]).map((r) => String(r.id))));
      this.offline = false;
      if (!this.lastError?.startsWith("Not allowed")) this.lastError = null;
      this.save({ ...this.data, cursors, lastPullOkAt: this.now() });
    } catch (e) {
      const kind = (e as { kind?: ErrKind }).kind ?? "network";
      if (kind === "network") { this.offline = true; this.lastError = "Offline. Showing what is saved on this device."; }
      else if (kind === "auth") { this.lastError = "Session expired. Sign in again to sync."; void sb.auth.refreshSession().catch(() => undefined); }
      else this.lastError = (e as Error).message;
      this.d.onChange?.();
    }
  }

  /** Merge pulled rows into the device store. Pending local edits always win locally until uploaded or resolved. */
  applyPulled(fetched: Partial<Record<TableName, Row[]>>, assignments: Row[] | null, visibleInspections: Set<string> | null) {
    const versions = { ...this.data.versions };
    const newConflicts: Omit<Conflict, "id" | "at">[] = [];
    const writes: { table: TableName; row: Row }[] = [];
    const removals: { table: TableName; id: string }[] = [];
    for (const t of TABLE_ORDER) {
      for (const row of fetched[t] ?? []) {
        const id = String(row.id);
        const key = `${t}:${id}`;
        const op = this.data.ops[key];
        const version = (row.version as number | undefined) ?? 0;
        if (row.deleted_at) {
          if (op && op.kind === "upsert") {
            if (!this.data.conflicts.some((c) => c.key === key)) newConflicts.push({ key, table: t, recordId: id, field: "__deleted", mine: "Keep my version", theirs: "Deleted on another device", theirsVersion: version, theirsBy: (row.updated_by as string) ?? null });
          } else if (this.last.has(key) || t === "thermal_images") removals.push({ table: t, id });
          versions[key] = version;
          continue;
        }
        if (t !== "review_events" && versions[key] !== undefined && versions[key] >= version && this.last.has(key)) continue;
        if (op?.kind === "delete") { continue; }
        // Natural-key twin created on this device: fold mine into the server's record.
        const nat = NATURAL_KEYS[t];
        if (nat && !this.last.has(key)) {
          const twin = [...this.last.values()].find((r) => r.table === t && r.id !== id && nat.every((k) => sameValue(r.row[k], row[k])));
          if (twin) {
            this.remapId(t, twin.id, id);
            this.rebase(key, row, "empty-only");
          }
        }
        const merged: Row = { ...row };
        const pending = this.data.ops[key];
        if (pending?.kind === "upsert") for (const f of pending.changed) merged[f] = pending.row[f];
        writes.push({ table: t, row: merged });
        if (t !== "review_events") versions[key] = Math.max(versions[key] ?? 0, version);
      }
    }
    this.data = { ...this.data, versions };
    this.writeRows(writes, removals, assignments, visibleInspections);
    if (newConflicts.length) this.addConflicts(newConflicts);
    this.save({ ...this.data, versions });
  }

  /** Convert database rows to device records and write them into the store in one update. */
  private writeRows(writes: { table: TableName; row: Row }[], removals: { table: TableName; id: string }[] = [], assignments: Row[] | null = null, visible: Set<string> | null = null) {
    const s = this.d.getState();
    const by = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const customers = by(s.customers), facilities = by(s.facilities), locations = by(s.locations), equipment = by(s.equipment);
    const inspections = by(s.inspections), rooms = by(s.rooms), results = by(s.results), events = by(s.reviewEvents);
    const orphans = { ...this.data.orphans };
    const imageRows: Row[] = [];
    let changed = writes.length > 0 || removals.length > 0;
    for (const { table, row } of writes) {
      const id = String(row.id);
      switch (table) {
        case "customers": customers.set(id, toCustomer(row)); break;
        case "facilities": facilities.set(id, toFacility(row)); break;
        case "locations": locations.set(id, toLocation(row)); break;
        case "equipment": equipment.set(id, toEquipment(row)); break;
        case "inspections": inspections.set(id, toInspection(row, inspections.get(id))); break;
        case "room_conditions": rooms.set(id, toRoom(row)); break;
        case "results": {
          const existing = results.get(id);
          const incoming = writes.filter((w) => w.table === "thermal_images" && w.row.result_id === id).map((w) => w.row);
          const fromOrphans = Object.values(orphans).filter((r) => r.result_id === id);
          let images: ThermalImage[] = existing?.images ?? [];
          if (!images.length) images = [...incoming, ...fromOrphans].sort(bySort).map(toImage);
          for (const o of fromOrphans) delete orphans[`thermal_images:${o.id}`];
          if (!images.length) images = [newThermalImage({ id: `${id}-img-0` })];
          results.set(id, toResult(row, images));
          break;
        }
        case "thermal_images": imageRows.push(row); break;
        case "review_events": events.set(id, toEvent(row)); break;
        default: break;
      }
    }
    for (const row of imageRows) {
      const r = results.get(String(row.result_id));
      if (!r) { orphans[`thermal_images:${row.id}`] = row; continue; }
      results.set(r.id, { ...r, images: upsertImage(r.images, toImage(row), row.sort_order as number, (iid) => this.isPlaceholder(iid)) });
    }
    for (const { table, id } of removals) {
      const map: Record<string, Map<string, unknown>> = { customers, facilities, locations, equipment, inspections, room_conditions: rooms, results };
      if (table === "thermal_images") {
        for (const r of results.values()) {
          if (!r.images.some((i) => i.id === id)) continue;
          const left = r.images.filter((i) => i.id !== id);
          results.set(r.id, { ...r, images: left.length ? left : [newThermalImage({ component: r.images[0]?.component ?? "" })] });
        }
        delete orphans[`thermal_images:${id}`];
      } else map[table]?.delete(id);
    }
    // Assignments: the server list is authoritative unless this device has a pending assignment change.
    if (assignments) {
      const grouped = new Map<string, string[]>();
      for (const a of assignments) grouped.set(String(a.inspection_id), [...(grouped.get(String(a.inspection_id)) ?? []), String(a.user_id)]);
      for (const [id, insp] of inspections) {
        if (insp.organizationId !== this.orgId) continue;
        if (Object.values(this.data.ops).some((o) => o.table === "inspection_assignments" && o.id.startsWith(`${id}|`))) continue;
        if (!(`inspections:${id}` in this.data.versions)) continue; // not on the server yet
        const server = grouped.get(id) ?? [];
        const ordered = [...insp.inspectorIds.filter((u) => server.includes(u)), ...server.filter((u) => !insp.inspectorIds.includes(u))];
        if (ordered.join() !== insp.inspectorIds.join()) { inspections.set(id, { ...insp, inspectorIds: ordered }); changed = true; }
      }
    }
    // Jobs no longer visible to this account (unassigned or deleted) leave this device, unless it has unsent work on them.
    let dropped = new Set<string>();
    if (visible) {
      dropped = new Set([...inspections.values()]
        .filter((i) => i.organizationId === this.orgId && !visible.has(i.id) && `inspections:${i.id}` in this.data.versions)
        .filter((i) => !Object.values(this.data.ops).some((o) => o.row.inspection_id === i.id || (o.table === "inspections" && o.id === i.id)))
        .map((i) => i.id));
    }
    const keepInsp = (x: { inspectionId: string }) => !dropped.has(x.inspectionId);
    this.data = { ...this.data, orphans };
    if (!changed && !dropped.size) return;
    this.applyLocal({
      customers: [...customers.values()], facilities: [...facilities.values()], locations: [...locations.values()], equipment: [...equipment.values()],
      inspections: [...inspections.values()].filter((i) => !dropped.has(i.id)),
      rooms: [...rooms.values()].filter(keepInsp), results: [...results.values()].filter(keepInsp), reviewEvents: [...events.values()].filter(keepInsp),
      activeInspectionId: s.activeInspectionId && dropped.has(s.activeInspectionId) ? null : s.activeInspectionId,
    });
  }

  private isPlaceholder(imageId: string) {
    const key = `thermal_images:${imageId}`;
    return !(key in this.data.versions) && !this.data.ops[key];
  }

  /* -------------------------------- conflicts -------------------------------- */

  resolveConflict(conflictId: string, choice: "mine" | "theirs") {
    const c = this.data.conflicts.find((x) => x.id === conflictId);
    if (!c) return;
    const conflicts = this.data.conflicts.filter((x) => x.id !== conflictId);
    const local = this.last.get(c.key);
    if (c.field === "__deleted") {
      if (choice === "theirs") {
        this.save({ ...this.data, conflicts });
        this.writeRows([], [{ table: c.table, id: c.recordId }]);
      } else if (local) {
        const op: PendingOp = { key: c.key, table: c.table, id: c.recordId, kind: "upsert", row: { ...local.row, __restore: true }, changed: Object.keys(local.row).filter((k) => k !== "id" && k !== "organization_id"), base: {}, baseVersion: c.theirsVersion, createdAt: this.now(), attempts: 0, nextAttemptAt: 0, failed: null, lastError: null, sentOnce: true };
        this.save({ ...this.data, conflicts, ops: { ...this.data.ops, [c.key]: op } });
      }
      return;
    }
    if (c.field === "__delete") {
      if (choice === "mine") {
        const op: PendingOp = { key: c.key, table: c.table, id: c.recordId, kind: "delete", row: { id: c.recordId, __force: true }, changed: [], base: {}, baseVersion: c.theirsVersion, createdAt: this.now(), attempts: 0, nextAttemptAt: 0, failed: null, lastError: null, sentOnce: true };
        this.save({ ...this.data, conflicts, ops: { ...this.data.ops, [c.key]: op } });
      } else {
        // Bring the other device's version back onto this device.
        this.save({ ...this.data, conflicts, cursors: { ...this.data.cursors, [c.table]: undefined } });
      }
      return;
    }
    if (choice === "theirs") {
      this.save({ ...this.data, conflicts });
      if (local) this.writeRows([{ table: c.table, row: { ...local.row, [c.field]: c.theirs } }]);
    } else {
      const existing = this.data.ops[c.key];
      const row = { ...(existing?.row ?? local?.row ?? { id: c.recordId }), [c.field]: c.mine };
      const op: PendingOp = existing
        ? { ...existing, row, changed: [...new Set([...existing.changed, c.field])], base: { ...existing.base, [c.field]: c.theirs }, baseVersion: c.theirsVersion }
        : { key: c.key, table: c.table, id: c.recordId, kind: "upsert", row, changed: [c.field], base: { [c.field]: c.theirs }, baseVersion: c.theirsVersion, createdAt: this.now(), attempts: 0, nextAttemptAt: 0, failed: null, lastError: null, sentOnce: true };
      this.save({ ...this.data, conflicts, ops: { ...this.data.ops, [c.key]: op } });
      if (local) this.writeRows([{ table: c.table, row: { ...local.row, [c.field]: c.mine } }]);
    }
  }

  /** Retry permanently failed changes (e.g. after an administrator fixed an assignment). */
  retryFailed() {
    const ops: Record<string, PendingOp> = {};
    for (const [k, o] of Object.entries(this.data.ops)) ops[k] = o.failed ? { ...o, failed: null, attempts: 0, nextAttemptAt: 0 } : o;
    this.save({ ...this.data, ops });
  }

  /** Drop a change the server refused; the server's current value is reloaded onto this device. */
  discardFailed(key: string) {
    const op = this.data.ops[key];
    if (!op) return;
    const ops = { ...this.data.ops };
    delete ops[key];
    const versions = { ...this.data.versions };
    delete versions[key];
    this.save({ ...this.data, ops, versions, cursors: { ...this.data.cursors, [op.table]: undefined } });
  }

  /** Make every due op eligible now (e.g. when the network comes back). */
  wake() {
    const ops: Record<string, PendingOp> = {};
    for (const [k, o] of Object.entries(this.data.ops)) ops[k] = o.failed ? o : { ...o, nextAttemptAt: 0 };
    this.data = { ...this.data, ops };
  }

  /** Forget all pull cursors so the next pull reloads everything visible. */
  resetCursors() { this.save({ ...this.data, cursors: {} }); }
}

const bySort = (a: Row, b: Row) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

function isBlank(i: ThermalImage) {
  return !i.irImageNumber && !i.visualImageNumber && !i.maxTemp && !i.notes && !i.distance && (!i.possibleCause || i.possibleCause === "NONE");
}

/** Insert or replace an image entry. Blank placeholders created on this device for display are replaced by real entries. */
export function upsertImage(images: ThermalImage[], img: ThermalImage, sortOrder: number, isPlaceholder: (id: string) => boolean): ThermalImage[] {
  const idx = images.findIndex((i) => i.id === img.id);
  if (idx >= 0) return images.map((i) => (i.id === img.id ? img : i));
  const kept = images.filter((i) => !(isBlank(i) && isPlaceholder(i.id)));
  const at = Math.max(0, Math.min(kept.length, Number.isFinite(sortOrder) ? sortOrder : kept.length));
  return [...kept.slice(0, at), img, ...kept.slice(at)];
}

function mergeImages(theirs: ThermalImage[], mine: ThermalImage[]): ThermalImage[] {
  const out = [...theirs];
  for (const m of mine) if (!out.some((x) => x.id === m.id) && !isBlank(m)) out.push(m);
  return out;
}

export type { InspectionResult };
