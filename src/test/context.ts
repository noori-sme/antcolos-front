import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { Membership, PermissionKey } from "@/types";

/**
 * Service contexts for tests, built the same way the app builds them.
 *
 * Deliberately assembled from the real fixtures and the real
 * `effectivePermissions` rather than hand-written permission sets: a test that
 * invents its own context can pass while the thing the app actually sends
 * fails.
 */

export function membershipFor(organizationId: string): Membership {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.organizationId === organizationId);
  if (!membership) throw new Error(`No fixture membership in ${organizationId}`);
  return membership;
}

export function contextFor(
  organizationId: string,
  overrides: {
    /** Replaces the derived set outright. Use for "what if they lacked X". */
    permissions?: PermissionKey[];
    /** Removes keys from the derived set. */
    without?: PermissionKey[];
    /** Adds keys to the derived set. */
    with?: PermissionKey[];
    scope?: ServiceContext["scope"];
    driverProfileId?: string;
  } = {},
): ServiceContext {
  const membership = membershipFor(organizationId);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === organizationId)!;

  const derived = overrides.permissions
    ? new Set(overrides.permissions)
    : effectivePermissions(membership, organization, MOCK_TEMPLATES);

  for (const key of overrides.with ?? []) derived.add(key);
  for (const key of overrides.without ?? []) derived.delete(key);

  return {
    organizationId,
    membershipId: membership.id,
    permissions: derived,
    scope: overrides.scope ?? membership.scope,
    driverProfileId: overrides.driverProfileId ?? membership.driverProfileId,
    actor: {
      userId: MOCK_USER.id,
      membershipId: membership.id,
      displayNameSnapshot: MOCK_USER.displayName,
      source: "web",
    },
  };
}

/** The permission set a seeded template grants inside an organization. */
export function templatePermissions(organizationId: string, templateName: string): PermissionKey[] {
  const template = MOCK_TEMPLATES.find(
    (t) => t.organizationId === organizationId && t.name.toLowerCase() === templateName.toLowerCase(),
  );
  if (!template) throw new Error(`No ${templateName} template in ${organizationId}`);
  return template.permissions;
}
