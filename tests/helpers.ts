import { effectivePermissions } from "@/lib/permissions/effective";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER } from "@/lib/session/fixtures";
import type { PermissionKey } from "@/types";
import type { ServiceContext as SvcCtx } from "@/lib/api/contracts/context";
import { maintenanceContextFrom, type MaintenanceContext } from "@/lib/api/mock/maintenance-registry";

/**
 * Contexts built the same way the app builds them: from a real membership in
 * the session fixtures, through `effectivePermissions`. Nothing here hand-rolls
 * a permission set, so a test cannot pass with access the product would not
 * actually grant.
 */
export function serviceContext(
  membershipId: string,
  overrides: Partial<SvcCtx> = {},
): SvcCtx {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No such membership: ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  return {
    organizationId: organization.id,
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
    ...overrides,
  };
}

export function ctxFor(membershipId: string): MaintenanceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId)!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
  return maintenanceContextFrom({
    ...serviceContext(membershipId),
    organizationName: organization.displayName,
  });
}

/** The same context minus specific permissions, to prove the seam enforces them. */
export function without(ctx: MaintenanceContext, ...keys: PermissionKey[]): MaintenanceContext {
  const permissions = new Set(ctx.permissions);
  for (const key of keys) permissions.delete(key);
  return { ...ctx, permissions };
}

export function withOnly(ctx: MaintenanceContext, ...keys: PermissionKey[]): MaintenanceContext {
  return { ...ctx, permissions: new Set(keys) };
}

export async function rejects(fn: () => Promise<unknown>, name: string): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    const e = error as Error;
    if (e.name !== name) throw new Error(`Expected ${name}, got ${e.name}: ${e.message}`);
    return e;
  }
  throw new Error(`Expected ${name}, but the call succeeded.`);
}

export type { SvcCtx as ServiceContext };
