"use client";

import { useSyncExternalStore } from "react";

/**
 * Tracks the visual viewport so bottom sheets and action bars sit above the
 * on-screen keyboard (iOS Safari keeps fixed elements behind it otherwise).
 */
interface VV { height: number; keyboard: number }
let snapshot: VV = { height: 0, keyboard: 0 };

function read(): VV {
  if (typeof window === "undefined") return snapshot;
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const keyboard = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  if (height !== snapshot.height || keyboard !== snapshot.keyboard) snapshot = { height, keyboard };
  return snapshot;
}

function subscribe(cb: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", cb);
  vv?.addEventListener("scroll", cb);
  window.addEventListener("resize", cb);
  return () => {
    vv?.removeEventListener("resize", cb);
    vv?.removeEventListener("scroll", cb);
    window.removeEventListener("resize", cb);
  };
}

export function useVisualViewport(): VV {
  return useSyncExternalStore(subscribe, read, () => snapshot);
}

/** True when the on-screen keyboard is likely open. */
export function useKeyboardOpen(): boolean {
  return useVisualViewport().keyboard > 120;
}
