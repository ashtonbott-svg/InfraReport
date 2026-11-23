"use client";

import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

/** The ⋯ menu beside a room: Rename Room, Delete Room. */
export function RoomMenu({ label, onRename, onDelete, className, compact }: {
  label: string; onRename?: () => void; onDelete?: () => void; className?: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Near the bottom of the screen (last rooms in a sheet) the menu opens upward so it is never cut off.
  const [up, setUp] = useState(false);
  if (!onRename && !onDelete) return null;
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {open ? <span className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-hidden /> : null}
      <button type="button" aria-label={`Room options for ${label}`} aria-haspopup="menu" aria-expanded={open} data-testid="room-menu"
        onClick={(e) => { e.stopPropagation(); setUp(e.currentTarget.getBoundingClientRect().bottom > window.innerHeight * 0.55); setOpen(!open); }}
        className={cn("flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200", compact ? "h-8 w-8" : "h-12 w-11")}>
        <MoreVertical className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
      {open ? (
        <span role="menu" className={cn("absolute right-0 z-40 w-48", up ? "bottom-full mb-1" : "top-full mt-1", " overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-lg")}>
          {onRename ? <button role="menuitem" type="button" data-testid="room-menu-rename" className="flex min-h-12 w-full items-center gap-3 px-4 text-base text-slate-800 hover:bg-slate-50"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onRename(); }}><Pencil className="h-4 w-4 text-slate-500" />Rename Room</button> : null}
          {onDelete ? <button role="menuitem" type="button" data-testid="room-menu-delete" className="flex min-h-12 w-full items-center gap-3 px-4 text-base text-red-700 hover:bg-red-50"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}><Trash2 className="h-4 w-4" />Delete Room</button> : null}
        </span>
      ) : null}
    </span>
  );
}
