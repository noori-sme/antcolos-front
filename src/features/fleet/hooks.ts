"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey, queryKeys } from "@/lib/query/keys";
import { usePeopleList } from "@/lib/api/use-org-people";
import type {
  AssignTruckInput, CreateTruckInput, FleetTruck, ReplaceAssignmentInput,
  ReplaceOwnershipInput, TruckListFilters, TruckOperationalStatus, UpdateTruckInput,
} from "@/types/fleet-truck";
import type { OrgPeopleFamily } from "@/types/org-people";

/**
 * Truck registry keys, namespaced by organization like every other key. A
 * truck mutation invalidates `fleetKeys.all(org)` (list and detail), and an
 * assignment change also `queryKeys.people(org)` (people lists show trucks).
 */
export const fleetKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "trucks"] as const,
  list: (organizationId: string, filters: TruckListFilters) =>
    [...orgKey(organizationId), "trucks", "list", filters] as const,
  detail: (organizationId: string, truckId: string) =>
    [...orgKey(organizationId), "trucks", "detail", truckId] as const,
  lookup: (organizationId: string, vin: string) =>
    [...orgKey(organizationId), "trucks", "lookup", vin] as const,
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

/** §1b VIN lookup; runs only once the screen passes a complete VIN. */
export function useTruckLookup(vin: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? fleetKeys.lookup(ctx.organizationId, vin) : ["trucks", "no-context"],
    queryFn: () => services.trucks.lookupByVin(ctx!, vin),
    enabled: Boolean(ctx) && enabled,
  });
}

/** Assignee picker: one people list, searched by `q`. */
export function useAssignablePeople(family: OrgPeopleFamily, q: string, enabled = true) {
  return usePeopleList(family, { q: q || undefined, pageSize: 50 }, enabled);
}

/**
 * Shared mutation plumbing: the service context, and invalidation of the
 * truck keys (plus people when assignments change) on success.
 */
function useTruckMutation<TVars, TResult>(
  run: (ctx: NonNullable<ReturnType<typeof useServiceContext>>, vars: TVars) => Promise<TResult>,
  options: {
    invalidatesPeople?: boolean;
    onTruck?: (result: TResult) => FleetTruck | null;
    /**
     * Mark the truck keys stale without refetching the open screen: for actions
     * that leave the truck (remove from fleet, archive), whose detail may now 404.
     */
    leavesTruck?: boolean;
  } = {},
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    onSuccess: async (result) => {
      if (!ctx) return;
      const truck = options.onTruck?.(result);
      if (truck) {
        // The contract returns the full truck: show it before the refetch lands.
        queryClient.setQueryData(fleetKeys.detail(ctx.organizationId, truck.id), truck);
      }
      await queryClient.invalidateQueries({
        queryKey: fleetKeys.all(ctx.organizationId),
        refetchType: options.leavesTruck ? "none" : "active",
      });
      if (options.invalidatesPeople) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.people(ctx.organizationId) });
      }
    },
  });
}

const asTruck = (truck: FleetTruck) => truck;

export function useCreateTruck() {
  return useTruckMutation(
    (ctx, vars: { input: CreateTruckInput; idempotencyKey: string }) =>
      services.trucks.create(ctx, vars.input, vars.idempotencyKey),
    { onTruck: asTruck },
  );
}

export function useUpdateTruck(truckId: string) {
  return useTruckMutation(
    (ctx, input: UpdateTruckInput) => services.trucks.update(ctx, truckId, input),
    { onTruck: asTruck },
  );
}

export function useArchiveTruck(truckId: string) {
  return useTruckMutation((ctx) => services.trucks.archive(ctx, truckId), {
    invalidatesPeople: true,
    leavesTruck: true,
  });
}

export function useSetTruckStatus(truckId: string) {
  return useTruckMutation(
    (
      ctx,
      vars: { status: TruckOperationalStatus; reason?: string; idempotencyKey: string },
    ) => services.trucks.setStatus(ctx, truckId, vars.status, vars.reason, vars.idempotencyKey),
    { onTruck: asTruck },
  );
}

export function useEndOperating(truckId: string) {
  return useTruckMutation(
    (ctx, vars: { operatingId: string; idempotencyKey: string }) =>
      services.trucks.endOperating(ctx, truckId, vars.operatingId, vars.idempotencyKey),
    { invalidatesPeople: true, leavesTruck: true },
  );
}

export function useReplaceOwnership(truckId: string) {
  return useTruckMutation(
    (
      ctx,
      vars: { ownershipId: string; input: ReplaceOwnershipInput; idempotencyKey: string },
    ) =>
      services.trucks.replaceOwnership(
        ctx, truckId, vars.ownershipId, vars.input, vars.idempotencyKey,
      ),
  );
}

export function useAssignTruck(truckId: string) {
  return useTruckMutation(
    (ctx, vars: { input: AssignTruckInput; idempotencyKey: string }) =>
      services.trucks.assign(ctx, truckId, vars.input, vars.idempotencyKey),
    { invalidatesPeople: true },
  );
}

export function useReplaceAssignment(truckId: string) {
  return useTruckMutation(
    (
      ctx,
      vars: { assignmentId: string; input: ReplaceAssignmentInput; idempotencyKey: string },
    ) =>
      services.trucks.replaceAssignment(
        ctx, truckId, vars.assignmentId, vars.input, vars.idempotencyKey,
      ),
    { invalidatesPeople: true },
  );
}

export function useRemoveAssignment(truckId: string) {
  return useTruckMutation(
    (ctx, vars: { assignmentId: string; idempotencyKey: string }) =>
      services.trucks.removeAssignment(ctx, truckId, vars.assignmentId, vars.idempotencyKey),
    { invalidatesPeople: true },
  );
}
