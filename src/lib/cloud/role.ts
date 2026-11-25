"use client";

import { useSession } from "./session";

/**
 * What the current person may see. In device-only mode (no cloud configured)
 * everything behaves exactly as before.
 */
export function useRole() {
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const view = useSession((s) => s.view);
  const cloud = status !== "disabled";
  const isAdmin = !cloud || me?.role === "admin";
  return {
    cloud,
    signedIn: status === "signedIn",
    isAdmin,
    isTechnician: cloud && me?.role === "technician",
    /** Admin screens visible (admins outside field view, or device-only mode). */
    adminView: !cloud || (me?.role === "admin" && view === "admin"),
    me,
  };
}

/** Routes a technician (or an admin in field view) can open. Everything else is administrator-only. */
export function fieldRouteAllowed(pathname: string) {
  return pathname === "/jobs" || pathname === "/settings" || pathname === "/sync" || /^\/inspections\/[^/]+(\/(entry|review|photos))?$/.test(pathname) && pathname !== "/inspections/new";
}
