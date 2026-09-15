"use client";

import {
  useMutation, useQuery, useQueryClient, type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
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
