import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import { workspaceKindOf, type PermissionKey } from "@/types";
import type { TrackingContext } from "@/lib/api/mock/tracking-registry";
import { resetTracking } from "@/lib/api/mock/tracking-registry";
import { resetTrackingSignals } from "@/lib/api/mock/tracking-signals";
import { resetEmptyConfirmations } from "@/lib/api/mock/tracking-availability";
import { resetMtLoops } from "@/lib/api/mock/mt-loop";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { resetEldRegistry } from "@/lib/api/mock/eld-registry";
import { mockStore } from "@/lib/api/mock/store";

/**
 * Callers built the way the app builds them — from a real fixture membership,
 * through `effectivePermissions` — so a test can never assert against access
 * the product would not actually grant.
 */
export function trackingContextFor(
  membershipId: string,
  overrides: Partial<TrackingContext> = {},
): TrackingContext {
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

/** The same caller minus specific permissions, to prove the seam enforces them. */
export function without(ctx: TrackingContext, ...keys: PermissionKey[]): TrackingContext {
  const permissions = new Set(ctx.permissions);
  for (const key of keys) permissions.delete(key);
  return { ...ctx, permissions };
}

export function withOnly(ctx: TrackingContext, ...keys: PermissionKey[]): TrackingContext {
  return { ...ctx, permissions: new Set(keys) };
}

/**
 * Put every store this module touches back to its fixture state.
 *
 * The tracking layer reads from six of them and owns two, so a test that reset
 * only its own would pass against state a previous test left behind. The ELD
 * registry is the one that bites hardest: telemetry SHARES live there, so a
 * test that grants one and does not clear it hands the next test an access
 * grant it never asked for — and a sharing test that passes because of a
 * leaked grant is worse than no test at all.
 */
export function resetWorld() {
  mockStore.reset();
  resetTruckRegistry();
  resetEldRegistry();
  resetFleetTelemetry();
  resetMtLoops();
  resetTracking();
  resetTrackingSignals();
  resetEmptyConfirmations();
}

export const NORTHLINE_OWNER = "mem_northline_owner";
export const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";
export const SUMMIT_OWNER = "mem_summit_owner";
export const SOLO_DISPATCHER = "mem_solo_dispatcher";
export const BAXTER_OWNER = "mem_baxter_owner";
export const CASCADE_DRIVER = "mem_cascade_driver";

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
