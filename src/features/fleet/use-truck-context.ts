"use client";

import { useMemo } from "react";
import { useActiveMembership, usePermissions, useSession } from "@/lib/session/hooks";
import type { TruckContext } from "@/lib/api/mock/truck-registry";

/**
 * The registry context for the signed-in membership.
 *
 * The organization comes from the active membership and nowhere else — never
 * from a route param, a form field or a prop — so a screen cannot ask the
 * registry to act as somebody else.
 */
export function useTruckContext(): TruckContext | null {
  const { user } = useSession();
  const { membership } = useActiveMembership();
  const permissions = usePermissions();

  return useMemo(() => {
    if (!membership) return null;
    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      actorName: user.displayName,
      permissions,
      driverProfileId:
        membership.scope.loads === "assigned" ? membership.driverProfileId : undefined,
    };
  }, [membership, permissions, user.displayName]);
}
