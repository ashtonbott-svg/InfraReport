"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui/misc";
import { CustomerFormModal, FacilityFormModal } from "@/components/forms/entity-forms";
import { DeleteCustomerDialog } from "@/components/forms/delete-customer-dialog";
import { useCustomers, useEquipment, useFacilities, useInspections } from "@/lib/store/hooks";
import { formatDate } from "@/lib/format";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const customer = useCustomers().find((c) => c.id === id);
  const facilities = useFacilities().filter((f) => f.customerId === id);
  const inspections = useInspections().filter((i) => i.customerId === id).sort((a, b) => b.date.localeCompare(a.date));
  const equipment = useEquipment();
  const [edit, setEdit] = useState(false);
  const [newFac, setNewFac] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!customer) return <EmptyState title="Customer not found" description="It may belong to another organization or have been removed." action={<Link href="/customers"><Button>Back to customers</Button></Link>} />;



  return (
    <>
      <PageHeader eyebrow={<Link href="/customers" className="hover:underline">Customers</Link>} title={customer.name}
        description={[customer.contactName, customer.contactPhone, customer.contactEmail].filter(Boolean).join(" · ")}
        actions={<>
          <Button onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" />Delete Customer</Button>
          <Link href={`/inspections/new?customer=${customer.id}`}><Button variant="primary"><Plus className="h-4 w-4" />New Inspection</Button></Link>
        </>} />
      {customer.notes ? <Card className="mb-6"><CardBody className="text-sm text-slate-600">{customer.notes}</CardBody></Card> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Facilities" description="Sites, rooms, and equipment inventories" actions={<Button size="sm" onClick={() => setNewFac(true)}><Plus className="h-3.5 w-3.5" />Add Facility</Button>} />
          {facilities.length === 0 ? <EmptyState icon={<Building2 className="h-5 w-5" />} title="No facilities yet" action={<Button variant="primary" onClick={() => setNewFac(true)}>Add Facility</Button>} /> : (
            <Table>
              <thead><tr><th className={th}>Facility</th><th className={th}>Address</th><th className={th}>Equipment</th></tr></thead>
              <tbody>
                {facilities.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className={td}><Link href={`/facilities/${f.id}`} className="font-medium text-slate-900 hover:text-thermal-700">{f.name}</Link></td>
                    <td className={`${td} text-xs`}>{[f.address, f.city, f.state].filter(Boolean).join(", ")}</td>
                    <td className={`${td} tabular-nums`}>{equipment.filter((e) => e.facilityId === f.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Inspection history" />
          {inspections.length === 0 ? <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No inspections yet" /> : (
            <Table>
              <thead><tr><th className={th}>Date</th><th className={th}>Facility</th><th className={th}>Status</th></tr></thead>
              <tbody>
                {inspections.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className={td}><Link href={`/inspections/${i.id}`} className="font-medium hover:text-thermal-700">{formatDate(i.date)}</Link></td>
                    <td className={td}>{facilities.find((f) => f.id === i.facilityId)?.name}</td>
                    <td className={td}><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
      <CustomerFormModal open={edit} onClose={() => setEdit(false)} customer={customer} />
      <DeleteCustomerDialog customerId={customer.id} open={confirmDelete} onClose={() => setConfirmDelete(false)} onDeleted={() => router.push("/customers")} />
      <FacilityFormModal open={newFac} onClose={() => setNewFac(false)} customerId={customer.id} onSaved={(fid) => router.push(`/facilities/${fid}`)} />
    </>
  );
}
