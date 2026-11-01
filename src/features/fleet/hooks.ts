"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import type { TruckListFilters } from "@/types/fleet-truck";

/**
 * Truck registry keys, namespaced by organization like every other key. A
 * truck mutation invalidates `fleetKeys.all(org)`.
 */
export const fleetKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "trucks"] as const,
  list: (organizationId: string, filters: TruckListFilters) =>
    [...orgKey(organizationId), "trucks", "list", filters] as const,
  detail: (organizationId: string, truckId: string) =>
    [...orgKey(organizationId), "trucks", "detail", truckId] as const,
};

export function useTrucks(filters: TruckListFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? fleetKeys.list(ctx.organizationId, filters) : ["trucks", "no-context"],
    queryFn: () => services.trucks.list(ctx!, filters),
    enabled: Boolean(ctx),
    placeholderData: keepPreviousData,
  });
}

export function useTruck(truckId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? fleetKeys.detail(ctx.organizationId, truckId) : ["trucks", "no-context"],
    queryFn: () => services.trucks.get(ctx!, truckId),
    enabled: Boolean(ctx) && Boolean(truckId),
  });
}
