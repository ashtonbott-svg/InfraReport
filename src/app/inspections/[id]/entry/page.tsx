"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Filter, ListPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { InspectionHeader } from "@/components/inspection/inspection-header";
import { AddRoomModal, RoomConditionsCard, RoomRail, type RoomEntry } from "@/components/inspection/room-panels";
import { EquipmentGrid, QuickAddBar, type GridRow } from "@/components/inspection/equipment-grid";
import { useAllowedCauses, useEquipment, useInspectionBundle, useLocations } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { countBySeverity } from "@/lib/domain/validation";
import { LIMITED_ACCESS_OPENED, POSSIBLE_CAUSE_NONE } from "@/lib/domain/constants";
import type { Equipment, Location } from "@/lib/domain/types";

type RowFilter = "all" | "problems" | "missing-image" | "limited" | "overrides" | "single-photo";

function EntryWorkspace() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const bundle = useInspectionBundle(id);
  const locations = useLocations();
  const allEquipment = useEquipment();
  const causes = useAllowedCauses();
  const addExistingEquipment = useStore((s) => s.addExistingEquipment);
  const [selectedRaw, setSelected] = useState(params.get("room") ?? "");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [addRoom, setAddRoom] = useState(false);

  const rooms: RoomEntry[] = useMemo(() => {
    if (!bundle) return [];
    const locMap = bundle.dataset.locations as Map<string, Location>;
    return bundle.dataset.rooms
      .map((room) => ({ room, location: locMap.get(room.locationId)!, count: bundle.dataset.results.filter((r) => r.locationId === room.locationId).length }))
      .filter((r) => r.location)
      .sort((a, b) => a.location.sortOrder - b.location.sortOrder);
  }, [bundle]);

  // Jump target from Review: scroll to and highlight the row
  const focusId = params.get("focus");
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-result-id="${focusId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("ring-2", "ring-thermal-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-thermal-400"), 2400);
    }, 150);
    return () => clearTimeout(t);
  }, [focusId]);

  // Fall back to the first room when nothing (or a removed room) is selected
  const selected = selectedRaw === "all" || rooms.some((r) => r.location.id === selectedRaw) ? selectedRaw : rooms[0]?.location.id ?? "";

  const gridRows: GridRow[] = useMemo(() => {
    if (!bundle) return [];
    const { dataset } = bundle;
    const eqMap = dataset.equipment as Map<string, Equipment>;
    const locMap = dataset.locations as Map<string, Location>;
    const s = q.trim().toLowerCase();
    return dataset.results
      .filter((r) => selected === "all" || r.locationId === selected)
      .map((r) => ({ result: r, equipment: eqMap.get(r.equipmentId), location: locMap.get(r.locationId), room: dataset.rooms.find((x) => x.locationId === r.locationId) }))
      .filter(({ result: r, equipment: e }) => {
        if (s && ![e?.name ?? "", r.component, r.irImageNumber, r.visualImageNumber, r.problemNotes].some((x) => x.toLowerCase().includes(s))) return false;
        switch (filter) {
          case "problems": return r.possibleCause !== POSSIBLE_CAUSE_NONE;
          case "missing-image": return !r.irImageNumber && !r.visualImageNumber;
          case "limited": return LIMITED_ACCESS_OPENED.includes(r.opened);
          case "overrides": return Object.values(r.overrides).some((v) => v !== null);
          case "single-photo": return r.visualFromSinglePhoto;
          default: return true;
        }
      })
      .sort((a, b) => (a.location?.sortOrder ?? 0) - (b.location?.sortOrder ?? 0) || a.result.sortOrder - b.result.sortOrder);
  }, [bundle, selected, q, filter]);

  if (!bundle) return <EmptyState title="Inspection not found" action={<Link href="/inspections"><Button>Back</Button></Link>} />;
  const { dataset, issues } = bundle;
  const inspection = dataset.inspection;
  const counts = countBySeverity(issues);
  const current = rooms.find((r) => r.location.id === selected);
  const roomResults = dataset.results.filter((r) => r.locationId === selected);
  const usedLocationIds = new Set(rooms.map((r) => r.location.id));

  // Inventory items in this room not yet in this inspection (e.g. added to facility later)
  const inspectedEq = new Set(dataset.results.map((r) => r.equipmentId));
  const missingInventory = allEquipment.filter((e) => e.facilityId === inspection.facilityId && e.active && !inspectedEq.has(e.id) && (selected === "all" || e.locationId === selected));
  const filtered = q.trim() !== "" || filter !== "all";

  return (
    <>
      <InspectionHeader inspection={inspection} errorCount={counts.error} />
      <div className="grid gap-4 2xl:grid-cols-[240px_minmax(0,1fr)]">
        <RoomRail rooms={rooms} selected={selected} onSelect={setSelected} onAdd={() => setAddRoom(true)} total={dataset.results.length} />

        <div className="min-w-0 space-y-4">
          {rooms.length === 0 ? (
            <Card><EmptyState icon={<ListPlus className="h-5 w-5" />} title="Add the first room" description="Create a room, enter humidity and temperatures once, then add equipment rapidly." action={<Button variant="primary" onClick={() => setAddRoom(true)}>Add room</Button>} /></Card>
          ) : (
            <>
              {current ? <RoomConditionsCard entry={current} results={roomResults} inspectionDate={inspection.date} /> : (
                <Card className="px-4 py-3 text-sm text-slate-600">Showing all {dataset.results.length} items across {rooms.length} rooms. Select a room to edit its conditions or quick add equipment.</Card>
              )}
              <QuickAddBar inspectionId={inspection.id} locationId={current ? current.location.id : null} disabled={!current} />

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input className="pl-9" placeholder="Search name, component, image #" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="relative">
                  <Filter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Select className="w-52 pl-9" value={filter} onChange={(e) => setFilter(e.target.value as RowFilter)} aria-label="Filter rows">
                    <option value="all">All rows</option>
                    <option value="problems">Problems documented</option>
                    <option value="missing-image">Missing image number</option>
                    <option value="limited">Not opened / inaccessible / off</option>
                    <option value="single-photo">Single photo, verify Visual #</option>
                    <option value="overrides">Rows with overrides</option>
                  </Select>
                </div>
                <span className="text-xs text-slate-500">{gridRows.length} shown{filtered ? " (filtered)" : ""}</span>
                <div className="ml-auto flex gap-2">
                  {missingInventory.length ? (
                    <Button size="sm" onClick={() => missingInventory.forEach((e) => addExistingEquipment(inspection.id, e.id))} title="Add facility inventory items that are not yet in this inspection">
                      Add {missingInventory.length} inventory item{missingInventory.length === 1 ? "" : "s"}
                    </Button>
                  ) : null}
                  <Link href={`/inspections/${id}/review`}><Button size="sm" variant={counts.error ? "danger" : "secondary"}>{counts.error ? `${counts.error} errors · Review` : "Review & export"}</Button></Link>
                </div>
              </div>

              {gridRows.length === 0 ? (
                <Card><EmptyState title={filtered ? "No rows match" : "No equipment in this room yet"} description={filtered ? "Clear the search or filter." : "Use Quick add above. Press Enter to add each item."} /></Card>
              ) : (
                <EquipmentGrid rows={gridRows} inspection={inspection} causes={causes} showRoomHeaders={selected === "all"} locations={locations} />
              )}
              <p className="text-xs text-slate-500">
                Tips: Enter moves down a column, Shift+Enter moves up, Esc cancels a cell edit. Blank Distance inherits the room value (shown in gray). Expand a row (›) for humidity and temperature overrides, problem notes, and review notes.
              </p>
            </>
          )}
        </div>
      </div>
      <AddRoomModal open={addRoom} onClose={() => setAddRoom(false)} inspectionId={inspection.id} facilityId={inspection.facilityId} usedLocationIds={usedLocationIds} onAdded={(lid) => setSelected(lid)} />
    </>
  );
}

export default function EntryPage() {
  return <Suspense fallback={null}><EntryWorkspace /></Suspense>;
}
