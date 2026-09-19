"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  DecideInput, EscalateInput, SnoozeInput,
} from "@/lib/api/contracts/needs-you";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import type { NeedsYouFilters, NeedsYouItem } from "@/types";

export function useNeedsYouList(filters: NeedsYouFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.needsYouList(ctx.organizationId, ctx.membershipId, filters)
      : ["needs-you", "no-context"],
    queryFn: () => services.needsYou.list(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

/**
 * The nav badge, and it counts what needs YOU.
 *
 * Deliberately not `needsYou.openCount`, which is everything the membership may
 * see: a Carrier Owner had a badge reading 142 sitting above a personal queue
 * of ten, and a badge that disagrees with the page it points at is worse than
 * no badge. It comes from the same derivation Home and the Needs You page use.
 */
export function useNeedsYouCount() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.needsYouCount(ctx.organizationId, ctx.membershipId)
      : ["needs-you", "count", "no-context"],
    queryFn: async () => {
      const views = await services.responsibility.attention(ctx!);
      return views.myNeedsYou.filter((a) => a.work.kind === "needs_you").length;
    },
    enabled: Boolean(ctx),
  });
}

export function useAssignableMembers() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? queryKeys.members(ctx.organizationId) : ["members", "no-context"],
    queryFn: () => services.directory.assignableMembers(ctx!),
    enabled: Boolean(ctx),
  });
}

type Action =
  | { kind: "resolve"; note?: string }
  | { kind: "reopen" }
  | { kind: "assign"; membershipId: string }
  | { kind: "snooze"; input: SnoozeInput }
  | { kind: "unsnooze" }
  | { kind: "escalate"; input: EscalateInput }
  /**
   * The one press. Names the pre-analysed option a person chose; the service
   * runs everything downstream of it.
   */
  | { kind: "decide"; input: DecideInput };

export type NeedsYouMutation = UseMutationResult<
  NeedsYouItem,
  Error,
  { id: string; action: Action }
>;

/** One mutation for every Needs You action, so invalidation stays in one place. */
export function useNeedsYouAction(): NeedsYouMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: Action }) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "resolve": return services.needsYou.resolve(ctx, id, action.note);
        case "reopen": return services.needsYou.reopen(ctx, id);
        case "assign": return services.needsYou.assign(ctx, id, action.membershipId);
        case "snooze": return services.needsYou.snooze(ctx, id, action.input);
        case "unsnooze": return services.needsYou.unsnooze(ctx, id);
        case "escalate": return services.needsYou.escalate(ctx, id, action.input);
        case "decide": return services.needsYou.decide(ctx, id, action.input);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      // Everything organization-scoped that could have changed.
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}
