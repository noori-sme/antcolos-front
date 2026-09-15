"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  AddEvidenceInput, AddNoteInput, OpenCaseInput, RecordDecisionInput,
  TransitionInput,
} from "@/lib/api/contracts/risk";
import { useServiceContext } from "@/lib/api/use-service-context";
import { auditKeys, riskKeys } from "@/lib/query/keys";
import type {
  AuditEventFilters, RiskCase, RiskCaseFilters, RiskSignalFilters,
} from "@/types";

/**
 * Every read and write goes through the service seam, with the organization
 * taken from the active membership and never from a prop or a route param.
 */

export const AUDIT_PAGE_SIZE = 100;

/**
 * The ledger, a page at a time.
 *
 * `limit` grows as the reader asks for more rather than fetching everything,
 * because a real backend will page this and the screen has to behave the same
 * way against both. `totalCount` comes back with every page, so the screen can
 * say what it is NOT showing rather than implying the page is the whole log.
 */
export function useAuditEvents(filters: AuditEventFilters, limit = AUDIT_PAGE_SIZE) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...auditKeys.list(ctx.organizationId, ctx.membershipId, filters), limit]
      : ["audit", "list", "no-context"],
    queryFn: () => services.audit.list(ctx!, { filters, limit }),
    enabled: Boolean(ctx),
    placeholderData: (previous) => previous,
  });
}

export function useAuditEvent(eventId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? auditKeys.event(ctx.organizationId, ctx.membershipId, eventId)
      : ["audit", "event", "no-context"],
    queryFn: () => services.audit.get(ctx!, eventId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useAuditSources() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? auditKeys.sources(ctx.organizationId, ctx.membershipId)
      : ["audit", "sources", "no-context"],
    queryFn: () => services.audit.sources(ctx!),
    enabled: Boolean(ctx),
  });
}

/**
 * Deliberately NOT automatic.
 *
 * Preparing an export is an audited act, so it happens when somebody asks for
 * it rather than on every render of the screen that offers it.
 */
export function useAuditExport() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filters: AuditEventFilters) => {
      if (!ctx) throw new Error("No active organization");
      return services.audit.exportView(ctx, filters);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: auditKeys.all(ctx.organizationId) });
    },
  });
}

export function useRiskDashboard() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? riskKeys.dashboard(ctx.organizationId, ctx.membershipId)
      : ["risk", "dashboard", "no-context"],
    queryFn: () => services.risk.dashboard(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useRiskRules() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? riskKeys.rules(ctx.organizationId) : ["risk", "rules"],
    queryFn: () => services.risk.rules(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useRiskSignals(filters: RiskSignalFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? riskKeys.signals(ctx.organizationId, ctx.membershipId, filters)
      : ["risk", "signals", "no-context"],
    queryFn: () => services.risk.signals(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useRiskCases(filters: RiskCaseFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? riskKeys.cases(ctx.organizationId, ctx.membershipId, filters)
      : ["risk", "cases", "no-context"],
    queryFn: () => services.risk.cases(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useRiskCase(caseId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? riskKeys.case(ctx.organizationId, ctx.membershipId, caseId)
      : ["risk", "case", "no-context"],
    queryFn: () => services.risk.case(ctx!, caseId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useEligibleAssignees(caseId: string, enabled = true) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? riskKeys.assignees(ctx.organizationId, ctx.membershipId, caseId)
      : ["risk", "assignees", "no-context"],
    queryFn: () => services.risk.eligibleAssignees(ctx!, caseId),
    enabled: Boolean(ctx) && enabled,
  });
}

export function useRiskExtensionPoints() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? riskKeys.extensions(ctx.organizationId) : ["risk", "extensions"],
    queryFn: () => services.risk.extensionPoints(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useDismissSignal() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ signalId, reason }: { signalId: string; reason: string }) => {
      if (!ctx) throw new Error("No active organization");
      return services.risk.dismissSignal(ctx, signalId, { reason });
    },
    onSuccess: () => {
      if (!ctx) return;
      // Risk feeds the ledger and Needs You, so all three refresh together.
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

export function useOpenCase() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OpenCaseInput) => {
      if (!ctx) throw new Error("No active organization");
      return services.risk.openCase(ctx, input);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

export type CaseAction =
  | { kind: "assign"; membershipId: string | null }
  | { kind: "note"; input: AddNoteInput }
  | { kind: "evidence"; input: AddEvidenceInput }
  | { kind: "decision"; input: RecordDecisionInput }
  | { kind: "transition"; input: TransitionInput }
  | { kind: "due"; dueAt: string | null }
  | { kind: "link"; signalId: string };

export type CaseMutation = UseMutationResult<
  RiskCase, Error, { caseId: string; action: CaseAction }
>;

/** One mutation for every case action, so invalidation stays in one place. */
export function useCaseAction(): CaseMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ caseId, action }: { caseId: string; action: CaseAction }) => {
      if (!ctx) throw new Error("No active organization");
      switch (action.kind) {
        case "assign": return services.risk.assign(ctx, caseId, action.membershipId);
        case "note": return services.risk.addNote(ctx, caseId, action.input);
        case "evidence": return services.risk.addEvidence(ctx, caseId, action.input);
        case "decision": return services.risk.recordDecision(ctx, caseId, action.input);
        case "transition": return services.risk.transition(ctx, caseId, action.input);
        case "due": return services.risk.setDueDate(ctx, caseId, action.dueAt);
        case "link": return services.risk.linkSignal(ctx, caseId, action.signalId);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}
