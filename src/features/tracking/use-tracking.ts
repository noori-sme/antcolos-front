"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useServiceContext } from "@/lib/api/use-service-context";
import { useActiveMembership } from "@/lib/session/hooks";
import type { DispatchTrackingFilters } from "@/types";
import {
  dispatchTrackingBoard, loadTracking, publishAvailability,
} from "@/lib/api/mock/tracking-board";
import type { TrackingContext } from "@/lib/api/mock/tracking-registry";

/**
 * The tracking service's context: the service context, plus the organization
 * and membership the workspace shape is derived from.
 *
 * Both are passed through rather than looked up again inside the service, so
 * there is exactly one place — the session — that decides which organization
 * the caller is acting in.
 */
export function useTrackingContext(): TrackingContext | null {
  const base = useServiceContext();
  const { membership, organization } = useActiveMembership();

  return useMemo(() => {
    if (!base || !membership || !organization) return null;
    return { ...base, membership, organization };
  }, [base, membership, organization]);
}

/**
 * The tracking board.
 *
 * Keyed by organization AND membership, like every other board in Antcolos:
 * two people in one workspace can legitimately see different rows, and neither
 * may be served from the other's cache.
 *
 * Publishing availability runs as part of the fetch rather than on a timer.
 * The decisions are recomputed on every read anyway, and the MT Loop service
 * deduplicates them, so doing it here means opening this screen keeps the
 * empty board current without a second thing to remember to run.
 */
export function useTrackingBoard(filters: DispatchTrackingFilters) {
  const ctx = useTrackingContext();
  return useQuery({
    queryKey: ctx
      ? ["tracking", ctx.organizationId, ctx.membershipId, "board", filters]
      : ["tracking", "no-context"],
    queryFn: async () => {
      publishAvailability(ctx!);
      return dispatchTrackingBoard(ctx!, filters);
    },
    enabled: Boolean(ctx),
  });
}

export function useLoadTracking(loadId: string) {
  const ctx = useTrackingContext();
  return useQuery({
    queryKey: ctx
      ? ["tracking", ctx.organizationId, ctx.membershipId, "load", loadId]
      : ["tracking", "no-context"],
    queryFn: () => loadTracking(ctx!, loadId),
    enabled: Boolean(ctx),
  });
}

/** Invalidate everything tracking after a mutation. */
export function useTrackingRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["tracking"] });
}
