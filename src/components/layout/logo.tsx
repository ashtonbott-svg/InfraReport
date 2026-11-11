import Image from "next/image";
import irLogo from "@/assets/ir-logo.png";
import { cn } from "@/lib/cn";

/**
 * Approved red and black IR logo. Shown on a white tile because the black
 * elements of the mark disappear against the dark navigation.
 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md bg-white p-0.5 shadow-sm", className)}>
      <Image src={irLogo} alt="" width={64} height={64} className="h-full w-full object-contain" priority />
    </span>
  );
}

export function Wordmark({ dark = true, compact }: { dark?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5" aria-label="InfraReport">
      <LogoMark className={compact ? "h-7 w-7" : "h-8 w-8"} />
      <span className={cn("font-semibold tracking-tight", compact ? "text-base" : "text-[17px]", dark ? "text-white" : "text-slate-900")}>
        Infra<span className="text-thermal-400">Report</span>
      </span>
    </span>
  );
}
