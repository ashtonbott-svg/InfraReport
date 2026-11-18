import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, authDeps, errorResponse, readJson, requestUserId } from "@/lib/server/supabase";
import { createActivation } from "@/lib/server/tech-auth";

/** New single-use activation link for a technician's phone. The token is returned once and never stored in clear. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/technicians/[id]/activation">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const d = authDeps();
    const body = await readJson<{ hours?: number }>(req).catch(() => ({ hours: 24 }));
    const r = await createActivation(d, (await requestUserId(d, req)) ?? "", id, Number(body.hours) || 24);
    return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
