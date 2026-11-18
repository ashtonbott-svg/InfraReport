import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, assertSameOrigin, authDeps, clientIp, errorResponse, readDeviceCookie, readJson, sessionPayload } from "@/lib/server/supabase";
import { pinLogin } from "@/lib/server/tech-auth";

/** PIN sign-in. Requires this phone's trusted-device secret for the chosen technician. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJson<{ userId?: string; pin?: string }>(req);
    const userId = String(body.userId ?? "");
    const map = readDeviceCookie(req.cookies.get(DEVICE_COOKIE)?.value);
    const r = await pinLogin(authDeps(), { deviceToken: map[userId] ?? "", userId, pin: String(body.pin ?? ""), ip: clientIp(req) });
    return NextResponse.json({ userId: r.userId, name: r.name, session: sessionPayload(r.session) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
