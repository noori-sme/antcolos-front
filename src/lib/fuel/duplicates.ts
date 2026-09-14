import type { FuelTransaction } from "@/types";
import { costCentsOf, countableTransactions } from "./economy";

/**
 * Duplicate detection, at the level a foundation should have it.
 *
 * The realistic causes of a duplicate are boring: a card feed re-imported, a
 * driver entering a purchase the card already sent, somebody submitting a form
 * twice. All three produce two rows that agree on the truck, the moment and
 * the amount — so that is what is matched on, and nothing cleverer is claimed.
 *
 * Two matching strengths, and they are treated differently on purpose:
 *
 *   exact   Same external id from the same adapter. This IS the same row
 *           arriving twice; there is nothing to judge.
 *   likely  Same truck, near-identical time, gallons and cost. A person
 *           decides, and the record is only ever FLAGGED, never auto-removed.
 */

export const DUPLICATE_BOUNDS = {
  /** Purchases this close together are the same stop, not two stops. */
  windowMinutes: 45,
  /** Gallons may differ by this many thousandths and still be one purchase. */
  gallonsToleranceThousandths: 500,
  /** Cost may differ by this many cents and still be one purchase. */
  costToleranceCents: 200,
} as const;

export interface DuplicateMatch {
  transactionId: string;
  strength: "exact" | "likely";
  reason: string;
}

/**
 * Finds what an incoming purchase duplicates, among what is already recorded.
 *
 * Superseded revisions, rejections and rows already marked duplicate are not
 * candidates — matching against them would chain one duplicate onto another
 * and lose the record that is actually current.
 */
export function findDuplicate(
  candidate: Pick<
    FuelTransaction,
    "truckId" | "purchasedAt" | "gallonsThousandths" | "cost" | "sourceRef"
  > & { id?: string },
  existing: readonly FuelTransaction[],
): DuplicateMatch | null {
  const pool = countableTransactions(existing).filter((t) => t.id !== candidate.id);

  if (candidate.sourceRef) {
    const { adapterId, externalId } = candidate.sourceRef;
    const sameRow = pool.find(
      (t) => t.sourceRef?.adapterId === adapterId && t.sourceRef?.externalId === externalId,
    );
    if (sameRow) {
      return {
        transactionId: sameRow.id,
        strength: "exact",
        reason: `The same ${adapterId} record (${externalId}) is already in the ledger.`,
      };
    }
  }

  const at = Date.parse(candidate.purchasedAt);
  const windowMs = DUPLICATE_BOUNDS.windowMinutes * 60_000;

  const near = pool.find((t) => {
    if (t.truckId !== candidate.truckId) return false;
    if (Math.abs(Date.parse(t.purchasedAt) - at) > windowMs) return false;
    if (
      Math.abs(t.gallonsThousandths - candidate.gallonsThousandths) >
      DUPLICATE_BOUNDS.gallonsToleranceThousandths
    ) {
      return false;
    }
    return (
      Math.abs(costCentsOf(t) - (candidate.cost?.totalCostCents ?? 0)) <=
      DUPLICATE_BOUNDS.costToleranceCents
    );
  });

  if (near) {
    return {
      transactionId: near.id,
      strength: "likely",
      reason: `Same truck, within ${DUPLICATE_BOUNDS.windowMinutes} minutes, and the same gallons and cost as an existing purchase.`,
    };
  }

  return null;
}
