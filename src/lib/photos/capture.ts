"use client";

import { makeThumbnail, savePhotoBlob } from "./photo-db";
import { useStore } from "../store/store";
import { useSaveStatus } from "../store/save-status";
import type { Photo } from "../domain/types";

const uid = () => `photo-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;

/**
 * Persist a photo: write the binary to IndexedDB, verify it, and only then
 * create the metadata record. If anything fails, no record is created, so the
 * app never treats an unsaved photo as saved.
 */
export async function persistPhoto(
  file: File,
  meta: Pick<Photo, "inspectionId" | "facilityId" | "kind" | "building" | "resultId">,
): Promise<string> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) throw new Error("That file is not an image.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Photo is larger than 40 MB.");
  const status = useSaveStatus.getState();
  status.beginPhoto();
  try {
    const id = uid();
    const thumb = await makeThumbnail(file);
    await savePhotoBlob(id, file, thumb);
    useStore.getState().addPhotoRecord({
      id, ...meta, fileName: file.name || "photo.jpg", mimeType: file.type || "image/jpeg", sizeBytes: file.size,
      capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
    });
    useSaveStatus.getState().endPhoto(null);
    return id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Photo could not be saved";
    useSaveStatus.getState().endPhoto(msg);
    throw new Error(msg);
  }
}
