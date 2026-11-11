"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useVisualViewport } from "@/lib/use-viewport";

/**
 * Bottom sheet on phones, centered dialog on larger screens. Stays above the
 * on-screen keyboard and keeps its action footer reachable with one thumb.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, size = "md", dismissible = true, labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
  size?: "md" | "lg" | "full"; dismissible?: boolean; labelledBy?: string;
}) {
  const vv = useVisualViewport();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissible) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  const maxH = vv.height ? `${vv.height - 8}px` : "92dvh";
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : labelledBy}>
      <div className="absolute inset-0 bg-slate-950/55" onClick={() => dismissible && onClose()} />
      <div
        className={cn(
          "absolute inset-x-0 flex flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          size === "md" && "sm:max-w-lg", size === "lg" && "sm:max-w-2xl", size === "full" && "sm:max-w-3xl",
        )}
        style={{ bottom: vv.keyboard || 0, maxHeight: maxH }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-slate-900">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div> : null}
          </div>
          {dismissible ? (
            <button onClick={onClose} className="-mr-2 rounded-full p-2.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </div>
    </div>
  );
}
