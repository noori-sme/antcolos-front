"use client";

import { usePeopleList, usePerson } from "@/lib/api/use-org-people";
import type { OrgPeopleQuery } from "@/types/org-people";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey, queryKeys } from "@/lib/query/keys";
import type {
  CreateCredentialInput, CredentialStatus, UpdateCredentialInput,
} from "@/types/driver-credential";

/** This organization's drivers (users contract). */
export function useDrivers(query: OrgPeopleQuery) {
  return usePeopleList("drivers", query);
}

export function useDriver(userId: string) {
  return usePerson("drivers", userId);
}

/* Driver credentials (plan 20, backend plan 40) ------------------------------ */


/** One driver's credentials, soonest expiry first (`credential.read`). */
export function useDriverCredentials(userId: string, enabled = true) {
  const ctx = useServiceContext();
  const query = { userId, pageSize: 100 };
  return useQuery({
    queryKey: ctx
      ? queryKeys.credentialList(ctx.organizationId, query)
      : [...orgKey("none"), "credentials", "no-context"],
    queryFn: () => services.driverCredentials.list(ctx!, query),
    enabled: Boolean(ctx) && Boolean(userId) && enabled,
  });
}

export function useCredentialHistory(credentialId: string, enabled: boolean) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.credentialHistory(ctx.organizationId, credentialId)
      : [...orgKey("none"), "credentials", "no-context"],
    queryFn: () => services.driverCredentials.history(ctx!, credentialId, { pageSize: 100 }),
    enabled: Boolean(ctx) && enabled,
  });
}

/** Every credential write refreshes this organization's credential lists and histories. */
function useCredentialMutation<TVars, TResult>(
  run: (ctx: NonNullable<ReturnType<typeof useServiceContext>>, vars: TVars) => Promise<TResult>,
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    onSuccess: async () => {
      if (!ctx) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.credentials(ctx.organizationId) });
    },
  });
}

export function useCreateCredential() {
  return useCredentialMutation(
    (ctx, vars: { input: CreateCredentialInput; idempotencyKey: string }) =>
      services.driverCredentials.create(ctx, vars.input, vars.idempotencyKey),
  );
}

export function useUpdateCredential() {
  return useCredentialMutation(
    (ctx, vars: { id: string; input: UpdateCredentialInput }) =>
      services.driverCredentials.update(ctx, vars.id, vars.input),
  );
}

export function useChangeCredentialStatus() {
  return useCredentialMutation(
    (ctx, vars: { id: string; status: CredentialStatus; reason?: string; idempotencyKey: string }) =>
      services.driverCredentials.changeStatus(
        ctx,
        vars.id,
        { status: vars.status, ...(vars.reason ? { reason: vars.reason } : {}) },
        vars.idempotencyKey,
      ),
  );
}
