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
  let migration5: boolean | null = null;
  let migration6: boolean | null = null;
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
        // Database version this app needs: migration 5 (field test improvements).
        const [a, b, c] = await Promise.all([
          admin.from("inspections").select("approval_snapshot, primary_thermographer, primary_locked, submission_count", { head: true }),
          admin.from("exterior_checks").select("id", { head: true }),
          admin.from("results").select("photo_notes", { head: true }),
        ]);
        migration5 = !a.error && !b.error && !c.error;
        // Migration 6: rooms can be archived.
        migration6 = !(await admin.from("locations").select("archived_at", { head: true })).error;
      }
    } catch (e) {
      secretKeyAccepted = false;
      secretKeyError = e instanceof Error ? e.message : "request failed";
    }
  }
  return NextResponse.json({
    ...cfg.present,
    ready: cfg.problems.length === 0 && secretKeyAccepted === true && migration5 === true && migration6 === true,
    migration5,
    migration6,
    problems: cfg.problems,
    secretKeyAccepted,
    secretKeyError,
    ...deploymentInfo(),
  }, { headers: { "cache-control": "no-store" } });
}
