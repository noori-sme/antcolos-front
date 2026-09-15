import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import { workspaceKindOf, type PermissionKey } from "@/types";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { resetAllMocks } from "@/lib/api/mock/registry";

/**
 * Callers built the way the app builds them — from a real fixture membership,
 * through `effectivePermissions` — so a test can never assert against access the
 * product would not actually grant.
 */
export function loopContextFor(
  membershipId: string,
  overrides: Partial<MtLoopContext> = {},
): MtLoopContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No fixture membership ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  return {
    organizationId: organization.id,
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization),
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization, MOCK_TEMPLATES),
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: {
      userId: MOCK_USER.id,
      membershipId: membership.id,
      displayNameSnapshot: MOCK_USER.displayName,
      source: "web",
    },
    organization,
    membership,
    ...overrides,
  };
}

export function without(ctx: MtLoopContext, ...keys: PermissionKey[]): MtLoopContext {
  const permissions = new Set(ctx.permissions);
  for (const key of keys) permissions.delete(key);
  return { ...ctx, permissions };
}

/**
 * Put every mock store back to its fixture state.
 *
 * Delegates to the central registry rather than naming stores, so a test written
 * today does not silently run against a store added tomorrow. `tests/mock-registry.test.ts`
 * is what keeps that registry from falling behind.
 */
export function resetPropagationWorld() {
  resetAllMocks();
}
