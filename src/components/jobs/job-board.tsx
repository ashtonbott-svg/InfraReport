"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarDays, Camera, MapPin, Play, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { useCustomers, useFacilities, useInspections, useResults, useRooms, useUsers } from "@/lib/store/hooks";
import { useBeginFieldWork } from "@/lib/store/field-actions";
import { roomProgress } from "@/lib/domain/thermal";
import { inspectorNames } from "@/components/forms/thermographer-picker";
import { primaryName } from "@/components/forms/primary-thermographer";
import { formatDate, todayISO } from "@/lib/format";
import type { Inspection } from "@/lib/domain/types";
import { DownloadExcelButton } from "@/components/inspection/download-excel";

export type JobGroup = "active" | "upcoming" | "submitted" | "approved";

export function jobGroup(i: Inspection, today: string): JobGroup {
  if (i.status === "Needs Review") return "submitted";
  if (["Approved", "Report Generated", "Delivered"].includes(i.status)) return "approved";
  if (i.status === "In Progress" || i.siteVisit.state !== "not-started" || i.date <= today) return "active";
  return "upcoming";
}

export const GROUP_LABEL: Record<JobGroup, string> = { active: "Active", upcoming: "Upcoming", submitted: "Submitted for review", approved: "Approved / completed" };

/** Job cards: customer, facility, address, date, technicians, room and equipment progress, Start/Resume. */
export function JobBoard({ onlyUserId, groups = ["active", "upcoming", "submitted", "approved"], empty, adminActions }: { onlyUserId?: string; groups?: JobGroup[]; empty?: React.ReactNode; adminActions?: boolean }) {
  const inspections = useInspections();
  const customers = useCustomers();
  const facilities = useFacilities();
  const rooms = useRooms();
  const results = useResults();
  const users = useUsers();
  const begin = useBeginFieldWork();
  const today = todayISO();

  const cards = useMemo(() => inspections
    .filter((i) => !onlyUserId || i.inspectorIds.includes(onlyUserId))
    .map((i) => {
      const f = facilities.find((x) => x.id === i.facilityId);
      const insRooms = rooms.filter((r) => r.inspectionId === i.id);
      const insResults = results.filter((r) => r.inspectionId === i.id);
      const p = roomProgress(insResults);
      return {
        i, group: jobGroup(i, today),
        customer: customers.find((c) => c.id === i.customerId)?.name ?? "",
        facility: f?.name ?? "", address: [f?.address, f?.city, f?.state].filter(Boolean).join(", "),
        roomsDone: insRooms.filter((r) => r.completedAt).length, roomsTotal: insRooms.length,
        eqDone: p.done, eqTotal: p.total,
      };
    })
    .sort((a, b) => a.i.date.localeCompare(b.i.date)), [inspections, facilities, rooms, results, customers, onlyUserId, today]);

  const shown = groups.map((g) => ({ g, items: cards.filter((c) => c.group === g) })).filter((x) => x.items.length);
  if (!shown.length) return <>{empty ?? null}</>;
  return (
    <div className="space-y-6">
      {shown.map(({ g, items }) => (
        <section key={g}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">{GROUP_LABEL[g]} <span className="text-slate-400">({items.length})</span></h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((c) => {
              const pct = c.eqTotal ? Math.round((c.eqDone / c.eqTotal) * 100) : 0;
              const live = c.i.siteVisit.state === "active" || c.i.siteVisit.state === "paused";
              return (
                <div key={c.i.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xs" data-testid="job-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-900">{c.facility}</div>
                      <div className="truncate text-sm text-slate-500">{c.customer}</div>
                    </div>
                    <StatusBadge status={c.i.status} />
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-slate-600">
                    {c.address ? <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{c.address}</span></div> : null}
                    <div className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />{formatDate(c.i.date)}</div>
                    <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{inspectorNames(c.i.inspectorIds, users)}</span></div>
                    {c.i.primaryThermographerId ? <div className="flex items-center gap-1.5" data-testid="job-primary"><Camera className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">Primary: {primaryName(c.i, users) ?? "Unknown"}</span></div> : null}
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] text-slate-500"><span>{c.eqDone} of {c.eqTotal} equipment</span><span>{c.roomsDone} of {c.roomsTotal} rooms finished</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={pct >= 100 ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-thermal-gradient"} style={{ width: `${pct}%` }} /></div>
                  </div>
                  {adminActions ? (
                    <div className="mt-4 grid gap-2">
                      <DownloadExcelButton inspectionId={c.i.id} size="lg" className="h-12 w-full justify-center text-base" data-testid="card-download-xlsx" />
                      <Link href={`/inspections/${c.i.id}/${c.group === "submitted" ? "review" : ""}`}><Button size="lg" className="h-11 w-full justify-center">{c.group === "submitted" ? "Review & Edit" : "Open"}</Button></Link>
                    </div>
                  ) : <div className="mt-4 flex gap-2">
                    {c.group === "active" || c.group === "upcoming" ? (
                      <Button variant="primary" size="lg" className="h-12 flex-1 justify-center text-base" onClick={() => begin(c.i.id)}><Play className="h-4 w-4" />{live || c.i.status === "In Progress" ? "Resume" : "Start"}</Button>
                    ) : (
                      <Link href={`/inspections/${c.i.id}/review`} className="flex-1"><Button size="lg" className="h-12 w-full justify-center">Open</Button></Link>
                    )}
                  </div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
