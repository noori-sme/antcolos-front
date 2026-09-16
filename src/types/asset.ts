/**
 * Primitives shared by every permanent physical asset in Antcolos.
 *
 * A truck and a trailer are different things — one is powered and carries a
 * driver, the other is pulled and carries freight — but the questions Antcolos
 * asks about them are the same: who owns it, which carriers are onboarded on
 * it, which one is running it right now, what paperwork does it carry, and what
 * happened to it. Those answers have one shape, defined here once.
 *
 * What is NOT here is anything specific to either asset: equipment types,
 * specifications, driver assignments, power-unit attachments. Those live in
 * `truck.ts` and `trailer.ts` respectively, because they genuinely differ.
 */

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What has happened to a document, honestly.
 *
 * `selected_local` is the state this build actually reaches: the browser told
 * us a filename, a type and a size, and nothing else happened. Nothing is
 * uploaded, stored, read, extracted or verified by anybody.
 */
export type DocumentLifecycleStatus =
  | "missing"
  | "selected_local"
  | "pending_review"
  | "approved"
  | "rejected"
  | "expiring_soon"
  | "expired"
  | "superseded";

/**
 * What survives when a document is replaced, or a relationship ends.
 *
 * Snapshots are kept rather than deleted: a carrier that has ended its
 * relationship still needs to show what it held at the time.
 */
export interface AssetDocumentSnapshot<K extends string = string> {
  kind: K;
  label: string;
  fileName: string;
  fileType?: string;
  sizeBytes?: number;
  capturedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Legal ownership                                                             */
/* -------------------------------------------------------------------------- */

export type OwnerType = "person" | "organization";
export type OwnershipRecordStatus = "active" | "ended";
export type OwnershipClaimStatus = "pending" | "accepted" | "rejected" | "manual_review";

/* -------------------------------------------------------------------------- */
/* Carrier relationships                                                       */
/* -------------------------------------------------------------------------- */

/** On what basis a carrier runs an asset it may or may not own. */
export type CarrierRelationshipType = "carrier_owned" | "leased_owner_operator";

/**
 * How far a carrier has got with onboarding an asset.
 *
 * This is eligibility, NOT operation. Several carriers can hold an approved
 * relationship with the same asset at the same time, each with its own
 * insurance evidence, lease agreement, documents and history. Being approved
 * means "allowed to run this when it is free" — never "running it now".
 */
export type CarrierRelationshipStatus =
  | "onboarding"
  | "pending_approval"
  | "approved"
  | "suspended"
  | "ended";

/** The simpler lifecycle used by dispatch-access records. */
export type ScopedAccessStatus = "pending" | "active" | "suspended" | "ended";

/* -------------------------------------------------------------------------- */
/* Operating authority                                                         */
/* -------------------------------------------------------------------------- */

export type OperatingLeaseStatus = "reserved" | "active" | "pending_release" | "ended";

/**
 * What has to be true before exclusive control of an asset can be given up.
 *
 * A passing estimated delivery time is not on this list, and deliberately so:
 * an asset is not free because a clock says it should be. Every field here is a
 * real event somebody recorded.
 */
export interface LeaseTermination {
  unloadedAt?: string;
  tripRequirementsCompletedAt?: string;
  deliveryConfirmationRecordedAt?: string;
  exclusiveControlEndedAt?: string;
}

/**
 * What one carrier sees of one asset right now.
 *
 * Derived from that carrier's own relationship plus whatever lease is live —
 * never stored, because it differs per carrier and changes the moment somebody
 * else activates.
 */
export type AssetActivationState =
  | "onboarding"
  | "pending_approval"
  | "approved"
  | "available_for_activation"
  | "activation_reserved"
  | "active_operating_lease"
  | "locked_by_other"
  | "pending_release"
  | "ended"
  | "suspended";

/* -------------------------------------------------------------------------- */
/* Point-in-time operating context                                             */
/* -------------------------------------------------------------------------- */

/**
 * HOW the carrier operating an asset at one moment was proven.
 *
 * Three bases, in the order they are tried, and the order is the whole point:
 * a lease is an explicit grant of exclusive authority for an interval, so it
 * beats everything; legal ownership plus the owner's own carrier relationship
 * is the ordinary case for a fleet running its own equipment; and one lone
 * approved relationship is what proves an owner-operator's truck, where the
 * carrier runs equipment it does not own and never took a lease on.
 *
 * `sole_approved_relationship` is deliberately NOT "the earliest of several".
 * With two carriers approved and nothing to separate them, the honest answer is
 * that the canonical records do not say, and a guess would attribute somebody's
 * meter reading, fuel or mileage to the wrong company.
 */
export type OperatingContextBasis =
  /** An operating lease covering the instant. Its id is pinned to the event. */
  | "operating_lease"
  /** The carrier is the recorded legal owner and holds a `carrier_owned` relationship. */
  | "carrier_owned"
  /** Exactly one carrier relationship covered the instant. No lease existed. */
  | "sole_approved_relationship";

/** Why no operating context could be established for an instant. */
export type OperatingContextRefusalCode =
  | "unreadable_instant"
  | "unknown_equipment"
  | "no_relationship"
  | "conflicting_leases"
  | "lease_without_relationship"
  | "indeterminate_lease"
  | "indeterminate_relationship"
  | "indeterminate_ownership"
  | "conflicting_ownership"
  | "conflicting_relationships";

/**
 * What is returned instead of a guess.
 *
 * Carries the canonical record ids involved so a refusal names the data a
 * person has to go and fix, rather than saying "not allowed" and leaving them
 * to find out which of four registries disagrees.
 */
export interface OperatingContextRefusal {
  resolved: false;
  code: OperatingContextRefusalCode;
  /** In the words the person who has to fix it would use. */
  reason: string;
  /** The conflicting or missing canonical record ids, when there are any. */
  records: string[];
}
