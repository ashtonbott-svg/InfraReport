"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSaveStatus } from "@/lib/store/save-status";
import { useOnline } from "@/lib/use-online";

/**
 * Honest save status. Data is written to this device on every change; there is
 * no server sync yet, so "offline" never implies pending uploads.
 */
export function SaveIndicator({ dark, className }: { dark?: boolean; className?: string }) {
  const { lastSavedAt, error, pendingPhotoWrites, photoError, storageWarning } = useSaveStatus();
  const online = useOnline();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!lastSavedAt) return;
    const on = setTimeout(() => setFlash(true), 0);
    const off = setTimeout(() => setFlash(false), 600);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [lastSavedAt]);

  let icon = <CheckCircle2 className="h-3.5 w-3.5" />;
  let text = "Saved on this device";
  let tone = dark ? "text-emerald-300" : "text-emerald-700";
  if (error || photoError) {
    icon = <AlertTriangle className="h-3.5 w-3.5" />;
    text = error ?? `Photo not saved: ${photoError}`;
    tone = dark ? "text-red-300" : "text-red-700";
  } else if (storageWarning && !(pendingPhotoWrites > 0 || flash)) {
    icon = <AlertTriangle className="h-3.5 w-3.5" />;
    text = storageWarning;
    tone = dark ? "text-amber-300" : "text-amber-700";
  } else if (pendingPhotoWrites > 0 || flash) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    text = "Saving…";
    tone = dark ? "text-slate-300" : "text-slate-500";
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs font-medium", tone, className)} role="status" aria-live="polite" data-testid="save-indicator">
      {icon}<span className="truncate">{text}</span>
      {!online ? <span className={cn("ml-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", dark ? "bg-white/10 text-amber-200" : "bg-amber-100 text-amber-900")}><CloudOff className="h-3 w-3" />Offline</span> : null}
    </span>
  );
}
