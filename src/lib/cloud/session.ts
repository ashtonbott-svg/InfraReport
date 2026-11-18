"use client";

/**
 * Who is signed in (cloud mode). The membership is cached on the device so a
 * phone that loses signal mid-inspection keeps working with its last session;
 * the database still re-checks every request when it reconnects.
 */
import { create } from "zustand";
import { cloudConfigured, supabase } from "./client";
import { useStore } from "../store/store";
import type { User } from "../domain/types";
import { DEFAULT_EMISSIVITY } from "../domain/constants";

export type Role = "admin" | "technician";
export interface Member { userId: string; organizationId: string; role: Role; name: string; certification: string; active: boolean }

interface SessionState {
  status: "disabled" | "loading" | "signedOut" | "signedIn";
  me: Member | null;
  orgName: string;
  members: Member[];
  /** Administrators can work as a field thermographer with the same account. */
  view: "admin" | "field";
  error: string | null;
  setView(v: "admin" | "field"): void;
}

const CACHE_KEY = "infrareport-cloud-member";

export const useSession = create<SessionState>((set) => ({
  status: cloudConfigured ? "loading" : "disabled",
  me: null,
  orgName: "",
  members: [],
  view: "admin",
  error: null,
  setView(v) {
    set({ view: v });
    try { localStorage.setItem(`${CACHE_KEY}:view`, v); } catch { /* ignore */ }
  },
}));

export const isAdmin = (s: Pick<SessionState, "me">) => s.me?.role === "admin";
/** Admin screens are shown to administrators who are not in field view. */
export const showsAdmin = (s: Pick<SessionState, "me" | "view" | "status">) => s.status === "disabled" || (s.me?.role === "admin" && s.view === "admin");

type Row = Record<string, unknown>;
const toMember = (r: Row): Member => ({
  userId: String(r.user_id), organizationId: String(r.organization_id), role: r.role as Role,
  name: String(r.display_name ?? ""), certification: String(r.certification ?? ""), active: r.active !== false,
});

/** Make the device store work inside the cloud organization (legacy device data stays under its own org, untouched). */
export function applyIdentity(me: Member, orgName: string, members: Member[]) {
  const users: User[] = members.filter((m) => m.active).map((m) => ({
    id: m.userId, organizationId: me.organizationId, name: m.name, email: "",
    role: m.role === "admin" ? "owner" : "inspector", certification: m.certification,
  }));
  useStore.setState((s) => {
    const hasOrg = s.organizations.some((o) => o.id === me.organizationId);
    return {
      currentOrgId: me.organizationId,
      currentUserId: me.userId,
      users: [...s.users.filter((u) => u.organizationId !== me.organizationId), ...users],
      organizations: hasOrg
        ? s.organizations.map((o) => (o.id === me.organizationId ? { ...o, name: orgName || o.name } : o))
        : [...s.organizations, {
          id: me.organizationId, name: orgName || "Organization", slug: "cloud", isDemo: false, createdAt: new Date().toISOString(),
          settings: { defaultEmissivity: DEFAULT_EMISSIVITY, customPossibleCauses: [], csvIncludeBom: true },
        }],
    };
  });
}

async function loadMembership(userId: string): Promise<{ me: Member; orgName: string; members: Member[] } | null> {
  const sb = supabase()!;
  const { data: mine, error } = await sb.from("memberships").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!mine) return null;
  const me = toMember(mine);
  const [{ data: org }, { data: all }] = await Promise.all([
    sb.from("organizations").select("name").eq("id", me.organizationId).maybeSingle(),
    sb.from("memberships").select("*").eq("organization_id", me.organizationId).order("display_name"),
  ]);
  return { me, orgName: String(org?.name ?? ""), members: (all ?? []).map(toMember) };
}

function cache(v: { me: Member; orgName: string; members: Member[] } | null) {
  try {
    if (v) localStorage.setItem(CACHE_KEY, JSON.stringify(v)); else localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}
function cached(): { me: Member; orgName: string; members: Member[] } | null {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); } catch { return null; }
}

function signedIn(v: { me: Member; orgName: string; members: Member[] }) {
  let view: "admin" | "field" = "admin";
  try { view = localStorage.getItem(`${CACHE_KEY}:view`) === "field" ? "field" : "admin"; } catch { /* ignore */ }
  applyIdentity(v.me, v.orgName, v.members);
  useSession.setState({ status: "signedIn", me: v.me, orgName: v.orgName, members: v.members, view: v.me.role === "admin" ? view : "field", error: null });
}

let started = false;
/** Resolve the current session once the device store has loaded. */
export async function startSession() {
  if (!cloudConfigured || started) return;
  started = true;
  const sb = supabase()!;
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") { cache(null); useSession.setState({ status: "signedOut", me: null }); }
  });
  await refreshIdentity();
}

export async function refreshIdentity() {
  const sb = supabase();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) { useSession.setState({ status: "signedOut", me: null }); return; }
  const prev = cached();
  try {
    const v = await loadMembership(uid);
    if (!v || !v.me.active) {
      await sb.auth.signOut({ scope: "local" });
      cache(null);
      useSession.setState({ status: "signedOut", me: null, error: v ? "This account is disabled." : "This account has no InfraReport access." });
      return;
    }
    cache(v);
    signedIn(v);
  } catch {
    // Offline: keep working with the last confirmed membership for this same user.
    if (prev && prev.me.userId === uid) signedIn(prev);
    else useSession.setState({ status: "signedOut", me: null, error: "Connect to the internet to sign in." });
  }
}

export async function adminSignIn(email: string, password: string) {
  const sb = supabase()!;
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message);
  await refreshIdentity();
  const s = useSession.getState();
  if (s.status !== "signedIn") throw new Error(s.error ?? "Sign in failed.");
  if (s.me?.role !== "admin") { await signOut(); throw new Error("Use Technician Login for this account."); }
}

/** Technician sessions are minted by our server after the PIN check; the client just adopts them. */
export async function adoptSession(session: { access_token: string; refresh_token: string }) {
  const sb = supabase()!;
  const { error } = await sb.auth.setSession(session);
  if (error) throw new Error(error.message);
  await refreshIdentity();
  const s = useSession.getState();
  if (s.status !== "signedIn") throw new Error(s.error ?? "Sign in failed.");
}

export async function signOut() {
  const sb = supabase();
  cache(null);
  if (sb) await sb.auth.signOut({ scope: "local" }).catch(() => undefined);
  useSession.setState({ status: "signedOut", me: null, members: [] });
}
