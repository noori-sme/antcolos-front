"use client";

import { useMemo } from "react";
import { useActiveMembership, usePermissions, useSession } from "@/lib/session/hooks";
import type { TrailerContext } from "@/lib/api/mock/trailer-registry";

/**
 * The trailer registry context for the signed-in membership.
 *
 * The organization comes from the active membership and nowhere else — never
 * from a route param, a form field or a prop — so a screen cannot ask the
 * registry to act as somebody else.
 */
export function useTrailerContext(): TrailerContext | null {
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
