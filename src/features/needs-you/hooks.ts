"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type { EscalateInput, SnoozeInput } from "@/lib/api/contracts/needs-you";
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

export function useNeedsYouCount() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.needsYouCount(ctx.organizationId, ctx.membershipId)
      : ["needs-you", "count", "no-context"],
    queryFn: () => services.needsYou.openCount(ctx!),
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
  | { kind: "escalate"; input: EscalateInput };

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
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      // Everything organization-scoped that could have changed.
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}
