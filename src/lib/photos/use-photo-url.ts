"use client";

import { useEffect, useState } from "react";
import { getPhotoBlob } from "./photo-db";

/** Object URL for a stored photo (thumbnail when available). null while loading or if missing. */
export function usePhotoUrl(id: string | null | undefined, prefer: "thumb" | "full" = "thumb") {
  const [state, setState] = useState<{ id: string; url: string | null; missing: boolean } | null>(null);
  useEffect(() => {
    if (!id) return;
    let url: string | null = null;
    let cancelled = false;
    getPhotoBlob(id)
      .then((rec) => {
        if (cancelled) return;
        if (!rec) { setState({ id, url: null, missing: true }); return; }
        url = URL.createObjectURL(prefer === "thumb" && rec.thumb ? rec.thumb : rec.blob);
        setState({ id, url, missing: false });
      })
      .catch(() => !cancelled && setState({ id, url: null, missing: true }));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [id, prefer]);
  if (!id || state?.id !== id) return { url: null, missing: false };
  return { url: state.url, missing: state.missing };
}
