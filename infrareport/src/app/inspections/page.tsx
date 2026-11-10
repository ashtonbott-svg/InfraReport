"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardList, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, Table, td, th } from "@/components/ui/misc";
import { INSPECTION_STATUSES } from "@/lib/domain/constants";
import { useCustomers, useFacilities, useInspections, useResults, useUsers } from "@/lib/store/hooks";
import { formatDate } from "@/lib/format";

function InspectionsList() {
  const params = useSearchParams();
  const inspections = useInspections();
  const customers = useCustomers();
  const facilities = useFacilities();
  const results = useResults();
  const users = useUsers();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inspections
      .map((i) => ({
        i,
        customer: customers.find((c) => c.id === i.customerId)?.name ?? "",
        facility: facilities.find((f) => f.id === i.facilityId)?.name ?? "",
        inspector: users.find((u) => u.id === i.inspectorId)?.name ?? "",
        count: results.filter((r) => r.inspectionId === i.id).length,
      }))
      .filter((r) => (!status || r.i.status === status) && (!s || [r.customer, r.facility, r.inspector].some((x) => x.toLowerCase().includes(s))))
      .sort((a, b) => b.i.date.localeCompare(a.i.date));
  }, [inspections, customers, facilities, users, results, q, status]);

  return (
    <>
      <PageHeader title="Inspections" description="Each inspection records one visit to one facility."
        actions={<Link href="/inspections/new"><Button variant="primary"><Plus className="h-4 w-4" />New Inspection</Button></Link>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search customer, facility, inspector" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {INSPECTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
        {rows.length === 0 ? <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No inspections match" /> : (
          <Table>
            <thead><tr><th className={th}>Date</th><th className={th}>Facility</th><th className={th}>Inspector</th><th className={th}>Equipment</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map(({ i, customer, facility, inspector, count }) => (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className={`${td} whitespace-nowrap`}><Link href={`/inspections/${i.id}`} className="font-medium text-slate-900 hover:text-thermal-700">{formatDate(i.date)}</Link></td>
                  <td className={td}><div className="font-medium text-slate-800">{facility}</div><div className="text-xs text-slate-500">{customer}</div></td>
                  <td className={`${td} whitespace-nowrap`}>{inspector}</td>
                  <td className={`${td} tabular-nums`}>{count}</td>
                  <td className={td}><StatusBadge status={i.status} /></td>
                  <td className={`${td} whitespace-nowrap text-right text-xs`}>
                    <Link href={`/inspections/${i.id}/entry`} className="font-medium text-thermal-700 hover:underline">Entry</Link>
                    <span className="mx-2 text-slate-300">|</span>
                    <Link href={`/inspections/${i.id}/review`} className="font-medium text-thermal-700 hover:underline">Review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

export default function InspectionsPage() {
  return <Suspense fallback={null}><InspectionsList /></Suspense>;
}
