import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, authDeps, clientIp, errorResponse, readJson } from "@/lib/server/supabase";
import { activationInfo } from "@/lib/server/tech-auth";

/** Whose activation link this is and whether they already have a PIN (the token is sent in the body, never in a URL). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { token } = await readJson<{ token?: string }>(req);
    const info = await activationInfo(authDeps(), { token: String(token ?? ""), ip: clientIp(req) });
    return NextResponse.json(info, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
