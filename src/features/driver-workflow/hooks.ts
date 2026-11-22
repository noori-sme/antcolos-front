"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  driverLoadKeys, loadExceptionKeys, loadRecordKeys, maintenanceKeys, orgKey,
} from "@/lib/query/keys";
import { useCan } from "@/lib/session/hooks";
import type { ReadingInput } from "@/types/maintenance-live";
import type { ReportExceptionInput } from "@/types/load-exception";
import { createIntentKeys } from "@/lib/rate-con/intent-key";
import type { NextMilestone } from "@/types/driver-load";
import type {
  ProposalCommand, WorkflowCommand,
} from "@/lib/driver-workflow/commands";
import type {
  DriverProposalFilters, ProposalCommandResult, WorkflowCommandResult,
} from "@/lib/api/contracts/driver-workflow";

/**
 * The dashboard's only route into the feature. Every hook here calls the same
 * service methods the Telegram bot will call, with the same command objects —
 * there is no browser-only shortcut and no client-side rule.
 */

const driverKey = (organizationId: string, membershipId: string) =>
  [...orgKey(organizationId), "driver-workflow", membershipId] as const;

export function useDriverPolicy() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? [...driverKey(ctx.organizationId, ctx.membershipId), "policy"] : ["policy"],
    queryFn: () => services.driverWorkflow.policy(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useProposals(filters: DriverProposalFilters = {}) {
  const ctx = useServiceContext();
  const enabled = Boolean(ctx?.permissions.has("proposals:view"));
  return useQuery({
    queryKey: ctx
      ? [...driverKey(ctx.organizationId, ctx.membershipId), "proposals", filters]
      : ["proposals", "no-context"],
    queryFn: () => services.driverWorkflow.listProposals(ctx!, filters),
    enabled: Boolean(ctx) && enabled,
    // A pause expires on its own. Re-reading keeps the countdown honest without
    // the screen inventing a state the service has not agreed to.
    refetchInterval: 30_000,
  });
}

export function useProposal(proposalId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...driverKey(ctx.organizationId, ctx.membershipId), "proposal", proposalId]
      : ["proposal", "no-context"],
    queryFn: () => services.driverWorkflow.getProposal(ctx!, proposalId),
    enabled: Boolean(ctx),
    retry: false,
    refetchInterval: 30_000,
  });
}

export function useProposalEvents(proposalId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...driverKey(ctx.organizationId, ctx.membershipId), "proposal", proposalId, "events"]
      : ["proposal-events", "no-context"],
    queryFn: () => services.driverWorkflow.proposalEvents(ctx!, proposalId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export type ProposalMutation = UseMutationResult<
  ProposalCommandResult,
  Error,
  ProposalCommand
>;

/** One mutation for every proposal action, so invalidation lives in one place. */
export function useProposalCommand(): ProposalMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (command: ProposalCommand) => {
      if (!ctx) throw new Error("No active organization");
      return services.driverWorkflow.executeProposalCommand(ctx, command);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

export function useTrips() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? [...driverKey(ctx.organizationId, ctx.membershipId), "trips"] : ["trips"],
    queryFn: () => services.driverWorkflow.listTrips(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useTripByLoad(loadId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...driverKey(ctx.organizationId, ctx.membershipId), "trip", "load", loadId]
      : ["trip", "no-context"],
    queryFn: () => services.driverWorkflow.getTripByLoad(ctx!, loadId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export type WorkflowMutation = UseMutationResult<
  WorkflowCommandResult,
  Error,
  WorkflowCommand
>;

export function useWorkflowCommand(): WorkflowMutation {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (command: WorkflowCommand) => {
      if (!ctx) throw new Error("No active organization");
      return services.driverWorkflow.executeWorkflowCommand(ctx, command);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

/** Pulls whatever the signal boundary has, and records it as inferred. */
export function useIngestSignals() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workflowId: string) => {
      if (!ctx) throw new Error("No active organization");
      return services.driverWorkflow.ingestSignals(ctx, workflowId);
    },
    onSuccess: () => {
      if (!ctx) return;
      queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
    },
  });
}

export function usePendingHandoffs() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? [...driverKey(ctx.organizationId, ctx.membershipId), "handoffs"] : ["handoffs"],
    queryFn: () => services.driverWorkflow.pendingHandoffs(ctx!),
    enabled: Boolean(ctx),
  });
}

export function useIntegrationStatus() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ["integration-status"],
    queryFn: () => services.driverWorkflow.integrationStatus(ctx!),
    enabled: Boolean(ctx),
    staleTime: Infinity,
  });
}

/**
 * A stable idempotency key per intent.
 *
 * The key is minted when the driver opens the action and reused for every
 * attempt at it, so a double tap or a retry after a dropped connection is
 * recognised as the same submission rather than a second one. It is rotated
 * only once the command has actually landed.
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map<string, string>());

  const keyFor = useCallback((intent: string) => {
    const existing = keys.current.get(intent);
    if (existing) return existing;
    const minted = `${intent}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    keys.current.set(intent, minted);
    return minted;
  }, []);

  const rotate = useCallback((intent: string) => {
    keys.current.delete(intent);
  }, []);

  return { keyFor, rotate };
}

// ── The driver's own loads on the real API (F1.4, plan 16) ────────────────────

/** The driver's own loads on the real API (F1.4, plan 16). */
export function useDriverLoads() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? driverLoadKeys.list(ctx.organizationId) : [...orgKey("none"), "driver-loads", "no-context"],
    queryFn: () => services.driverLoads.list(ctx!, 1),
    enabled: Boolean(ctx),
  });
}

export function useDriverLoad(loadId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? driverLoadKeys.detail(ctx.organizationId, loadId)
      : [...orgKey("none"), "driver-loads", "no-context", loadId],
    queryFn: () => services.driverLoads.get(ctx!, loadId),
    enabled: Boolean(ctx),
    retry: false,
  });
}

/** One Idempotency-Key per intent, kept across re-renders. */
export function useIntentKeys() {
  const [keys] = useState(() => createIntentKeys());
  return keys;
}

export type DriverLoadAction =
  | { kind: "milestone"; next: NextMilestone }
  | { kind: "accept" }
  | { kind: "reject"; reason: string }
  | { kind: "upload"; type: "bol" | "pod"; stopSequence: number | null; file: File }
  // A problem on the load (F1.5): reported from the phone, the status does not change.
  | { kind: "report"; input: ReportExceptionInput };

/** Every driver write; on success the driver's loads (and the dispatcher's view) refetch. */
export function useDriverLoadAction(loadId: string) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, idempotencyKey }: { action: DriverLoadAction; idempotencyKey: string }) => {
      if (!ctx) throw new Error("Not signed in");
      const svc = services.driverLoads;
      switch (action.kind) {
        case "milestone":
          return svc.recordMilestone(ctx, loadId, {
            milestone: action.next.milestone,
            stopSequence: action.next.stopSequence,
          }, idempotencyKey);
        case "accept":
          return svc.accept(ctx, loadId, idempotencyKey);
        case "reject":
          return svc.reject(ctx, loadId, action.reason, idempotencyKey);
        case "upload":
          return svc.uploadDocument(ctx, loadId, {
            type: action.type,
            stopSequence: action.stopSequence,
            file: action.file,
          }, idempotencyKey);
        case "report":
          return services.loadExceptions.report(ctx, loadId, action.input, idempotencyKey);
      }
    },
    onSettled: () => {
      if (!ctx) return;
      void queryClient.invalidateQueries({ queryKey: driverLoadKeys.all(ctx.organizationId) });
      void queryClient.invalidateQueries({ queryKey: loadRecordKeys.all(ctx.organizationId) });
      void queryClient.invalidateQueries({ queryKey: loadExceptionKeys.all(ctx.organizationId) });
    },
  });
}

// ── The driver's own truck maintenance (F2.3, plan 24) ────────────────────

/** Their current truck's maintenance; `null` data when they drive no truck here. */
export function useMyTruckMaintenance() {
  const ctx = useServiceContext();
  const allowed = useCan("maintenance:own:view");
  return useQuery({
    queryKey: ctx ? maintenanceKeys.mine(ctx.organizationId) : ["maintenance", "no-context"],
    queryFn: () => services.maintenance.myTruck(ctx!),
    enabled: Boolean(ctx) && allowed,
  });
}

function useMyMaintenanceMutation<TVars>(run: (ctx: NonNullable<ReturnType<typeof useServiceContext>>, vars: TVars) => Promise<unknown>) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    onSuccess: async () => {
      if (!ctx) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: maintenanceKeys.mine(ctx.organizationId) }),
        queryClient.invalidateQueries({ queryKey: maintenanceKeys.tasksAll(ctx.organizationId) }),
        queryClient.invalidateQueries({ queryKey: maintenanceKeys.trucksAll(ctx.organizationId) }),
      ]);
    },
  });
}

export function useRecordMyReading() {
  return useMyMaintenanceMutation((ctx, vars: { input: ReadingInput; idempotencyKey: string }) =>
    services.maintenance.recordMyReading(ctx, vars.input, vars.idempotencyKey),
  );
}

export function useAcknowledgeMyTask() {
  return useMyMaintenanceMutation((ctx, vars: { taskId: string; idempotencyKey: string }) =>
    services.maintenance.acknowledgeMyTask(ctx, vars.taskId, vars.idempotencyKey),
  );
}

