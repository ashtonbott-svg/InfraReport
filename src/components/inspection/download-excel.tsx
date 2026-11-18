"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { inspectorNames } from "@/components/forms/thermographer-picker";
import { exportInspectionXlsx } from "@/lib/export-excel";
import { useStore } from "@/lib/store/store";
import { syncNow, useSyncStatus } from "@/lib/sync/runtime";
import type { ExportDataset } from "@/lib/domain/csv";

/**
 * Before a file leaves the app: fetch the latest from the cloud and say plainly
 * if anything is still missing. Returns false when the person cancels.
 */
export async function confirmSyncComplete(inspectionId: string): Promise<boolean> {
  if (!useSyncStatus.getState().active) return true;
  await syncNow()?.catch(() => undefined);
  const st = useSyncStatus.getState();
  const insp = useStore.getState().inspections.find((i) => i.id === inspectionId);
  const mine = st.ops.filter((o) => o.row.inspection_id === inspectionId || (o.table === "inspections" && o.id === inspectionId) || (!!insp && o.row.facility_id === insp.facilityId));
  if (!mine.length && !st.conflictList.length && !st.offline) return true;
  const waiting = mine.filter((o) => !o.failed).length, failed = mine.filter((o) => o.failed).length;
  const parts = [
    waiting ? `${waiting} change(s) on this device have not reached the cloud yet` : "",
    failed ? `${failed} change(s) failed to sync` : "",
    st.conflictList.length ? `${st.conflictList.length} conflict(s) still need a decision` : "",
    st.offline ? "this device is offline, so the latest work from other phones may be missing" : "",
  ].filter(Boolean);
  return confirm(`Sync is not complete: ${parts.join("; ")}.\n\nThe file will contain what is on this device right now. Download anyway?`);
}

/** Everything recorded for the inspection, from every assigned technician, as of now on this device. */
export function inspectionDataset(inspectionId: string): ExportDataset | null {
  const s = useStore.getState();
  const inspection = s.inspections.find((i) => i.id === inspectionId);
  if (!inspection) return null;
  const org = inspection.organizationId;
  return {
    inspection,
    results: s.results.filter((r) => r.inspectionId === inspectionId),
    equipment: new Map(s.equipment.filter((e) => e.organizationId === org).map((e) => [e.id, e])),
    locations: new Map(s.locations.filter((l) => l.organizationId === org).map((l) => [l.id, l])),
    rooms: s.rooms.filter((r) => r.inspectionId === inspectionId),
  };
}

/**
 * Download Excel (.xlsx): the existing 16 column Generator format (Generator Import,
 * Equipment Summary, Column Map), one row per thermal image entry. Available in any
 * status, before and after approval.
 */
export function DownloadExcelButton({ inspectionId, label = "Download Excel (.xlsx)", ...props }: { inspectionId: string; label?: string } & Omit<ButtonProps, "onClick">) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await confirmSyncComplete(inspectionId))) return;
      const ds = inspectionDataset(inspectionId);
      if (!ds) { toast("Inspection not found on this device", "error"); return; }
      const s = useStore.getState();
      const n = await exportInspectionXlsx(ds, {
        customer: s.customers.find((c) => c.id === ds.inspection.customerId)?.name ?? "Customer",
        facility: s.facilities.find((f) => f.id === ds.inspection.facilityId)?.name ?? "Facility",
        inspectionDate: ds.inspection.date,
        thermographers: inspectorNames(ds.inspection.inspectorIds, s.users.filter((u) => u.organizationId === ds.inspection.organizationId)),
      });
      s.logEvent(inspectionId, "Excel workbook exported", `${n} Generator rows (one per thermal image), 16 columns, status ${ds.inspection.status}`);
      toast(`Excel downloaded: ${n} rows`);
    } catch (e) {
      toast(e instanceof Error ? `Excel export failed: ${e.message}` : "Excel export failed", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="primary" {...props} onClick={() => void download()} disabled={busy || props.disabled}>
      <FileSpreadsheet className="h-4 w-4" />{busy ? "Preparing…" : label}
    </Button>
  );
}
