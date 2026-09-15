"use client";

import { useMemo } from "react";
import {
  useActiveMembership, usePermissions, useSession,
} from "@/lib/session/hooks";
import { workspaceKindOf } from "@/types";
import type { ServiceContext } from "./contracts/context";

/**
 * Builds the ServiceContext every call carries: the active organization, the
 * membership's permissions, its record scope, and an actor snapshot. Components
 * never assemble this by hand and never call an adapter directly.
 */
export function useServiceContext(): ServiceContext | null {
  const { user } = useSession();
  const { membership, organization } = useActiveMembership();
  const permissions = usePermissions();

  return useMemo(() => {
    if (!membership || !organization) return null;
    return {
      organizationId: organization.id,
      organizationName: organization.displayName,
      workspaceKind: workspaceKindOf(organization),
      membershipId: membership.id,
      permissions,
      scope: membership.scope,
      driverProfileId: membership.driverProfileId,
      actor: {
        userId: user.id,
        membershipId: membership.id,
        displayNameSnapshot: user.displayName,
        source: "web",
      },
    };
  }, [membership, organization, permissions, user]);
}
