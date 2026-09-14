import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import type { InsuranceContext } from "@/lib/api/mock/insurance-registry";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { ActorRef, PermissionKey } from "@/types";

/**
 * Callers for the tests, built the way the app builds them: from a real
 * membership in the real fixtures, through `effectivePermissions`. Nothing
 * here hand-writes a permission set, so a test can never grant access the
 * product would not.
 */

export const ALL_PERMISSIONS: ReadonlySet<PermissionKey> = new Set(
  PERMISSION_CATALOG.map((p) => p.key),
);

function actorFor(membershipId: string): ActorRef {
  return {
    userId: MOCK_USER.id,
    membershipId,
    displayNameSnapshot: MOCK_USER.displayName,
    source: "web",
  };
}

export function serviceContextFor(membershipId: string): ServiceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No fixture membership ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
  return {
    organizationId: organization.id,
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization, MOCK_TEMPLATES),
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: actorFor(membership.id),
  };
}

/** An insurance caller with a chosen permission set, in a chosen organization. */
export function insuranceCaller(
  organizationId: string,
  permissions: Iterable<PermissionKey> = ALL_PERMISSIONS,
  extra: Partial<InsuranceContext> = {},
): InsuranceContext {
  return {
    organizationId,
    membershipId: `mem_${organizationId}`,
    permissions: new Set(permissions),
    actor: actorFor(`mem_${organizationId}`),
    ...extra,
  };
}

/** Every permission except the named ones. */
export function allExcept(...withheld: PermissionKey[]): Set<PermissionKey> {
  const set = new Set(ALL_PERMISSIONS);
  for (const key of withheld) set.delete(key);
  return set;
}

export const NORTHLINE = "org_northline";
export const BAXTER = "org_baxter";
export const MERIDIAN = "org_meridian";
export const CASCADE = "org_cascade";
