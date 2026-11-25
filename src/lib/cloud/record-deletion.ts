"use client";

/**
 * Customer and facility deletion for shared (cloud) records. The database deletes everything
 * under the record in one transaction (all or nothing) and keeps a restorable entry for 30 days.
 * Phones then receive the deletion through normal sync.
 */
import { supabase } from "./client";
import { syncNow } from "@/lib/sync/runtime";

export type DeletionKind = "customer" | "facility";
export const RECOVERY_DAYS = 30;

export interface DeletionEntry {
  id: string; kind: DeletionKind; target_id: string; target_name: string; include_history: boolean;
  counts: Record<string, number>; deleted_by: string | null; deleted_at: string;
  restored_at: string | null; purged_at: string | null;
}

const message = (e: { message?: string } | null | undefined, fallback: string) => (e?.message || fallback).replace(/^.*?ERROR:\s*/, "");

export async function deleteInCloud(kind: DeletionKind, id: string, includeHistory: boolean): Promise<{ ok: true; batch: string } | { ok: false; message: string }> {
  const sb = supabase();
  if (!sb) return { ok: false, message: "Not connected to the cloud." };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ok: false, message: "You are offline. Deleting a customer or facility needs a connection." };
  // Upload this phone's own pending changes first, so nothing of mine is caught in the deletion.
  await syncNow()?.catch(() => undefined);
  const { data, error } = await sb.rpc("admin_delete_records", { p_kind: kind, p_id: id, p_include_history: includeHistory });
  if (error) return { ok: false, message: message(error, "Not deleted.") };
  await syncNow()?.catch(() => undefined);
  return { ok: true, batch: (data as { batch: string }).batch };
}

export async function restoreDeletion(batch: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Not connected to the cloud.";
  const { error } = await sb.rpc("admin_restore_deletion", { p_batch: batch });
  if (error) return message(error, "Not restored.");
  await syncNow()?.catch(() => undefined);
  return null;
}

export async function purgeDeletion(batch: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Not connected to the cloud.";
  const { error } = await sb.rpc("admin_purge_deletion", { p_batch: batch });
  return error ? message(error, "Not deleted.") : null;
}

export async function listDeletions(): Promise<DeletionEntry[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data } = await sb.from("deletion_batches").select("id, kind, target_id, target_name, include_history, counts, deleted_by, deleted_at, restored_at, purged_at").order("deleted_at", { ascending: false }).limit(100);
  return (data ?? []) as DeletionEntry[];
}

/** Phones that reported changes not yet uploaded for these inspections. */
export async function unsyncedDevices(inspectionIds: string[]): Promise<{ userId: string; pending: number; failed: number }[]> {
  const sb = supabase();
  if (!sb || !inspectionIds.length) return [];
  const { data } = await sb.from("sync_reports").select("user_id, pending, failed").in("inspection_id", inspectionIds);
  const by = new Map<string, { userId: string; pending: number; failed: number }>();
  for (const r of (data ?? []) as { user_id: string; pending: number; failed: number }[]) {
    if (!r.pending && !r.failed) continue;
    const cur = by.get(r.user_id) ?? { userId: r.user_id, pending: 0, failed: 0 };
    cur.pending += r.pending; cur.failed += r.failed;
    by.set(r.user_id, cur);
  }
  return [...by.values()];
}
