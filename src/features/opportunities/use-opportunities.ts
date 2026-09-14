"use client";

import { useQuery } from "@tanstack/react-query";
import { opportunityInbox, truckOpportunities } from "@/lib/api/mock/opportunity-service";
import { useMtLoopContext } from "@/features/mt-loop/use-mt-loop";

/**
 * The workspace's whole Opportunity Inbox.
 *
 * Keyed by organization AND membership, like every other workspace query: two
 * people in one workspace may be entitled to different amounts of it, and
 * neither may be served the other's cache.
 */
export function useOpportunityInbox() {
  const ctx = useMtLoopContext();
  return useQuery({
    queryKey: ctx ? ["opportunities", ctx.organizationId, ctx.membershipId] : ["opportunities", "none"],
    queryFn: () => opportunityInbox(ctx!),
    enabled: Boolean(ctx),
  });
}

/** Just the opportunities for one truck's cycle. */
export function useTruckOpportunities(dispatchCycleId: string | undefined) {
  const ctx = useMtLoopContext();
  return useQuery({
    queryKey: ctx && dispatchCycleId
      ? ["opportunities", ctx.organizationId, ctx.membershipId, dispatchCycleId]
      : ["opportunities", "no-cycle"],
    queryFn: () => truckOpportunities(dispatchCycleId!, ctx!),
    enabled: Boolean(ctx && dispatchCycleId),
  });
}
