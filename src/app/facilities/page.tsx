"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui/misc";
import { FacilityFormModal } from "@/components/forms/entity-forms";
import { useCustomers, useEquipment, useFacilities, useLocations } from "@/lib/store/hooks";

export default function FacilitiesPage() {
  const facilities = useFacilities();
  const customers = useCustomers();
  const locations = useLocations();
  const equipment = useEquipment();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return facilities
      .map((f) => ({ f, customer: customers.find((c) => c.id === f.customerId)?.name ?? "" }))
      .filter(({ f, customer }) => !s || [f.name, f.city, f.address, customer].some((x) => x.toLowerCase().includes(s)))
      .sort((a, b) => a.customer.localeCompare(b.customer) || a.f.name.localeCompare(b.f.name));
  }, [facilities, customers, q]);

  return (
    <>
      <PageHeader title="Facilities" description="Sites with permanent rooms and equipment inventories that carry forward to every inspection."
        actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={customers.length === 0}><Plus className="h-4 w-4" />New Facility</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search facilities or customers" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {rows.length === 0 ? <EmptyState icon={<Building2 className="h-5 w-5" />} title="No facilities" description={customers.length === 0 ? "Create a customer first." : undefined} /> : (
          <Table>
            <thead><tr><th className={th}>Facility</th><th className={th}>Customer</th><th className={th}>Location</th><th className={th}>Rooms</th><th className={th}>Equipment</th></tr></thead>
            <tbody>
              {rows.map(({ f, customer }) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className={td}><Link href={`/facilities/${f.id}`} className="font-medium text-slate-900 hover:text-thermal-700">{f.name}</Link></td>
                  <td className={td}><Link href={`/customers/${f.customerId}`} className="hover:underline">{customer}</Link></td>
                  <td className={`${td} text-xs`}>{[f.city, f.state].filter(Boolean).join(", ")}</td>
                  <td className={`${td} tabular-nums`}>{locations.filter((l) => l.facilityId === f.id).length}</td>
                  <td className={`${td} tabular-nums`}>{equipment.filter((e) => e.facilityId === f.id).length}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <FacilityFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
