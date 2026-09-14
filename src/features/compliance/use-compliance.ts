"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  AssignResponsibilityInput, RecordResolutionInput,
} from "@/lib/api/contracts/compliance";
import { useServiceContext } from "@/lib/api/use-service-context";
import { complianceKeys } from "@/lib/query/keys";
import type { ComplianceFilters, ComplianceRequirement } from "@/types";

/**
 * Every read and write goes through the service seam, with the organization
 * taken from the active membership and never from a prop or a route param.
 */

export function useComplianceSummary() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? complianceKeys.summary(ctx.organizationId, ctx.membershipId)
      : ["compliance", "no-context"],
    queryFn: () => services.compliance.summary(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useComplianceGroups(filters: ComplianceFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? complianceKeys.groups(ctx.organizationId, ctx.membershipId, filters)
      : ["compliance", "groups", "no-context"],
    queryFn: () => services.compliance.bySubject(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useComplianceList(filters: ComplianceFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? complianceKeys.list(ctx.organizationId, ctx.membershipId, filters)
      : ["compliance", "list", "no-context"],
    queryFn: () => services.compliance.list(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useComplianceRequirement(requirementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? complianceKeys.requirement(ctx.organizationId, ctx.membershipId, requirementId)
      : ["compliance", "requirement", "no-context"],
    queryFn: () => services.compliance.get(ctx!, requirementId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useComplianceShares() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? complianceKeys.shares(ctx.organizationId) : ["compliance", "shares"],
    queryFn: () => services.compliance.shares(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useComplianceSnapshots(subjectId?: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? complianceKeys.snapshots(ctx.organizationId, subjectId)
      : ["compliance", "snapshots"],
    queryFn: () => services.compliance.snapshots(ctx!, subjectId),
    enabled: Boolean(ctx),
  });
}

export function useComplianceExtensionPoints() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? complianceKeys.extensions(ctx.organizationId) : ["compliance", "ext"],
    queryFn: () => services.compliance.extensionPoints(ctx!),
    enabled: Boolean(ctx),
  });
}

type Action =
  | { kind: "resolve"; input: RecordResolutionInput }
  | { kind: "assign"; input: AssignResponsibilityInput }
  | { kind: "suspend"; reason: string }
  | { kind: "reinstate" }
  | { kind: "note"; note: string };

export type ComplianceMutation = UseMutationResult<
  ComplianceRequirement, Error, { id: string; action: Action }
>;

/** One mutation for every compliance action, so invalidation stays in one place. */
export function useComplianceAction(): ComplianceMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: Action }) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "resolve": return services.compliance.recordResolution(ctx, id, action.input);
        case "assign": return services.compliance.assignResponsibility(ctx, id, action.input);
        case "suspend": return services.compliance.suspend(ctx, id, { reason: action.reason });
        case "reinstate": return services.compliance.reinstate(ctx, id);
        case "note": return services.compliance.addNote(ctx, id, action.note);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      // Compliance feeds Needs You, so both have to be refreshed together.
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}
