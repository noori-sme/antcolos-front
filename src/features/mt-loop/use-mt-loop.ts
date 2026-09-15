"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useServiceContext } from "@/lib/api/use-service-context";
import { useActiveMembership } from "@/lib/session/hooks";
import { mtLoopBoard, type MtLoopContext } from "@/lib/api/mock/mt-loop";
import { publishAvailability } from "@/lib/api/mock/tracking-board";

/**
 * The context the MT Loop service needs: the service context, plus the
 * organization and membership the workspace shape is derived from.
 *
 * Both are passed through rather than looked up again inside the service, so
 * there is exactly one place — the session — that decides which organization
 * the caller is acting in.
 */
export function useMtLoopContext(): MtLoopContext | null {
  const base = useServiceContext();
  const { membership, organization } = useActiveMembership();

  return useMemo(() => {
    if (!base || !membership || !organization) return null;
    return { ...base, membership, organization };
  }, [base, membership, organization]);
}

/**
 * The MT Loop board for the active membership.
 *
 * Keyed by organization AND membership: two people in one workspace see two
 * different boards — the same loops, but different things they may do to them —
 * and neither may be served the other's cache.
 */
export function useMtLoopBoard() {
  const ctx = useMtLoopContext();
  return useQuery({
    queryKey: ctx ? ["mt-loop", ctx.organizationId, ctx.membershipId] : ["mt-loop", "no-context"],
    queryFn: async () => {
      // Availability is decided by the tracking module and PUBLISHED to the
      // loop service, so it is produced here rather than inside the board: the
      // loop service owns the cycle and must not grow a dependency on the
      // thing that reports about it. The decisions are recomputed from
      // evidence on every read and deduplicated by operational cycle, so this
      // keeps the empty board current without a scheduler and without ever
      // opening a second entry for one empty truck.
      if (ctx!.permissions.has("tracking:view")) publishAvailability(ctx!);
      return mtLoopBoard(ctx!);
    },
    enabled: Boolean(ctx),
  });
}
