import { effectivePermissions } from "@/lib/permissions/effective";
import { DEFAULT_SCOPE, OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import {
  MOCK_ORGANIZATIONS, MOCK_USER,
} from "@/lib/session/fixtures";
import {
  membershipRecordFor, memberById,
} from "@/lib/api/mock/membership-directory";
import type { ResponsibilityCandidate } from "@/lib/responsibility";
import { fleetProfileFor } from "@/lib/responsibility";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type {
  PermissionKey, ResponsibilityContext, ResponsibilityFunction,
} from "@/types";
import { workspaceKindOf } from "@/types";

/**
 * Callers and candidates built the way the app builds them.
 *
 * `contextFor` runs a real fixture membership through the real
 * `effectivePermissions`, so a test can never assert against access the product
 * would not actually grant. `candidate` is the exception and says so: it exists
 * for the workspaces that do NOT exist in the fixtures — a brand-new one-truck
 * carrier with nobody in it but its Owner — which is precisely the case the
 * milestone asks to be proven and precisely the case no fixture can supply.
 */

export function contextFor(
  membershipId: string,
  over: { permissions?: PermissionKey[]; without?: PermissionKey[] } = {},
): ServiceContext {
  // Resolved through the membership directory rather than the session
  // fixtures, so a test can act as a COLLEAGUE — the operations lead, the
  // bookkeeper, the driver down the hall — and not only as the one person the
  // demo session signs in as.
  const membership = membershipRecordFor(membershipId);
  if (!membership) throw new Error(`No such membership: ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  const permissions = over.permissions
    ? new Set(over.permissions)
    : effectivePermissions(membership, organization);
  for (const key of over.without ?? []) permissions.delete(key);

  return {
    organizationId: organization.id,
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization),
    membershipId: membership.id,
    permissions,
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: {
      userId: membership.userId,
      membershipId: membership.id,
      displayNameSnapshot: memberById(membership.id)?.displayName ?? MOCK_USER.displayName,
      source: "web",
    },
  };
}

/** The seeded memberships these scenarios are worth exercising against. */
export const NORTHLINE_OWNER = "mem_northline_owner";
export const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";
export const SUMMIT_OWNER = "mem_summit_owner";
export const SOLO_DISPATCHER = "mem_solo_dispatcher";
export const BAXTER_OWNER = "mem_baxter_owner";
export const CASCADE_DRIVER = "mem_cascade_driver";

/** Colleagues, reachable because `contextFor` reads the directory. */
export const NORTHLINE_PAIGE = "mem_northline_paige";
export const NORTHLINE_SHOP = "mem_northline_disp2";
export const NORTHLINE_BOOKS = "mem_northline_books";
export const NORTHLINE_DRIVER = "mem_northline_driver_wes";
export const MERIDIAN_OWNER = "mem_meridian_owner";
export const MERIDIAN_OPS = "mem_meridian_ops";
export const MERIDIAN_LANE = "mem_meridian_lane";
export const MERIDIAN_INES = "mem_meridian_ines";
export const MERIDIAN_SUSPENDED = "mem_meridian_night";
export const SUMMIT_DEVON = "mem_summit_dev";
export const SUMMIT_ON_LEAVE = "mem_summit_rosa";

/* -------------------------------------------------------------------------- */
/* Hand-built candidates, for workspaces that do not exist yet                  */
/* -------------------------------------------------------------------------- */

const ALL_PERMISSIONS: PermissionKey[] = [
  "loads:view", "loads:assign", "loads:create", "loads:edit", "trucks:view",
  "trailers:view", "drivers:view", "documents:view", "documents:upload",
  "members:view", "members:edit", "organization:manage", "maintenance:view",
  "maintenance:manage", "compliance:view", "compliance:manage",
];

export function candidate(
  over: Partial<ResponsibilityCandidate> & { membershipId: string },
): ResponsibilityCandidate {
  return {
    organizationId: "org_new",
    displayName: over.membershipId,
    status: "active",
    isOwner: false,
    permissions: new Set(ALL_PERMISSIONS),
    scope: DEFAULT_SCOPE,
    takesWork: true,
    functions: [],
    truckIds: [],
    carrierOrganizationIds: [],
    ...over,
  };
}

/** A driver membership: own records only, linked to a driver profile. */
export function driverCandidate(
  over: Partial<ResponsibilityCandidate> & { membershipId: string; driverProfileId: string },
): ResponsibilityCandidate {
  return candidate({
    scope: OWN_RECORDS_SCOPE,
    functions: ["driver_action"],
    permissions: new Set<PermissionKey>([
      "loads:view", "documents:view", "documents:upload", "compliance:view",
      "trucks:view", "maintenance:view", "maintenance:defects:report",
    ]),
    ...over,
  });
}

/* -------------------------------------------------------------------------- */
/* Work                                                                        */
/* -------------------------------------------------------------------------- */

const HOUR = 3_600_000;
export const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR).toISOString();
export const hoursFromNow = (n: number) => new Date(Date.now() + n * HOUR).toISOString();

export function work(
  over: Partial<ResponsibilityContext> & { functionKey?: ResponsibilityFunction } = {},
): ResponsibilityContext {
  return {
    organizationId: "org_new",
    work: { kind: "needs_you", id: "w1", label: "Something to do" },
    functionKey: "dispatch",
    severity: "medium",
    scope: [],
    requires: ["loads:view"],
    openedAt: hoursAgo(1),
    ...over,
  };
}

/** A workspace profile, for the engine tests that are not about a fixture. */
export function profile(truckCount: number, members: readonly ResponsibilityCandidate[]) {
  return fleetProfileFor({ organizationId: "org_new", truckCount, members });
}
