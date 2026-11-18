"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { isInspectionLocked, useStore } from "./store";

/** Open the front-of-building reminder when a building still needs it and the person did not choose "Remind Me Later". */
export function promptExteriorIfNeeded(inspectionId: string) {
  const insp = useStore.getState().inspections.find((i) => i.id === inspectionId);
  if (insp && !useStore.getState().exitCheck(inspectionId).allowed && !insp.siteVisit.skippedExteriorPrompt) {
    useFieldUi.getState().openExterior("start");
  }
}
import { useFieldUi } from "./field-ui";

/**
 * Start or resume on-site work: makes the inspection active, opens the entry
 * workspace at the last room used, and asks for the building exterior photo
 * if one is still missing and the inspector has not chosen "Skip for Now".
 */
export function useBeginFieldWork() {
  const router = useRouter();
  return useCallback((inspectionId: string) => {
    const s = useStore.getState();
    s.startSiteVisit(inspectionId);
    const insp = useStore.getState().inspections.find((i) => i.id === inspectionId);
    const room = insp?.siteVisit.lastActiveLocationId;
    // Shared inspection with several people and nobody chosen yet: ask first, then the exterior reminder.
    if (insp && insp.organizationId !== "org-demo" && !insp.primaryThermographerId && insp.inspectorIds.length > 1 && !isInspectionLocked(insp)) {
      useFieldUi.getState().openPrimary(inspectionId);
    } else {
      promptExteriorIfNeeded(inspectionId);
    }
    router.push(`/inspections/${inspectionId}/entry${room ? `?room=${room}` : ""}`);
  }, [router]);
}
