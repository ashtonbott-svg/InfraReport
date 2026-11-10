"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore, allowedCauses } from "./store";
import type { ExportDataset } from "../domain/csv";
import { validateInspection, type ValidationIssue } from "../domain/validation";
import type { ID } from "../domain/types";

/** Tenant filter. Every list read in the UI goes through the active organization. */
function useOrgFiltered<T extends { organizationId: ID }>(items: T[]): T[] {
  const orgId = useStore((s) => s.currentOrgId);
  return useMemo(() => items.filter((i) => i.organizationId === orgId), [items, orgId]);
}

export const useCustomers = () => useOrgFiltered(useStore((s) => s.customers));
export const useFacilities = () => useOrgFiltered(useStore((s) => s.facilities));
export const useLocations = () => useOrgFiltered(useStore((s) => s.locations));
export const useEquipment = () => useOrgFiltered(useStore((s) => s.equipment));
export const useInspections = () => useOrgFiltered(useStore((s) => s.inspections));
export const useRooms = () => useOrgFiltered(useStore((s) => s.rooms));
export const useResults = () => useOrgFiltered(useStore((s) => s.results));
export const useImages = () => useOrgFiltered(useStore((s) => s.images));
export const useDocuments = () => useOrgFiltered(useStore((s) => s.documents));
export const useReviewEvents = () => useOrgFiltered(useStore((s) => s.reviewEvents));
export const useUsers = () => useOrgFiltered(useStore((s) => s.users));

export function useOrganization() {
  const orgs = useStore((s) => s.organizations);
  const id = useStore((s) => s.currentOrgId);
  return useMemo(() => orgs.find((o) => o.id === id), [orgs, id]);
}

export function useAllowedCauses() {
  const org = useOrganization();
  return useMemo(() => allowedCauses(org?.settings), [org]);
}

export interface InspectionBundle {
  dataset: ExportDataset;
  issues: ValidationIssue[];
}

export function useInspectionBundle(inspectionId: ID): InspectionBundle | null {
  const inspections = useInspections();
  const results = useResults();
  const equipment = useEquipment();
  const locations = useLocations();
  const rooms = useRooms();
  const causes = useAllowedCauses();
  return useMemo(() => {
    const inspection = inspections.find((i) => i.id === inspectionId);
    if (!inspection) return null;
    const dataset: ExportDataset = {
      inspection,
      results: results.filter((r) => r.inspectionId === inspectionId),
      equipment: new Map(equipment.map((e) => [e.id, e])),
      locations: new Map(locations.map((l) => [l.id, l])),
      rooms: rooms.filter((r) => r.inspectionId === inspectionId),
    };
    return { dataset, issues: validateInspection(dataset, { allowedCauses: causes }) };
  }, [inspections, results, equipment, locations, rooms, causes, inspectionId]);
}

/** Rehydrates the persisted store on the client only (avoids SSR mismatch). */
export function useHydrateStore(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const p = useStore.persist.rehydrate();
    Promise.resolve(p).finally(() => setReady(true));
  }, []);
  return ready;
}
