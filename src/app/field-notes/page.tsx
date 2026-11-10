"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { FileText, Sparkles, Trash2, UploadCloud, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, PageHeader, PreviewBanner } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { useDocuments, useFacilities, useInspections } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { dropSessionFile, getSessionFile, putSessionFile } from "@/lib/session-files";
import { cn } from "@/lib/cn";

const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/tiff", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;

export default function FieldNotesPage() {
  const inspections = useInspections();
  const facilities = useFacilities();
  const documents = useDocuments().filter((d) => d.kind === "field-notes");
  const addDocument = useStore((s) => s.addDocument);
  const removeDocument = useStore((s) => s.removeDocument);
  const [inspectionId, setInspectionId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const label = (iid: string | null) => {
    const i = inspections.find((x) => x.id === iid);
    if (!i) return "Unassigned";
    return `${facilities.find((f) => f.id === i.facilityId)?.name} · ${formatDate(i.date)}`;
  };
  const sorted = useMemo(() => [...documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), [documents]);
  const current = sorted.find((d) => d.id === selected) ?? null;
  const currentFile = current ? getSessionFile(current.id) : undefined;

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    let added = 0;
    for (const file of Array.from(list)) {
      if (!ACCEPT.includes(file.type)) { toast(`${file.name}: unsupported type`, "error"); continue; }
      if (file.size > MAX_BYTES) { toast(`${file.name}: larger than 25 MB`, "error"); continue; }
      const id = addDocument({ inspectionId: inspectionId || null, kind: "field-notes", fileName: file.name, sizeBytes: file.size, mimeType: file.type, pageCount: null, extractionStatus: "unavailable" });
      putSessionFile(id, file);
      setSelected(id);
      added++;
    }
    if (added) toast(`${added} file${added === 1 ? "" : "s"} uploaded`);
    force((n) => n + 1);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); };

  return (
    <>
      <PageHeader title="Field Notes Import" description="Upload scanned handwritten inspection sheets or PDFs and review them beside the inspection." />
      <PreviewBanner title="Future feature">
        <strong>AI extraction is not connected.</strong> Uploads and preview work now. No rows are extracted and none are invented. When extraction is enabled it will keep every legitimate equipment row, mark crossed-out items for review instead of deleting them, expand known abbreviations, and flag uncertain values with a confidence score instead of guessing.
      </PreviewBanner>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Upload" />
            <CardBody className="space-y-4">
              <Field label="Attach to inspection" htmlFor="fn-insp">
                <Select id="fn-insp" value={inspectionId} onChange={(e) => setInspectionId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {inspections.map((i) => <option key={i.id} value={i.id}>{label(i.id)}</option>)}
                </Select>
              </Field>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
                className={cn("flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors", drag ? "border-thermal-400 bg-thermal-50" : "border-slate-300 bg-slate-50")}>
                <UploadCloud className="h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-800">Drop PDFs or photos of sheets</p>
                <p className="text-xs text-slate-500">PDF, JPG, PNG, HEIC, TIFF · up to 25 MB</p>
                <Button className="mt-4" onClick={() => inputRef.current?.click()}>Choose files</Button>
                <input ref={inputRef} type="file" multiple accept={ACCEPT.join(",")} className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              </div>
              <p className="text-xs text-slate-500">Prototype: file contents stay in this browser tab only and disappear on reload. Only the file name and size are saved. Do not upload real customer sheets to this demo.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Documents" description={`${sorted.length} uploaded`} />
            {sorted.length === 0 ? <EmptyState icon={<FileText className="h-5 w-5" />} title="No field notes yet" /> : (
              <ul className="divide-y divide-slate-100">
                {sorted.map((d) => (
                  <li key={d.id} className={cn("flex items-center gap-3 px-4 py-2.5", selected === d.id && "bg-thermal-50/60")}>
                    <button onClick={() => setSelected(d.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{d.fileName}</span>
                        <span className="block truncate text-xs text-slate-500">{label(d.inspectionId)} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.uploadedAt)}</span>
                      </span>
                    </button>
                    <Button size="icon" variant="ghost" aria-label="Remove document" onClick={() => { removeDocument(d.id); dropSessionFile(d.id); if (selected === d.id) setSelected(null); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={current ? current.fileName : "Preview"}
              actions={current?.inspectionId ? <Link href={`/inspections/${current.inspectionId}/entry`} target="_blank"><Button size="sm"><ExternalLink className="h-3.5 w-3.5" />Open entry in new tab</Button></Link> : null} />
            {!current ? <EmptyState title="Select a document" description="Preview a sheet here while you transcribe it in Equipment Entry." /> :
              !currentFile ? <EmptyState title="File not in this session" description="Only metadata was saved. Re-upload the file to preview it." /> :
              current.mimeType === "application/pdf" ? <iframe title={current.fileName} src={currentFile.url} className="h-[70vh] w-full bg-slate-100" /> :
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentFile.url} alt={current.fileName} className="max-h-[70vh] w-full bg-slate-100 object-contain" />}
          </Card>
          <Card>
            <CardHeader title="Extraction review" actions={<Badge tone="violet"><Sparkles className="h-3 w-3" />Not connected</Badge>} />
            <CardBody className="space-y-3 text-sm text-slate-600">
              <p>Extracted rows will appear here for line by line approval before anything reaches the inspection. Planned review columns:</p>
              <div className="flex flex-wrap gap-1.5">
                {["Source page & line", "Equipment", "Component", "IR #", "Visual #", "Distance", "Opened", "Crossed out?", "Abbreviation expanded", "Confidence", "Reviewer decision"].map((c) => <Badge key={c}>{c}</Badge>)}
              </div>
              <Button disabled title="Available when the extraction service is connected"><Sparkles className="h-4 w-4" />Run extraction (not connected)</Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
