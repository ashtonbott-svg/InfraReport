"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Building2, ClipboardCheck, ClipboardList, Camera, FileSpreadsheet, FileUp, Images, LayoutDashboard, ListChecks, LogOut, MapPin, Menu, Settings, Users, X, Plus, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useHydrateStore, useOrganization, useUsers } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { useFieldUi } from "@/lib/store/field-ui";
import { Wordmark } from "./logo";
import { Toaster } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { SaveIndicator } from "@/components/field/save-indicator";
import { ExitCheckpoint, ExteriorPhotoSheet, useFieldState, type FieldState } from "@/components/field/exterior-photos";
import { requestPersistentStorage } from "@/lib/photos/photo-db";
import { locationLabel } from "@/lib/domain/csv";
import { useOnline } from "@/lib/use-online";
import { CloudOff } from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/facilities", label: "Facilities", icon: Building2 },
  { href: "/inspections", label: "Inspections", icon: ClipboardList },
  { href: "/field-notes", label: "Field Notes", icon: FileUp, preview: true },
  { href: "/images", label: "Images", icon: Images, preview: true },
  { href: "/reports", label: "Reports", icon: FileSpreadsheet },
];

const linkCls = (active: boolean) =>
  cn("group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
    active ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100");

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
      {NAV.map(({ href, label, icon: Icon, preview }) => (
        <Link key={href} href={href} onClick={onNavigate} className={linkCls(isActive(href))}>
          <Icon className={cn("h-4 w-4", isActive(href) ? "text-thermal-400" : "text-slate-500 group-hover:text-slate-300")} />
          <span className="flex-1">{label}</span>
          {preview ? <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Preview</span> : null}
        </Link>
      ))}
      <div className="my-3 border-t border-white/5" />
      <Link href="/settings" onClick={onNavigate} className={linkCls(isActive("/settings"))}>
        <Settings className="h-4 w-4 text-slate-500" />Settings
      </Link>
    </nav>
  );
}

/** Navigation while an inspection is active: only this job's screens. */
function FieldNav({ field, onNavigate }: { field: FieldState; onNavigate?: () => void }) {
  const pathname = usePathname();
  const openCheckpoint = useFieldUi((s) => s.openCheckpoint);
  const openExterior = useFieldUi((s) => s.openExterior);
  const base = `/inspections/${field.inspection.id}`;
  const items = [
    { href: `${base}/entry`, label: "Equipment Entry", icon: ListChecks },
    { href: base, label: "Overview & Rooms", icon: MapPin },
    { href: `${base}/review`, label: "Review & Export", icon: ClipboardCheck },
  ];
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
      {items.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={onNavigate} className={linkCls(pathname === href)}>
          <Icon className={cn("h-4 w-4", pathname === href ? "text-thermal-400" : "text-slate-500")} />{label}
        </Link>
      ))}
      <button onClick={() => { onNavigate?.(); openExterior("manage"); }} className={cn(linkCls(false), "text-left")}>
        <Camera className="h-4 w-4 text-slate-500" />
        <span className="flex-1">Exterior Photos</span>
        {!field.exit.allowed ? <span className="h-2 w-2 rounded-full bg-amber-400" aria-label="Photo required" /> : null}
      </button>
      <div className="my-3 border-t border-white/5" />
      <Link href="/settings" onClick={onNavigate} className={linkCls(pathname === "/settings")}><Settings className="h-4 w-4 text-slate-500" />Settings &amp; recovery</Link>
      <button onClick={() => { onNavigate?.(); openCheckpoint(); }} className={cn(linkCls(false), "mt-1 text-left text-slate-200")}>
        <LogOut className="h-4 w-4 text-slate-400" />Pause or Finish Visit
      </button>
    </nav>
  );
}

function ActiveCard({ field }: { field: FieldState }) {
  return (
    <div className="mx-3 mb-3 rounded-lg border border-thermal-500/30 bg-thermal-500/10 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-thermal-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-thermal-400" />Active Inspection
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{field.facility?.name}</div>
      <div className="truncate text-xs text-slate-400">{field.customer?.name}</div>
      <div className="mt-2 text-[11px] uppercase tracking-wide text-slate-500">Current location</div>
      <div className="truncate text-xs text-slate-200">{field.lastRoom ? locationLabel(field.lastRoom) : "No room selected"}</div>
    </div>
  );
}

function SidebarFooter() {
  const org = useOrganization();
  const users = useUsers();
  const currentUserId = useStore((s) => s.currentUserId);
  const user = users.find((u) => u.id === currentUserId);
  return (
    <div className="border-t border-white/5 p-4">
      <SaveIndicator dark className="mb-3" />
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

/** Shown when an active inspection exists and the user lands on an unrelated screen. */
function ActiveGuard({ field }: { field: FieldState }) {
  const openCheckpoint = useFieldUi((s) => s.openCheckpoint);
  const room = field.inspection.siteVisit.lastActiveLocationId;
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-thermal-100 text-thermal-700"><ClipboardList className="h-6 w-6" /></div>
      <h1 className="text-xl font-semibold text-slate-900">An inspection is in progress</h1>
      <p className="mt-2 text-sm text-slate-600">{field.facility?.name} for {field.customer?.name}. Other jobs and admin screens are hidden until you pause or finish this site visit. Your work is saved.</p>
      <div className="mt-6 grid gap-2">
        <Link href={`/inspections/${field.inspection.id}/entry${room ? `?room=${room}` : ""}`}><Button variant="primary" size="lg" className="h-12 w-full justify-center text-base">Return to Inspection</Button></Link>
        <Button size="lg" className="h-12 w-full justify-center text-base" onClick={openCheckpoint}>Pause or Finish Site Visit</Button>
        <Link href="/settings" className="py-2 text-sm text-slate-500 underline">Settings &amp; data recovery</Link>
      </div>
    </div>
  );
}

function FieldOverlays({ field }: { field: FieldState }) {
  const router = useRouter();
  const ui = useFieldUi();
  const skip = useStore((s) => s.skipExteriorPrompt);
  // Browser-level reminder when closing the tab with a photo still missing.
  // (Mobile browsers often ignore this; the in-app checkpoint is the real control.)
  useEffect(() => {
    if (field.exit.allowed) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [field.exit.allowed]);
  return (
    <>
      <ExitCheckpoint open={ui.checkpointOpen} field={field} onClose={ui.closeCheckpoint} onExited={() => { ui.closeCheckpoint(); router.push("/"); }} />
      {ui.exteriorSheet ? (
        <ExteriorPhotoSheet open mode={ui.exteriorSheet} field={field} onClose={ui.closeExterior}
          onSkip={() => { skip(field.inspection.id); ui.closeExterior(); }} />
      ) : null}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const ready = useHydrateStore();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const activeId = useStore((s) => s.activeInspectionId);
  const field = useFieldState(activeId);
  const openCheckpoint = useFieldUi((s) => s.openCheckpoint);
  const fieldMode = ready && !!field;
  const online = useOnline();
  const allowed = !field || pathname.startsWith(`/inspections/${field.inspection.id}`) || pathname === "/settings";

  useEffect(() => {
    if (!ready) return;
    void requestPersistentStorage();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, [ready]);
  // An active id pointing to a deleted inspection must never lock the app.
  useEffect(() => {
    if (ready && activeId && !field) useStore.setState({ activeInspectionId: null });
  }, [ready, activeId, field]);

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-slate-950 lg:flex">
        <div className="flex h-16 items-center px-5"><Link href={fieldMode ? `/inspections/${field!.inspection.id}/entry` : "/"}><Wordmark /></Link></div>
        {fieldMode ? (
          <>
            <ActiveCard field={field!} />
            <FieldNav field={field!} />
          </>
        ) : (
          <>
            <div className="px-3 pb-4">
              <Link href="/inspections/new" className="flex items-center justify-center gap-2 rounded-md bg-thermal-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-thermal-500">
                <Plus className="h-4 w-4" /> New Inspection
              </Link>
            </div>
            <NavLinks />
          </>
        )}
        <SidebarFooter />
      </aside>

      {/* Mobile / tablet top bar */}
      <div className="no-print fixed inset-x-0 top-0 z-30 bg-slate-950 pt-[env(safe-area-inset-top)] lg:hidden">
        {fieldMode ? (
          <div className="flex h-14 items-center gap-2 px-3">
            <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Open inspection menu"><Menu className="h-6 w-6" /></button>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-thermal-300"><span className="h-1.5 w-1.5 rounded-full bg-thermal-400" />Active Inspection</div>
              <div className="truncate text-sm font-semibold text-white">{field!.facility?.name}</div>
            </div>
            <button onClick={openCheckpoint} className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-white/10">Exit</button>
          </div>
        ) : (
          <div className="flex h-14 items-center justify-between px-3">
            <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Open navigation"><Menu className="h-6 w-6" /></button>
            <Link href="/"><Wordmark compact /></Link>
            <Link href="/inspections/new" className="rounded-lg bg-thermal-600 p-2 text-white" aria-label="New inspection"><Plus className="h-6 w-6" /></Link>
          </div>
        )}
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col bg-slate-950 pt-[env(safe-area-inset-top)]">
            <div className="flex h-14 items-center justify-between px-4">
              <Wordmark compact />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Close navigation"><X className="h-6 w-6" /></button>
            </div>
            {fieldMode ? <><ActiveCard field={field!} /><FieldNav field={field!} onNavigate={() => setOpen(false)} /></> : <NavLinks onNavigate={() => setOpen(false)} />}
            <SidebarFooter />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip pt-[calc(3.5rem+env(safe-area-inset-top))] lg:pl-60 lg:pt-0">
        <div className={cn("no-print items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 sm:px-8", fieldMode ? "hidden lg:flex" : "flex")}>
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span><strong>Prototype.</strong> Fictional demo data, saved only on this device (not a secure database). Do not enter real customer information.</span>
        </div>
        {!online ? (
          <div className="no-print flex items-center gap-2 bg-slate-800 px-4 py-1.5 text-xs text-amber-200 sm:px-8" role="status">
            <CloudOff className="h-3.5 w-3.5 shrink-0" />
            <span><strong>Offline.</strong> Keep working: everything is saved on this device. Nothing needs to upload in this prototype.</span>
          </div>
        ) : null}
        <main className={cn("mx-auto w-full max-w-[1600px] flex-1 px-4 sm:px-8", fieldMode ? "py-4 sm:py-6" : "py-6 sm:py-8")}>
          {!ready ? <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading workspace…</div>
            : !allowed && field ? <ActiveGuard field={field} />
            : children}
        </main>
      </div>
      {fieldMode ? <FieldOverlays field={field!} /> : null}
      <Toaster />
    </div>
  );
}
