"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Building2, ClipboardList, Cpu, FileSpreadsheet, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Stat, Table, td, th } from "@/components/ui/misc";
import { INSPECTION_STATUSES } from "@/lib/domain/constants";
import { ResumeInspections } from "@/components/field/resume-card";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import {
  useCustomers, useEquipment, useFacilities, useInspections, useResults, useReviewEvents, useUsers,
} from "@/lib/store/hooks";

const WORKFLOW = ["Customer", "Facility", "Inspection", "Equipment", "Field Notes", "Review", "Images", "Excel", "Report", "Approve", "Deliver"];

export default function DashboardPage() {
  const customers = useCustomers();
  const facilities = useFacilities();
  const equipment = useEquipment();
  const inspections = useInspections();
  const results = useResults();
  const events = useReviewEvents();
  const users = useUsers();

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inspections) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [inspections]);

  const active = useMemo(
    () => inspections.filter((i) => !["Delivered"].includes(i.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [inspections],
  );
  const recent = useMemo(() => [...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8), [events]);
  const name = (id: string, list: { id: string; name: string }[]) => list.find((x) => x.id === id)?.name ?? "";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Inspection workload, facility inventory, and report readiness at a glance."
        actions={
          <Link href="/inspections/new"><Button variant="primary"><Plus className="h-4 w-4" />New Inspection</Button></Link>
        }
      />

      <ResumeInspections />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open inspections" value={active.length} sub={`${byStatus.get("Needs Review") ?? 0} need review`} icon={<ClipboardList className="h-4 w-4" />} />
        <Stat label="Customers" value={customers.length} sub={plural(facilities.length, "facility", "facilities")} icon={<Users className="h-4 w-4" />} />
        <Stat label="Equipment records" value={equipment.length} sub="Permanent inventory" icon={<Cpu className="h-4 w-4" />} />
        <Stat label="Inspection results" value={results.length} sub="Across all inspections" icon={<Building2 className="h-4 w-4" />} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Pipeline" description="Inspections by status" />
        <CardBody>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {INSPECTION_STATUSES.map((s) => (
              <Link key={s} href={`/inspections?status=${encodeURIComponent(s)}`} className="rounded-md border border-slate-200 px-3 py-2.5 transition-colors hover:border-thermal-300 hover:bg-thermal-50/40">
                <div className="text-xl font-semibold tabular-nums text-slate-900">{byStatus.get(s) ?? 0}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{s}</div>
              </Link>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
            {WORKFLOW.map((w, i) => (
              <span key={w} className="flex items-center gap-1">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{w}</span>
                {i < WORKFLOW.length - 1 ? <ArrowRight className="h-3 w-3" /> : null}
              </span>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Active inspections" actions={<Link href="/inspections" className="text-xs font-medium text-thermal-700 hover:underline">View all</Link>} />
          {active.length === 0 ? (
            <EmptyState title="No open inspections" description="Start an inspection to begin recording equipment." action={<Link href="/inspections/new"><Button variant="primary">New Inspection</Button></Link>} />
          ) : (
            <Table>
              <thead><tr><th className={th}>Facility</th><th className={th}>Date</th><th className={th}>Inspector</th><th className={th}>Items</th><th className={th}>Status</th><th className={th} /></tr></thead>
              <tbody>
                {active.map((i) => {
                  const f = facilities.find((x) => x.id === i.facilityId);
                  const count = results.filter((r) => r.inspectionId === i.id).length;
                  return (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <td className={td}>
                        <div className="font-medium text-slate-900">{f?.name}</div>
                        <div className="text-xs text-slate-500">{name(i.customerId, customers)}</div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(i.date)}</td>
                      <td className={`${td} whitespace-nowrap`}>{name(i.inspectorId, users)}</td>
                      <td className={`${td} tabular-nums`}>{count}</td>
                      <td className={td}><StatusBadge status={i.status} /></td>
                      <td className={`${td} text-right`}>
                        <Link href={`/inspections/${i.id}/entry`} className="whitespace-nowrap text-xs font-medium text-thermal-700 hover:underline">Open entry</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          <CardBody className="space-y-3">
            {recent.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : recent.map((e) => {
              const insp = inspections.find((i) => i.id === e.inspectionId);
              const f = facilities.find((x) => x.id === insp?.facilityId);
              return (
                <div key={e.id} className="flex gap-3 text-sm">
                  <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-thermal-500" />
                  <div className="min-w-0">
                    <div className="text-slate-800"><span className="font-medium">{e.action}</span>{f ? <> · <Link className="hover:underline" href={`/inspections/${e.inspectionId}`}>{f.name}</Link></> : null}</div>
                    <div className="truncate text-xs text-slate-500">{e.detail}</div>
                    <div className="text-[11px] text-slate-400">{formatDateTime(e.at)} · {name(e.actorId, users)}</div>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Reports" description="Generator CSV exports are available for every inspection. Finished PDF reports arrive with Generator integration." actions={<Link href="/reports"><Button size="sm"><FileSpreadsheet className="h-3.5 w-3.5" />Open Reports</Button></Link>} />
        <CardBody className="grid gap-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-slate-500">Approved, awaiting report</div><div className="text-lg font-semibold">{byStatus.get("Approved") ?? 0}</div></div>
          <div><div className="text-xs text-slate-500">Report generated</div><div className="text-lg font-semibold">{byStatus.get("Report Generated") ?? 0}</div></div>
          <div><div className="text-xs text-slate-500">Delivered</div><div className="text-lg font-semibold">{byStatus.get("Delivered") ?? 0}</div></div>
        </CardBody>
      </Card>
    </>
  );
}
