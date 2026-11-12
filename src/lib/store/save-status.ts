"use client";

import { create } from "zustand";
import type { StateStorage } from "zustand/middleware";

/** Tracks whether the last local write succeeded. Drives the save indicator. */
interface SaveStatus {
  lastSavedAt: number | null;
  error: string | null;
  pendingPhotoWrites: number;
  photoError: string | null;
  storageWarning: string | null;
  beginPhoto(): void;
  endPhoto(error?: string | null, warning?: string | null): void;
}

export const useSaveStatus = create<SaveStatus>((set) => ({
  lastSavedAt: null,
  error: null,
  pendingPhotoWrites: 0,
  photoError: null,
  storageWarning: null,
  beginPhoto: () => set((s) => ({ pendingPhotoWrites: s.pendingPhotoWrites + 1, photoError: null })),
  endPhoto: (error = null, warning = null) => set((s) => ({ pendingPhotoWrites: Math.max(0, s.pendingPhotoWrites - 1), photoError: error, storageWarning: warning ?? s.storageWarning })),
}));

/**
 * localStorage wrapper. Writes are synchronous, so once setItem returns the
 * data survives a crash or power loss. Quota and privacy-mode failures are
 * surfaced instead of being silently swallowed.
 */
export const trackedLocalStorage: StateStorage = {
  getItem: (name) => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
      useSaveStatus.setState({ lastSavedAt: Date.now(), error: null });
    } catch (e) {
      const msg = e instanceof Error && /quota/i.test(e.name + e.message)
        ? "Device storage is full. Recent changes were NOT saved."
        : "This browser blocked saving (private mode?). Recent changes were NOT saved.";
      useSaveStatus.setState({ error: msg });
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};
