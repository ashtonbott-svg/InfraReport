"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Flame, Image as ImageIcon, ImagePlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, PreviewBanner, Stat, Table, td, th } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { useEquipment, useFacilities, useImages, useInspections, useResults } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { formatDate } from "@/lib/format";
import { getSessionFile, putSessionFile } from "@/lib/session-files";
import { LIMITED_ACCESS_OPENED } from "@/lib/domain/constants";
import type { ImageAsset } from "@/lib/domain/types";
import { imageNumberFromFileName, kindFromFileName, normalizeImageNumber } from "@/lib/domain/images";

const norm = normalizeImageNumber;

export default function ImagesPage() {
  const inspections = useInspections();
  const facilities = useFacilities();
  const results = useResults();
  const equipment = useEquipment();
  const images = useImages();
  const upsertImages = useStore((s) => s.upsertImages);
  const clearImages = useStore((s) => s.clearImages);
  const updateImage = useStore((s) => s.updateImage);
  const [inspectionId, setInspectionId] = useState(inspections.find((i) => i.status === "In Progress")?.id ?? inspections[0]?.id ?? "");
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => results.filter((r) => r.inspectionId === inspectionId).sort((a, b) => a.sortOrder - b.sortOrder), [results, inspectionId]);
  const imgs = useMemo(() => images.filter((i) => i.inspectionId === inspectionId), [images, inspectionId]);
  const byNumber = useMemo(() => {
    const m = new Map<string, ImageAsset[]>();
    for (const i of imgs) { const k = norm(i.imageNumber); m.set(k, [...(m.get(k) ?? []), i]); }
    return m;
  }, [imgs]);

  // One line per thermal image entry.
  const lines = rows.flatMap((r) => r.images.map((img, idx) => ({ r, img, idx })));
  const referenced = new Set(lines.flatMap(({ img }) => [img.irImageNumber, img.visualImageNumber].filter(Boolean).map(norm)));
  const unmatched = imgs.filter((i) => !referenced.has(norm(i.imageNumber)));
  const missing = lines.filter(({ img }) => (img.irImageNumber && !byNumber.has(norm(img.irImageNumber))) || (img.visualImageNumber && !byNumber.has(norm(img.visualImageNumber))));
  const noNumber = rows.filter((r) => !r.images.some((i) => i.irImageNumber || i.visualImageNumber) && !LIMITED_ACCESS_OPENED.includes(r.opened) && !r.exception);

  const onFiles = (list: FileList | null) => {
    if (!list || !inspectionId) return;
    const entries = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|is2|tiff?)$/i.test(f.name));
    upsertImages(inspectionId, entries.map((f) => ({ fileName: f.name, imageNumber: imageNumberFromFileName(f.name), kind: kindFromFileName(f.name), matchedResultId: null, verified: false })));
    // keep session previews keyed by inspection + file name
    for (const f of entries) putSessionFile(`${inspectionId}:${f.name}`, f);
    toast(`${entries.length} image${entries.length === 1 ? "" : "s"} indexed`);
    force((n) => n + 1);
  };

  const thumb = (i: ImageAsset | undefined) => {
    if (!i) return null;
    const f = getSessionFile(`${inspectionId}:${i.fileName}`);
    // eslint-disable-next-line @next/next/no-img-element
    return f && f.file.type.startsWith("image/") ? <img src={f.url} alt={i.fileName} className="h-10 w-14 rounded object-cover ring-1 ring-slate-200" /> : null;
  };

  const matchCell = (num: string) => {
    if (!num) return <span className="text-slate-300">no #</span>;
    const found = byNumber.get(norm(num));
    if (!found?.length) return <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="h-3.5 w-3.5" />{num} missing</span>;
    const img = found[0];
    return (
      <span className="inline-flex items-center gap-2">
        {thumb(img)}
        <span>
          <span className="block font-mono text-xs text-slate-700">{img.fileName}</span>
          <button onClick={() => updateImage(img.id, { verified: !img.verified })} className="text-[11px] font-medium">
            {img.verified ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Verified</span> : <span className="text-thermal-700 hover:underline">Mark verified</span>}
          </button>
        </span>
      </span>
    );
  };

  return (
    <>
      <PageHeader title="Images" description="Associate thermal and visual images with individual equipment records by image number." />
      <PreviewBanner>
        Image number matching below is functional: choose image files and InfraReport reads the number from each file name and matches it to IR # and Visual # on the inspection. Image files are <strong>not uploaded or stored</strong> in this prototype; previews last for this tab only. Secure image storage, radiometric data, and automatic thermal/visual pairing are future work.
      </PreviewBanner>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="Inspection" htmlFor="img-insp" className="w-full max-w-md">
          <Select id="img-insp" value={inspectionId} onChange={(e) => setInspectionId(e.target.value)}>
            {inspections.map((i) => <option key={i.id} value={i.id}>{facilities.find((f) => f.id === i.facilityId)?.name} · {formatDate(i.date)} ({i.status})</option>)}
          </Select>
        </Field>
        <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={!inspectionId}><ImagePlus className="h-4 w-4" />Choose images</Button>
        {imgs.length ? <Button variant="ghost" onClick={() => clearImages(inspectionId)}>Clear index</Button> : null}
        <input ref={inputRef} type="file" multiple accept="image/*,.is2" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Images indexed" value={imgs.length} icon={<ImageIcon className="h-4 w-4" />} />
        <Stat label="Referenced numbers missing" value={<span className={missing.length ? "text-red-600" : ""}>{missing.length}</span>} sub="Rows whose image # has no file" />
        <Stat label="Unmatched images" value={unmatched.length} sub="Files no row references" />
        <Stat label="Rows without image #" value={noNumber.length} sub="Excludes locked out / off / inaccessible" icon={<Flame className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Equipment to image matching" actions={<Link href={`/inspections/${inspectionId}/entry`} className="text-xs font-medium text-thermal-700 hover:underline">Edit image numbers</Link>} />
          {rows.length === 0 ? <EmptyState title="No equipment rows" /> : (
            <Table>
              <thead><tr><th className={th}>Equipment</th><th className={th}>Component</th><th className={th}>Thermal (IR #)</th><th className={th}>Visual #</th></tr></thead>
              <tbody>
                {lines.map(({ r, img, idx }) => (
                  <tr key={img.id}>
                    <td className={`${td} font-medium text-slate-900`}>{idx === 0 ? equipment.find((e) => e.id === r.equipmentId)?.name : <span className="pl-3 text-xs font-normal text-slate-400">image {idx + 1}</span>}</td>
                    <td className={td}>{img.component}</td>
                    <td className={td}>{matchCell(img.irImageNumber)}</td>
                    <td className={td}>{matchCell(img.visualImageNumber)}{img.visualOverridden ? <Badge tone="amber" className="ml-2">different</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Unmatched images" />
          <CardBody>
            {unmatched.length === 0 ? <p className="text-sm text-slate-500">{imgs.length ? "Every indexed image matches a row." : "No images indexed yet."}</p> : (
              <ul className="space-y-2">
                {unmatched.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 text-sm">
                    {thumb(i)}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{i.fileName}</span>
                    <Badge tone={i.kind === "thermal" ? "orange" : i.kind === "visual" ? "blue" : "slate"}>#{i.imageNumber || "?"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
