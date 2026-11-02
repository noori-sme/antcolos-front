"use client";

import { useContext, useMemo } from "react";
import { can, canAll, canAny } from "@/lib/permissions/can";
import type { PermissionKey } from "@/types";
import { SessionContext, type SessionContextValue } from "./provider";

function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** "Who am I" — the permanent identity. Never carries permissions. */
/** An individual driver account: the shell is shown locked. */
export function useIsDriverAccount(): boolean {
  return useSessionContext().isDriverAccount;
}

export function useSession() {
  const { user, memberships, organizations, switchOrganization, density, setDensity } =
    useSessionContext();
  return { user, memberships, organizations, switchOrganization, density, setDensity };
}

/** "What may I do here" — the organization-scoped membership. */
export function useActiveMembership() {
  const { activeMembership, activeOrganization, isDriverMembership } =
    useSessionContext();
  return { membership: activeMembership, organization: activeOrganization, isDriverMembership };
}

export function usePermissions(): ReadonlySet<PermissionKey> {
  return useSessionContext().permissions;
}

export function useCan(permission: PermissionKey): boolean {
  const permissions = usePermissions();
  return can(permissions, permission);
}

export function useCanAll(permissions: readonly PermissionKey[]): boolean {
  const set = usePermissions();
  return useMemo(() => canAll(set, permissions), [set, permissions]);
}

export function useCanAny(permissions: readonly PermissionKey[]): boolean {
  const set = usePermissions();
  return useMemo(() => canAny(set, permissions), [set, permissions]);
}
