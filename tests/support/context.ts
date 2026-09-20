import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_USER,
} from "@/lib/session/fixtures";
import type { ServiceContext } from "@/lib/api/contracts/context";
import { workspaceKindOf, type Membership, type PermissionKey } from "@/types";

/**
 * Builds the same ServiceContext the app builds, from the same fixtures and the
 * same permission resolver.
 *
 * Tests that hand-roll a permission set prove nothing about the product: the
 * interesting failures are the ones where a real membership turns out to hold
 * more than anybody intended.
 */
export function contextFor(
  membershipId: string,
  overrides: Partial<ServiceContext> = {},
): ServiceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No fixture membership ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  return {
    organizationId: organization.id,
    // Required on ServiceContext since the Document Center; the workspace kind
    // decides which document requirements exist, so it is never inferred.
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization),
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization),
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: {
      userId: MOCK_USER.id,
      membershipId: membership.id,
      displayNameSnapshot: MOCK_USER.displayName,
      source: "web",
    },
    ...overrides,
  };
}

/** The same context with some permissions removed, to test the boundary. */
export function withoutPermissions(
  ctx: ServiceContext,
  ...remove: PermissionKey[]
): ServiceContext {
  const next = new Set(ctx.permissions);
  for (const key of remove) next.delete(key);
  return { ...ctx, permissions: next };
}

export function withPermissions(
  ctx: ServiceContext,
  ...add: PermissionKey[]
): ServiceContext {
  const next = new Set(ctx.permissions);
  for (const key of add) next.add(key);
  return { ...ctx, permissions: next };
}

export function membership(membershipId: string): Membership {
  return MOCK_MEMBERSHIPS.find((m) => m.id === membershipId)!;
}

export const NORTHLINE_OWNER = "mem_northline_owner";
export const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";
export const BAXTER_OWNER = "mem_baxter_owner";
export const CASCADE_DRIVER = "mem_cascade_driver";
export const SUMMIT_OWNER = "mem_summit_owner";
