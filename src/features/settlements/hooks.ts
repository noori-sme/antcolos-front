"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  CreateAdjustmentInput,
  RaiseDisputeInput,
  RecordSettlementPaymentInput,
  ResolveDisputeInput,
  SettlementView,
} from "@/lib/api/contracts/settlements";
import { useServiceContext } from "@/lib/api/use-service-context";
import { settlementKeys } from "@/lib/query/keys";
import type { SettlementFilters, SettlementSort } from "@/types";

/**
 * Every settlement query is namespaced by organization, like the rest of the
 * app: one carrier's pay data can never be served from cache to a screen
 * rendered under another.
 */

export function useSettlementList(filters: SettlementFilters, sort?: SettlementSort) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.list(ctx.organizationId, ctx.membershipId, filters, sort)
      : ["settlements", "no-context"],
    queryFn: () => services.settlements.list(ctx!, filters, sort, { limit: 100 }),
    enabled: Boolean(ctx),
  });
}

export function useSettlementTotals(filters: SettlementFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.totals(ctx.organizationId, ctx.membershipId, filters)
      : ["settlements", "totals", "no-context"],
    queryFn: () => services.settlements.listTotals(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useSettlement(settlementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.detail(ctx.organizationId, ctx.membershipId, settlementId)
      : ["settlements", "detail", "no-context"],
    queryFn: () => services.settlements.get(ctx!, settlementId),
    enabled: Boolean(ctx),
  });
}

export function useSettlementAudit(settlementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.audit(ctx.organizationId, ctx.membershipId, settlementId)
      : ["settlements", "audit", "no-context"],
    queryFn: () => services.settlements.audit(ctx!, settlementId),
    enabled: Boolean(ctx),
  });
}

export function useSettlementPayees() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.payees(ctx.organizationId, ctx.membershipId)
      : ["settlements", "payees", "no-context"],
    queryFn: () => services.settlements.payees(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useSettlementPeriods() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.periods(ctx.organizationId)
      : ["settlements", "periods", "no-context"],
    queryFn: () => services.settlements.periods(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useSettlementStatements(settlementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? settlementKeys.statements(ctx.organizationId, ctx.membershipId, settlementId)
      : ["settlements", "statements", "no-context"],
    queryFn: () => services.settlements.statements(ctx!, settlementId),
    enabled: Boolean(ctx),
  });
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export type SettlementAction =
  | { kind: "recalculate" }
  | { kind: "submitForReview" }
  | { kind: "approve"; note?: string }
  | { kind: "raiseDispute"; input: RaiseDisputeInput }
  | { kind: "addDisputeMessage"; disputeId: string; body: string }
  | { kind: "resolveDispute"; disputeId: string; input: ResolveDisputeInput }
  | { kind: "markReadyForPayment" }
  | { kind: "recordPayment"; input: RecordSettlementPaymentInput }
  | { kind: "createAdjustment"; input: CreateAdjustmentInput }
  | { kind: "void"; reason: string }
  | { kind: "generateStatement" };

export type SettlementMutation = UseMutationResult<
  SettlementView | null,
  Error,
  { id: string; action: SettlementAction }
>;

/**
 * One mutation for every settlement action, so cache invalidation lives in one
 * place. Approving a settlement changes its Needs You items too, so the whole
 * organization namespace is invalidated rather than a hand-picked list of keys
 * that would drift.
 */
export function useSettlementAction(): SettlementMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: SettlementAction }) => {
      if (!ctx) throw new Error("No active organization");
      const api = services.settlements;
      switch (action.kind) {
        case "recalculate": return api.recalculate(ctx, id);
        case "submitForReview": return api.submitForReview(ctx, id);
        case "approve": return api.approve(ctx, id, { note: action.note });
        case "raiseDispute": return api.raiseDispute(ctx, id, action.input);
        case "addDisputeMessage":
          return api.addDisputeMessage(ctx, id, action.disputeId, { body: action.body });
        case "resolveDispute":
          return api.resolveDispute(ctx, id, action.disputeId, action.input);
        case "markReadyForPayment": return api.markReadyForPayment(ctx, id);
        case "recordPayment": return api.recordPayment(ctx, id, action.input);
        case "createAdjustment": return api.createAdjustment(ctx, id, action.input);
        case "void": return api.void(ctx, id, { reason: action.reason });
        case "generateStatement":
          // Returns the statement, not the settlement. The detail screen
          // refetches rather than reading a view from here.
          await api.generateStatement(ctx, id);
          return null;
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}
