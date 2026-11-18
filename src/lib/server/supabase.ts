/**
 * Server-only Supabase access for route handlers.
 * The secret key never leaves the server: it is read from the environment and
 * used only inside API routes.
 */
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ConfigError, serverEnv } from "./env";
import { AuthError, type AuthDeps } from "./tech-auth";

const noPersist = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function authDeps(): AuthDeps {
  const env = serverEnv();
  return {
    admin: createClient(env.url, env.secret, noPersist),
    anon: () => createClient(env.url, env.publishable, noPersist),
    pepper: env.pepper,
  };
}

/** The signed-in user behind the request's Bearer token (verified by Supabase Auth), or null. */
export async function requestUserId(d: AuthDeps, req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await d.admin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim() || "unknown";
}

/** Uniform JSON errors; internal details are logged, not returned. */
export function errorResponse(e: unknown) {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof ConfigError) return NextResponse.json({ error: "The server is not configured for cloud sign-in yet.", code: "not_configured" }, { status: 503 });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong on the server.", code: "server_error" }, { status: 500 });
}

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new AuthError("Invalid request body", 400, "bad_request"); }
}

/** Only accept state-changing requests from our own origin (defense in depth next to SameSite cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from some browsers omit it for GET; POSTs from forms on other sites include it
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new AuthError("Cross-site request refused", 403, "bad_origin");
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError("Cross-site request refused", 403, "bad_origin");
  }
}

/* --------------------------- trusted device cookie -------------------------- */

export const DEVICE_COOKIE = "ir_device";

/** The cookie maps technician user id -> device secret (a phone can be trusted for more than one technician). */
export function readDeviceCookie(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(k)) out[k] = v;
      return out;
    }
  } catch { /* ignore malformed */ }
  return {};
}

export function writeDeviceCookie(res: NextResponse, map: Record<string, string>) {
  res.cookies.set(DEVICE_COOKIE, Buffer.from(JSON.stringify(map)).toString("base64url"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/tech",
    maxAge: 60 * 60 * 24 * 400,
  });
}

export function sessionPayload(s: { access_token: string; refresh_token: string; expires_at?: number }) {
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? null };
}
