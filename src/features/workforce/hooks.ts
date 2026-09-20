"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import type {
  AssignFunctionInput, CreateEngagementInput, EndEngagementInput,
  EndLeaveInput, RecordLeaveInput, RecordStartDateInput, RemoveFunctionInput,
  SuspendInput, WaiveStepInput,
} from "@/lib/api/contracts/workforce";
import type { AdoptDocumentInput } from "@/lib/api/contracts/qualification";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import type { WorkforceFilters } from "@/types";

/**
 * Every key is namespaced by organization, like the rest of the app, so one
 * organization's workforce can never be served from cache to a screen rendered
 * under another.
 */
export const workforceKeys = {
  list: (organizationId: string, filters: WorkforceFilters) =>
    [...orgKey(organizationId), "workforce", "list", filters] as const,
  detail: (organizationId: string, engagementId: string) =>
    [...orgKey(organizationId), "workforce", "detail", engagementId] as const,
  checklist: (organizationId: string, engagementId: string) =>
    [...orgKey(organizationId), "workforce", "checklist", engagementId] as const,
  plan: (organizationId: string, engagementId: string) =>
    [...orgKey(organizationId), "workforce", "offboarding-plan", engagementId] as const,
  qualification: (organizationId: string, engagementId: string) =>
    [...orgKey(organizationId), "workforce", "qualification", engagementId] as const,
};

export function useWorkforceList(filters: WorkforceFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? workforceKeys.list(ctx.organizationId, filters) : ["workforce", "no-context"],
    queryFn: () => services.workforce.list(ctx!, filters),
    enabled: Boolean(ctx),
  });
}

export function useEngagement(engagementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? workforceKeys.detail(ctx.organizationId, engagementId)
      : ["workforce", "no-context", engagementId],
    queryFn: () => services.workforce.get(ctx!, engagementId),
    enabled: Boolean(ctx),
  });
}

export function useOnboardingChecklist(engagementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? workforceKeys.checklist(ctx.organizationId, engagementId)
      : ["workforce", "no-context", "checklist", engagementId],
    queryFn: () => services.workforce.onboardingChecklist(ctx!, engagementId),
    enabled: Boolean(ctx),
  });
}

/**
 * The impact preview.
 *
 * Fetched when the dialog opens rather than cached ahead of time, because it is
 * computed from six modules' live state and a stale preview is a person
 * confirming something that is no longer true.
 */
export function useOffboardingPlan(engagementId: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? workforceKeys.plan(ctx.organizationId, engagementId)
      : ["workforce", "no-context", "plan", engagementId],
    queryFn: () => services.workforce.offboardingPlan(ctx!, engagementId),
    enabled: Boolean(ctx) && enabled,
    staleTime: 0,
  });
}

export function useQualificationRecords(engagementId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? workforceKeys.qualification(ctx.organizationId, engagementId)
      : ["workforce", "no-context", "qual", engagementId],
    queryFn: () => services.qualification.list(ctx!, { engagementId }),
    enabled: Boolean(ctx),
  });
}

type EngagementAction =
  | { kind: "startOnboarding" }
  | { kind: "activate" }
  | { kind: "suspend"; input: SuspendInput }
  | { kind: "restore" }
  | { kind: "reject"; reason: string }
  | { kind: "waive"; input: WaiveStepInput }
  | { kind: "offboard"; input: EndEngagementInput }
  | { kind: "assignFunction"; input: AssignFunctionInput }
  | { kind: "removeFunction"; input: RemoveFunctionInput }
  | { kind: "recordLeave"; input: RecordLeaveInput }
  | { kind: "endLeave"; input: EndLeaveInput }
  | { kind: "recordStartDate"; input: RecordStartDateInput }
  | { kind: "reconcileAvailability" };

/**
 * One mutation for every engagement command.
 *
 * Kept as one so that every action invalidates the same three queries — the
 * engagement, its checklist and the list — and a screen cannot forget one and
 * show a stale state after a transition.
 */
export function useEngagementAction(engagementId: string) {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: EngagementAction) => {
      if (!ctx) throw new Error("No workspace selected.");
      switch (action.kind) {
        case "startOnboarding": return services.workforce.startOnboarding(ctx, engagementId);
        case "activate": return services.workforce.activate(ctx, engagementId);
        case "suspend": return services.workforce.suspend(ctx, engagementId, action.input);
        case "restore": return services.workforce.restore(ctx, engagementId);
        case "reject": return services.workforce.reject(ctx, engagementId, action.reason);
        case "waive": return services.workforce.waiveStep(ctx, engagementId, action.input);
        case "offboard": return services.workforce.offboard(ctx, engagementId, action.input);
        case "assignFunction":
          return services.workforce.assignFunction(ctx, engagementId, action.input);
        case "removeFunction":
          return services.workforce.removeFunction(ctx, engagementId, action.input);
        case "recordLeave":
          return services.workforce.recordLeave(ctx, engagementId, action.input);
        case "endLeave": return services.workforce.endLeave(ctx, engagementId, action.input);
        case "recordStartDate":
          return services.workforce.recordStartDate(ctx, engagementId, action.input);
        case "reconcileAvailability":
          return services.workforce.reconcileAvailability(ctx, engagementId);
      }
    },
    onSuccess: () => {
      if (!ctx) return;
      void client.invalidateQueries({ queryKey: [...orgKey(ctx.organizationId), "workforce"] });
      // Needs You reads engagement state, so a transition changes the queue.
      void client.invalidateQueries({ queryKey: [...orgKey(ctx.organizationId), "needs-you"] });
    },
  });
}

/** Adopting a document version into the carrier's qualification file. */
export function useAdoptDocument() {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdoptDocumentInput) => {
      if (!ctx) throw new Error("No workspace selected.");
      return services.qualification.adopt(ctx, input);
    },
    onSuccess: () => {
      if (!ctx) return;
      void client.invalidateQueries({ queryKey: orgKey(ctx.organizationId) });
    },
  });
}

export function useAdoptionPreview(documentId: string | null) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx && documentId
      ? [...orgKey(ctx.organizationId), "qualification", "preview", documentId]
      : ["qualification", "no-preview"],
    queryFn: () => services.qualification.previewAdoption(ctx!, documentId!),
    enabled: Boolean(ctx && documentId),
    staleTime: 0,
  });
}

/**
 * Creating an engagement, or connecting one for somebody already known.
 *
 * ONE mutation for both, because they are one command: the difference between
 * "connect this person" and "record somebody who has no account" is which
 * identity fields the input carries, not which service it calls. Two hooks
 * would be two code paths that could disagree about the duplicate check.
 */
export function useCreateEngagement() {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEngagementInput) => {
      if (!ctx) throw new Error("No workspace selected.");
      return services.workforce.create(ctx, input);
    },
    onSuccess: () => {
      if (!ctx) return;
      void client.invalidateQueries({ queryKey: [...orgKey(ctx.organizationId), "workforce"] });
      void client.invalidateQueries({ queryKey: [...orgKey(ctx.organizationId), "needs-you"] });
    },
  });
}

/** The people a manager or an approver can be chosen from. Memberships, never titles. */
export function useWorkspaceColleagues() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...orgKey(ctx.organizationId), "workforce", "colleagues"]
      : ["workforce", "no-context", "colleagues"],
    queryFn: () => services.responsibility.assignable(ctx!),
    enabled: Boolean(ctx),
  });
}
