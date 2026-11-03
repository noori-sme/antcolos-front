"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import type { ServiceContext } from "@/lib/api/contracts/context";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import type {
  ApproveInvitationRequestInput, CreateOrgInvitationInput, CreateOrgRoleInput,
  OrgInvitationListQuery, UpdateOrgRoleInput,
} from "@/types/org-access";

/**
 * Real invitations and roles (NestJS identity API), namespaced by organization.
 * Mutations invalidate the narrowest prefix that covers what they changed.
 */
export const accessKeys = {
  invitations: (org: string) => [...orgKey(org), "access", "invitations"] as const,
  invitationList: (org: string, query: OrgInvitationListQuery) =>
    [...orgKey(org), "access", "invitations", "list", query] as const,
  requests: (org: string) => [...orgKey(org), "access", "invitation-requests"] as const,
  roles: (org: string) => [...orgKey(org), "access", "roles"] as const,
  catalog: (org: string) => [...orgKey(org), "access", "permission-catalog"] as const,
};

/**
 * The org a key is scoped to. Without one the queries are disabled, but a
 * manual refetch can still run, so even that key stays org-namespaced.
 */
const orgOf = (ctx: ServiceContext | null) => ctx?.organizationId ?? "none";

/** Mutations need an organization; a missing one is a clear error, not a crash. */
function requireCtx(ctx: ServiceContext | null): ServiceContext {
  if (!ctx) throw new Error("No organization is selected.");
  return ctx;
}

/*
 * The invitation and request lists have always re-read on every visit
 * (staleTime 0, refetch on mount): people act on them from email links in
 * other tabs, so a cached list would show stale statuses. Kept on purpose.
 */
const ALWAYS_FRESH = { staleTime: 0, refetchOnMount: "always" } as const;

export function useOrgInvitations(query: OrgInvitationListQuery = {}) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: accessKeys.invitationList(orgOf(ctx), query),
    queryFn: () => services.orgInvitations.list(ctx!, query),
    enabled: Boolean(ctx),
    ...ALWAYS_FRESH,
  });
}

export function useInvitationRequests() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: accessKeys.requests(orgOf(ctx)),
    queryFn: () => services.orgInvitations.listRequests(ctx!, {}),
    enabled: Boolean(ctx),
    ...ALWAYS_FRESH,
  });
}

export function useOrgRoles() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: accessKeys.roles(orgOf(ctx)),
    queryFn: () => services.orgRoles.list(ctx!),
    enabled: Boolean(ctx),
  });
}

export function usePermissionCatalog() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: accessKeys.catalog(orgOf(ctx)),
    queryFn: () => services.orgRoles.catalog(ctx!),
    enabled: Boolean(ctx),
    // The picker has always re-read the catalog when it opens, so a key
    // synced on the backend shows up without a reload. Kept on purpose.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });
}

function useInvalidate() {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return (key: (org: string) => readonly unknown[]) =>
    ctx ? client.invalidateQueries({ queryKey: key(ctx.organizationId) }) : Promise.resolve();
}

export function useCreateInvitation() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateOrgInvitationInput) =>
      services.orgInvitations.create(requireCtx(ctx), input),
    onSuccess: () => Promise.all([invalidate(accessKeys.invitations), invalidate(accessKeys.requests)]),
  });
}

export function useResendInvitation() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (invitationId: string) => services.orgInvitations.resend(requireCtx(ctx), invitationId),
    onSuccess: () => invalidate(accessKeys.invitations),
  });
}

export function useRevokeInvitation() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (invitationId: string) => services.orgInvitations.revoke(requireCtx(ctx), invitationId),
    onSuccess: () => invalidate(accessKeys.invitations),
  });
}

export function useDecideInvitationRequest() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      requestId, decision, input,
    }: { requestId: string; decision: "approve" | "reject"; input?: ApproveInvitationRequestInput }) =>
      decision === "approve"
        ? services.orgInvitations.approveRequest(requireCtx(ctx), requestId, input)
        : services.orgInvitations.rejectRequest(requireCtx(ctx), requestId),
    // An approved request becomes a sent invitation, so both lists move.
    onSuccess: () => Promise.all([invalidate(accessKeys.requests), invalidate(accessKeys.invitations)]),
  });
}

export function useCreateRole() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateOrgRoleInput) => services.orgRoles.create(requireCtx(ctx), input),
    onSuccess: () => invalidate(accessKeys.roles),
  });
}

export function useUpdateRole() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ roleId, input }: { roleId: string; input: UpdateOrgRoleInput }) =>
      services.orgRoles.update(requireCtx(ctx), roleId, input),
    onSuccess: () => invalidate(accessKeys.roles),
  });
}

export function useDeleteRole() {
  const ctx = useServiceContext();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (roleId: string) => services.orgRoles.remove(requireCtx(ctx), roleId),
    onSuccess: () => invalidate(accessKeys.roles),
  });
}
