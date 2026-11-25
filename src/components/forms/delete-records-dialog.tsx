"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { useOnOpen } from "@/lib/use-draft";
import { planCustomerDeletion, planFacilityDeletion, useStore } from "@/lib/store/store";
import { DEFAULT_ORG_ID } from "@/lib/store/seed";
import { isLockedStatus } from "@/lib/domain/rules";
import { useSession } from "@/lib/cloud/session";
import { deleteInCloud, RECOVERY_DAYS, restoreDeletion, unsyncedDevices, type DeletionKind } from "@/lib/cloud/record-deletion";
import { deleteOrphanPhotoBlobs, deletePhotoBlob } from "@/lib/photos/photo-db";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Delete a customer or a facility (administrators). Empty records: one simple confirmation.
 * Records with inspections: everything affected is listed, deleting the inspections needs a
 * second confirmation, and approved reports need their name typed. Facilities can be archived
 * instead. Shared records are deleted by the database in one step and can be restored for
 * 30 days (Undo, or Recently Deleted).
 */
export function DeleteRecordsDialog({ kind, id, open, onClose, onDeleted }: {
  kind: DeletionKind; id: string | null; open: boolean; onClose: () => void; onDeleted?: () => void;
}) {
  const s = useStore();
  const members = useSession((x) => x.members);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<{ userId: string; pending: number; failed: number }[]>([]);
  useOnOpen(open, () => { setAck(false); setTyped(""); setBusy(false); setDevices([]); });

  const target = id ? (kind === "customer" ? s.customers.find((c) => c.id === id) : s.facilities.find((f) => f.id === id)) : undefined;
  const plan = useMemo(() => (id ? (kind === "customer" ? planCustomerDeletion(s, id) : planFacilityDeletion(s, id)) : null), [s, id, kind]);
  const cloud = !!target && target.organizationId !== DEFAULT_ORG_ID;
  const inspIds = plan?.inspectionIds ?? [];
  useEffect(() => {
    if (!open || !cloud || !inspIds.length) return;
    let live = true;
    void unsyncedDevices(inspIds).then((d) => live && setDevices(d));
    return () => { live = false; };
  }, [open, cloud, inspIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target || !plan) return null;
  const name = target.name;
  const facility = kind === "facility" ? s.facilities.find((f) => f.id === id) : undefined;
  const address = facility ? [facility.address, facility.city, facility.state, facility.postalCode].filter(Boolean).join(", ") : "";
  const insps = s.inspections.filter((i) => inspIds.includes(i.id));
  const open_ = insps.filter((i) => i.status === "Draft" || i.status === "In Progress");
  const review = insps.filter((i) => i.status === "Needs Review");
  const approved = insps.filter((i) => isLockedStatus(i.status));
  const facs = kind === "customer" ? s.facilities.filter((f) => plan.facilityIds.includes(f.id)) : [];
  const c = plan.counts;
  const empty = c.inspections === 0 && c.rooms === 0 && c.equipment === 0 && (kind === "facility" || c.facilities === 0);
  const needTyped = approved.length > 0;
  const typedOk = typed.trim().toLowerCase() === name.trim().toLowerCase();
  const canDelete = !busy && (empty || (ack && (!needTyped || typedOk)));
  const label = kind === "customer" ? "Customer" : "Facility";

  const run = async () => {
    if (!canDelete) return;
    setBusy(true);
    if (cloud) {
      const res = await deleteInCloud(kind, kind === "facility" ? plan.facilityIds[0] : plan.customerId, approved.length > 0);
      if (!res.ok) { toast(res.message, "error"); setBusy(false); return; }
      toast(`${name} deleted`, "success", { label: "Undo", onClick: () => { void restoreDeletion(res.batch).then((err) => toast(err ?? `${name} restored`, err ? "error" : "success")); } });
    } else {
      const removed = kind === "customer" ? s.deleteCustomer(plan.customerId) : s.deleteFacility(plan.facilityIds[0]);
      if (!removed) { toast(`${label} was already removed`, "error"); onClose(); return; }
      await Promise.all(removed.photoIds.map((p) => deletePhotoBlob(p).catch(() => undefined)));
      await deleteOrphanPhotoBlobs(new Set(useStore.getState().photos.map((p) => p.id))).catch(() => 0);
      toast(`${name} deleted`);
    }
    onClose();
    onDeleted?.();
  };
  const archive = () => {
    if (!facility) return;
    s.updateFacility(facility.id, { archivedAt: new Date().toISOString() });
    toast(`${name} archived`, "success", { label: "Undo", onClick: () => useStore.getState().updateFacility(facility.id, { archivedAt: null }) });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Delete ${label}?`}
      footer={<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:justify-end" data-testid="delete-records-footer">
        <Button className="justify-center" onClick={onClose} disabled={busy}>Cancel</Button>
        {facility && !empty && !facility.archivedAt ? <Button className="justify-center" onClick={archive} disabled={busy} data-testid="archive-facility"><Archive className="h-4 w-4" />Archive Instead</Button> : null}
        <Button variant="destructive" className={cn("justify-center", facility && !empty && !facility.archivedAt ? "col-span-2" : "")} onClick={run} disabled={!canDelete} data-testid="confirm-delete-records"><Trash2 className="h-4 w-4" />{busy ? "Deleting…" : `Delete ${label}`}</Button>
      </div>}>
      <div className="space-y-3 text-sm text-slate-700" data-testid="delete-records-dialog">
        <div>
          <div className="text-base font-semibold text-slate-900">{name}</div>
          {address ? <div className="text-slate-500">{address}</div> : null}
          {kind === "facility" ? <div className="text-slate-500">Customer: {s.customers.find((x) => x.id === plan.customerId)?.name}</div> : null}
        </div>
        {empty ? <p data-testid="delete-simple">This {label.toLowerCase()} has no {kind === "customer" ? "facilities, " : ""}inspections, rooms or equipment.</p> : (
          <>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-4 py-3" data-testid="delete-counts">
              {kind === "customer" ? <li><strong className="tabular-nums">{c.facilities}</strong> {c.facilities === 1 ? "facility" : "facilities"}</li> : null}
              <li><strong className="tabular-nums">{c.inspections}</strong> {c.inspections === 1 ? "inspection" : "inspections"}</li>
              <li><strong className="tabular-nums">{c.rooms}</strong> {c.rooms === 1 ? "room" : "rooms"}</li>
              <li><strong className="tabular-nums">{c.equipment}</strong> equipment {c.equipment === 1 ? "record" : "records"}</li>
              <li><strong className="tabular-nums">{c.results}</strong> inspection {c.results === 1 ? "line" : "lines"}</li>
            </ul>
            {facs.length ? <p><b>Facilities:</b> {facs.map((f) => f.name).join(", ")}</p> : null}
            {insps.length ? (
              <ul className="space-y-1" data-testid="delete-inspections">
                {open_.length ? <li className="text-amber-900"><b>{plural(open_.length, "inspection")} still active</b> (Draft or In Progress){plan.activeInspectionId ? ", including the current site visit" : ""}.</li> : null}
                {review.length ? <li className="text-amber-900"><b>{plural(review.length, "inspection")} awaiting review.</b></li> : null}
                {approved.length ? <li className="text-red-800"><b>{plural(approved.length, "approved report")}</b> (historical records).</li> : null}
              </ul>
            ) : null}
            {devices.length ? (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950" data-testid="delete-unsynced">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{devices.map((d) => `${members.find((m) => m.userId === d.userId)?.name ?? "A technician"} has ${plural(d.pending + d.failed, "change")} not uploaded yet`).join("; ")}. Their phone keeps that work, but it will not be saved here unless the deletion is restored.</span>
              </div>
            ) : null}
            {c.inspections ? (
              <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="delete-ack" />
                <span>Also delete {plural(c.inspections, "inspection")} with {plural(c.results, "equipment line")}, room conditions and thermal image entries{c.photos ? ` and ${plural(c.photos, "photo")} on this device` : ""}.</span>
              </label>
            ) : (
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="delete-ack" />
                <span>Delete the {plural(c.rooms, "room")} and {plural(c.equipment, "equipment record")} too.</span>
              </label>
            )}
            {needTyped ? (
              <label className="block" htmlFor="delete-typed">
                <span className="mb-1 block font-medium text-red-900">This deletes approved historical reports. Type <b>{name}</b> to confirm.</span>
                <input id="delete-typed" autoComplete="off" className="h-11 w-full rounded-lg border border-red-300 px-3 text-base" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="delete-typed" />
              </label>
            ) : null}
          </>
        )}
        <p className="text-xs text-slate-500">
          {cloud ? `Recoverable: Undo right after, or restore from Recently Deleted for ${RECOVERY_DAYS} days. Only then can it be permanently removed.` : "These records are only on this device and cannot be restored after deleting."}
          {facility && !empty ? " Archive keeps everything and hides the facility from new work." : ""}
        </p>
      </div>
    </Modal>
  );
}
