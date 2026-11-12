"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { useOnOpen } from "@/lib/use-draft";
import { planCustomerDeletion, useStore } from "@/lib/store/store";
import { deleteOrphanPhotoBlobs, deletePhotoBlob } from "@/lib/photos/photo-db";
import { downloadBackup } from "@/lib/backup";

/**
 * "Delete Customer?" confirmation. Shows exactly what will be removed and
 * requires an explicit acknowledgement when records or photos go with it.
 */
export function DeleteCustomerDialog({ customerId, open, onClose, onDeleted }: { customerId: string | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const customers = useStore((s) => s.customers);
  const facilities = useStore((s) => s.facilities);
  const locations = useStore((s) => s.locations);
  const equipment = useStore((s) => s.equipment);
  const inspections = useStore((s) => s.inspections);
  const results = useStore((s) => s.results);
  const photos = useStore((s) => s.photos);
  const documents = useStore((s) => s.documents);
  const activeInspectionId = useStore((s) => s.activeInspectionId);
  const deleteCustomer = useStore((s) => s.deleteCustomer);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  useOnOpen(open, () => { setAck(false); setBusy(false); });

  const plan = useMemo(
    () => (customerId ? planCustomerDeletion({ customers, facilities, locations, equipment, inspections, results, photos, documents, activeInspectionId }, customerId) : null),
    [customerId, customers, facilities, locations, equipment, inspections, results, photos, documents, activeInspectionId],
  );
  if (!plan) return null;
  const c = plan.counts;
  const hasData = c.facilities + c.inspections + c.equipment + c.photos > 0;
  const activeFacility = plan.activeInspectionId ? facilities.find((f) => f.id === inspections.find((i) => i.id === plan.activeInspectionId)?.facilityId)?.name : null;

  const run = async () => {
    if (hasData && !ack) return;
    setBusy(true);
    const removed = deleteCustomer(plan.customerId);
    if (!removed) { toast("Customer was already removed", "error"); onClose(); return; }
    // Remove photo binaries for the deleted records, then any orphaned binaries.
    await Promise.all(removed.photoIds.map((id) => deletePhotoBlob(id).catch(() => undefined)));
    const remaining = new Set(useStore.getState().photos.map((p) => p.id));
    await deleteOrphanPhotoBlobs(remaining).catch(() => 0);
    toast(`${removed.customerName} deleted`);
    onClose();
    onDeleted?.();
  };

  const lines = [
    [c.facilities, "facility", "facilities"], [c.rooms, "room", "rooms"], [c.equipment, "equipment record", "equipment records"],
    [c.inspections, "inspection", "inspections"], [c.results, "inspection result", "inspection results"], [c.photos, "photo", "photos"], [c.documents, "document", "documents"],
  ] as [number, string, string][];

  return (
    <Modal open={open} onClose={onClose} title="Delete Customer?"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="destructive" onClick={run} disabled={busy || (hasData && !ack)} data-testid="confirm-delete-customer"><Trash2 className="h-4 w-4" />Delete Customer</Button>
      </>}>
      <div className="space-y-4 text-sm text-slate-700">
        <p className="text-base">Are you sure you want to delete <strong className="text-slate-900">{plan.customerName}</strong>?</p>
        {hasData ? (
          <>
            <p>This will also remove its associated facilities, inspections, equipment records, and locally stored photographs:</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-red-50 px-4 py-3 text-red-900" data-testid="delete-counts">
              {lines.filter(([n]) => n > 0).map(([n, one, many]) => <li key={one}><strong className="tabular-nums">{n}</strong> {n === 1 ? one : many}</li>)}
            </ul>
          </>
        ) : <p>This customer has no facilities, inspections or photos.</p>}
        {plan.activeInspectionId ? (
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>The inspection at <strong>{activeFacility}</strong> is the active site visit. Deleting ends it immediately and permanently deletes its readings and photos. The exterior photo requirement no longer applies because the inspection will no longer exist.</span>
          </div>
        ) : null}
        <p className="text-xs text-slate-500">Other customers are not affected. This cannot be undone. {hasData ? <button className="inline-flex items-center gap-1 font-medium text-slate-700 underline" onClick={downloadBackup}><Download className="h-3 w-3" />Download a backup first</button> : null}</p>
        {hasData ? (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-red-600" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack-delete" />
            <span>I understand this permanently deletes {plan.customerName} and everything listed above from this device.</span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
