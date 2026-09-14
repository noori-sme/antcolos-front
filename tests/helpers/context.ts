import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import type { PermissionKey } from "@/types";
import type { ServiceContext } from "@/lib/api/contracts/context";

/**
 * A ServiceContext built exactly the way the app builds one: from a membership,
 * its organization and the permissions that membership actually resolves to.
 *
 * Tests that hand-rolled a permission set would prove nothing about the app —
 * the interesting question is what a REAL membership can reach, and that is
 * what this produces.
 */
export function contextFor(
  membershipId: string,
  over: { permissions?: PermissionKey[]; without?: PermissionKey[] } = {},
): ServiceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No such membership: ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  const permissions = over.permissions
    ? new Set(over.permissions)
    : effectivePermissions(membership, organization, MOCK_TEMPLATES);
  for (const key of over.without ?? []) permissions.delete(key);

  return {
    organizationId: organization.id,
    membershipId: membership.id,
    permissions,
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: {
      userId: MOCK_USER.id,
      membershipId: membership.id,
      displayNameSnapshot: MOCK_USER.displayName,
      source: "web",
    },
  };
}

/** The seeded memberships the fleet layer is worth exercising against. */
export const NORTHLINE_OWNER = "mem_northline_owner";
export const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";
export const BAXTER_OWNER = "mem_baxter_owner";
export const CASCADE_DRIVER = "mem_cascade_driver";
export const SUMMIT_OWNER = "mem_summit_owner";
