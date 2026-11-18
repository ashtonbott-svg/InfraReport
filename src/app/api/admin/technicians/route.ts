import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, authDeps, errorResponse, readJson, requestUserId } from "@/lib/server/supabase";
import { createTechnician, listTechnicians } from "@/lib/server/tech-auth";

export async function GET(req: NextRequest) {
  try {
    const d = authDeps();
    return NextResponse.json({ people: await listTechnicians(d, (await requestUserId(d, req)) ?? "") }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const d = authDeps();
    const actor = await requestUserId(d, req);
    const body = await readJson<{ name?: string; certification?: string }>(req);
    const id = await createTechnician(d, actor ?? "", { name: String(body.name ?? ""), certification: String(body.certification ?? "") });
    return NextResponse.json({ userId: id });
  } catch (e) {
    return errorResponse(e);
  }
}
