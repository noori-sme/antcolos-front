import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import type { ServiceContext } from "@/lib/api/contracts/context";
import { driverWorkflowStore } from "@/lib/api/mock/driver-workflow-store";
import { mockStore } from "@/lib/api/mock/store";
import { resetIntegrationMocks } from "@/lib/integrations";
import { workspaceKindOf, type EventSource } from "@/types";

/**
 * Builds a real `ServiceContext` from the real fixtures, so a test exercises
 * the same permission set, record scope and actor the app would send. Nothing
 * here fabricates permissions: if a membership cannot do something in the
 * product, it cannot do it in a test either.
 */
export function contextFor(
  membershipId: string,
  options: { source?: EventSource } = {},
): ServiceContext {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === membershipId);
  if (!membership) throw new Error(`No fixture membership ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;

  return {
    organizationId: organization.id,
    // Taken from the same fixture organization as everything else here, so the
    // context a test runs under is the one the product would build.
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
      // The channel. A Telegram call is the same call with this set differently.
      source: (options.source as "web" | "telegram" | "system") ?? "web",
    },
  };
}

export const CASCADE_DRIVER = "mem_cascade_driver";
export const STONEBRIDGE_DRIVER = "mem_stonebridge_driver";
export const NORTHLINE_OWNER = "mem_northline_owner";
export const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";

/** Every test starts from the same seeded world. */
export function resetWorld() {
  driverWorkflowStore.reset();
  resetIntegrationMocks();
  mockStore.reset();
}

let keySequence = 0;
/** A fresh idempotency key. Reuse one deliberately to test replay. */
export function key(label = "k"): string {
  keySequence += 1;
  return `${label}-${keySequence}`;
}
