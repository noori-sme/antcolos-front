"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  AmendContractInput, AuthorizeSignerInput, CreateContractInput,
  LinkRelationshipInput, SignContractInput, TerminationNoticeInput,
} from "@/lib/api/contracts/agreements";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import type {
  ContractFilters, ContractLinkRef, ContractSortKey, ContractTerms,
  TerminationStepKey,
} from "@/types";

/**
 * Query and mutation hooks for Contracts & Relationships.
 *
 * Every key is organization-namespaced through `queryKeys`, so one
 * organization's agreements can never be served from cache to a screen rendered
 * under another. Mutations invalidate the whole organization subtree rather than
 * guessing which tiles a change touched — signing a version moves the dashboard,
 * the list, the requirements, the timeline and the Needs You queue at once.
 */

const noContext = (what: string) => [what, "no-context"] as const;

export function useContractsDashboard() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.contractsDashboard(ctx.organizationId, ctx.membershipId)
      : noContext("contracts-dashboard"),
    queryFn: () => services.agreements.dashboard(ctx!),
    enabled: Boolean(ctx?.permissions.has("contracts:view")),
  });
}

export function useContracts(filters: ContractFilters = {}, sort: ContractSortKey = "updated") {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.contracts(ctx.organizationId, ctx.membershipId, { filters, sort })
      : noContext("contracts"),
    queryFn: () => services.agreements.list(ctx!, filters, sort, { limit: 100 }),
    enabled: Boolean(ctx?.permissions.has("contracts:view")),
  });
}

export function useContract(contractId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.contract(ctx.organizationId, ctx.membershipId, contractId)
      : noContext("contract"),
    queryFn: () => services.agreements.get(ctx!, contractId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useContractVersion(contractId: string, contractVersionId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.contractVersion(ctx.organizationId, ctx.membershipId, contractId, contractVersionId)
      : noContext("contract-version"),
    queryFn: () => services.agreements.getVersion(ctx!, contractId, contractVersionId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useTransitionRequests() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.contractTransitionRequests(ctx.organizationId, ctx.membershipId)
      : noContext("contract-transitions"),
    queryFn: () => services.agreements.transitionRequests(ctx!),
    enabled: Boolean(ctx?.permissions.has("contracts:view")),
  });
}

/** One place that decides what a write invalidates. */
function useInvalidateOrg() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return () => {
    if (!ctx) return;
    queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
  };
}

export function useCreateContract() {
  const ctx = useServiceContext();
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (input: CreateContractInput) => {
      if (!ctx) throw new Error("No active organization");
      return services.agreements.create(ctx, input);
    },
    onSuccess: invalidate,
  });
}

/**
 * Every write on one contract, in one mutation.
 *
 * A single discriminated action rather than a dozen hooks, so a screen cannot
 * accidentally call a write with a stale contract id and so the invalidation is
 * identical whatever changed.
 */
export type ContractAction =
  | { kind: "edit_draft"; terms: Partial<ContractTerms> }
  | { kind: "send_for_review"; note?: string }
  | { kind: "return_from_review"; note: string }
  | { kind: "issue" }
  | { kind: "cancel"; reason: string }
  | { kind: "authorize_signer"; input: Omit<AuthorizeSignerInput, "contractId"> }
  | { kind: "revoke_signer"; signerId: string; reason: string }
  | { kind: "sign"; input: Omit<SignContractInput, "contractId"> }
  | { kind: "amend"; input: Omit<AmendContractInput, "contractId"> }
  | { kind: "renew"; terms?: Partial<ContractTerms> }
  | { kind: "terminate"; input: Omit<TerminationNoticeInput, "contractId"> }
  | { kind: "confirm_step"; step: TerminationStepKey; note?: string }
  | { kind: "withdraw_termination"; reason: string }
  | { kind: "waive"; requirementId: string; reason: string }
  | { kind: "link_relationship"; input: Omit<LinkRelationshipInput, "contractId"> }
  | { kind: "detach_relationship"; relationshipRefId: string; reason: string }
  | { kind: "link_record"; ref: ContractLinkRef; note?: string };

export function useContractAction(contractId: string) {
  const ctx = useServiceContext();
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: async (action: ContractAction) => {
      if (!ctx) throw new Error("No active organization");
      const s = services.agreements;
      switch (action.kind) {
        case "edit_draft": return s.updateDraftTerms(ctx, contractId, action.terms);
        case "send_for_review": return s.sendForReview(ctx, contractId, action.note);
        case "return_from_review": return s.returnFromReview(ctx, contractId, action.note);
        case "issue": return s.issueForSignature(ctx, contractId);
        case "cancel": return s.cancel(ctx, contractId, action.reason);
        case "authorize_signer":
          return s.authorizeSigner(ctx, { ...action.input, contractId });
        case "revoke_signer":
          return s.revokeSigner(ctx, contractId, action.signerId, action.reason);
        case "sign": return s.sign(ctx, { ...action.input, contractId });
        case "amend": return s.amend(ctx, { ...action.input, contractId });
        case "renew": return s.renew(ctx, contractId, action.terms);
        case "terminate":
          return s.giveTerminationNotice(ctx, { ...action.input, contractId });
        case "confirm_step":
          return s.confirmTerminationStep(ctx, contractId, action.step, action.note);
        case "withdraw_termination":
          return s.withdrawTermination(ctx, contractId, action.reason);
        case "waive":
          return s.waiveRequirement(ctx, contractId, action.requirementId, action.reason);
        case "link_relationship":
          return s.linkRelationship(ctx, { ...action.input, contractId });
        case "detach_relationship":
          return s.detachRelationship(ctx, contractId, action.relationshipRefId, action.reason);
        case "link_record":
          return s.linkRecord(ctx, contractId, action.ref, action.note);
      }
    },
    onSuccess: invalidate,
  });
}
