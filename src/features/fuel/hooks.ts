"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  CorrectFuelPurchaseInput, CorrectMileageInput, FuelDashboardWindow,
  RecordFilingInput, RecordFuelPurchaseInput, RecordMileageInput,
} from "@/lib/api/contracts/fuel";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import type { FuelTransactionFilters, MileageRecordFilters } from "@/types";

/**
 * Every fuel query is keyed by organization AND membership, because what the
 * service returns genuinely differs between two people in the same
 * organization: one sees the cost, the other does not. Keying by organization
 * alone would let a cache hand a rate-blind dispatcher somebody else's answer.
 */

export function useFuelDashboard(window?: FuelDashboardWindow) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fuelDashboard(ctx.organizationId, ctx.membershipId, window ?? null)
      : ["fuel", "dashboard", "no-context"],
    queryFn: () => services.fuel.dashboard(ctx!, window),
    enabled: Boolean(ctx),
  });
}

export function useFuelTransactions(filters: FuelTransactionFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fuelTransactions(ctx.organizationId, ctx.membershipId, filters)
      : ["fuel", "transactions", "no-context"],
    queryFn: () => services.fuel.listTransactions(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useFuelTransaction(transactionId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fuelTransaction(ctx.organizationId, ctx.membershipId, transactionId)
      : ["fuel", "transaction", "no-context"],
    queryFn: () => services.fuel.getTransaction(ctx!, transactionId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useMileageRecords(filters: MileageRecordFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fuelMileage(ctx.organizationId, ctx.membershipId, filters)
      : ["fuel", "mileage", "no-context"],
    queryFn: () => services.fuel.listMileage(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useIftaPeriods() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.iftaPeriods(ctx.organizationId, ctx.membershipId)
      : ["ifta", "periods", "no-context"],
    queryFn: () => services.ifta.listPeriods(ctx!),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useIftaPeriod(periodId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.iftaPeriod(ctx.organizationId, ctx.membershipId, periodId)
      : ["ifta", "period", "no-context"],
    queryFn: () => services.ifta.getPeriod(ctx!, periodId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useFuelIntegrations() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? queryKeys.fuelIntegrations(ctx.organizationId) : ["fuel", "integrations", "none"],
    queryFn: () => services.fuel.integrations(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useFuelSharing() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fuelSharing(ctx.organizationId, ctx.membershipId)
      : ["fuel", "sharing", "no-context"],
    queryFn: () => services.fuel.sharingGrants(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useFuelAudit(subjectId?: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.fuelAudit(ctx.organizationId, ctx.membershipId, subjectId)
      : ["fuel", "audit", "no-context"],
    queryFn: () => services.fuel.audit(ctx!, subjectId),
    enabled: Boolean(ctx),
  });
}

type FuelAction =
  | { kind: "record"; input: RecordFuelPurchaseInput }
  | { kind: "verify"; id: string }
  | { kind: "reject"; id: string; reason: string }
  | { kind: "duplicate"; id: string; duplicateOfId: string }
  | { kind: "correct"; id: string; input: CorrectFuelPurchaseInput }
  | { kind: "attach_receipt"; id: string; documentId: string }
  | { kind: "record_mileage"; input: RecordMileageInput }
  | { kind: "verify_mileage"; id: string }
  | { kind: "reject_mileage"; id: string; reason: string }
  | { kind: "correct_mileage"; id: string; input: CorrectMileageInput }
  | { kind: "import"; adapterId: string }
  | { kind: "record_filing"; periodId: string; input: RecordFilingInput }
  | { kind: "amend"; periodId: string; reason: string };

export type FuelMutation = UseMutationResult<unknown, Error, FuelAction>;

/**
 * One mutation for every fuel action, so invalidation lives in one place.
 *
 * Everything organization-scoped is invalidated on success — a correction
 * moves gallons, which moves MPG, which moves a jurisdiction line, which moves
 * a quarter's readiness, which moves the Needs You count. Trying to invalidate
 * only the parts that changed is how two screens end up disagreeing.
 */
export function useFuelAction(): FuelMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (action: FuelAction) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "record": return services.fuel.recordTransaction(ctx, action.input);
        case "verify": return services.fuel.verifyTransaction(ctx, action.id);
        case "reject": return services.fuel.rejectTransaction(ctx, action.id, action.reason);
        case "duplicate": return services.fuel.markDuplicate(ctx, action.id, action.duplicateOfId);
        case "correct": return services.fuel.correctTransaction(ctx, action.id, action.input);
        case "attach_receipt": return services.fuel.attachReceipt(ctx, action.id, action.documentId);
        case "record_mileage": return services.fuel.recordMileage(ctx, action.input);
        case "verify_mileage": return services.fuel.verifyMileage(ctx, action.id);
        case "reject_mileage": return services.fuel.rejectMileage(ctx, action.id, action.reason);
        case "correct_mileage": return services.fuel.correctMileage(ctx, action.id, action.input);
        case "import": return services.fuel.runImport(ctx, action.adapterId);
        case "record_filing": return services.ifta.recordFiling(ctx, action.periodId, action.input);
        case "amend": return services.ifta.amendPeriod(ctx, action.periodId, action.reason);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}
