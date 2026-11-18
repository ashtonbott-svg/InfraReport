import { NextResponse } from "next/server";

/** Reports which server settings are present (names only, never values). */
export async function GET() {
  const has = (k: string) => !!process.env[k];
  const pepper = process.env.INFRAREPORT_PIN_PEPPER ?? "";
  return NextResponse.json({
    supabaseUrl: has("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    secretKey: has("SUPABASE_SECRET_KEY"),
    pinPepper: pepper.length >= 32,
  }, { headers: { "cache-control": "no-store" } });
}
