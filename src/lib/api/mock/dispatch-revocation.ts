import type { DocumentShare, TruckDispatchAccess } from "@/types";
import { grantIsLive } from "@/types";
import { sealDispatchReceipts } from "./booking";
import { allShares, currentVersion, revokeShare } from "./document-store";
import {
  dispatchGrantById, liveDispatchGrantsHeldBy, revokeTruckDispatchAccess,
  type TruckContext,
} from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * ★ WHAT ENDING A DISPATCH ARRANGEMENT ACTUALLY ENDS ★
 *
 * Revoking a grant is not one write. It is one write plus three consequences,
 * and the consequences are where a delegation feature leaks:
 *
 *   1. The grant itself closes. `truck-registry` owns that.
 *   2. The provider's work RECEIPT is sealed, while a command is still running
 *      and the load's state can honestly be read.
 *   3. Document access that exists BECAUSE of this delegation ends — and
 *      nothing else does.
 *
 * This module is a coordinator and owns no records. Each step is the command of
 * the module that owns the thing, so there is no second copy of any rule here.
 * It lives apart from `dispatch-delegation` because it needs Booking and the
 * Document Center, and those already depend on the guard.
 *
 * ── WHY DOCUMENT REVOCATION IS NARROW ──────────────────────────────────────
 * `endRelationshipDocuments` ends EVERY live link with a matching context
 * organization and revokes EVERY unrevoked share to that organization for a
 * subject. That is right for a carrier relationship ending and wrong here: a
 * provider may hold the same document on an unrelated basis, or for a
 * different carrier entirely, and a dispatch arrangement ending must not reach
 * any of it.
 *
 * So this revokes `DocumentShare`s only, and only those whose basis is
 * `dispatch_access` for the carrier whose grant just ended. It ends no LINKS at
 * all, because a `DocumentLink` carries no basis and no grant reference — there
 * is nothing on it that could say which delegation it belongs to, and ending
 * links by organization and subject alone is exactly the over-broad revocation
 * this design refuses. If load paperwork later gains grant-specific links, the
 * link will have to carry the attribution before anything here may end one.
 */

/* -------------------------------------------------------------------------- */
/* Document access attributable to a delegation                                */
/* -------------------------------------------------------------------------- */

/**
 * Does the provider still dispatch ANYTHING for this carrier?
 *
 * A `dispatch_access` share exists because the provider works for the carrier
 * at all — a carrier's insurance certificate is needed to tender any of its
 * freight, not one named truck. So the share survives while any grant from that
 * carrier survives, and ends with the last one. Revoking it when a single
 * truck's grant ends would cut off a provider still dispatching four others.
 */
function stillDispatchesFor(
  providerOrganizationId: string,
  carrierOrganizationId: string,
): boolean {
  return liveDispatchGrantsHeldBy(providerOrganizationId)
    .some((g) => g.grantedByCarrierOrganizationId === carrierOrganizationId);
}

/** The carrier that owns the document a share points at. */
function ownerOfShare(share: DocumentShare): string | undefined {
  return currentVersion(share.lineageId)?.organizationId;
}

/**
 * Shares that exist because of THIS delegation, and only those.
 *
 * Three conditions, all required: the basis says `dispatch_access`, the
 * recipient is this provider, and the document belongs to the carrier whose
 * grant ended. A share on any other basis — a driver's own package, a carrier
 * relationship, a workspace upgrade — is untouched, as is a share of the very
 * same document from a different carrier.
 */
export function delegationSharesFor(
  providerOrganizationId: string,
  carrierOrganizationId: string,
): DocumentShare[] {
  return allShares().filter(
    (s) => !s.revokedAt
      && s.basis.kind === "dispatch_access"
      && s.sharedWithOrganizationId === providerOrganizationId
      && ownerOfShare(s) === carrierOrganizationId,
  );
}

/* -------------------------------------------------------------------------- */
/* The command                                                                 */
/* -------------------------------------------------------------------------- */

export interface DispatchRevocationOutcome {
  grant: TruckDispatchAccess;
  /** Work receipts sealed for the provider by this revocation. */
  receiptsSealed: number;
  /** `dispatch_access` shares revoked. Zero while other grants remain. */
  sharesRevoked: number;
}

/**
 * The carrier ends one dispatch arrangement, and everything that followed from
 * it ends with it.
 *
 * Authorization is the registry's: only a membership holding
 * `trucks:relationships:manage` in the carrier that ISSUED the grant gets past
 * `revokeTruckDispatchAccess`, and anything else is a not-found.
 */
export async function revokeDispatchDelegation(
  grantId: string,
  reason: string,
  ctx: TruckContext,
): Promise<DispatchRevocationOutcome> {
  const before = dispatchGrantById(grantId);
  const grant = await revokeTruckDispatchAccess(grantId, reason, ctx);

  return {
    grant,
    ...cascadeAfterEnding(grant, {
      basis: "revoked",
      note: `${grant.grantedByCarrierName} ended this dispatch arrangement.`,
      truckId: before?.truckId,
    }),
  };
}

/**
 * The same consequences, for a grant that ended some other way.
 *
 * `transferred` is a command running, so the receipt carries the status it
 * could see. `expired_unobserved` is reconciliation noticing afterwards that
 * an `effectiveTo` has passed — nothing ran at that instant, so the receipt
 * records no status at all rather than pretending somebody was watching.
 */
export function cascadeAfterEnding(
  grant: TruckDispatchAccess,
  input: {
    basis: "revoked" | "transferred" | "expired_unobserved";
    note: string;
    truckId?: string;
  },
): { receiptsSealed: number; sharesRevoked: number } {
  const at = grant.endedAt ?? grant.effectiveTo ?? new Date().toISOString();

  const receiptsSealed = sealDispatchReceipts({
    providerOrganizationId: grant.dispatchOrganizationId,
    carrierOrganizationId: grant.grantedByCarrierOrganizationId,
    truckId: input.truckId ?? grant.truckId,
    basis: input.basis,
    at,
    note: input.note,
  });

  let sharesRevoked = 0;
  if (!stillDispatchesFor(grant.dispatchOrganizationId, grant.grantedByCarrierOrganizationId)) {
    for (const share of delegationSharesFor(
      grant.dispatchOrganizationId,
      grant.grantedByCarrierOrganizationId,
    )) {
      revokeShare(share.id, input.note, grant.endedByName ?? grant.grantedByCarrierName);
      sharesRevoked += 1;
    }
  }

  return { receiptsSealed, sharesRevoked };
}

/**
 * Notices grants that have lapsed on their own and seals what they left behind.
 *
 * ★ THERE IS NO SCHEDULER, AND THIS IS NOT PRETENDING TO BE ONE ★
 * Nothing runs at `effectiveTo`. Reach already refuses from that instant
 * onwards because every check asks `grantIsLive` rather than reading `status`,
 * so access is correct with or without this. What this adds is the receipt —
 * and it records `expired_unobserved`, with no status, precisely because by the
 * time anybody called this the moment had passed unwatched.
 *
 * Idempotent: a receipt is written once, and a grant is closed once.
 */
export function reconcileExpiredDispatchGrants(
  grants: readonly TruckDispatchAccess[],
): number {
  let closed = 0;
  for (const grant of grants) {
    if (grant.status !== "active") continue;
    if (grantIsLive(grant)) continue;
    grant.status = "ended";
    grant.endedAt = grant.effectiveTo;
    grant.endReason = "The arrangement reached the end of its agreed period.";
    cascadeAfterEnding(grant, {
      basis: "expired_unobserved",
      note:
        "This arrangement ended on its own date. Antcolos was not running at "
        + "that moment, so it cannot say what the load's status was then.",
    });
    closed += 1;
  }
  return closed;
}
