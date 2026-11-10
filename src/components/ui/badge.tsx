import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { InspectionStatus } from "@/lib/domain/types";

type Tone = "slate" | "orange" | "green" | "blue" | "amber" | "red" | "violet" | "teal";
const tones: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  orange: "bg-thermal-50 text-thermal-700 ring-thermal-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
};

export function Badge({ tone = "slate", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const statusTone: Record<InspectionStatus, Tone> = {
  Draft: "slate",
  "In Progress": "blue",
  "Needs Review": "amber",
  Approved: "green",
  "Report Generated": "violet",
  Delivered: "teal",
};

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return <Badge tone={statusTone[status]} dot>{status}</Badge>;
}
