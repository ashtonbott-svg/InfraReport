"use client";

import { useId } from "react";

export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7c2d12" />
          <stop offset="0.45" stopColor="#e44408" />
          <stop offset="1" stopColor="#fdba74" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="7" fill={`url(#${gid})`} />
      <circle cx="16" cy="16" r="6.5" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M16 4.5v5M16 22.5v5M4.5 16h5M22.5 16h5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.8" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ dark = true }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className={`text-[17px] font-semibold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}>
        Infra<span className="text-thermal-400">Report</span>
      </span>
    </span>
  );
}
