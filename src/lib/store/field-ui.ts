"use client";

import { create } from "zustand";

/** Transient UI state for the field workflow (not persisted). */
interface FieldUi {
  checkpointOpen: boolean;
  exteriorSheet: null | "start" | "manage";
  openCheckpoint(): void;
  closeCheckpoint(): void;
  openExterior(mode: "start" | "manage"): void;
  closeExterior(): void;
}

export const useFieldUi = create<FieldUi>((set) => ({
  checkpointOpen: false,
  exteriorSheet: null,
  openCheckpoint: () => set({ checkpointOpen: true, exteriorSheet: null }),
  closeCheckpoint: () => set({ checkpointOpen: false }),
  openExterior: (mode) => set((s) => (s.checkpointOpen ? {} : { exteriorSheet: mode })),
  closeExterior: () => set({ exteriorSheet: null }),
}));
