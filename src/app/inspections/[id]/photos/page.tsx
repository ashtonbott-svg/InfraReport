"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Camera, CheckCircle2, Download, FolderUp, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { InspectionHeader } from "@/components/inspection/inspection-header";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useRole } from "@/lib/cloud/role";
import { useCustomers, useFacilities, useInspectionBundle } from "@/lib/store/hooks";
import { clearFinishedUploads, queuePhotos, retryUploads, signedPhotoUrl, uploadEngine, useUploads } from "@/lib/photos/cloud-upload";
import { buildPhotoZip, listPhotoFiles, matchEntries, matchInspectionPhotos, setExcluded, setManualMatch, type PhotoFile } from "@/lib/photos/photo-files";
import type { PhotoRole } from "@/lib/photos/match";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const STATE_TEXT = { queued: "Waiting", uploading: "Uploading", verifying: "Checking stored copy", done: "Stored and verified", failed: "Not stored" } as const;

export default function InspectionPhotosPage() {
  const { id } = useParams<{ id: string }>();
  const bundle = useInspectionBundle(id);
  const facility = useFacilities().find((f) => f.id === bundle?.dataset.inspection.facilityId);
  const customer = useCustomers().find((c) => c.id === bundle?.dataset.inspection.customerId);
  const { cloud, isAdmin } = useRole();
  const uploads = useUploads((s) => s.items).filter((u) => u.inspectionId === id);
  const [files, setFiles] = useState<PhotoFile[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [zipping, setZipping] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const camRef = useRef<HTMLInputElement>(null), pickRef = useRef<HTMLInputElement>(null), extRef = useRef<HTMLInputElement>(null);
  const [building, setBuilding] = useState("");
  const doneCount = uploads.filter((u) => u.state === "done").length;

  const refresh = useCallback(async () => {
    try { setFiles(await listPhotoFiles(id)); } catch (e) { toast((e as Error).message, "error"); }
  }, [id]);
  useEffect(() => { uploadEngine(); }, []);
  useEffect(() => { let live = true; listPhotoFiles(id).then((f) => { if (live) setFiles(f); }, () => undefined); return () => { live = false; }; }, [id, doneCount]);

  const report = useMemo(() => (bundle && files ? matchInspectionPhotos(bundle.dataset, files) : null), [bundle, files]);
  const entries = useMemo(() => (bundle ? matchEntries(bundle.dataset) : []), [bundle]);
  const byId = useMemo(() => new Map((files ?? []).map((f) => [f.id, f])), [files]);
  const review = report ? [...report.unmatched.map((u) => ({ id: u.photoId, why: u.reason })), ...report.conflicts.flatMap((c) => c.photoIds.map((p) => ({ id: p, why: `${c.photoIds.length} files are ${c.role === "ir" ? "IR" : "visual"} image ${c.number}. Choose the right one.` }))),
    ...report.ambiguous.flatMap((a) => a.photoIds.map((p) => ({ id: p, why: `Image number ${a.number} was recorded on ${a.imageIds.length} entries. Choose the entry.` }))), ...report.duplicates.map((d) => ({ id: d.photoId, why: `Same file as ${byId.get(d.sameAs)?.original_name ?? "another upload"}` }))] : [];
  const reviewIds = review.map((r) => r.id).join("|");
  useEffect(() => {
    if (!files) return;
    let live = true;
    const want = files.filter((f) => f.kind === "exterior" || reviewIds.includes(f.id)).filter((f) => !thumbs[f.id]);
    Promise.all(want.map(async (f) => [f.id, await signedPhotoUrl(f.storage_path, 3600)] as const)).then((pairs) => {
      if (live && pairs.length) setThumbs((t) => ({ ...t, ...Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p[1])) }));
    }, () => undefined);
    return () => { live = false; };
  }, [files, reviewIds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!bundle) return <EmptyState title="Inspection not found" />;
  const insp = bundle.dataset.inspection;
  if (!cloud) return <><InspectionHeader inspection={insp} errorCount={0} /><EmptyState title="Photographs are stored in the cloud" description="Sign in to upload and review inspection photographs." /></>;

  const add = async (list: FileList | File[] | null, exteriorOf?: string) => {
    const arr = [...(list ?? [])];
    if (!arr.length) return;
    try {
      await queuePhotos(arr, { organizationId: insp.organizationId, inspectionId: insp.id, facilityId: insp.facilityId, ...(exteriorOf !== undefined ? { kind: "exterior" as const, building: exteriorOf } : {}) });
      toast(`${arr.length} photograph${arr.length === 1 ? "" : "s"} added to the upload queue`);
    } catch (e) { toast((e as Error).message, "error"); }
  };
  const assign = async (f: PhotoFile, value: string) => {
    try {
      if (value === "__auto") await setManualMatch(f.id, null);
      else if (value === "__exclude") await setExcluded(f, true);
      else { const [imageId, role] = value.split("|"); const e = entries.find((x) => x.imageId === imageId)!; await setManualMatch(f.id, { resultId: e.resultId, imageId, role: role as PhotoRole }); }
      await refresh();
    } catch (e) { toast((e as Error).message, "error"); }
  };
  const zip = async () => {
    if (!files) return;
    setZipping("Preparing…");
    try {
      const z = await buildPhotoZip(bundle.dataset, files, { customer: customer?.name ?? "Customer", facility: facility?.name ?? "Facility" }, (d, t) => setZipping(`Adding ${d} of ${t}…`));
      const a = document.createElement("a"); a.href = URL.createObjectURL(z.blob); a.download = z.fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      toast(`ZIP ready: ${z.included} photograph${z.included === 1 ? "" : "s"}${z.skipped ? `, ${z.skipped} not included (see manifest)` : ""}`);
    } catch (e) { toast((e as Error).message, "error"); }
    setZipping(null);
  };

  const stored = files ?? [];
  const verified = stored.filter((f) => f.verified_at).length;
  const exterior = stored.filter((f) => f.kind === "exterior");
  const equipmentPhotos = stored.filter((f) => f.kind === "equipment" || f.kind === "before-opening");
  const matchedByImage = new Map<string, { ir?: PhotoFile; visual?: PhotoFile; source: string }>();
  for (const a of report?.assignments ?? []) {
    const cur = matchedByImage.get(a.imageId) ?? { source: a.source };
    cur[a.role] = byId.get(a.photoId);
    if (a.source === "manual") cur.source = "manual";
    matchedByImage.set(a.imageId, cur);
  }
  const pending = uploads.filter((u) => u.state !== "done");
  const option = (f: PhotoFile) => (
    <select aria-label={`Match for ${f.original_name}`} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-base" defaultValue="" onChange={(e) => void assign(f, e.target.value)} data-testid="assign-select">
      <option value="" disabled>Assign to…</option>
      {entries.map((e) => (["ir", "visual"] as const).map((r) => <option key={`${e.imageId}|${r}`} value={`${e.imageId}|${r}`}>{e.label} · {r === "ir" ? `IR ${e.irNumber || "?"}` : `Visual ${e.visualNumber || "?"}`}</option>))}
      <option value="__exclude">Not used for this inspection</option>
      {f.match_source === "manual" ? <option value="__auto">Back to automatic matching</option> : null}
    </select>
  );

  return (
    <>
      <InspectionHeader inspection={insp} errorCount={0} />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Add photographs" description="Infrared, visual and building photographs. Originals are stored unchanged and matched by their image numbers." />
          <CardBody>
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files); }}
              className={cn("flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center", drag ? "border-thermal-400 bg-thermal-50" : "border-slate-200")} data-testid="photo-drop">
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" className="h-12" onClick={() => pickRef.current?.click()}><FolderUp className="h-5 w-5" />Choose Photographs</Button>
                <Button className="h-12" onClick={() => camRef.current?.click()}><Camera className="h-5 w-5" />Take Photo</Button>
                <Button className="h-12" onClick={() => extRef.current?.click()}><Building2 className="h-5 w-5" />Add Building Photo</Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">Building for building photos
                <input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="Main building" className="h-9 w-44 rounded-lg border border-slate-300 px-2 text-base" data-testid="exterior-building" /></label>
              <input ref={extRef} type="file" multiple accept="image/*,.jpg,.jpeg,.png,.heic,.heif" className="hidden" data-testid="exterior-input" onChange={(e) => { void add(e.target.files, building.trim()); e.target.value = ""; }} />
              <p className="text-sm text-slate-500">Select many at once (for example the camera&apos;s whole folder), or drag them here on a computer.</p>
              <input ref={pickRef} type="file" multiple accept="image/*,.jpg,.jpeg,.png,.heic,.heif,.tif,.tiff,.irg" className="hidden" data-testid="photo-input" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
              <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
            </div>
            {uploads.length ? (
              <div className="mt-4" data-testid="upload-list">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>{pending.length ? `${pending.length} waiting or uploading` : "All uploads stored and verified"}{uploads.some((u) => u.state === "failed") ? ` · ${uploads.filter((u) => u.state === "failed").length} not stored` : ""}</span>
                  <span className="flex gap-2">
                    {uploads.some((u) => u.state === "failed" || u.state === "queued") ? <Button size="sm" onClick={() => void retryUploads()}><RotateCcw className="h-3.5 w-3.5" />Retry</Button> : null}
                    {doneCount ? <Button size="sm" variant="ghost" onClick={() => void clearFinishedUploads()}>Clear finished</Button> : null}
                  </span>
                </div>
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {uploads.sort((a, b) => a.createdAt - b.createdAt).map((u) => (
                    <li key={u.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm" data-testid="upload-item" data-state={u.state}>
                      <div className="flex justify-between gap-2"><span className="truncate font-medium">{u.name}</span><span className={cn("shrink-0", u.state === "done" ? "text-emerald-700" : u.state === "failed" ? "text-red-700" : "text-slate-500")}>{u.state === "done" ? <CheckCircle2 className="inline h-4 w-4" /> : null} {STATE_TEXT[u.state]}</span></div>
                      {u.state !== "done" ? <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-thermal-500" style={{ width: `${Math.round((u.state === "verifying" ? 1 : u.progress) * 100)}%` }} /></div> : null}
                      {u.error && u.state !== "done" ? <div className="mt-1 text-xs text-red-700">{u.error}</div> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Stored photographs" description={files === null ? "Loading…" : `${stored.length} stored · ${verified} verified · ${report?.assignments.length ?? 0} matched to entries · ${report?.missing.length ?? 0} missing · ${review.length} to review`}
            actions={isAdmin ? <Button onClick={() => void zip()} disabled={!!zipping || !stored.length} data-testid="zip-photos"><Download className="h-4 w-4" />{zipping ?? "Download All Photographs"}</Button> : null} />
          <CardBody className="space-y-5">
            {review.length ? (
              <section data-testid="photo-review">
                <h3 className="mb-2 font-semibold text-amber-900">Needs review ({review.length})</h3>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {review.map((r) => { const f = byId.get(r.id)!; return (
                    <li key={r.id} className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2" data-testid="review-item">
                      {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" className="h-20 w-24 shrink-0 rounded object-cover" loading="lazy" /> : <div className="h-20 w-24 shrink-0 rounded bg-slate-200" />}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="truncate text-sm font-medium">{f.original_name}</div>
                        <div className="text-xs text-amber-900">{r.why}</div>
                        {option(f)}
                      </div>
                    </li>
                  ); })}
                </ul>
              </section>
            ) : null}
            {report?.missing.length ? (
              <section data-testid="photo-missing">
                <h3 className="mb-2 font-semibold text-slate-900">Missing photographs ({report.missing.length})</h3>
                <ul className="grid gap-x-4 text-sm sm:grid-cols-2">{report.missing.map((m) => <li key={`${m.imageId}${m.role}`} className="border-b border-slate-100 py-1">{m.label} <span className="text-slate-500">· {m.role === "ir" ? "IR" : "visual"} {m.number}</span></li>)}</ul>
              </section>
            ) : null}
            <section>
              <h3 className="mb-2 font-semibold text-slate-900">Building exterior ({exterior.length})</h3>
              {exterior.length ? <ul className="flex flex-wrap gap-3">{exterior.map((f) => <li key={f.id} className="w-40 text-xs">{thumbs[f.id] ? <img src={thumbs[f.id]} alt="" className="h-28 w-40 rounded object-cover" /> : <div className="h-28 w-40 rounded bg-slate-100" />}<div className="mt-1 truncate">{f.building || "Main building"} {f.verified_at ? "· verified" : "· not verified yet"}</div></li>)}</ul> : <p className="text-sm text-slate-500">No building photograph stored yet. Take it from Field Mode (Exterior) or use Add Building Photo above.</p>}
            </section>
            <section data-testid="photo-matched">
              <h3 className="mb-2 font-semibold text-slate-900">Matched to entries ({matchedByImage.size} entries)</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Entry</th><th>Infrared</th><th>Visual</th><th /></tr></thead>
                <tbody>{entries.filter((e) => matchedByImage.has(e.imageId)).map((e) => { const m = matchedByImage.get(e.imageId)!; return (
                  <tr key={e.imageId} className="border-t border-slate-100"><td className="py-1 pr-2">{e.label}</td><td className="pr-2">{m.ir?.original_name ?? <span className="text-amber-700">missing</span>}</td><td className="pr-2">{m.visual?.original_name ?? <span className="text-amber-700">missing</span>}</td><td className="text-xs text-slate-400">{m.source === "manual" ? "chosen" : "auto"}</td></tr>
                ); })}</tbody>
              </table>
            </section>
            {equipmentPhotos.length ? <section><h3 className="mb-1 font-semibold text-slate-900">Equipment and before-opening photos ({equipmentPhotos.length})</h3><p className="text-sm text-slate-500">{equipmentPhotos.map((f) => f.original_name).join(", ")}</p></section> : null}
            {!stored.length && files !== null ? <p className="text-sm text-slate-500"><Upload className="mr-1 inline h-4 w-4" />No photographs stored for this inspection yet ({mb(0)}).</p> : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
