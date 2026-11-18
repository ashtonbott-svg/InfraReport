import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, authDeps, errorResponse, readDeviceCookie } from "@/lib/server/supabase";
import { deviceTechnicians } from "@/lib/server/tech-auth";

/** Technicians this phone is activated for (names only). Nothing is listed on an untrusted device. */
export async function GET(req: NextRequest) {
  try {
    const map = readDeviceCookie(req.cookies.get(DEVICE_COOKIE)?.value);
    const techs = await deviceTechnicians(authDeps(), Object.values(map));
    return NextResponse.json({ technicians: techs }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
