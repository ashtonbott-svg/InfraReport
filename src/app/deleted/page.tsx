"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { useRole } from "@/lib/cloud/role";
import { useSession } from "@/lib/cloud/session";
import { listDeletions, purgeDeletion, RECOVERY_DAYS, restoreDeletion, type DeletionEntry } from "@/lib/cloud/record-deletion";
import { formatDateTime } from "@/lib/format";

const DAY = 86_400_000;

/** Customers and facilities deleted by administrators: restore within 30 days, then optional permanent removal. */
export default function RecentlyDeletedPage() {
  const { cloud, isAdmin } = useRole();
  const members = useSession((s) => s.members);
  const [rows, setRows] = useState<DeletionEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [purging, setPurging] = useState<DeletionEntry | null>(null);
  const [typed, setTyped] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const load = useCallback(async () => { const r = await listDeletions(); setLoadedAt(Date.now()); setRows(r); }, []);
  useEffect(() => {
    if (!cloud || !isAdmin) return;
    let live = true;
    listDeletions().then((r) => { if (live) { setLoadedAt(Date.now()); setRows(r); } }, () => undefined);
    return () => { live = false; };
  }, [cloud, isAdmin]);

  if (!cloud || !isAdmin) return <EmptyState title="Administrators only" description="Recently deleted shared customers and facilities are listed here for administrators." />;

  const restore = async (e: DeletionEntry) => {
    setBusy(e.id);
    const err = await restoreDeletion(e.id);
    toast(err ?? `${e.target_name} restored`, err ? "error" : "success");
    setBusy(null);
    await load();
  };
  const purge = async () => {
    if (!purging) return;
    setBusy(purging.id);
    const err = await purgeDeletion(purging.id);
    toast(err ?? `${purging.target_name} permanently deleted`, err ? "error" : "success");
    setBusy(null); setPurging(null); setTyped("");
    await load();
  };
  const what = (e: DeletionEntry) => {
    const c = e.counts ?? {};
    return [[c.facilities, "facility", "facilities"], [c.inspections, "inspection", "inspections"], [c.locations, "room", "rooms"], [c.equipment, "equipment record", "equipment records"], [c.results, "line", "lines"]]
      .filter(([n]) => Number(n) > 0).map(([n, one, many]) => `${n} ${Number(n) === 1 ? one : many}`).join(" · ");
  };

  return (
    <>
      <PageHeader eyebrow={<><Link href="/customers" className="hover:underline">Customers</Link> / <Link href="/facilities" className="hover:underline">Facilities</Link></>}
        title="Recently Deleted" description={`Deleted customers and facilities can be restored with everything they contained for ${RECOVERY_DAYS} days. After that an administrator may remove them permanently.`} />
      <Card>
        {rows === null ? <p className="p-5 text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <EmptyState icon={<History className="h-5 w-5" />} title="Nothing deleted" /> : (
          <ul className="divide-y divide-slate-100" data-testid="deleted-list">
            {rows.map((e) => {
              const age = loadedAt - new Date(e.deleted_at).getTime();
              const until = new Date(new Date(e.deleted_at).getTime() + RECOVERY_DAYS * DAY);
              const state = e.purged_at ? "Permanently deleted" : e.restored_at ? "Restored" : null;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="deleted-row">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">{e.target_name} <span className="text-xs font-normal capitalize text-slate-500">{e.kind}</span>{e.include_history ? <> <Badge tone="amber">Included approved reports</Badge></> : null}</div>
                    <div className="text-xs text-slate-500">{what(e) || "No inspection records"}</div>
                    <div className="text-xs text-slate-400">Deleted {formatDateTime(e.deleted_at)} by {members.find((m) => m.userId === e.deleted_by)?.name ?? "an administrator"}{state ? ` · ${state}` : ` · restorable until ${until.toLocaleDateString()}`}</div>
                  </div>
                  {state ? <Badge>{state}</Badge> : (
                    <div className="flex gap-2">
                      <Button onClick={() => restore(e)} disabled={busy === e.id} data-testid="restore-deletion"><RotateCcw className="h-4 w-4" />Restore</Button>
                      <Button variant="danger" disabled={busy === e.id || age < RECOVERY_DAYS * DAY} title={age < RECOVERY_DAYS * DAY ? `Available after ${until.toLocaleDateString()}` : undefined} onClick={() => { setTyped(""); setPurging(e); }}><Trash2 className="h-4 w-4" />Delete Permanently</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Modal open={!!purging} onClose={() => setPurging(null)} title="Delete permanently?"
        footer={<><Button onClick={() => setPurging(null)}>Cancel</Button><Button variant="destructive" disabled={!purging || typed.trim().toLowerCase() !== purging.target_name.trim().toLowerCase() || busy !== null} onClick={purge}><Trash2 className="h-4 w-4" />Delete Permanently</Button></>}>
        {purging ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p><b>{purging.target_name}</b> and everything it contained ({what(purging) || "no inspection records"}) will be removed for good. This cannot be undone.</p>
            <label className="block" htmlFor="purge-typed"><span className="mb-1 block font-medium">Type <b>{purging.target_name}</b> to confirm.</span>
              <input id="purge-typed" autoComplete="off" className="h-11 w-full rounded-lg border border-slate-300 px-3 text-base" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
