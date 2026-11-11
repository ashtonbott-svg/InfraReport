import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deletePhotoBlob, getPhotoBlob, savePhotoBlob } from "@/lib/photos/photo-db";
import { useStore } from "@/lib/store/store";
import { useSaveStatus, trackedLocalStorage } from "@/lib/store/save-status";

const S = () => useStore.getState();

describe("IndexedDB photo storage", () => {
  it("saves, verifies, reads back and deletes a binary", async () => {
    const blob = new Blob([new Uint8Array(250_000)], { type: "image/jpeg" });
    const rec = await savePhotoBlob("x1", blob, null);
    expect(rec.blob.size).toBe(250_000);
    expect((await getPhotoBlob("x1"))?.blob.size).toBe(250_000);
    await deletePhotoBlob("x1");
    expect(await getPhotoBlob("x1")).toBeUndefined();
  });
});

describe("persistPhoto", () => {
  beforeEach(() => { S().resetDemoData(); vi.restoreAllMocks(); });

  it("creates the photo record only after the binary is stored", async () => {
    const { persistPhoto } = await import("@/lib/photos/capture");
    const file = new File([new Uint8Array(1234)], "front.jpg", { type: "image/jpeg" });
    const id = await persistPhoto(file, { inspectionId: "insp-2", facilityId: "fac-1", kind: "exterior", building: "Building A", resultId: null });
    const rec = S().photos.find((p) => p.id === id)!;
    expect(rec.sizeBytes).toBe(1234);
    expect((await getPhotoBlob(id))?.blob.size).toBe(1234);
    expect(S().exitCheck("insp-2").missing).not.toContain("Building A");
  });

  it("creates no record when the binary cannot be saved", async () => {
    const db = await import("@/lib/photos/photo-db");
    vi.spyOn(db, "savePhotoBlob").mockRejectedValueOnce(new Error("Storage full"));
    const { persistPhoto } = await import("@/lib/photos/capture");
    const before = S().photos.length;
    const file = new File([new Uint8Array(10)], "front.jpg", { type: "image/jpeg" });
    await expect(persistPhoto(file, { inspectionId: "insp-2", facilityId: "fac-1", kind: "exterior", building: "", resultId: null })).rejects.toThrow("Storage full");
    expect(S().photos.length).toBe(before);
    expect(useSaveStatus.getState().photoError).toBe("Storage full");
  });

  it("rejects non-image files", async () => {
    const { persistPhoto } = await import("@/lib/photos/capture");
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(persistPhoto(file, { inspectionId: "insp-2", facilityId: "fac-1", kind: "exterior", building: "", resultId: null })).rejects.toThrow();
  });
});

describe("save status", () => {
  it("records successful writes and surfaces quota failures", () => {
    const store = new Map<string, string>();
    let full = false;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { if (full) { const e = new Error("exceeded"); e.name = "QuotaExceededError"; throw e; } store.set(k, v); },
      removeItem: (k: string) => store.delete(k),
    });
    trackedLocalStorage.setItem("k", "v");
    expect(useSaveStatus.getState().error).toBeNull();
    expect(useSaveStatus.getState().lastSavedAt).not.toBeNull();
    full = true;
    trackedLocalStorage.setItem("k", "v2");
    expect(useSaveStatus.getState().error).toMatch(/full/i);
    vi.unstubAllGlobals();
  });
});
