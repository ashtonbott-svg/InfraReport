import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, assertSameOrigin, errorResponse, readDeviceCookie, readJson, writeDeviceCookie } from "@/lib/server/supabase";

/** Removes a technician from this phone's trusted list (the administrator can also revoke it centrally). */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { userId } = await readJson<{ userId?: string }>(req);
    const map = readDeviceCookie(req.cookies.get(DEVICE_COOKIE)?.value);
    delete map[String(userId ?? "")];
    const res = NextResponse.json({ ok: true });
    writeDeviceCookie(res, map);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
