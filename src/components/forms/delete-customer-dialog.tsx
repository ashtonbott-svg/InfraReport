"use client";

import { DeleteRecordsDialog } from "./delete-records-dialog";

/** "Delete Customer?" (kept for existing callers): the shared customer and facility deletion dialog. */
export function DeleteCustomerDialog({ customerId, open, onClose, onDeleted }: { customerId: string | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  return <DeleteRecordsDialog kind="customer" id={customerId} open={open} onClose={onClose} onDeleted={onDeleted} />;
}
