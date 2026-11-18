import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, authDeps, errorResponse, readJson, requestUserId } from "@/lib/server/supabase";
import { updateTechnician } from "@/lib/server/tech-auth";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/technicians/[id]">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    const d = authDeps();
    const body = await readJson<{ name?: string; certification?: string; active?: boolean }>(req);
    await updateTechnician(d, (await requestUserId(d, req)) ?? "", id, {
      name: typeof body.name === "string" ? body.name : undefined,
      certification: typeof body.certification === "string" ? body.certification : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
