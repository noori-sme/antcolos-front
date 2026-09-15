import { effectivePermissions } from "@/lib/permissions/effective";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import { workspaceKindOf, type PermissionKey } from "@/types";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { resetMtLoops } from "@/lib/api/mock/mt-loop";
import { resetBookings } from "@/lib/api/mock/booking";
import { resetNegotiations } from "@/lib/api/mock/negotiation";
import { resetListings } from "@/lib/api/mock/listing-registry";
import { resetMatches } from "@/lib/api/mock/opportunity-matching";
import { resetDrafts } from "@/lib/api/mock/outreach-drafts";
import { resetCommunications } from "@/lib/api/mock/communications";
import { resetDriverReviews } from "@/lib/api/mock/driver-review";
import { resetRateConfirmations } from "@/lib/api/mock/rate-confirmation";
import { resetRateConfirmationRecords } from "@/lib/api/mock/rate-confirmation-record";
import { resetExtractionQueue } from "@/lib/api/mock/rate-con-extractions";
import { resetLoadCommands, resetLoadFinalizations } from "@/lib/api/mock/load-commands";
import { resetMeterLedger } from "@/lib/api/mock/meter-ledger";
import { resetFuelStore } from "@/lib/api/mock/fuel-store";
import { resetMaintenanceRegistry } from "@/lib/api/mock/maintenance-registry";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetDriverWorkflowAdapter } from "@/lib/api/mock/driver-workflow-adapter";
import { resetPropagationBus } from "@/lib/propagation";
import { mockStore } from "@/lib/api/mock/store";

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
 * Put every store the propagation flow touches back to its fixture state.
 *
 * Order matters in one place: the bus is cleared LAST, because clearing a store
 * can publish nothing but rebuilding a seed can.
 */
export function resetPropagationWorld() {
  mockStore.reset();
  resetTruckRegistry();
  resetFleetTelemetry();
  resetMeterLedger();
  resetMaintenanceRegistry();
  resetFuelStore();
  resetMtLoops();
  resetListings();
  resetMatches();
  resetDrafts();
  resetNegotiations();
  resetDriverReviews();
  resetCommunications();
  resetBookings();
  resetRateConfirmations();
  resetRateConfirmationRecords();
  resetExtractionQueue();
  resetLoadCommands();
  resetLoadFinalizations();
  resetDriverWorkflowAdapter();
  resetPropagationBus();
}
