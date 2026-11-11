"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "./store";
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
    if (insp && !useStore.getState().exitCheck(inspectionId).allowed && !insp.siteVisit.skippedExteriorPrompt) {
      useFieldUi.getState().openExterior("start");
    }
    router.push(`/inspections/${inspectionId}/entry${room ? `?room=${room}` : ""}`);
  }, [router]);
}
