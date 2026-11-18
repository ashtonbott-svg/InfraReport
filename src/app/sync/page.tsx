"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { LastSynced, SyncBadge } from "@/components/sync/sync-status";
import { describeRecord, fieldLabel, showValue, tableLabel } from "@/components/sync/describe";
import { discardFailed, resolveConflict, retryFailed, syncNow, useSyncStatus } from "@/lib/sync/runtime";
import { useStore } from "@/lib/store/store";
import { useSession } from "@/lib/cloud/session";
import { toast } from "@/components/ui/toast";

export default function SyncPage() {
  const s = useSyncStatus();
  const state = useStore();
  const members = useSession((x) => x.members);
  const who = (id: string | null) => members.find((m) => m.userId === id)?.name ?? "another device";
  const pending = useMemo(() => s.ops.filter((o) => !o.failed), [s.ops]);
  const failed = useMemo(() => s.ops.filter((o) => o.failed), [s.ops]);

  if (!s.active) return <EmptyState title="Saved on this device" description="Cloud sync is not active (not signed in, or this deployment is device-only)." />;

  return (
    <>
      <PageHeader title="Sync" description="Everything is saved on this phone first. This page shows what has not reached the cloud yet." actions={<Button onClick={() => { void syncNow(); toast("Syncing…"); }}><RefreshCw className="h-4 w-4" />Sync now</Button>} />
      <div className="mb-6 flex flex-wrap items-center gap-3"><SyncBadge dark={false} className="text-sm" /><LastSynced /></div>
      {s.offline ? <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This phone is offline. Its unsynced changes are <strong>not visible on other phones</strong> until it reconnects. Keep working: nothing is lost.</p> : null}

      <Card className="mb-6">
        <CardHeader title={`Decisions needed (${s.conflictList.length})`} description="The same value was changed on two phones. Nothing was overwritten; choose which one to keep." />
        <CardBody className="space-y-3">
          {s.conflictList.length === 0 ? <p className="text-sm text-slate-500">None.</p> : s.conflictList.map((c) => (
            <div key={c.id} className="rounded-lg border border-red-200 p-3" data-testid="conflict">
              <div className="text-sm font-semibold text-slate-900">{tableLabel(c.table)}: {describeRecord(state, c.table, c.recordId) || c.recordId}</div>
              <div className="text-xs text-slate-500">{fieldLabel(c.field)}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-slate-50 p-2 text-sm"><div className="text-[11px] font-semibold uppercase text-slate-500">This phone</div>{showValue(c.mine)}</div>
                <div className="rounded-md bg-slate-50 p-2 text-sm"><div className="text-[11px] font-semibold uppercase text-slate-500">Saved by {who(c.theirsBy)}</div>{showValue(c.theirs)}</div>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => resolveConflict(c.id, "mine")}>Keep this phone&apos;s</Button>
                <Button size="sm" onClick={() => resolveConflict(c.id, "theirs")}>Use {who(c.theirsBy)}&apos;s</Button>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title={`Could not be saved to the cloud (${failed.length})`} description="Still saved on this phone. Usually a permission problem, for example a job you were removed from." actions={failed.length ? <Button size="sm" onClick={retryFailed}>Retry all</Button> : null} />
        <CardBody className="space-y-2">
          {failed.length === 0 ? <p className="text-sm text-slate-500">None.</p> : failed.map((o) => (
            <div key={o.key} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{tableLabel(o.table)}: {describeRecord(state, o.table, o.id) || o.id}</div>
                <div className="text-xs text-red-700">{o.failed}{o.lastError && o.lastError !== o.failed ? ` (${o.lastError})` : ""}</div>
              </div>
              <Button size="sm" variant="danger" onClick={() => { if (confirm("Discard this change on this phone and reload the cloud version?")) discardFailed(o.key); }}>Discard</Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Waiting to upload (${pending.length})`} description="Uploads automatically when the phone is online. Retries on its own." />
        <CardBody>
          {pending.length === 0 ? <p className="text-sm text-slate-500">Nothing waiting.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {pending.slice(0, 200).map((o) => (
                <li key={o.key} className="py-1.5">
                  <span className="font-medium text-slate-800">{tableLabel(o.table)}</span> <span className="text-slate-600">{describeRecord(state, o.table, o.id)}</span>
                  {o.kind === "delete" ? <span className="text-xs text-slate-500"> (delete)</span> : o.changed.length && o.baseVersion !== null ? <span className="text-xs text-slate-500"> ({o.changed.map(fieldLabel).join(", ")})</span> : <span className="text-xs text-slate-500"> (new)</span>}
                  {o.lastError ? <div className="text-xs text-amber-700">Last try: {o.lastError}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
