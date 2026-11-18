"use client";

/**
 * Browser Supabase client. Uses ONLY the publishable key; every request runs
 * as the signed-in user, so Row Level Security decides what they can see and
 * change. When the public Supabase settings are absent the app runs in the
 * original device-only mode.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const cloudConfigured = !!(URL_ && KEY);

let client: SupabaseClient | null = null;
let override: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (override) return override;
  if (!cloudConfigured || typeof window === "undefined") return null;
  if (!client) {
    client = createClient(URL_!, KEY!, {
      db: { retry: false }, // the sync engine has its own retry with backoff
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "infrareport-auth" },
    });
  }
  return client;
}

/** Tests only. */
export function setSupabaseForTests(c: SupabaseClient | null) { override = c; }

export async function accessToken(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Calls our API routes with the user's access token. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: "same-origin" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `Request failed (${res.status})`), { status: res.status, code: (body as { code?: string }).code });
  return body as T;
}
