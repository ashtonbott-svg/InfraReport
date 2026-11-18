import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, authDeps, errorResponse, requestUserId } from "@/lib/server/supabase";
import { resetPin } from "@/lib/server/tech-auth";

/** Clears the PIN, revokes every trusted phone and returns a fresh activation link. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/technicians/[id]/reset-pin">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const d = authDeps();
    const r = await resetPin(d, (await requestUserId(d, req)) ?? "", id);
    return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
