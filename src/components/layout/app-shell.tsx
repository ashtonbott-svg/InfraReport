"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Building2, ClipboardList, FileSpreadsheet, FileUp, Images, LayoutDashboard, Menu, Settings, Users, X, Plus, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useHydrateStore, useOrganization, useUsers } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { Wordmark } from "./logo";
import { Toaster } from "@/components/ui/toast";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/facilities", label: "Facilities", icon: Building2 },
  { href: "/inspections", label: "Inspections", icon: ClipboardList },
  { href: "/field-notes", label: "Field Notes", icon: FileUp, preview: true },
  { href: "/images", label: "Images", icon: Images, preview: true },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV.map(({ href, label, icon: Icon, preview }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          className={cn(
            "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            isActive(href) ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
          )}
        >
          <Icon className={cn("h-4 w-4", isActive(href) ? "text-thermal-400" : "text-slate-500 group-hover:text-slate-300")} />
          <span className="flex-1">{label}</span>
          {preview ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Preview</span> : null}
        </Link>
      ))}
      <div className="my-3 border-t border-white/5" />
      <Link
        href="/settings"
        onClick={onNavigate}
        className={cn(
          "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive("/settings") ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
        )}
      >
        <Settings className="h-4 w-4 text-slate-500" />
        Settings
      </Link>
    </nav>
  );
}

function SidebarFooter() {
  const org = useOrganization();
  const users = useUsers();
  const currentUserId = useStore((s) => s.currentUserId);
  const user = users.find((u) => u.id === currentUserId);
  return (
    <div className="border-t border-white/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
          {user?.name.split(" ").map((p) => p[0]).join("") ?? "?"}
        </div>
        <div className="min-w-0 text-xs">
          <div className="truncate font-medium text-slate-200">{user?.name}</div>
          <div className="truncate text-slate-500">{org?.name}</div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const ready = useHydrateStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-slate-950 lg:flex">
        <div className="flex h-16 items-center px-6"><Link href="/"><Wordmark /></Link></div>
        <div className="px-3 pb-4">
          <Link href="/inspections/new" className="flex items-center justify-center gap-2 rounded-md bg-thermal-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thermal-500">
            <Plus className="h-4 w-4" /> New Inspection
          </Link>
        </div>
        <NavLinks />
        <SidebarFooter />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between bg-slate-950 px-4 lg:hidden">
        <button onClick={() => setOpen(true)} className="-ml-1 rounded p-1.5 text-slate-300 hover:bg-white/10" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
        <Link href="/"><Wordmark /></Link>
        <Link href="/inspections/new" className="rounded-md bg-thermal-600 p-1.5 text-white" aria-label="New inspection"><Plus className="h-5 w-5" /></Link>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-slate-950">
            <div className="flex h-14 items-center justify-between px-5">
              <Wordmark />
              <button onClick={() => setOpen(false)} className="rounded p-1.5 text-slate-400 hover:bg-white/10" aria-label="Close navigation"><X className="h-5 w-5" /></button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <SidebarFooter />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pl-60 lg:pt-0">
        <div className="no-print flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:px-8">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span><strong>Prototype.</strong> Fictional demo data, saved only in this browser (not a secure database). Do not enter real customer information.</span>
        </div>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {ready ? children : <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading workspace…</div>}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
