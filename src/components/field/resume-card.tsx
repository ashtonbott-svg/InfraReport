"use client";

import { useMemo } from "react";
import { Camera, CheckCircle2, MapPin, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { useCustomers, useFacilities, useInspections, useLocations, useResults, useRooms } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { useBeginFieldWork } from "@/lib/store/field-actions";
import { checkExit, requiredBuildings, visitDayCount } from "@/lib/domain/site-visit";
import { locationLabel } from "@/lib/domain/csv";
import { formatDateTime } from "@/lib/format";

/** Prominent Resume Inspection cards for paused or active site visits. */
export function ResumeInspections() {
  const inspections = useInspections();
  const customers = useCustomers();
  const facilities = useFacilities();
  const locations = useLocations();
  const rooms = useRooms();
  const results = useResults();
  const photos = useStore((s) => s.photos);
  const begin = useBeginFieldWork();
  const items = useMemo(() => {
    const locMap = new Map(locations.map((l) => [l.id, l]));
    return inspections
      .filter((i) => i.siteVisit.state === "paused" || i.siteVisit.state === "active")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((i) => {
        const inspRooms = rooms.filter((r) => r.inspectionId === i.id);
        return {
          i,
          customer: customers.find((c) => c.id === i.customerId)?.name ?? "",
          facility: facilities.find((f) => f.id === i.facilityId)?.name ?? "",
          room: i.siteVisit.lastActiveLocationId ? locMap.get(i.siteVisit.lastActiveLocationId) : undefined,
          count: results.filter((r) => r.inspectionId === i.id).length,
          exit: checkExit(requiredBuildings(inspRooms, locMap), photos, i.id),
          days: visitDayCount(i),
        };
      });
  }, [inspections, customers, facilities, locations, rooms, results, photos]);
  if (!items.length) return null;
  return (
    <div className="mb-6 space-y-3">
      {items.map(({ i, customer, facility, room, count, exit, days }) => (
        <div key={i.id} className="overflow-hidden rounded-xl border border-thermal-300 bg-white shadow-sm" data-testid="resume-card">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-thermal-700">Resume Inspection</div>
              <div className="mt-0.5 truncate text-lg font-semibold text-slate-900">{facility}</div>
              <div className="truncate text-sm text-slate-500">{customer}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{room ? locationLabel(room) : "No room yet"}</span>
                <span>{count} equipment</span>
                <span>Day {Math.max(days, 1)}</span>
                <span>Last saved {formatDateTime(i.updatedAt)}</span>
                <StatusBadge status={i.status} />
                {exit.allowed ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Exterior photo saved</span>
                  : <span className="inline-flex items-center gap-1 text-amber-700"><Camera className="h-3.5 w-3.5" />Exterior photo required</span>}
              </div>
            </div>
            <Button variant="primary" size="lg" className="h-14 justify-center px-6 text-base" onClick={() => begin(i.id)}><Play className="h-5 w-5" />Resume Inspection</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
