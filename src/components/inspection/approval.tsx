"use client";

import { useEffect, useState } from "react";
import { History, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useRole } from "@/lib/cloud/role";
import { useSession } from "@/lib/cloud/session";
import { supabase } from "@/lib/cloud/client";
import { syncNow } from "@/lib/sync/runtime";
import { isInspectionLocked, useStore } from "@/lib/store/store";
import { formatDateTime } from "@/lib/format";
import { describeRecord, fieldLabel, showValue } from "@/components/sync/describe";
import type { Inspection } from "@/lib/domain/types";
import type { TableName } from "@/lib/sync/mapping";

/** Ask for a reason and reopen an approved shared inspection (administrators only). */
export function useReopen() {
  const reopen = useStore((s) => s.reopenInspection);
  return (inspection: Inspection) => {
    const reason = prompt("Reopen this approved inspection for corrections?\n\nEvery change from now on is recorded, and the inspection must be approved again.\n\nReason (optional):");
    if (reason === null) return false;
    if (!reopen(inspection.id, reason)) { toast("Could not reopen", "error"); return false; }
    toast("Reopened for corrections. Approve again when done.");
    return true;
  };
}

/** Lock state of a shared inspection: approved and locked, or reopened and awaiting approval again. */
export function ApprovalBanner({ inspection }: { inspection: Inspection }) {
  const { isAdmin, cloud } = useRole();
  const reopen = useReopen();
  if (!cloud) return null;
  if (isInspectionLocked(inspection)) {
    return (
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-950 sm:flex-row sm:items-center" data-testid="approval-locked">
        <Lock className="hidden h-4 w-4 shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <strong>{inspection.status}{inspection.approvedAt ? ` ${formatDateTime(inspection.approvedAt)}` : ""}. Locked.</strong>{" "}
          No one can change this inspection&apos;s data{isAdmin ? " until you reopen it for corrections" : ". An administrator can reopen it for corrections"}. Excel download stays available.
        </div>
        {isAdmin ? <Button size="sm" onClick={() => reopen(inspection)} data-testid="reopen"><LockOpen className="h-3.5 w-3.5" />Reopen for corrections</Button> : null}
      </div>
    );
  }
  if (inspection.firstApprovedAt) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950" data-testid="approval-reopened">
        <LockOpen className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Reopened for corrections{inspection.reopenCount && inspection.reopenCount > 1 ? ` (${inspection.reopenCount} times)` : ""}.</strong>{" "}
          {inspection.reopenReason ? <>Reason: {inspection.reopenReason}. </> : null}
          Every change is recorded and the inspection must be approved again.
        </span>
      </div>
    );
  }
  return null;
}

interface ChangeRow { id: number; table_name: string; record_id: string; action: string; changes: Record<string, [unknown, unknown]>; changed_by: string | null; changed_at: string }

const HIDDEN = new Set(["submitted_at", "submitted_by", "approved_at", "approved_by", "first_approved_at", "reopened_at", "reopened_by", "reopen_count", "deleted_at", "approval_snapshot", "submission_count"]);

/** Administrators: everything changed after the first approval, read from the database's change log. */
export function ChangesSinceApproval({ inspection }: { inspection: Inspection }) {
  const { isAdmin, cloud } = useRole();
  const members = useSession((s) => s.members);
  const state = useStore();
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${inspection.id}|${inspection.status}|${inspection.reopenCount ?? 0}|${inspection.updatedAt}`;
  useEffect(() => {
    const sb = supabase();
    if (!sb || !cloud || !isAdmin || !inspection.firstApprovedAt) return;
    let alive = true;
    sb.from("inspection_changes").select("*").eq("inspection_id", inspection.id).order("changed_at", { ascending: false }).limit(300)
      .then(({ data, error: e }) => { if (!alive) return; if (e) setError(e.message); else { setRows((data ?? []) as ChangeRow[]); setError(null); } });
    return () => { alive = false; };
  }, [cloud, isAdmin, inspection.id, inspection.firstApprovedAt, key]);
  if (!cloud || !isAdmin || !inspection.firstApprovedAt) return null;
  const who = (id: string | null) => members.find((m) => m.userId === id)?.name ?? (id ? "Unknown user" : "System");
  const label: Record<string, string> = { created: "Added", changed: "Changed", deleted: "Removed", reopened: "Reopened", approved: "Approved", status: "Status" };
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><History className="h-4 w-4" />Changes since approval</span>} description="Recorded by the database for every change after the first approval. Online only." />
      <CardBody className="text-sm">
        {error ? <p className="text-red-700">{error}</p> : rows === null ? <p className="text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-slate-500">No changes recorded.</p> : (
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto" data-testid="change-log">
            {rows.map((r) => {
              const fields = Object.entries(r.changes ?? {}).filter(([f]) => !HIDDEN.has(f));
              return (
                <li key={r.id} className="py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500"><span className="font-semibold text-slate-800">{label[r.action] ?? r.action}</span><span>{describeRecord(state, r.table_name as TableName, r.record_id) || r.table_name}</span><span>· {who(r.changed_by)} · {formatDateTime(r.changed_at)}</span></div>
                  {r.action !== "created" && fields.length ? (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {fields.slice(0, 8).map(([f, [a, b]]) => <li key={f}><span className="text-slate-500">{fieldLabel(f)}:</span> {showValue(a)} → <strong>{showValue(b)}</strong></li>)}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------ submission ------------------------------ */

/** "Submitted for Review by … at …" once any assigned person submitted; otherwise the Submit button. */
export function SubmitControl({ inspection, disabled, onBlocked }: { inspection: Inspection; disabled?: boolean; onBlocked: () => void }) {
  const members = useSession((s) => s.members);
  const setStatus = useStore((s) => s.setInspectionStatus);
  const [busy, setBusy] = useState(false);
  const submitted = inspection.status !== "Draft" && inspection.status !== "In Progress";
  if (submitted) {
    const who = members.find((m) => m.userId === inspection.submittedBy)?.name;
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="submitted-info">
        <strong>Submitted for Review</strong>{who ? ` by ${who}` : ""}{inspection.submittedAt ? ` · ${formatDateTime(inspection.submittedAt)}` : ""}
      </div>
    );
  }
  const submit = async () => {
    setBusy(true);
    try {
      // Get the latest first: a teammate may already have submitted from their phone.
      await syncNow()?.catch(() => undefined);
      const fresh = useStore.getState().inspections.find((i) => i.id === inspection.id);
      if (fresh && fresh.status !== "Draft" && fresh.status !== "In Progress") { toast("Already submitted for review"); return; }
      if (setStatus(inspection.id, "Needs Review")) toast("Submitted for review"); else onBlocked();
    } finally { setBusy(false); }
  };
  return <Button disabled={disabled || busy} onClick={() => void submit()} data-testid="submit-review">{busy ? "Checking…" : "Submit for Review"}</Button>;
}

interface ReportRow { device_id: string; user_id: string; pending: number; failed: number; reported_at: string }

/** Administrators: what each phone last reported about changes it has not uploaded for this inspection. */
export function useDeviceReports(inspection: Inspection) {
  const { isAdmin, cloud } = useRole();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const key = `${inspection.id}|${inspection.updatedAt}|${inspection.status}`;
  useEffect(() => {
    const sb = supabase();
    if (!sb || !cloud || !isAdmin) return;
    let alive = true;
    sb.from("sync_reports").select("device_id, user_id, pending, failed, reported_at").eq("inspection_id", inspection.id).order("reported_at", { ascending: false })
      .then(({ data, error }) => { if (alive) setRows(error ? [] : ((data ?? []) as ReportRow[])); });
    return () => { alive = false; };
  }, [cloud, isAdmin, inspection.id, key]);
  return rows;
}

export function DeviceReports({ rows }: { rows: ReportRow[] | null }) {
  const members = useSession((s) => s.members);
  if (!rows || rows.length === 0) return null;
  const name = (id: string) => members.find((m) => m.userId === id)?.name ?? "A teammate";
  const waiting = rows.filter((r) => r.pending > 0 || r.failed > 0);
  return (
    <div className={waiting.length ? "rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950" : "rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700"} data-testid="device-reports">
      <div className="mb-1 font-semibold">{waiting.length ? "Phones with changes not uploaded yet" : "Phones report everything uploaded"}</div>
      <ul className="space-y-0.5 text-xs">
        {rows.map((r) => (
          <li key={r.device_id}>
            {name(r.user_id)}&apos;s device: {r.pending || r.failed ? <strong>{r.pending ? `${r.pending} waiting` : ""}{r.pending && r.failed ? ", " : ""}{r.failed ? `${r.failed} failed` : ""}</strong> : "nothing waiting"} · reported {formatDateTime(r.reported_at)}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] opacity-80">A phone that is offline cannot report; this is its last report.</p>
    </div>
  );
}
