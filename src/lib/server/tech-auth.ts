/**
 * Technician accounts and PIN sign-in (server side only).
 *
 * - Technicians are real Supabase Auth users with an internal email and a
 *   random password nobody knows. They never sign in with a password.
 * - A device is trusted only after activation: an administrator-issued,
 *   single-use, expiring activation token + the temporary PIN 12345, followed
 *   immediately by a personal PIN. The temporary PIN alone grants nothing.
 * - Later sign-ins need the trusted-device secret (httpOnly cookie) AND the
 *   personal PIN. Failed attempts lock the account temporarily; requests are
 *   also rate limited per network address.
 * - Success mints a genuine Supabase session for the technician, so database
 *   Row Level Security applies to everything they do.
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { TEMP_PIN, hashPin, pinProblem, randomToken, sha256, verifyPin } from "./pin";

export interface AuthDeps {
  admin: SupabaseClient;            // secret-key client (server only)
  anon: () => SupabaseClient;       // publishable-key client used to exchange the sign-in token
  pepper: string;
  now?: () => Date;
}

export class AuthError extends Error {
  constructor(message: string, public status = 400, public code = "auth_error") { super(message); }
}

export const MAX_PIN_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const MAX_ACTIVATION_FAILURES = 5;
export const TECH_EMAIL_DOMAIN = "technicians.infrareport.app";

const nowOf = (d: AuthDeps) => (d.now ? d.now() : new Date());

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new AuthError(`${what}: ${error.message}`, 500, "db_error");
  return data;
}

/** Fixed-window rate limit stored in the database (works across serverless instances). */
export async function rateLimit(d: AuthDeps, key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = nowOf(d);
  const row = await must(d.admin.from("auth_rate_limits").select("key, window_start, count").eq("key", key).maybeSingle(), "rate limit");
  const fresh = !row || now.getTime() - new Date(row.window_start as string).getTime() > windowSeconds * 1000;
  const count = fresh ? 1 : (row!.count as number) + 1;
  await must(d.admin.from("auth_rate_limits").upsert({ key, window_start: fresh ? now.toISOString() : row!.window_start, count }), "rate limit");
  if (count > limit) throw new AuthError("Too many attempts. Wait a few minutes and try again.", 429, "rate_limited");
}

export interface Member { user_id: string; organization_id: string; role: "admin" | "technician"; display_name: string; certification: string; active: boolean }

export async function getMember(d: AuthDeps, userId: string): Promise<Member | null> {
  return (await must(d.admin.from("memberships").select("*").eq("user_id", userId).maybeSingle(), "membership")) as Member | null;
}

export async function requireAdmin(d: AuthDeps, userId: string | null | undefined): Promise<Member> {
  if (!userId) throw new AuthError("Sign in required", 401, "unauthenticated");
  const m = await getMember(d, userId);
  if (!m || !m.active || m.role !== "admin") throw new AuthError("Administrator access required", 403, "forbidden");
  return m;
}

async function requireTechInOrg(d: AuthDeps, admin: Member, techId: string): Promise<Member> {
  const t = await getMember(d, techId);
  if (!t || t.organization_id !== admin.organization_id || t.role !== "technician") throw new AuthError("Technician not found", 404, "not_found");
  return t;
}

/* ------------------------------ admin actions ------------------------------ */

export async function createTechnician(d: AuthDeps, actorId: string, input: { name: string; certification: string }): Promise<string> {
  const admin = await requireAdmin(d, actorId);
  const name = input.name.trim();
  if (!name) throw new AuthError("Name is required");
  const { data, error } = await d.admin.auth.admin.createUser({
    email: `tech-${crypto.randomUUID()}@${TECH_EMAIL_DOMAIN}`,
    password: randomToken(48), // never shown, never used
    email_confirm: true,
    app_metadata: { infrareport: "technician" },
  });
  if (error || !data.user) throw new AuthError(`Could not create technician: ${error?.message}`, 500);
  const uid = data.user.id;
  await must(d.admin.from("memberships").insert({ user_id: uid, organization_id: admin.organization_id, role: "technician", display_name: name, certification: input.certification.trim() }), "membership");
  await must(d.admin.from("tech_credentials").insert({ user_id: uid }), "credentials");
  return uid;
}

export async function updateTechnician(d: AuthDeps, actorId: string, techId: string, patch: { name?: string; certification?: string; active?: boolean }) {
  const admin = await requireAdmin(d, actorId);
  await requireTechInOrg(d, admin, techId);
  const upd: Record<string, unknown> = { updated_at: nowOf(d).toISOString() };
  if (patch.name !== undefined) upd.display_name = patch.name.trim();
  if (patch.certification !== undefined) upd.certification = patch.certification.trim();
  if (patch.active !== undefined) upd.active = patch.active;
  await must(d.admin.from("memberships").update(upd).eq("user_id", techId), "update technician");
  if (patch.active === false) {
    // Disabled: no new sessions (ban), all devices revoked, and RLS denies data on any still-valid token.
    await d.admin.auth.admin.updateUserById(techId, { ban_duration: "876000h" });
    await must(d.admin.from("tech_devices").update({ revoked_at: nowOf(d).toISOString() }).eq("user_id", techId).is("revoked_at", null), "revoke devices");
  } else if (patch.active === true) {
    await d.admin.auth.admin.updateUserById(techId, { ban_duration: "none" });
  }
}

/** Single-use activation token for a new device (or after a PIN reset). Returned once; only its hash is stored. */
export async function createActivation(d: AuthDeps, actorId: string, techId: string, ttlHours = 24): Promise<{ token: string; expiresAt: string }> {
  const admin = await requireAdmin(d, actorId);
  await requireTechInOrg(d, admin, techId);
  const token = randomToken(24);
  const expiresAt = new Date(nowOf(d).getTime() + Math.min(Math.max(ttlHours, 1), 72) * 3600_000).toISOString();
  // Older unused activations for this technician stop working.
  await must(d.admin.from("tech_activations").update({ used_at: nowOf(d).toISOString() }).eq("user_id", techId).is("used_at", null), "expire old activations");
  await must(d.admin.from("tech_activations").insert({ user_id: techId, token_hash: sha256(token), expires_at: expiresAt, created_by: actorId }), "activation");
  return { token, expiresAt };
}

/** Clears the personal PIN and revokes every trusted device; a new activation is required. */
export async function resetPin(d: AuthDeps, actorId: string, techId: string) {
  const admin = await requireAdmin(d, actorId);
  await requireTechInOrg(d, admin, techId);
  await must(d.admin.from("tech_credentials").update({ pin_hash: null, pin_set_at: null, failed_attempts: 0, locked_until: null }).eq("user_id", techId), "reset pin");
  await must(d.admin.from("tech_devices").update({ revoked_at: nowOf(d).toISOString() }).eq("user_id", techId).is("revoked_at", null), "revoke devices");
  return createActivation(d, actorId, techId);
}

export async function revokeDevice(d: AuthDeps, actorId: string, deviceId: string) {
  const admin = await requireAdmin(d, actorId);
  const dev = await must(d.admin.from("tech_devices").select("id, user_id").eq("id", deviceId).maybeSingle(), "device");
  if (!dev) throw new AuthError("Device not found", 404);
  await requireTechInOrg(d, admin, dev.user_id as string);
  await must(d.admin.from("tech_devices").update({ revoked_at: nowOf(d).toISOString() }).eq("id", deviceId), "revoke device");
}

export async function listTechnicians(d: AuthDeps, actorId: string) {
  const admin = await requireAdmin(d, actorId);
  const members = await must(d.admin.from("memberships").select("*").eq("organization_id", admin.organization_id).order("display_name"), "members");
  const ids = (members as Member[]).map((m) => m.user_id);
  const creds = ids.length ? await must(d.admin.from("tech_credentials").select("user_id, pin_hash, locked_until, failed_attempts, pin_set_at").in("user_id", ids), "creds") : [];
  const devices = ids.length ? await must(d.admin.from("tech_devices").select("id, user_id, label, created_at, last_used_at, revoked_at").in("user_id", ids).order("created_at", { ascending: false }), "devices") : [];
  return (members as Member[]).map((m) => {
    const c = (creds as { user_id: string; pin_hash: string | null; locked_until: string | null; failed_attempts: number; pin_set_at: string | null }[]).find((x) => x.user_id === m.user_id);
    return {
      userId: m.user_id, name: m.display_name, certification: m.certification, role: m.role, active: m.active,
      pinSet: !!c?.pin_hash, pinSetAt: c?.pin_set_at ?? null, lockedUntil: c?.locked_until ?? null,
      devices: (devices as { id: string; user_id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[]).filter((x) => x.user_id === m.user_id),
    };
  });
}

/* ---------------------------- technician actions --------------------------- */

/** Exchanges a server-generated one-time token for a real Supabase session. */
export async function mintSession(d: AuthDeps, userId: string): Promise<Session> {
  const { data: u, error: ue } = await d.admin.auth.admin.getUserById(userId);
  if (ue || !u.user?.email) throw new AuthError("Account unavailable", 403);
  const { data: link, error: le } = await d.admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (le || !link.properties?.hashed_token) throw new AuthError(`Could not start session: ${le?.message ?? "no token"}`, 500);
  const { data: s, error: se } = await d.anon().auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (se || !s.session) throw new AuthError(`Could not start session: ${se?.message ?? "no session"}`, 500);
  return s.session;
}

export async function activateDevice(d: AuthDeps, input: { token: string; tempPin: string; newPin: string; confirmPin: string; label: string; ip: string }) {
  await rateLimit(d, `activate:${input.ip}`, 10, 15 * 60);
  const act = await must(d.admin.from("tech_activations").select("*").eq("token_hash", sha256(input.token || "")).maybeSingle(), "activation");
  const now = nowOf(d);
  if (!act || act.used_at || new Date(act.expires_at as string) < now || (act.failed_attempts as number) >= MAX_ACTIVATION_FAILURES) {
    throw new AuthError("This activation link is invalid, already used or expired. Ask your administrator for a new one.", 403, "activation_invalid");
  }
  if (input.tempPin !== TEMP_PIN) {
    await must(d.admin.from("tech_activations").update({ failed_attempts: (act.failed_attempts as number) + 1 }).eq("id", act.id), "activation");
    throw new AuthError("Temporary PIN is incorrect.", 403, "temp_pin_wrong");
  }
  const problem = pinProblem(input.newPin);
  if (problem) throw new AuthError(problem, 400, "pin_weak");
  if (input.newPin !== input.confirmPin) throw new AuthError("The two PINs do not match.", 400, "pin_mismatch");
  const member = await getMember(d, act.user_id as string);
  if (!member || !member.active || member.role !== "technician") throw new AuthError("This account is disabled.", 403, "disabled");
  // Single use: claim the activation atomically before doing anything else.
  const claimed = await must(d.admin.from("tech_activations").update({ used_at: now.toISOString() }).eq("id", act.id).is("used_at", null).select("id"), "claim activation");
  if (!(claimed as unknown[]).length) throw new AuthError("This activation link was already used.", 403, "activation_invalid");
  await must(d.admin.from("tech_credentials").upsert({ user_id: act.user_id, pin_hash: await hashPin(input.newPin, d.pepper), pin_set_at: now.toISOString(), failed_attempts: 0, locked_until: null, updated_at: now.toISOString() }), "set pin");
  const deviceToken = randomToken(32);
  await must(d.admin.from("tech_devices").insert({ user_id: act.user_id, token_hash: sha256(deviceToken), label: input.label.slice(0, 80), last_used_at: now.toISOString() }), "device");
  const session = await mintSession(d, act.user_id as string);
  return { userId: act.user_id as string, name: member.display_name, deviceToken, session };
}

export async function pinLogin(d: AuthDeps, input: { deviceToken: string; userId: string; pin: string; ip: string }) {
  await rateLimit(d, `pin:${input.ip}`, 20, 15 * 60);
  const now = nowOf(d);
  const device = input.deviceToken
    ? await must(d.admin.from("tech_devices").select("*").eq("token_hash", sha256(input.deviceToken)).eq("user_id", input.userId).maybeSingle(), "device")
    : null;
  if (!device || device.revoked_at) throw new AuthError("This device is not activated for this technician.", 403, "device_untrusted");
  const member = await getMember(d, input.userId);
  if (!member || !member.active || member.role !== "technician") throw new AuthError("This account is disabled.", 403, "disabled");
  const cred = await must(d.admin.from("tech_credentials").select("*").eq("user_id", input.userId).maybeSingle(), "credentials");
  if (!cred?.pin_hash) throw new AuthError("No PIN is set. Ask your administrator for an activation link.", 403, "pin_not_set");
  if (cred.locked_until && new Date(cred.locked_until as string) > now) {
    throw new AuthError(`Too many wrong PINs. Locked until ${new Date(cred.locked_until as string).toLocaleTimeString("en-US")}.`, 423, "locked");
  }
  const ok = /^\d{4,6}$/.test(input.pin) && (await verifyPin(input.pin, cred.pin_hash as string, d.pepper));
  if (!ok) {
    const failed = (cred.failed_attempts as number) + 1;
    const lock = failed >= MAX_PIN_FAILURES;
    await must(d.admin.from("tech_credentials").update({
      failed_attempts: lock ? 0 : failed,
      locked_until: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : cred.locked_until,
      updated_at: now.toISOString(),
    }).eq("user_id", input.userId), "record failure");
    throw new AuthError(lock ? `Too many wrong PINs. Locked for ${LOCK_MINUTES} minutes.` : `Incorrect PIN. ${MAX_PIN_FAILURES - failed} attempt(s) left.`, lock ? 423 : 401, lock ? "locked" : "pin_wrong");
  }
  await must(d.admin.from("tech_credentials").update({ failed_attempts: 0, locked_until: null, updated_at: now.toISOString() }).eq("user_id", input.userId), "reset failures");
  await must(d.admin.from("tech_devices").update({ last_used_at: now.toISOString() }).eq("id", device.id), "device");
  const session = await mintSession(d, input.userId);
  return { userId: input.userId, name: member.display_name, session };
}

/** Names of technicians this device is activated for (shown on the login page). */
export async function deviceTechnicians(d: AuthDeps, deviceTokens: string[]) {
  if (!deviceTokens.length) return [];
  const devices = await must(d.admin.from("tech_devices").select("user_id, revoked_at").in("token_hash", deviceTokens.map(sha256)), "devices");
  const ids = (devices as { user_id: string; revoked_at: string | null }[]).filter((x) => !x.revoked_at).map((x) => x.user_id);
  if (!ids.length) return [];
  const members = await must(d.admin.from("memberships").select("user_id, display_name, certification, active").in("user_id", ids), "members");
  return (members as { user_id: string; display_name: string; certification: string; active: boolean }[]).filter((m) => m.active).map((m) => ({ userId: m.user_id, name: m.display_name, certification: m.certification }));
}
