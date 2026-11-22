"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  carrierAuthorityKeys, fleetKeys, loadExceptionKeys, loadRecordKeys, orgKey, queryKeys,
} from "@/lib/query/keys";
import { useCan } from "@/lib/session/hooks";
import type { TruckListFilters } from "@/types/fleet-truck";
import type { LoadRecordQuery, LoadRecordStatus } from "@/types/load-record";

export function useHomeSummary() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.home(ctx.organizationId, ctx.membershipId)
      : ["home", "no-context"],
    queryFn: () => services.home.summary(ctx!),
    enabled: Boolean(ctx),
  });
}

// ── Owner dashboard, first cut (F1.6): live counts in http mode ─────────────

const OVERVIEW_TRUCKS: TruckListFilters = { page: 1, pageSize: 100 };

/** Trucks for the fleet tile (first 100; enough for a small carrier). */
export function useOverviewTrucks() {
  const ctx = useServiceContext();
  const enabled = Boolean(ctx?.permissions.has("trucks:view"));
  return useQuery({
    queryKey: ctx
      ? fleetKeys.list(ctx.organizationId, OVERVIEW_TRUCKS)
      : [...orgKey("none"), "trucks", "overview", "no-context"],
    queryFn: () => services.trucks.list(ctx!, OVERVIEW_TRUCKS),
    enabled: Boolean(ctx) && enabled,
  });
}

/** How many loads are in one status (one row asked; the total is what counts). */
export function useLoadStatusCount(status: LoadRecordStatus) {
  const ctx = useServiceContext();
  const query: LoadRecordQuery = { page: 1, pageSize: 1, status, sortBy: "createdAt", sortDir: "desc" };
  const enabled = Boolean(ctx?.permissions.has("loads:view"));
  return useQuery({
    queryKey: ctx ? loadRecordKeys.list(ctx.organizationId, query) : [...orgKey("none"), "load-records", "no-context", status],
    queryFn: () => services.loadRecords.list(ctx!, query),
    enabled: Boolean(ctx) && enabled,
    select: (page) => page.totalItems,
  });
}

/** Open and acknowledged problems across the organization's loads. */
export function useOpenExceptionsCount() {
  const ctx = useServiceContext();
  const enabled = Boolean(ctx?.permissions.has("loads:view"));
  return useQuery({
    queryKey: ctx ? loadExceptionKeys.open(ctx.organizationId, 1) : [...orgKey("none"), "load-exceptions", "no-context"],
    queryFn: () => services.loadExceptions.listOpen(ctx!, 1),
    enabled: Boolean(ctx) && enabled,
    select: (page) => page.totalItems,
  });
}

// ── Carrier authority (plan 25) ────────────────────────────────────────────

export function useCarrierAuthority() {
  const ctx = useServiceContext();
  const allowed = useCan("carrier:authority:view");
  return useQuery({
    queryKey: ctx ? carrierAuthorityKeys.current(ctx.organizationId) : ["carrier-authority", "no-context"],
    queryFn: () => services.carrierAuthority.current(ctx!),
    enabled: Boolean(ctx) && allowed,
  });
}

export function useCarrierAuthorityHistory(page: number, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? carrierAuthorityKeys.history(ctx.organizationId, page) : ["carrier-authority", "no-context"],
    queryFn: () => services.carrierAuthority.history(ctx!, { page, pageSize: 20 }),
    enabled: Boolean(ctx) && enabled,
    placeholderData: keepPreviousData,
  });
}

/** Ask FMCSA now; the stored check and its history refresh after. */
export function useRefreshCarrierAuthority() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!ctx) throw new Error("No organization selected");
      return services.carrierAuthority.refresh(ctx);
    },
    onSuccess: () =>
      ctx && queryClient.invalidateQueries({ queryKey: carrierAuthorityKeys.all(ctx.organizationId) }),
  });
}

