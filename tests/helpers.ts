import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_USER,
} from "@/lib/session/fixtures";
import type { InsuranceContext } from "@/lib/api/mock/insurance-registry";
import {
  maintenanceContextFrom, type MaintenanceContext,
} from "@/lib/api/mock/maintenance-registry";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { ServiceContext as SvcCtx } from "@/lib/api/contracts/context";
import { workspaceKindOf, type ActorRef, type PermissionKey } from "@/types";

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
    // From the same fixture organization as the permissions below, so the
    // context a test runs under is the one the app would build.
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization),
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization),
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

/* ────────────────────────────────────────────────────────────────────────────
 * Maintenance test helpers.
 *
 * A second set of context builders, kept because the maintenance tests name
 * them differently and take a maintenance overlay context rather than an
 * insurance one.
 * ──────────────────────────────────────────────────────────────────────────── */

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
    // Required on ServiceContext since the Document Center. The `...overrides`
    // spread below is a Partial, which widens the literal enough that tsc will
    // not flag these as missing — so they have to be got right here.
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
