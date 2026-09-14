"use client";

import { useQuery } from "@tanstack/react-query";
import { truckDispatchWorkspace } from "@/lib/api/mock/truck-dispatch-workspace";
import { useMtLoopContext } from "./use-mt-loop";

/**
 * The contextual dispatch workspace for one truck.
 *
 * Keyed by organization AND membership as well as the truck: two people looking
 * at the same truck from the same workspace can be entitled to different
 * amounts of it, so neither may be served the other's cache.
 */
export function useTruckDispatchWorkspace(truckId: string) {
  const ctx = useMtLoopContext();
  return useQuery({
    queryKey: ctx
      ? ["truck-dispatch", ctx.organizationId, ctx.membershipId, truckId]
      : ["truck-dispatch", "no-context", truckId],
    // Mapped to null rather than returned as undefined: react-query treats an
    // undefined result as a failed query, which turned "this truck is not yours"
    // into "something went wrong" — two very different things to tell somebody.
    queryFn: async () => (await truckDispatchWorkspace(truckId, ctx!)) ?? null,
    enabled: Boolean(ctx),
  });
}
