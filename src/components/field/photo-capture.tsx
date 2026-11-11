"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImageUp, Loader2, RotateCcw, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Camera-first photo picker. "Take Photo" opens the rear camera on phones and
 * tablets (capture="environment"); "Upload" opens the photo library / files.
 * Shows a preview with Retake before anything is saved.
 */
export function PhotoCapture({ onSave, takeLabel = "Take Photo", compact, autoOpen, onCancel }: {
  onSave: (file: File) => Promise<void>; takeLabel?: string; compact?: boolean; autoOpen?: boolean; onCancel?: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { if (autoOpen) cameraRef.current?.click(); }, [autoOpen]);

  const pick = (f: File | undefined | null) => { if (f) { setError(null); setFile(f); } };
  const save = async () => {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(file);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const inputs = (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" data-testid="camera-input"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" data-testid="upload-input"
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );

  if (file) {
    return (
      <div className="space-y-3">
        {inputs}
        <div className="overflow-hidden rounded-xl bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Photo preview" className="mx-auto max-h-[45dvh] w-full object-contain" /> : <div className="h-48" />}
        </div>
        {error ? <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-12 justify-center text-base" onClick={() => cameraRef.current?.click()} disabled={saving}><RotateCcw className="h-5 w-5" />Retake</Button>
          <Button size="lg" variant="primary" className="h-12 justify-center text-base" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}{saving ? "Saving…" : "Save Photo"}
          </Button>
        </div>
        <button className="w-full py-1 text-sm text-slate-500 hover:text-slate-800" onClick={() => { setFile(null); onCancel?.(); }} disabled={saving}>Discard</button>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1")}>
      {inputs}
      <Button size="lg" variant="primary" className={cn("justify-center text-base", compact ? "h-11" : "h-14")} onClick={() => cameraRef.current?.click()}>
        <Camera className="h-5 w-5" />{takeLabel}
      </Button>
      <Button size="lg" className={cn("justify-center text-base", compact ? "h-11" : "h-12")} onClick={() => uploadRef.current?.click()}>
        <ImageUp className="h-5 w-5" />Upload from device
      </Button>
    </div>
  );
}
