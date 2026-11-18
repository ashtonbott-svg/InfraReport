"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { inspectorNames } from "@/components/forms/thermographer-picker";
import { exportInspectionXlsx } from "@/lib/export-excel";
import { useStore } from "@/lib/store/store";
import { syncNow, useSyncStatus } from "@/lib/sync/runtime";
import { withApprovalSnapshot, type ExportDataset, type ExportFormat } from "@/lib/domain/csv";
import { Modal } from "@/components/ui/modal";

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
  return withApprovalSnapshot({
    inspection,
    results: s.results.filter((r) => r.inspectionId === inspectionId),
    equipment: new Map(s.equipment.filter((e) => e.organizationId === org).map((e) => [e.id, e])),
    locations: new Map(s.locations.filter((l) => l.organizationId === org).map((l) => [l.id, l])),
    rooms: s.rooms.filter((r) => r.inspectionId === inspectionId),
  });
}

export const FORMAT_LABEL: Record<ExportFormat, string> = { infinite: "Infinite Infrared Excel (.xlsx)", irt: "IRT Excel (.xlsx)" };

/** Build and download one workbook. Read only: nothing about the inspection is changed or logged. */
export async function downloadInspectionExcel(inspectionId: string, format: ExportFormat): Promise<number | null> {
  if (!(await confirmSyncComplete(inspectionId))) return null;
  const ds = inspectionDataset(inspectionId);
  if (!ds) { toast("Inspection not found on this device", "error"); return null; }
  const s = useStore.getState();
  return exportInspectionXlsx(ds, {
    customer: s.customers.find((c) => c.id === ds.inspection.customerId)?.name ?? "Customer",
    facility: s.facilities.find((f) => f.id === ds.inspection.facilityId)?.name ?? "Facility",
    inspectionDate: ds.inspection.date,
    thermographers: inspectorNames(ds.inspection.inspectorIds, s.users.filter((u) => u.organizationId === ds.inspection.organizationId)),
  }, format);
}

/**
 * Download Excel: choose Infinite Infrared (15 columns, Generator Import +
 * Equipment Summary + Column Map) or IRT (14 columns, one Data sheet). Same
 * data, one row per thermal image entry. Available in every status.
 */
export function DownloadExcelButton({ inspectionId, label = "Download Excel", ...props }: { inspectionId: string; label?: string } & Omit<ButtonProps, "onClick">) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const testId = (props as { "data-testid"?: string })["data-testid"] ?? "download-xlsx";
  const go = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(format);
    try {
      const n = await downloadInspectionExcel(inspectionId, format);
      if (n !== null) { toast(`${FORMAT_LABEL[format]} downloaded: ${n} rows`); setOpen(false); }
    } catch (e) {
      toast(e instanceof Error ? `Excel export failed: ${e.message}` : "Excel export failed", "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Button variant="primary" {...props} onClick={() => setOpen(true)}>
        <FileSpreadsheet className="h-4 w-4" />{label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Download Excel" description="Same inspection data, two layouts. Downloading does not change the inspection.">
        <div className="grid gap-3">
          <button type="button" onClick={() => void go("infinite")} disabled={!!busy} data-testid={`${testId}-infinite`}
            className="rounded-xl border-2 border-thermal-500 bg-thermal-50 p-4 text-left hover:bg-thermal-100 disabled:opacity-60">
            <span className="block text-base font-semibold text-slate-900">{busy === "infinite" ? "Preparing…" : FORMAT_LABEL.infinite}</span>
            <span className="text-sm text-slate-600">15 columns for your Generator, with Max Temp. Generator Import, Equipment Summary and Column Map sheets.</span>
          </button>
          <button type="button" onClick={() => void go("irt")} disabled={!!busy} data-testid={`${testId}-irt`}
            className="rounded-xl border border-slate-300 bg-white p-4 text-left hover:bg-slate-50 disabled:opacity-60">
            <span className="block text-base font-semibold text-slate-900">{busy === "irt" ? "Preparing…" : FORMAT_LABEL.irt}</span>
            <span className="text-sm text-slate-600">14 columns for Infrared Team, no Max Temp. One Data sheet, no branding.</span>
          </button>
        </div>
      </Modal>
    </>
  );
}
