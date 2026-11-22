"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { selfMembershipKeys } from "@/lib/query/keys";
import { useSignOut } from "@/lib/session/use-sign-out";

/** Every organization the person belongs to (plan 25). */
export function useMyOrganizations() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? selfMembershipKeys.list(ctx.organizationId) : ["account", "no-context"],
    queryFn: () => services.selfMemberships.list(ctx!),
    enabled: Boolean(ctx),
  });
}

/**
 * Leave an organization. Leaving the one this session works in signs out at
 * once and refetches nothing: its token stops working, and a refetch would
 * hit the forced-logout path with a confusing message. Leaving another one
 * refreshes only the list (the session roster holds the current one only).
 */
export function useLeaveOrganization() {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  const signOut = useSignOut();
  return useMutation({
    mutationFn: async (organization: { organizationId: string; name: string }) => {
      if (!ctx) throw new Error("No organization selected");
      try {
        await services.selfMemberships.leave(ctx, organization.organizationId);
      } catch (error) {
        // Already gone (a repeat, or another tab): the list just needs to catch up.
        if (error instanceof Error && /membership not found/i.test(error.message)) return organization;
        throw error;
      }
      return organization;
    },
    onSuccess: async (organization) => {
      if (!ctx) return;
      if (organization.organizationId === ctx.organizationId) {
        signOut(`You left ${organization.name}. Sign in again to continue.`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: selfMembershipKeys.list(ctx.organizationId) });
    },
  });
}
