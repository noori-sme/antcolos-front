"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useServiceContext } from "@/lib/api/use-service-context";

/**
 * Everything that can go stale the moment a search runs, a match moves, or a
 * draft is read.
 *
 * Refetching the panel you are standing in is not enough. Starting a search on
 * one truck also changes the Opportunity Inbox, the board's "nobody is looking"
 * count and the Needs You queue, and those are cached on screens you may walk
 * to a second later — inside the cache's stale window, react-query would serve
 * the answer from before you searched. Every one of these is a derived view of
 * the same store, so the honest thing is to mark them all stale together.
 */
export function useOpportunityRefresh() {
  const queryClient = useQueryClient();
  const ctx = useServiceContext();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    void queryClient.invalidateQueries({ queryKey: ["truck-dispatch"] });
    void queryClient.invalidateQueries({ queryKey: ["mt-loop"] });
    // Needs You, Home and the rest of the workspace hang off the org key.
    if (ctx) void queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
  };
}
