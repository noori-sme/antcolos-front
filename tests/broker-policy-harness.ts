import { effectivePermissions } from "@/lib/permissions/effective";
import { MOCK_ORGANIZATIONS, MOCK_USER } from "@/lib/session/fixtures";
import { workspaceKindOf, type Party, type PermissionKey } from "@/types";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { membershipRecordFor } from "@/lib/api/mock/membership-directory";
import { allParties } from "@/lib/api/mock/party-registry";
import { resetAllMocks } from "@/lib/api/mock/registry";

/**
 * Callers for the broker-policy suite, built the way the app builds them.
 *
 * ★ FROM THE REAL ROSTER, NOT FROM A HAND-WRITTEN PERMISSION SET ★
 * `tests/support/context.ts` resolves only the memberships the SESSION fixtures
 * ship — one per workspace, all of them the signed-in user. This suite needs
 * colleagues: a Northline dispatcher who is not the Owner, a Meridian
 * dispatcher who is not Meridian's Owner, and Meridian's Owner herself. Those
 * live in the membership directory, which is the one roster the product reads,
 * so this resolves through it and runs every seat through the real
 * `effectivePermissions`.
 *
 * The consequence matters: no test here can grant itself an authority the
 * product would refuse, and "a dispatcher may only propose" is proved against
 * the permissions a real Dispatcher template actually carries.
 */
export function policyContextFor(
  membershipId: string,
  overrides: Partial<MtLoopContext> = {},
): MtLoopContext {
  const membership = membershipRecordFor(membershipId);
  if (!membership) throw new Error(`No membership ${membershipId} in the directory`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId);
  if (!organization) throw new Error(`No organization ${membership.organizationId}`);

  return {
    organizationId: organization.id,
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization),
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization),
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: {
      userId: membership.userId === MOCK_USER.id ? MOCK_USER.id : membership.userId,
      membershipId: membership.id,
      displayNameSnapshot: membership.title ?? membership.id,
      source: "web",
    },
    organization,
    membership,
    ...overrides,
  };
}

export function withoutKeys(ctx: MtLoopContext, ...keys: PermissionKey[]): MtLoopContext {
  const permissions = new Set(ctx.permissions);
  for (const key of keys) permissions.delete(key);
  return { ...ctx, permissions };
}

export function resetPolicyWorld() {
  resetAllMocks();
}

/* -------------------------------------------------------------------------- */
/* The brokers the sample market actually posts                                */
/* -------------------------------------------------------------------------- */

/**
 * The canonical profile behind an MC number, resolved the way the product does.
 *
 * Every policy in these tests is written against a REAL Directory party, which
 * is the point: a policy that could be written against a name would be a policy
 * that could land on the wrong company.
 */
export function brokerPartyByMc(mcNumber: string): Party {
  const digits = mcNumber.replace(/\D/g, "");
  const party = allParties().find(
    (p) => p.broker?.official?.mcNumber === digits || p.identifiers.mcNumber === digits,
  );
  if (!party) throw new Error(`No canonical broker profile for MC ${mcNumber}`);
  return party;
}

/** Apex Logistics — the broker the midwest sample market posts most often. */
export const APEX_MC = "MC-612884";
/** Tandem Freight Partners — a second broker, for "not this one" assertions. */
export const TANDEM_MC = "MC-908114";

export const NORTHLINE = "org_northline";
export const BAXTER = "org_baxter";
export const MERIDIAN = "org_meridian";

/** Northline's Owner. Final authority over Northline's own broker policies. */
export const NORTHLINE_OWNER = "mem_northline_owner";
/** A Northline dispatcher who is NOT the Owner. */
export const NORTHLINE_DISPATCHER = "mem_northline_paige";
/** Baxter's Owner. The carrier Meridian dispatches for. */
export const BAXTER_OWNER = "mem_baxter_owner";
/** Meridian's Owner — Nadia. The signed-in user is only a dispatcher there. */
export const MERIDIAN_OWNER = "mem_meridian_owner";
/** A Meridian dispatcher. Delegated, and not an owner of anything. */
export const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";
