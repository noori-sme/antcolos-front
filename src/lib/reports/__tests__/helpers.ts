import type { ServiceContext } from "@/lib/api/contracts/context";
import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_USER,
} from "@/lib/session/fixtures";
import { workspaceKindOf, type ReportFilters } from "@/types";

/**
 * Builds a ServiceContext exactly the way the app does — from a real fixture
 * membership and its effective permissions — so a test can never grant itself
 * access the product would not.
 */
export function contextFor(membershipId: string): ServiceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No fixture membership ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  return {
    organizationId: organization.id,
    workspaceKind: workspaceKindOf(organization),
    organizationName: organization.displayName,
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
  };
}

/** A wide range, so fixtures generated relative to load time always fall in it. */
export function wideFilters(): ReportFilters {
  const to = new Date(Date.now() + 30 * 86_400_000);
  const from = new Date(Date.now() - 365 * 86_400_000);
  return { range: { from: from.toISOString(), to: to.toISOString() } };
}

export const OWNER_CARRIER = "mem_northline_owner";
export const DISPATCH_OWNER = "mem_summit_owner";
export const INDIVIDUAL_DISPATCHER = "mem_meridian_dispatcher";
export const DRIVER = "mem_cascade_driver";
export const CARRIER_WITHOUT_DATA = "mem_baxter_owner";
