import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, authDeps, errorResponse, requestUserId } from "@/lib/server/supabase";
import { revokeDevice } from "@/lib/server/tech-auth";

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/devices/[id]">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const d = authDeps();
    await revokeDevice(d, (await requestUserId(d, req)) ?? "", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
