import type { CarrierAttribution } from "@/types";
import type {
  CarrierRelationshipLike, OperatingContextResult, OperatingLeaseLike,
} from "@/lib/fleet/operating-context";

/**
 * Who was responsible, at a moment in the past.
 *
 * This is the rule the whole module hangs on: mileage and fuel belong to the
 * carrier whose operating authority was live WHEN THE TRAVEL OR PURCHASE
 * HAPPENED. Not the carrier that owns the truck today, not the carrier the
 * driver works for now, not whoever is looking at the screen.
 *
 * The rule itself lives in `@/lib/fleet/operating-context`, where the truck and
 * trailer registries and the meter ledger read it too. This module no longer
 * decides anything about intervals; it says what fuel does with the answer.
 */

/**
 * Fuel's attribution, derived from the ONE operating-context rule.
 *
 * This module used to carry a second point-in-time resolver of its own, over
 * the same canonical leases and relationships, and the two disagreed about
 * reserved leases, end boundaries, unapproved relationships and the carrier's
 * own truck. `resolveOperatingContextAt` is now the single rule for every
 * module, and this function is the translation: what that rule establishes,
 * said in the vocabulary a fuel record and an IFTA return speak.
 *
 * ★ WHAT DID NOT MOVE: `unresolved` ★
 * A refusal here is not a refusal to record. A fuel purchase that happened is
 * a fact whether or not Antcolos can work out whose authority it was under, so
 * the record is written, flagged, and put in front of a person. Only a MODULE
 * that would be writing into somebody's permanent history on the strength of
 * that answer — the meter ledger — refuses outright.
 */
export function attributionFrom<
  L extends OperatingLeaseLike,
  R extends CarrierRelationshipLike & { organizationName: string },
>(
  context: OperatingContextResult<L, R>,
  resolvedAt: string,
): CarrierAttribution {
  if (!context.resolved) {
    return {
      carrierOrganizationId: "",
      carrierNameSnapshot: "Not established",
      basis: "unresolved",
      resolvedAt,
    };
  }

  // Two bases, not three. `carrier_owned` and `sole_approved_relationship` are
  // both "a relationship said so" as far as a return is concerned; the
  // difference between them is how the rule got there, and it is on the
  // relationship record for anybody who needs it.
  if (context.basis === "operating_lease" && context.lease) {
    return {
      carrierOrganizationId: context.operatingCarrierOrganizationId,
      carrierNameSnapshot: context.relationship.organizationName,
      basis: "operating_lease",
      operatingLeaseId: context.lease.id,
      relationshipId: context.relationship.id,
      resolvedAt,
    };
  }

  return {
    carrierOrganizationId: context.operatingCarrierOrganizationId,
    carrierNameSnapshot: context.relationship.organizationName,
    basis: "carrier_relationship",
    relationshipId: context.relationship.id,
    resolvedAt,
  };
}

/**
 * A person stating the answer, when the history could not.
 *
 * Kept as its own basis so a return can always distinguish "the system knew"
 * from "somebody said so" — the two are not the same evidence in an audit.
 */
export function declareAttribution(
  carrierOrganizationId: string,
  carrierNameSnapshot: string,
  resolvedAt: string,
): CarrierAttribution {
  return {
    carrierOrganizationId,
    carrierNameSnapshot,
    basis: "manual_declaration",
    resolvedAt,
  };
}

/**
 * Whether a correction may change attribution.
 *
 * It may not. A correction fixes what was recorded — gallons, odometer, the
 * jurisdiction somebody typed wrong. Moving responsibility to a different
 * carrier after the fact is exactly the rewriting of history this module
 * exists to prevent, so the revision keeps the original's snapshot and the
 * service refuses anything else.
 */
export function carryForwardAttribution(original: CarrierAttribution): CarrierAttribution {
  return { ...original };
}
