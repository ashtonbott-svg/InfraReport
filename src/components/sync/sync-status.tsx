"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, HardDrive, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSyncStatus, type SyncLabel } from "@/lib/sync/runtime";
import { formatDateTime } from "@/lib/format";

const ICON: Record<SyncLabel, React.ComponentType<{ className?: string }>> = {
  "Saved on Device": HardDrive, Syncing: Loader2, "Synced to Cloud": CheckCircle2, Offline: CloudOff,
  "Pending Changes": CloudUpload, "Sync Failed": XCircle, "Needs Attention": AlertTriangle,
};
const TONE: Record<SyncLabel, string> = {
  "Saved on Device": "text-slate-300", Syncing: "text-sky-300", "Synced to Cloud": "text-emerald-300", Offline: "text-amber-300",
  "Pending Changes": "text-amber-200", "Sync Failed": "text-red-300", "Needs Attention": "text-red-300",
};
const TONE_LIGHT: Record<SyncLabel, string> = {
  "Saved on Device": "text-slate-600", Syncing: "text-sky-700", "Synced to Cloud": "text-emerald-700", Offline: "text-amber-700",
  "Pending Changes": "text-amber-700", "Sync Failed": "text-red-700", "Needs Attention": "text-red-700",
};

/** Compact cloud status. "Synced to Cloud" appears only after the database confirmed every change. */
export function SyncBadge({ dark = true, className, compact }: { dark?: boolean; className?: string; compact?: boolean }) {
  const s = useSyncStatus();
  if (!s.active) return null;
  const Icon = ICON[s.label];
  const extra = s.label === "Needs Attention" ? ` (${s.conflicts})` : s.label === "Sync Failed" ? ` (${s.failed})` : (s.label === "Offline" || s.label === "Pending Changes") && s.pending ? (compact ? ` (${s.pending})` : ` · ${s.pending} waiting`) : "";
  return (
    <Link href="/sync" className={cn("flex items-center gap-1.5 text-xs font-medium", dark ? TONE[s.label] : TONE_LIGHT[s.label], className)} data-testid="sync-badge" aria-live="polite">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", s.label === "Syncing" && "animate-spin")} />
      <span>{s.label}{extra}</span>
    </Link>
  );
}

/** Banner for anything the person must know: offline (not visible to teammates), failures, conflicts. */
export function SyncNotice({ inspectionId }: { inspectionId?: string }) {
  const s = useSyncStatus();
  if (!s.active) return null;
  const ops = inspectionId ? s.ops.filter((o) => o.row.inspection_id === inspectionId || o.id === inspectionId || o.table === "locations" || o.table === "equipment") : s.ops;
  const conflicts = inspectionId ? s.conflictList : s.conflictList;
  if (conflicts.length) {
    return <Banner tone="red" href="/sync"><strong>{conflicts.length} change{conflicts.length === 1 ? "" : "s"} need your decision.</strong> The same value was edited on two phones. Tap to choose which to keep.</Banner>;
  }
  const failed = ops.filter((o) => o.failed);
  if (failed.length) return <Banner tone="red" href="/sync"><strong>{failed.length} change{failed.length === 1 ? "" : "s"} could not be saved to the cloud.</strong> They are still on this phone. Tap for details.</Banner>;
  const pending = ops.filter((o) => !o.failed).length;
  if (s.offline && pending) {
    return <Banner tone="amber" href="/sync"><strong>Offline.</strong> {pending} change{pending === 1 ? " is" : "s are"} saved on this phone only and <strong>not visible on other phones</strong> until this phone reconnects.</Banner>;
  }
  return null;
}

function Banner({ tone, href, children }: { tone: "red" | "amber"; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn("mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm", tone === "red" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")} data-testid="sync-notice">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span>
    </Link>
  );
}

export function LastSynced() {
  const s = useSyncStatus();
  if (!s.active) return null;
  const t = Math.max(s.lastPullOkAt ?? 0, s.lastPushOkAt ?? 0);
  return <span className="text-xs text-slate-500">{t ? `Last confirmed by the cloud ${formatDateTime(new Date(t).toISOString())}` : "Not confirmed by the cloud yet"}</span>;
}
