import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, assertSameOrigin, authDeps, clientIp, errorResponse, readDeviceCookie, readJson, sessionPayload, writeDeviceCookie } from "@/lib/server/supabase";
import { activateDevice } from "@/lib/server/tech-auth";

/** First sign-in on a phone: activation token + temporary PIN 12345, then a personal PIN. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readJson<{ token?: string; tempPin?: string; newPin?: string; confirmPin?: string; currentPin?: string; label?: string }>(req);
    const r = await activateDevice(authDeps(), {
      token: String(body.token ?? ""), tempPin: String(body.tempPin ?? ""), newPin: String(body.newPin ?? ""), currentPin: String(body.currentPin ?? ""),
      confirmPin: String(body.confirmPin ?? ""), label: String(body.label ?? req.headers.get("user-agent") ?? "").slice(0, 80), ip: clientIp(req),
    });
    const res = NextResponse.json({ userId: r.userId, name: r.name, session: sessionPayload(r.session) }, { headers: { "cache-control": "no-store" } });
    const map = readDeviceCookie(req.cookies.get(DEVICE_COOKIE)?.value);
    map[r.userId] = r.deviceToken;
    writeDeviceCookie(res, map);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
