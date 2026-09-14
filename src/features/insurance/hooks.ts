"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  advanceClaimStatus, addClaimNote, attachClaimEvidence, coverageGaps,
  getClaim, getPolicyProfile, insuranceDashboard, listCertificates,
  listClaims, listPolicies, recordClaimCost, renewPolicy, revokePolicyShare,
  sharePolicy, type ClaimFilters, type PolicyFilters,
} from "@/lib/api/mock/insurance-registry";
import { queryKeys } from "@/lib/query/keys";
import type { ClaimStatus } from "@/types";
import { useInsuranceContext } from "./use-insurance-context";

/**
 * Query and mutation hooks for Insurance & Claims.
 *
 * Every key is organization-namespaced through `queryKeys`, so one
 * organization's insurance can never be served from cache to a screen rendered
 * under another. Mutations invalidate the whole organization subtree rather
 * than guessing which tiles a change touched — renewing a policy moves the
 * dashboard, the queue, the gap list and the claim attributions at once.
 */

const noContext = (what: string) => [what, "no-context"] as const;

export function useInsuranceDashboard() {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.insuranceDashboard(ctx.organizationId, ctx.membershipId)
      : noContext("insurance-dashboard"),
    queryFn: () => insuranceDashboard(ctx!),
    enabled: Boolean(ctx),
  });
}

export function usePolicies(filters: PolicyFilters = {}) {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.policies(ctx.organizationId, ctx.membershipId, filters)
      : noContext("policies"),
    queryFn: () => listPolicies(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function usePolicyProfile(policyId: string) {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.policy(ctx.organizationId, ctx.membershipId, policyId)
      : noContext("policy"),
    queryFn: () => getPolicyProfile(ctx!, policyId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useCertificates() {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.certificates(ctx.organizationId, ctx.membershipId)
      : noContext("certificates"),
    queryFn: () => listCertificates(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useClaims(filters: ClaimFilters = {}) {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.claims(ctx.organizationId, ctx.membershipId, filters)
      : noContext("claims"),
    queryFn: () => listClaims(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useClaim(claimId: string) {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.claim(ctx.organizationId, ctx.membershipId, claimId)
      : noContext("claim"),
    queryFn: () => getClaim(ctx!, claimId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useCoverageGaps() {
  const ctx = useInsuranceContext();
  return useQuery({
    queryKey: ctx
      ? [...queryKeys.insuranceDashboard(ctx.organizationId, ctx.membershipId), "gaps"]
      : noContext("coverage-gaps"),
    queryFn: () => coverageGaps(ctx!),
    enabled: Boolean(ctx),
  });
}

/** One place that decides what a write invalidates. */
function useInvalidateOrg() {
  const ctx = useInsuranceContext();
  const queryClient = useQueryClient();
  return () => {
    if (!ctx) return;
    queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
  };
}

export type PolicyAction =
  | { kind: "renew"; policyId: string; input: Parameters<typeof renewPolicy>[2] }
  | { kind: "share"; policyId: string; input: Parameters<typeof sharePolicy>[2] }
  | { kind: "revoke_share"; shareId: string };

export function usePolicyAction() {
  const ctx = useInsuranceContext();
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: async (action: PolicyAction) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "renew": return renewPolicy(ctx, action.policyId, action.input);
        case "share": return sharePolicy(ctx, action.policyId, action.input);
        case "revoke_share": return revokePolicyShare(ctx, action.shareId);
      }
    },
    onSuccess: invalidate,
  });
}

export type ClaimAction =
  | { kind: "advance"; to: ClaimStatus; note?: string }
  | { kind: "note"; body: string; visibility: "internal" | "operational" }
  | { kind: "evidence"; evidenceId: string; fileName: string; fileType?: string; sizeBytes?: number }
  | { kind: "cost"; input: Parameters<typeof recordClaimCost>[2] };

export function useClaimAction(claimId: string) {
  const ctx = useInsuranceContext();
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: async (action: ClaimAction) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "advance":
          return advanceClaimStatus(ctx, claimId, action.to, action.note);
        case "note":
          return addClaimNote(ctx, claimId, { body: action.body, visibility: action.visibility });
        case "evidence":
          return attachClaimEvidence(ctx, action.evidenceId, {
            fileName: action.fileName, fileType: action.fileType, sizeBytes: action.sizeBytes,
          });
        case "cost":
          return recordClaimCost(ctx, claimId, action.input);
      }
    },
    onSuccess: invalidate,
  });
}
