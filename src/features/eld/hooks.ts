"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey, queryKeys } from "@/lib/query/keys";
import type {
  BindDeviceInput, BindDriverInput, EldEventQuery, IngestDeliveryInput,
} from "@/lib/api/contracts/eld";
import type { EldBindingEndReason } from "@/types";

/**
 * Every call goes through the service seam with a ServiceContext, exactly like
 * Fleet and Home. No screen in this feature imports the registry, an adapter or
 * a store, so the permission, relationship, sharing and driver-privacy checks in
 * the service layer cannot be stepped around by a component.
 */

export function useEldDashboard() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.eldDashboard(ctx.organizationId, ctx.membershipId)
      : ["eld", "no-context"],
    queryFn: () => services.eld.dashboard(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useEldDevice(deviceId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.eldDevice(ctx.organizationId, ctx.membershipId, deviceId)
      : ["eld", "device", "no-context"],
    queryFn: () => services.eld.device(ctx!, deviceId),
    enabled: Boolean(ctx) && Boolean(deviceId),
    retry: false,
  });
}

export function useEldEvents(query: EldEventQuery) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.eldEvents(ctx.organizationId, ctx.membershipId, query)
      : ["eld", "events", "no-context"],
    queryFn: () => services.eld.events(ctx!, query),
    enabled: Boolean(ctx),
  });
}

export function useEldSignals(limit = 60) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.eldSignals(ctx.organizationId, ctx.membershipId)
      : ["eld", "signals", "no-context"],
    queryFn: () => services.eld.signals(ctx!, limit),
    enabled: Boolean(ctx),
  });
}

export function useEldRawPayloads(limit = 25) {
  const ctx = useServiceContext();
  const enabled = Boolean(ctx) && Boolean(ctx?.permissions.has("eld:raw:view"));
  return useQuery({
    queryKey: ctx
      ? queryKeys.eldRawPayloads(ctx.organizationId, ctx.membershipId)
      : ["eld", "raw", "no-context"],
    queryFn: () => services.eld.rawPayloads(ctx!, limit),
    // Not fetched at all without the key. A query that fired and was refused
    // would put a red error state on a panel the person simply may not see.
    enabled,
  });
}

export function useEldShares() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.eldShares(ctx.organizationId, ctx.membershipId)
      : ["eld", "shares", "no-context"],
    queryFn: () => services.eld.shares(ctx!),
    enabled: Boolean(ctx),
  });
}

/**
 * Anything that writes invalidates the whole organization's cache.
 *
 * Narrower keys would be wrong here rather than merely inefficient: one
 * delivery changes the device list, the snapshot, the dashboard counts, the
 * published signals and any Needs You item raised from them, and leaving four
 * of those five showing the previous answer is exactly the disagreement this
 * module exists to prevent.
 */
function useEldMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (ctx) client.invalidateQueries({ queryKey: orgKey(ctx.organizationId) });
    },
  });
}

export function useIngestDelivery() {
  const ctx = useServiceContext();
  return useEldMutation((input: IngestDeliveryInput) => services.eld.ingest(ctx!, input));
}

export function useBindDeviceToTruck() {
  const ctx = useServiceContext();
  return useEldMutation((input: BindDeviceInput) => services.eld.bindDeviceToTruck(ctx!, input));
}

export function useBindDriverToDevice() {
  const ctx = useServiceContext();
  return useEldMutation((input: BindDriverInput) => services.eld.bindDriverToDevice(ctx!, input));
}

export function useEndVehicleBinding() {
  const ctx = useServiceContext();
  return useEldMutation(
    (input: { bindingId: string; reason: EldBindingEndReason }) =>
      services.eld.endVehicleBinding(ctx!, input.bindingId, input.reason),
  );
}

export function useEndDriverBinding() {
  const ctx = useServiceContext();
  return useEldMutation(
    (input: { bindingId: string; reason: EldBindingEndReason }) =>
      services.eld.endDriverBinding(ctx!, input.bindingId, input.reason),
  );
}

export function useDisconnectConnection() {
  const ctx = useServiceContext();
  return useEldMutation(
    (input: { connectionId: string; reason: string }) =>
      services.eld.disconnect(ctx!, input.connectionId, input.reason),
  );
}
