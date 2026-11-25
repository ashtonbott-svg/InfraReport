"use client";

import { CheckCircle2, CloudUpload, AlertTriangle } from "lucide-react";
import { useUploads } from "@/lib/photos/cloud-upload";
import type { Photo } from "@/lib/domain/types";

/** Where a photo is: on this phone only, uploading (with progress), or verified in cloud storage. */
export function CloudPhotoStatus({ photo }: { photo: Photo }) {
  const item = useUploads((s) => s.items.find((i) => i.id === photo.cloudFileId));
  if (!photo.cloudFileId) return null;
  if (!item) return <span className="text-[11px] text-slate-500">Saved on this phone</span>;
  if (item.state === "done") return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700" data-testid="cloud-stored"><CheckCircle2 className="h-3 w-3" />Stored in the cloud</span>;
  if (item.state === "failed") return <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700" title={item.error ?? ""}><AlertTriangle className="h-3 w-3" />Not uploaded yet</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] text-slate-600" data-testid="cloud-uploading"><CloudUpload className="h-3 w-3" />{item.state === "verifying" ? "Checking stored copy" : `Uploading ${Math.round(item.progress * 100)}%`}{item.error ? " (will retry)" : ""}</span>;
}
