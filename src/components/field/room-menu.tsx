"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";

const MENU_W = 192, MENU_H = 112;

/**
 * The ⋯ menu beside a room: Rename Room, Delete Room. The menu is drawn over the whole page
 * (fixed position), so a sheet header or scrolling list can never hide it, whatever the
 * number of rooms or where the row sits on the screen.
 */
export function RoomMenu({ label, onRename, onDelete, className, compact }: {
  label: string; onRename?: () => void; onDelete?: () => void; className?: string; compact?: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  if (!onRename && !onDelete) return null;
  const close = () => setPos(null);
  const openAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const below = r.bottom + 4 + MENU_H <= vh - 8;
    setPos({
      top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - MENU_H),
      left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  };
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <button type="button" aria-label={`Room options for ${label}`} aria-haspopup="menu" aria-expanded={!!pos} data-testid="room-menu"
        onClick={(e) => { e.stopPropagation(); if (pos) close(); else openAt(e.currentTarget); }}
        className={cn("flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200", compact ? "h-8 w-8" : "h-12 w-11")}>
        <MoreVertical className={compact ? "h-4 w-4" : "h-5 w-5"} />
      </button>
      {pos && typeof document !== "undefined" ? createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={close} aria-hidden />
          <div role="menu" aria-label={`Room options for ${label}`} className="fixed z-[71] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl"
            style={{ top: pos.top, left: pos.left, width: MENU_W }}>
            {onRename ? <button role="menuitem" type="button" data-testid="room-menu-rename" className="flex min-h-12 w-full items-center gap-3 px-4 text-base text-slate-800 hover:bg-slate-50"
              onClick={() => { close(); onRename(); }}><Pencil className="h-4 w-4 text-slate-500" />Rename Room</button> : null}
            {onDelete ? <button role="menuitem" type="button" data-testid="room-menu-delete" className="flex min-h-12 w-full items-center gap-3 px-4 text-base text-red-700 hover:bg-red-50"
              onClick={() => { close(); onDelete(); }}><Trash2 className="h-4 w-4" />Delete Room</button> : null}
          </div>
        </>, document.body) : null}
    </span>
  );
}
