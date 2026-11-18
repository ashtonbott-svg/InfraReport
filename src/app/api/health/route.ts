import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deploymentInfo, readServerConfig } from "@/lib/server/env";

/**
 * Configuration check used by the owner. It runs the exact same configuration
 * reader as the sign-in routes, then asks Supabase whether the secret key is
 * actually accepted. Reports setting names and reasons only, never values.
 */
export async function GET() {
  const cfg = readServerConfig();
  let secretKeyAccepted: boolean | null = null;
  let secretKeyError: string | null = null;
  if (!cfg.problems.length) {
    try {
      const admin = createClient(cfg.values.url, cfg.values.secret, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      secretKeyAccepted = !error;
      if (error) secretKeyError = `${error.status ?? ""} ${error.message}`.trim();
      if (!error) {
        // Server-only tables must be reachable with the secret key (migrations applied, key has service access).
        const { error: tErr } = await admin.from("tech_credentials").select("user_id", { head: true, count: "exact" });
        if (tErr) { secretKeyAccepted = false; secretKeyError = `database: ${tErr.message}`; }
      }
    } catch (e) {
      secretKeyAccepted = false;
      secretKeyError = e instanceof Error ? e.message : "request failed";
    }
  }
  return NextResponse.json({
    ...cfg.present,
    ready: cfg.problems.length === 0 && secretKeyAccepted === true,
    problems: cfg.problems,
    secretKeyAccepted,
    secretKeyError,
    ...deploymentInfo(),
  }, { headers: { "cache-control": "no-store" } });
}
