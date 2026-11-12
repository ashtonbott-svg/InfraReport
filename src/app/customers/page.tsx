"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, Trash2, Users } from "lucide-react";
import { DeleteCustomerDialog } from "@/components/forms/delete-customer-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui/misc";
import { CustomerFormModal } from "@/components/forms/entity-forms";
import { useCustomers, useFacilities, useInspections } from "@/lib/store/hooks";
import { formatDate } from "@/lib/format";

export default function CustomersPage() {
  const customers = useCustomers();
  const facilities = useFacilities();
  const inspections = useInspections();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers
      .filter((c) => !s || [c.name, c.contactName, c.contactEmail].some((x) => x.toLowerCase().includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, q]);

  return (
    <>
      <PageHeader title="Customers" description="Companies you inspect for. Each customer can have multiple facilities."
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New Customer</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title={q ? "No matching customers" : "No customers yet"} action={<Button variant="primary" onClick={() => setOpen(true)}>New Customer</Button>} />
        ) : (
          <>
          {/* Phones: one card per customer, delete always visible */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-4 py-3">
                <Link href={`/customers/${c.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium text-slate-900">{c.name}</span>
                  <span className="block text-xs text-slate-500">{facilities.filter((f) => f.customerId === c.id).length} facilities · {inspections.filter((i) => i.customerId === c.id).length} inspections</span>
                </Link>
                <Button variant="danger" className="h-10 shrink-0" onClick={() => setDeleting(c.id)} aria-label={`Delete ${c.name}`}><Trash2 className="h-4 w-4" />Delete</Button>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block">
            <thead><tr><th className={th}>Customer</th><th className={th}>Contact</th><th className={th}>Facilities</th><th className={th}>Last inspection</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((c) => {
                const last = inspections.filter((i) => i.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date))[0];
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className={td}><Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-thermal-700">{c.name}</Link></td>
                    <td className={td}><div>{c.contactName}</div><div className="text-xs text-slate-500">{c.contactEmail}</div></td>
                    <td className={`${td} tabular-nums`}>{facilities.filter((f) => f.customerId === c.id).length}</td>
                    <td className={`${td} whitespace-nowrap`}>{last ? formatDate(last.date) : <span className="text-slate-400">None</span>}</td>
                    <td className={`${td} text-right`}><Button size="sm" variant="danger" onClick={() => setDeleting(c.id)} aria-label={`Delete ${c.name}`}><Trash2 className="h-3.5 w-3.5" />Delete Customer</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          </>
        )}
      </Card>
      <CustomerFormModal open={open} onClose={() => setOpen(false)} />
      <DeleteCustomerDialog customerId={deleting} open={deleting !== null} onClose={() => setDeleting(null)} />
    </>
  );
}
