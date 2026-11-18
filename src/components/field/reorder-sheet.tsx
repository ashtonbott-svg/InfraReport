"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { roomOrder, useStore } from "@/lib/store/store";
import type { Equipment, InspectionResult } from "@/lib/domain/types";

/**
 * Reorder equipment within one room. Move up / down buttons, "move after",
 * or drag the handle. Each move changes one item's position only, so the
 * order syncs safely between phones. Readings and completion are untouched.
 */
export function ReorderSheet({ open, onClose, sample, equipment, roomName }: {
  open: boolean; onClose: () => void; sample: Pick<InspectionResult, "inspectionId" | "locationId">; equipment: Map<string, Equipment>; roomName?: string;
}) {
  const results = useStore((s) => s.results);
  const moveResult = useStore((s) => s.moveResult);
  const list = roomOrder(results, sample);
  const name = (r: InspectionResult) => equipment.get(r.equipmentId)?.name || "Equipment";
  const [picked, setPicked] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const rowsRef = useRef<HTMLUListElement>(null);

  /** Index of the gap under the pointer (0 = top). */
  const gapAt = (clientY: number) => {
    const items = [...(rowsRef.current?.querySelectorAll<HTMLElement>("[data-reorder-row]") ?? [])];
    let i = 0;
    for (const el of items) { const b = el.getBoundingClientRect(); if (clientY > b.top + b.height / 2) i++; }
    return i;
  };
  const dropAt = (id: string, gap: number) => {
    const others = list.filter((x) => x.id !== id);
    const from = list.findIndex((x) => x.id === id);
    const target = gap > from ? gap - 1 : gap;
    if (target === from) return;
    moveResult(id, { after: target === 0 ? null : others[target - 1].id });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Reorder Equipment" subtitle={`${roomName ? `${roomName} · ` : ""}Drag the handle, or use the arrows. Saved and synced right away.`} size="lg"
      footer={<Button variant="primary" size="lg" className="h-12 w-full justify-center text-base" onClick={onClose}>Done</Button>}>
      {picked ? (
        <div className="mb-3 rounded-lg bg-thermal-50 px-3 py-2 text-sm text-thermal-900">Tap the item that <strong>{name(list.find((x) => x.id === picked)!)}</strong> should follow, or <button className="underline" onClick={() => { moveResult(picked, { after: null }); setPicked(null); }}>move it to the top</button>. <button className="ml-1 underline" onClick={() => setPicked(null)}>Cancel</button></div>
      ) : null}
      <ul ref={rowsRef} className="space-y-1.5" data-testid="reorder-list">
        {list.map((r, i) => (
          <li key={r.id} data-reorder-row data-result-id={r.id}
            className={cn("flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5", drag?.id === r.id ? "border-thermal-400 opacity-60" : "border-slate-200",
              drag && drag.over === i && drag.id !== r.id && "border-t-4 border-t-thermal-500", picked && picked !== r.id && "cursor-pointer")}
            onClick={() => { if (picked && picked !== r.id) { moveResult(picked, { after: r.id }); setPicked(null); } }}>
            <span role="button" aria-label={`Drag ${name(r)}`} className="flex h-11 w-9 shrink-0 touch-none items-center justify-center text-slate-400"
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: r.id, over: i }); }}
              onPointerMove={(e) => { if (drag?.id === r.id) setDrag({ id: r.id, over: gapAt(e.clientY) }); }}
              onPointerUp={(e) => { if (drag?.id === r.id) { dropAt(r.id, gapAt(e.clientY)); setDrag(null); } }}
              onPointerCancel={() => setDrag(null)}>
              <GripVertical className="h-5 w-5" />
            </span>
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900" data-testid="reorder-name">{name(r)}</span>
            <Button size="sm" className="h-10 w-10 justify-center" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveResult(r.id, "up"); }} aria-label={`Move ${name(r)} up`}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="sm" className="h-10 w-10 justify-center" disabled={i === list.length - 1} onClick={(e) => { e.stopPropagation(); moveResult(r.id, "down"); }} aria-label={`Move ${name(r)} down`}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="sm" className="h-10 px-2" onClick={(e) => { e.stopPropagation(); setPicked(picked === r.id ? null : r.id); }} aria-label={`Move ${name(r)} after another item`}>Move…</Button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
