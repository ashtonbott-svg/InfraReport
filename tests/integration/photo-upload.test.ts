/**
 * Cloud photographs (migration 9): upload engine against real Supabase Storage, server verification,
 * interrupted uploads, integrity, permissions and original-file preservation.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { POST as verifyRoute } from "@/app/api/photos/verify/route";
import { sha256Hex, storagePathFor, UploadEngine, type QueueStore, type UploadItem } from "@/lib/photos/upload-engine";
import { PUB, run, SECRET, setupTwoPhones, sql, URL as SB_URL, type Phone } from "./helpers";

const BUCKET = "inspection-photos";

function memoryStore(): QueueStore & { files: Map<string, Blob>; items: Map<string, UploadItem> } {
  const items = new Map<string, UploadItem>(), files = new Map<string, Blob>();
  return {
    items, files,
    list: async () => [...items.values()].map((i) => ({ ...i })),
    put: async (i, f) => { items.set(i.id, { ...i }); if (f) files.set(i.id, f); },
    file: async (id) => files.get(id),
    release: async (id) => { files.delete(id); },
    remove: async (id) => { items.delete(id); files.delete(id); },
  };
}

run("Cloud photographs (real Supabase Storage, two accounts)", () => {
  let ashton: Phone, justice: Phone, org = "", inspJ = "", inspOther = "", facId = "";
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB_URL; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = PUB; process.env.SUPABASE_SECRET_KEY = SECRET;
    process.env.INFRAREPORT_PIN_PEPPER ??= "test-pepper-0123456789-0123456789-abcdef";
    ({ ashton, justice, org } = await setupTwoPhones());
    const cust = ashton.s.createCustomer({ name: "Photo Co", contactName: "", contactEmail: "", contactPhone: "", notes: "" });
    facId = ashton.s.createFacility({ customerId: cust, name: "Photo Plant", address: "", city: "", state: "", postalCode: "", notes: "" });
    inspJ = ashton.s.createInspection({ customerId: cust, facilityId: facId, date: "2026-11-25", inspectorIds: [ashton.userId, justice.userId], carryForward: false });
    inspOther = ashton.s.createInspection({ customerId: cust, facilityId: facId, date: "2026-11-26", inspectorIds: [ashton.userId], carryForward: false });
    await ashton.sync(); await justice.sync();
  }, 60_000);

  const token = async (p: Phone) => (await p.sb.auth.getSession()).data.session!.access_token;
  const verifyAs = (p: Phone) => async (i: UploadItem) => {
    const res = await verifyRoute(new Request("http://x/api/photos/verify", { method: "POST", headers: { authorization: `Bearer ${await token(p)}`, "content-type": "application/json" }, body: JSON.stringify({ id: i.id }) }));
    return (await res.json()) as { verified: boolean; error?: string };
  };
  /** Engine with real storage; hooks let a test break the connection or corrupt the upload. */
  function engineFor(p: Phone, hooks: { failPutTimes?: number; loseAnswerOnce?: boolean; corrupt?: boolean } = {}) {
    const store = memoryStore();
    let fails = hooks.failPutTimes ?? 0, lose = !!hooks.loseAnswerOnce;
    const e = new UploadEngine({
      store,
      insertRow: async (i) => {
        const { error } = await p.sb.from("photo_files").insert({ id: i.id, organization_id: i.organizationId, inspection_id: i.inspectionId, facility_id: i.facilityId, kind: i.kind, building: i.building, image_number: i.imageNumber, original_name: i.name, mime_type: i.mime, size_bytes: i.size, sha256: i.sha256, storage_path: i.storagePath, metadata: {} });
        if (!error) return "ok";
        if (error.code === "23505") return "exists";
        throw Object.assign(new Error(error.message), { permanent: error.code === "42501" });
      },
      putObject: async (i, f, onProgress) => {
        if (fails > 0) { fails--; throw new Error("Connection lost during upload."); }
        const body = hooks.corrupt ? new Blob([await f.arrayBuffer(), new Uint8Array([1])]) : f;
        const { error } = await p.sb.storage.from(BUCKET).upload(i.storagePath, body, { upsert: false, contentType: i.mime });
        if (error && /exists|Duplicate/i.test(error.message)) return "exists";
        if (error) throw new Error(error.message);
        onProgress(1);
        if (lose) { lose = false; throw new Error("Connection lost before the answer arrived."); }
        return "ok";
      },
      markUploaded: async (i) => { await p.sb.from("photo_files").update({ uploaded_at: new Date().toISOString() }).eq("id", i.id); },
      verify: verifyAs(p),
      now: () => clock,
    });
    let clock = Date.now();
    return { e, store, advance: (ms: number) => { clock += ms; } };
  }
  const file = (name: string, bytes = randomBytes(200_000)) => ({ name, blob: new Blob([bytes], { type: "image/jpeg" }), sha: createHash("sha256").update(bytes).digest("hex") });
  const add = async (eng: UploadEngine, p: Phone, insp: string, f: ReturnType<typeof file>, kind: UploadItem["kind"] = "ir") => {
    const id = `pf-${Math.random().toString(36).slice(2)}`;
    await eng.add({ id, organizationId: org, inspectionId: insp, facilityId: facId, kind, building: "", name: f.name, mime: "image/jpeg", size: f.blob.size, sha256: await sha256Hex(f.blob), imageNumber: "51", meta: null, capturedAt: null, storagePath: storagePathFor(org, insp, id, f.name) }, f.blob);
    return id;
  };
  const row = async (id: string) => (await sql("select verified_at, verify_error, sha256, size_bytes, storage_path, created_by from public.photo_files where id = $1", [id]))[0];

  it("a technician uploads originals; the server verifies them; the stored bytes are identical", async () => {
    const { e, store } = engineFor(justice);
    const f = file("HM_00051.jpg");
    const id = await add(e, justice, inspJ, f);
    await e.run();
    expect(store.items.get(id)).toMatchObject({ state: "done", progress: 1, error: null });
    expect(store.files.has(id)).toBe(false); // released only after verification
    const r = await row(id);
    expect(r.verified_at).not.toBeNull();
    expect(r.sha256).toBe(f.sha);
    const back = await ashton.sb.storage.from(BUCKET).download(r.storage_path); // administrator reads the technician's upload
    expect(createHash("sha256").update(Buffer.from(await back.data!.arrayBuffer())).digest("hex")).toBe(f.sha);
  });

  it("interrupted connections: retried with waits; an upload whose answer was lost is not duplicated", async () => {
    const { e, store, advance } = engineFor(justice, { failPutTimes: 2 });
    const id = await add(e, justice, inspJ, file("HM_00052.jpg"));
    await e.run();
    expect(store.items.get(id)).toMatchObject({ state: "queued", attempts: 1 });
    expect(store.items.get(id)!.error).toMatch(/Connection lost/);
    expect(store.files.has(id)).toBe(true); // original kept for the retry
    advance(3_000); await e.run(); advance(6_000); await e.run();
    expect(store.items.get(id)!.state).toBe("done");
    const lost = engineFor(justice, { loseAnswerOnce: true });
    const id2 = await add(lost.e, justice, inspJ, file("HM_00053.jpg"));
    await lost.e.run(); lost.advance(3_000); await lost.e.run();
    expect(lost.store.items.get(id2)!.state).toBe("done");
    expect((await sql("select count(*)::int n from storage.objects where name like $1", [`%/${id2}/%`]))[0].n).toBe(1);
  });

  it("a damaged upload is never treated as stored; the original stays on the device", async () => {
    const { e, store } = engineFor(justice, { corrupt: true });
    const id = await add(e, justice, inspJ, file("HM_00054.jpg"));
    await e.run();
    const r = await row(id);
    expect(r.verified_at).toBeNull();
    expect(r.verify_error).toMatch(/differs/);
    expect(store.items.get(id)!.state).not.toBe("done");
    expect(store.files.has(id)).toBe(true);
  });

  it("permissions: only the assigned inspection; no self-verification, no overwrite, no technician deletes", async () => {
    // Not assigned to inspOther: cannot record, upload or read.
    const { e, store } = engineFor(justice);
    const id = await add(e, justice, inspOther, file("HM_00060.jpg"));
    await e.run();
    expect(store.items.get(id)!.state).toBe("failed");
    expect(store.items.get(id)!.error).toMatch(/row-level security|not allowed|organization mismatch/i);
    const sneaky = await justice.sb.storage.from(BUCKET).upload(`${org}/${inspOther}/x/HM.jpg`, new Blob([new Uint8Array([1, 2, 3])]));
    expect(sneaky.error).not.toBeNull();
    // Admin uploads to inspOther; the technician cannot see it.
    const a = engineFor(ashton);
    const aid = await add(a.e, ashton, inspOther, file("HM_00061.jpg"));
    await a.e.run();
    expect(a.store.items.get(aid)!.state).toBe("done");
    expect((await justice.sb.from("photo_files").select("id").eq("id", aid)).data).toEqual([]);
    const path = (await row(aid)).storage_path;
    expect((await justice.sb.storage.from(BUCKET).download(path)).error).not.toBeNull();
    expect((await verifyAs(justice)({ id: aid } as UploadItem)).error).toMatch(/not found or not allowed/);
    // Claiming verification or swapping the file is ignored for signed-in users.
    const mine = (await sql("select id from public.photo_files where created_by = $1 and verified_at is null limit 1", [justice.userId]))[0].id;
    await justice.sb.from("photo_files").update({ verified_at: new Date().toISOString(), sha256: "0".repeat(64) }).eq("id", mine);
    expect((await row(mine)).verified_at).toBeNull();
    expect((await row(mine)).sha256).not.toBe("0".repeat(64));
    // Stored originals cannot be overwritten, and technicians cannot delete them.
    const first = (await sql("select storage_path from public.photo_files where created_by = $1 and verified_at is not null limit 1", [justice.userId]))[0].storage_path;
    expect((await justice.sb.storage.from(BUCKET).upload(first, new Blob([new Uint8Array([9])]), { upsert: true })).error).not.toBeNull();
    await justice.sb.storage.from(BUCKET).remove([first]);
    expect((await sql("select count(*)::int n from storage.objects where name = $1", [first]))[0].n).toBe(1);
  });
});
