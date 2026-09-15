"use client";

import { useMemo } from "react";
import { useActiveMembership, usePermissions, useSession } from "@/lib/session/hooks";
import type { PartyContext } from "@/lib/api/mock/party-registry";

/**
 * The directory context for the signed-in membership.
 *
 * The organization comes from the active membership and nowhere else — never
 * from a route param, a form field or a prop — so a screen cannot ask the
 * registry to read another carrier's private notes by passing a different id.
 */
export function usePartyContext(): PartyContext | null {
  const { user } = useSession();
  const { membership } = useActiveMembership();
  const permissions = usePermissions();

  return useMemo(() => {
    if (!membership) return null;
    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      actorName: user.displayName,
      userId: user.id,
      permissions,
    };
  }, [membership, permissions, user.displayName, user.id]);
}
