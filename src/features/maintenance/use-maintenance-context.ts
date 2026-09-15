"use client";

import { useMemo } from "react";
import { useActiveMembership, usePermissions, useSession } from "@/lib/session/hooks";
import {
  maintenanceContextFrom, type MaintenanceContext,
} from "@/lib/api/mock/maintenance-registry";

/**
 * The maintenance context for the signed-in membership.
 *
 * The organization comes from the active membership and nowhere else — never
 * from a route param, a form field or a prop — so a screen cannot ask the
 * registry to act as somebody else. The organization NAME is passed too,
 * because completing a repair order snapshots it into a permanent record that
 * must still read correctly after the organization is renamed or the
 * relationship ends.
 */
export function useMaintenanceContext(): MaintenanceContext | null {
  const { user } = useSession();
  const { membership, organization } = useActiveMembership();
  const permissions = usePermissions();

  return useMemo(() => {
    if (!membership || !organization) return null;
    return maintenanceContextFrom({
      organizationId: organization.id,
      organizationName: organization.displayName,
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
    });
  }, [membership, organization, permissions, user]);
}
