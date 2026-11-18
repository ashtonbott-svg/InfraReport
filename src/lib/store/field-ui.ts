"use client";

import { create } from "zustand";

/** Transient UI state for the field workflow (not persisted). */
interface FieldUi {
  checkpointOpen: boolean;
  exteriorSheet: null | "start" | "manage";
  /** Ask who is the Primary Thermographer for this inspection. */
  primaryPrompt: string | null;
  openPrimary(inspectionId: string): void;
  closePrimary(): void;
  openCheckpoint(): void;
  closeCheckpoint(): void;
  openExterior(mode: "start" | "manage"): void;
  closeExterior(): void;
}

export const useFieldUi = create<FieldUi>((set) => ({
  checkpointOpen: false,
  exteriorSheet: null,
  primaryPrompt: null,
  openPrimary: (inspectionId) => set({ primaryPrompt: inspectionId }),
  closePrimary: () => set({ primaryPrompt: null }),
  openCheckpoint: () => set({ checkpointOpen: true, exteriorSheet: null }),
  closeCheckpoint: () => set({ checkpointOpen: false }),
  openExterior: (mode) => set((s) => (s.checkpointOpen ? {} : { exteriorSheet: mode })),
  closeExterior: () => set({ exteriorSheet: null }),
}));
