"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type { PolicyPatch, WorkKey } from "@/lib/api/contracts/responsibility";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import type { ResponsibilityAssignment, ResponsibilityRole } from "@/types";

/**
 * Every call goes through `services.responsibility`, never an adapter.
 *
 * One mutation hook covers all ten actions rather than ten hooks, so cache
 * invalidation is decided in one place: acting on responsibility can change an
 * MT Loop card, a Needs You row and the nav badge at once, and three hooks with
 * three ideas about what to invalidate is how a queue starts disagreeing with
 * the panel open on top of it.
 */

export function useResponsibilityBoard() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.responsibilityBoard(ctx.organizationId, ctx.membershipId)
      : ["responsibility", "no-context"],
    queryFn: () => services.responsibility.board(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useResponsibilityExplain(work: WorkKey | null) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx && work
      ? queryKeys.responsibilityExplain(ctx.organizationId, ctx.membershipId, work.id)
      : ["responsibility", "explain", "no-context"],
    queryFn: () => services.responsibility.explain(ctx!, work!),
    enabled: Boolean(ctx && work),
  });
}

export function useFleetProfile() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.responsibilityFleetProfile(ctx.organizationId)
      : ["responsibility", "fleet", "no-context"],
    queryFn: () => services.responsibility.fleetProfile(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useEscalationPolicies(enabled = true) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.responsibilityPolicies(ctx.organizationId)
      : ["responsibility", "policies", "no-context"],
    queryFn: () => services.responsibility.policies(ctx!),
    enabled: Boolean(ctx) && enabled,
  });
}

export function useAssignableMemberships(role?: ResponsibilityRole) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.responsibilityAssignable(ctx.organizationId, role)
      : ["responsibility", "assignable", "no-context"],
    queryFn: () => services.responsibility.assignable(ctx!, role),
    enabled: Boolean(ctx),
  });
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The ten actions, kept distinct all the way to the service.
 *
 * Deliberately not collapsed into a generic "update": delegating, reassigning
 * and taking over are three different things with three different effects on
 * accountability, and a single `update({ assignee })` would let a screen do one
 * while meaning another.
 */
export type ResponsibilityAction =
  | { kind: "acknowledge" }
  | { kind: "keep"; note?: string }
  | { kind: "delegate"; toMembershipId: string; note: string }
  | { kind: "reassign"; toMembershipId: string; note: string }
  | { kind: "takeOver"; note: string }
  | { kind: "changeAccountable"; toMembershipId: string; note: string }
  | { kind: "requestApproval"; approverMembershipId?: string; note: string }
  | { kind: "decideApproval"; decision: "approve" | "decline"; note: string }
  | { kind: "escalate"; note: string }
  | { kind: "addWatcher"; membershipId: string; note?: string }
  | { kind: "removeWatcher"; membershipId: string };

export type ResponsibilityMutation = UseMutationResult<
  ResponsibilityAssignment,
  Error,
  { work: WorkKey; action: ResponsibilityAction }
>;

export function useResponsibilityAction(): ResponsibilityMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ work, action }: { work: WorkKey; action: ResponsibilityAction }) => {
      if (!ctx) throw new Error("No active organization");
      const r = services.responsibility;
      switch (action.kind) {
        case "acknowledge": return r.acknowledge(ctx, work);
        case "keep": return r.keep(ctx, work, action.note);
        case "delegate":
          return r.delegate(ctx, work, {
            toMembershipId: action.toMembershipId, note: action.note,
          });
        case "reassign":
          return r.reassign(ctx, work, {
            toMembershipId: action.toMembershipId, note: action.note,
          });
        case "takeOver": return r.takeOver(ctx, work, action.note);
        case "changeAccountable":
          return r.changeAccountable(ctx, work, {
            toMembershipId: action.toMembershipId, note: action.note,
          });
        case "requestApproval":
          return r.requestApproval(ctx, work, {
            approverMembershipId: action.approverMembershipId, note: action.note,
          });
        case "decideApproval":
          return r.decideApproval(ctx, work, {
            decision: action.decision, note: action.note,
          });
        case "escalate": return r.escalate(ctx, work, action.note);
        case "addWatcher":
          return r.addWatcher(ctx, work, {
            membershipId: action.membershipId, note: action.note,
          });
        case "removeWatcher": return r.removeWatcher(ctx, work, action.membershipId);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      // Moving responsibility can change an MT Loop card, a Needs You row and
      // the nav badge at once, so everything organization-scoped is refetched
      // rather than this hook guessing which of them it touched.
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

/** The one setup call in the module: how many trucks. */
export function useSetFleetSize() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (truckCount: number) => {
      if (!ctx) throw new Error("No active organization");
      return services.responsibility.setFleetSize(ctx, truckCount);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

export function useUpdatePolicy() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ policyId, patch }: { policyId: string; patch: PolicyPatch }) => {
      if (!ctx) throw new Error("No active organization");
      return services.responsibility.updatePolicy(ctx, policyId, patch);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* For the surfaces that only need the name                                    */
/* -------------------------------------------------------------------------- */

/**
 * Work id → who holds it, for a list that belongs to another module.
 *
 * The Needs You queue has to be able to say who a row is routed to. Asking the
 * responsibility service once per row would be a query per row; this reads the
 * board the viewer already has cached — the same query key `My work` uses — and
 * turns it into a lookup.
 *
 * It returns names only. Nothing derived from it can act, and the module it
 * serves still owns its own records: this is a label, not a second routing
 * engine growing inside a feature component.
 */
export function useRoutedHolders(): Map<
  string,
  { displayName: string; isFallback: boolean }
> {
  const board = useResponsibilityBoard();
  const queues = board.data?.queues ?? [];

  const out = new Map<string, { displayName: string; isFallback: boolean }>();
  for (const queue of queues) {
    for (const item of queue.items) {
      if (out.has(item.work.id)) continue;
      out.set(item.work.id, {
        displayName: item.responsible.displayName,
        isFallback: item.responsible.source === "fallback",
      });
    }
  }
  return out;
}
