"use client";

import { useMemo } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useStore, planDemoRemoval, demoCounts } from "@/lib/store/store";
import { downloadBackup } from "@/lib/backup";
import { deletePhotoBlob } from "@/lib/photos/photo-db";

/** Shown only when fictional records from earlier prototype releases are still on this device. */
export function DemoDataNotice({ compact }: { compact?: boolean }) {
  const customers = useStore((s) => s.customers);
  const facilities = useStore((s) => s.facilities);
  const inspections = useStore((s) => s.inspections);
  const equipment = useStore((s) => s.equipment);
  const clear = useStore((s) => s.clearDemoData);
  const counts = useMemo(() => demoCounts(planDemoRemoval({ customers, facilities, inspections, equipment })), [customers, facilities, inspections, equipment]);
  const total = counts.customers + counts.facilities + counts.inspections;
  if (!total) return compact ? <p className="text-sm text-slate-500">No sample data on this device.</p> : null;
  const run = async () => {
    const msg = `Remove the sample data from earlier prototype versions?\n\n${counts.customers} customers, ${counts.facilities} facilities, ${counts.equipment} equipment items and ${counts.inspections} inspections (including any inspection you created on those sample facilities).\n\nYour own customers and facilities are kept. Download a backup first if unsure.`;
    if (!confirm(msg)) return;
    const before = new Set(useStore.getState().photos.map((p) => p.id));
    clear();
    const after = new Set(useStore.getState().photos.map((p) => p.id));
    await Promise.all([...before].filter((id) => !after.has(id)).map((id) => deletePhotoBlob(id).catch(() => undefined)));
    toast("Sample data removed");
  };
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center" data-testid="demo-notice">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Sample data from the earlier prototype is still on this device</div>
        <div className="text-xs">{counts.customers} sample customers, {counts.facilities} facilities, {counts.inspections} inspections. Nothing is removed until you confirm.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={downloadBackup}><Download className="h-4 w-4" />Download backup</Button>
        <Button variant="danger" onClick={run}><Trash2 className="h-4 w-4" />Clear sample data</Button>
      </div>
    </div>
  );
}
