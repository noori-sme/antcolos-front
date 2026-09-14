"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys, orgKey } from "@/lib/query/keys";
import type { FleetAssetKind, FleetEquipmentFilters } from "@/types";
import type { RecordTelemetryInput } from "@/lib/api/contracts/fleet";

/**
 * Every call goes through the service seam with a ServiceContext, exactly like
 * Home and Loads. No screen in this feature imports an adapter, a registry or a
 * store directly, so the permission and organization checks in the service
 * layer cannot be stepped around by a component.
 */

export function useFleetDashboard() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fleetDashboard(ctx.organizationId, ctx.membershipId)
      : ["fleet", "no-context"],
    queryFn: () => services.fleet.dashboard(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useFleetEquipment(filters: FleetEquipmentFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fleetEquipment(ctx.organizationId, ctx.membershipId, filters)
      : ["fleet", "equipment", "no-context"],
    queryFn: () => services.fleet.equipment(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useFleetAsset(assetKind: FleetAssetKind, assetId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fleetAsset(ctx.organizationId, ctx.membershipId, assetKind, assetId)
      : ["fleet", "asset", "no-context"],
    queryFn: () => services.fleet.asset(ctx!, assetKind, assetId),
    enabled: Boolean(ctx) && Boolean(assetId),
    retry: false,
  });
}

/**
 * Records a reading.
 *
 * Invalidates the whole organization's cache rather than one key: a new
 * location changes the asset row, the dashboard's stale count and any Needs You
 * item raised for the staleness, and leaving two of those three showing the old
 * answer is exactly the kind of disagreement this layer exists to avoid.
 */
export function useRecordTelemetry() {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordTelemetryInput) => services.fleet.recordTelemetry(ctx!, input),
    onSuccess: () => {
      if (ctx) client.invalidateQueries({ queryKey: orgKey(ctx.organizationId) });
    },
  });
}
