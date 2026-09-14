"use client";

import { useQuery } from "@tanstack/react-query";
import { rateConById } from "@/lib/api/mock/rate-confirmation";
import { useMtLoopContext } from "@/features/mt-loop/use-mt-loop";

/**
 * One rate confirmation workflow.
 *
 * Keyed by organization and membership like every other workspace query, and
 * mapped to null rather than undefined: react-query treats an undefined result
 * as a failed query, which would turn "this is not yours" into "something went
 * wrong" — two very different things to tell somebody about a document with a
 * signature on it.
 */
export function useRateCon(rateConId: string) {
  const ctx = useMtLoopContext();
  return useQuery({
    queryKey: ctx
      ? ["rate-confirmation", ctx.organizationId, ctx.membershipId, rateConId]
      : ["rate-confirmation", "no-context", rateConId],
    queryFn: () => rateConById(rateConId, ctx!) ?? null,
    enabled: Boolean(ctx),
  });
}
