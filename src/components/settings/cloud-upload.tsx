"use client";

import { useMemo, useRef, useState } from "react";
import { CloudUpload, FileJson, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/lib/store/store";
import { useUsers } from "@/lib/store/hooks";
import { existingIdSet, legacyCustomers, parseBackup, planCounts, planUpload } from "@/lib/sync/upload";
import { syncNow } from "@/lib/sync/runtime";

type Src = ReturnType<typeof parseBackup>;

/**
 * Administrator tool: copy existing device-only inspections into the shared
 * cloud workspace, after an explicit preview and confirmation. Nothing on the
 * device is changed or removed.
 */
export function CloudUploadCard() {
  const state = useStore();
  const cloudUsers = useUsers();
  const [fromFile, setFromFile] = useState<{ name: string; src: Src } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const src: Src = fromFile?.src ?? state;
  const existing = useMemo(() => existingIdSet(state), [state]);
  const list = useMemo(() => legacyCustomers(src, state.currentOrgId, existing), [src, state.currentOrgId, existing]);
  const plan = useMemo(() => planUpload(src, [...picked], state.currentOrgId, cloudUsers, existing), [src, picked, state.currentOrgId, cloudUsers, existing]);
  const counts = planCounts(plan);

  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    try { setFromFile({ name: f.name, src: parseBackup(await f.text()) }); setPicked(new Set()); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not read the file", "error"); }
  };

  const upload = () => {
    const lines = [
      `Copy to the shared cloud workspace:`,
      `${counts.customers} customer(s), ${counts.facilities} facility(ies), ${counts.rooms} room(s), ${counts.equipment} equipment record(s),`,
      `${counts.inspections} inspection(s) with ${counts.results} equipment line(s) and ${counts.images} thermal image entries.`,
      ``,
      `The original records ${fromFile ? "in the backup file and " : ""}on this device are NOT changed or removed. Photos are not uploaded.`,
      plan.unmatchedThermographers.length ? `\nNo cloud account found for: ${plan.unmatchedThermographers.join(", ")}. Those names will not be assigned.` : "",
      ``, `Continue?`,
    ];
    if (!confirm(lines.join("\n"))) return;
    useStore.setState((s) => ({
      customers: [...s.customers, ...plan.customers], facilities: [...s.facilities, ...plan.facilities], locations: [...s.locations, ...plan.locations],
      equipment: [...s.equipment, ...plan.equipment], inspections: [...s.inspections, ...plan.inspections], rooms: [...s.rooms, ...plan.rooms],
      results: [...s.results, ...plan.results], reviewEvents: [...s.reviewEvents, ...plan.reviewEvents],
    }));
    setPicked(new Set());
    toast("Copied. Uploading to the cloud now; watch the sync status.");
    void syncNow();
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Move existing inspections to the cloud" description="Copies records that were saved on a device before cloud sync. You choose what to copy and confirm first. Originals are kept." />
      <CardBody className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button variant={fromFile ? "secondary" : "dark"} onClick={() => { setFromFile(null); setPicked(new Set()); }}><Smartphone className="h-4 w-4" />From this device</Button>
          <Button variant={fromFile ? "dark" : "secondary"} onClick={() => fileRef.current?.click()}><FileJson className="h-4 w-4" />{fromFile ? fromFile.name : "From a backup file"}</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <p className="text-xs text-slate-500">
          Records saved in the current production app live in that site&apos;s storage, which this preview cannot read. To move them: open the production app on the phone that has them, go to Settings, tap <strong>Download JSON backup</strong>, then choose that file here.
        </p>
        {list.length === 0 ? <p className="text-slate-500">No device-only customers found {fromFile ? "in this file" : "on this device"}.</p> : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {list.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" className="h-4 w-4" disabled={c.alreadyUploaded} checked={picked.has(c.id)}
                  onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} aria-label={`Copy ${c.name}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-800">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.facilities} facility(ies) · {c.equipment} equipment · {c.inspections} inspection(s) · {c.results} equipment lines</div>
                </div>
                {c.alreadyUploaded ? <span className="text-xs text-emerald-700">Already copied</span> : null}
              </li>
            ))}
          </ul>
        )}
        <Button variant="primary" disabled={!picked.size} onClick={upload}><CloudUpload className="h-4 w-4" />Review and copy {picked.size ? `(${counts.inspections} inspections, ${counts.equipment} equipment)` : ""}</Button>
      </CardBody>
    </Card>
  );
}
