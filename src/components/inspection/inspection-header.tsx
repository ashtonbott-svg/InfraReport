"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { INSPECTION_STATUSES } from "@/lib/domain/constants";
import type { Inspection, InspectionStatus } from "@/lib/domain/types";
import { useCustomers, useFacilities, useUsers } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { formatDate } from "@/lib/format";
import { toast } from "@/components/ui/toast";

export function InspectionHeader({ inspection, errorCount }: { inspection: Inspection; errorCount: number }) {
  const pathname = usePathname();
  const customer = useCustomers().find((c) => c.id === inspection.customerId);
  const facility = useFacilities().find((f) => f.id === inspection.facilityId);
  const inspector = useUsers().find((u) => u.id === inspection.inspectorId);
  const setStatus = useStore((s) => s.setInspectionStatus);
  const base = `/inspections/${inspection.id}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/entry`, label: "Equipment Entry" },
    { href: `${base}/review`, label: "Review & Export" },
  ];

  const changeStatus = (s: InspectionStatus) => {
    const idx = INSPECTION_STATUSES.indexOf(s);
    if (idx >= INSPECTION_STATUSES.indexOf("Approved") && errorCount > 0) {
      toast(`Resolve ${errorCount} validation error${errorCount === 1 ? "" : "s"} before approval`, "error");
      return;
    }
    if (!setStatus(inspection.id, s)) { toast("Building exterior photo required before review", "error"); return; }
    toast(`Status set to ${s}`);
  };

  return (
    <div className="mb-6">
      <div className="mb-1 text-xs font-medium text-slate-500">
        <Link href="/inspections" className="hover:underline">Inspections</Link> / <Link href={`/customers/${customer?.id}`} className="hover:underline">{customer?.name}</Link>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{facility?.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <span>{formatDate(inspection.date)}</span>
            <span className="text-slate-300">•</span>
            <span>{inspector?.name}</span>
            <StatusBadge status={inspection.status} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Status
          <Select className="h-8 w-44 text-xs" value={inspection.status} onChange={(e) => changeStatus(e.target.value as InspectionStatus)}>
            {INSPECTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </label>
      </div>
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              pathname === t.href ? "border-thermal-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
