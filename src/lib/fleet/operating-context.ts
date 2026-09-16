import type {
  CarrierRelationshipStatus, CarrierRelationshipType, OperatingContextBasis,
  OperatingContextRefusal, OperatingLeaseStatus, OwnerType, OwnershipRecordStatus,
} from "@/types";

/**
 * ★ WHO WAS OPERATING THIS PIECE OF EQUIPMENT AT THIS MOMENT ★
 *
 * One algorithm, run over two canonical domains. The truck registry and the
 * trailer registry each hold their own ownership records, carrier relationships
 * and operating leases; this module holds the RULE that reads them, so the
 * answer cannot drift between the two the way the meter values themselves once
 * did before the ledger existed.
 *
 * It creates no registry, stores nothing, and copies no relationship record. It
 * is given the canonical rows and returns one of them.
 *
 * ── ONE RULE, RECONCILED ──────────────────────────────────────────────────
 * Fuel had its own point-in-time carrier resolver before this one existed, and
 * for a while the two ran side by side over the same canonical rows and
 * disagreed in four ways. They were compared against what a lease and a
 * relationship actually mean, and this is the settled answer — fuel now derives
 * its attribution from this function rather than repeating it:
 *
 *  1. A LEASE WINDOW OPENS AT `reservedAt`, not `activatedAt`. Fuel had this
 *     right: the registry's own `holdingLease` counts a reservation as holding
 *     the truck, because that is the moment nobody else can activate. It does
 *     NOT open at `createdAt`, which fuel also allowed — that is when the row
 *     was written, not when anything happened.
 *  2. A WINDOW IS HALF-OPEN, `[start, end)`. Fuel's inclusive end let a lease
 *     that ended at T and one that began at T both cover T, which is two
 *     carriers operating one truck at one instant.
 *  3. A RELATIONSHIP PROVES A PERIOD ONLY FROM `approvedAt`. Fuel fell back to
 *     `startedAt`, which let a relationship that was never approved — one that
 *     went from pending straight to ended — cover the time it was merely asked
 *     for.
 *  4. THE OWNER'S OWN RELATIONSHIP DECIDES the multi-carrier case. Fuel had no
 *     such step and answered "unresolved" for every truck with two approved
 *     carriers, including a carrier's own truck that somebody else is merely
 *     eligible to run.
 *
 * What did NOT change is what happens when this refuses. A meter reading cannot
 * be published without a carrier; a fuel purchase that happened is still
 * recorded, flagged `unresolved`, and put in front of a person. One rule, two
 * outcomes.
 *
 * ── WHY POINT-IN-TIME, NOT CURRENT STATE ──────────────────────────────────
 * A meter reading typed in from a receipt found in a glovebox three weeks later
 * is a fact about the day it was read, not about today. Deriving its carrier
 * from today's lease would attribute a Tuesday in March to whoever holds the
 * truck in April, and the attribution would silently change again next month.
 * So every rule below is an interval test against `instant`, and current
 * `status` is used only where it is the ONLY signal the records carry — and
 * where it is ambiguous about the past, the answer is a refusal rather than a
 * guess.
 *
 * ███ MOCK-ADJACENT — THE RULE IS REAL, THE RECORDS ARE FIXTURES ███
 * Nothing here is authorization. A real backend must run this derivation server
 * side, against records it trusts, before it accepts an event.
 */

/* -------------------------------------------------------------------------- */
/* What the rule needs of a record                                             */
/* -------------------------------------------------------------------------- */

/**
 * Structural shapes, not the canonical interfaces.
 *
 * `TruckOperatingLease` and `TrailerOperatingLease` are separate types on
 * purpose and stay separate; what they share is the handful of fields this rule
 * reads. Taking them structurally means neither registry has to convert its
 * rows into some third "equipment" shape — the very copy this module exists to
 * avoid — and the generic parameters below hand the ORIGINAL row back.
 */
export interface OperatingLeaseLike {
  id: string;
  organizationId: string;
  relationshipId: string;
  status: OperatingLeaseStatus;
  /**
   * When exclusivity was TAKEN. This is where the window starts.
   *
   * Not `activatedAt`, and the registry is the reason: `holdingLease` counts a
   * reserved lease as holding the truck because "it is the moment exclusivity
   * is taken, and it is what makes two simultaneous activations impossible".
   * From that moment nobody else can be operating the equipment, so nobody else
   * can own a fact about it.
   */
  reservedAt?: string;
  /** When it went live. Later than `reservedAt`, or the same instant. */
  activatedAt?: string;
  endedAt?: string;
}

export interface CarrierRelationshipLike {
  id: string;
  organizationId: string;
  relationshipType: CarrierRelationshipType;
  status: CarrierRelationshipStatus;
  /** The moment onboarding completed. The temporal proof of "approved". */
  approvedAt?: string;
  startedAt: string;
  endedAt?: string;
}

export interface OwnershipRecordLike {
  id: string;
  ownerType: OwnerType;
  /** Set only when the owner is an organization or driver profile in Antcolos. */
  ownerRef?: string;
  status: OwnershipRecordStatus;
  startedAt: string;
  endedAt?: string;
}

export interface ResolvedOperatingContext<
  L extends OperatingLeaseLike,
  R extends CarrierRelationshipLike,
> {
  resolved: true;
  basis: OperatingContextBasis;
  /** The carrier the fact is attributed to. Never the recording workspace. */
  operatingCarrierOrganizationId: string;
  /** The canonical relationship row, handed back as it was stored. */
  relationship: R;
  /** The canonical lease row, only for `basis: "operating_lease"`. */
  lease?: L;
}

export type OperatingContextResult<
  L extends OperatingLeaseLike,
  R extends CarrierRelationshipLike,
> = ResolvedOperatingContext<L, R> | OperatingContextRefusal;

/* -------------------------------------------------------------------------- */
/* Intervals                                                                   */
/* -------------------------------------------------------------------------- */

const at = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
};

/**
 * Half-open: `start <= instant < end`.
 *
 * The end is exclusive so that a lease ending and the next one beginning at the
 * same recorded instant cannot both cover it. Two carriers owning the same
 * moment is exactly the ambiguity this rule must never produce.
 */
function covers(start: string, end: string | undefined, instant: number): boolean {
  const from = at(start);
  if (from === undefined || instant < from) return false;
  const to = at(end);
  if (to === undefined) return true;
  return instant < to;
}

/**
 * When a lease's window opens.
 *
 * `reservedAt` first, because that is when the truck stopped being anybody
 * else's — see the field's own note. `activatedAt` is the fallback for a lease
 * that was recorded as live without a separate reservation. `createdAt` is
 * deliberately NOT a fallback: it is when the ROW was written, which can
 * precede anything happening in the world, and a lease created in advance would
 * otherwise cover time during which no exclusivity existed.
 */
function leaseStart(lease: OperatingLeaseLike): string | undefined {
  return lease.reservedAt ?? lease.activatedAt;
}

const refuse = (
  code: OperatingContextRefusal["code"],
  reason: string,
  records: string[] = [],
): OperatingContextRefusal => ({ resolved: false, code, reason, records });

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the operating carrier for one piece of equipment at one instant.
 *
 * Precedence, and nothing falls through a level it matched ambiguously:
 *
 *  1. AN OPERATING LEASE covering the instant. A lease is an explicit,
 *     exclusive grant of operating authority for an interval, so it settles the
 *     question outright — and its id is pinned to whatever is published, which
 *     is what keeps two separate lease cycles on the same relationship apart.
 *     Two leases covering one instant is impossible data and is refused.
 *
 *  2. THE CARRIER-OWNED CASE: the recorded legal owner is an organization in
 *     Antcolos and that organization holds a `carrier_owned` relationship
 *     covering the instant. This is the ordinary fleet, and it stays decidable
 *     even when a second carrier is also onboarded, because the second carrier
 *     is not the owner.
 *
 *  3. EXACTLY ONE relationship covering the instant. This is the owner-operator
 *     case — a carrier running a truck a person owns, with no lease ever taken.
 *     "Exactly one" is load-bearing: with two approved carriers and nothing to
 *     separate them the records genuinely do not say who was operating, and
 *     picking the older relationship would be a fabrication dressed as a rule.
 *
 * Anything else refuses, by name, with the record ids that disagree.
 */
export function resolveOperatingContextAt<
  L extends OperatingLeaseLike,
  R extends CarrierRelationshipLike,
  O extends OwnershipRecordLike,
>(input: {
  /** "truck" or "trailer" — used only to write the refusal in plain words. */
  equipmentNoun: string;
  instant: string;
  leases: readonly L[];
  relationships: readonly R[];
  ownership: readonly O[];
}): OperatingContextResult<L, R> {
  const noun = input.equipmentNoun;
  const instant = at(input.instant);
  if (instant === undefined) {
    return refuse("unreadable_instant", `"${input.instant}" is not a readable instant, so nothing can be derived for it.`);
  }

  /* 1. Operating lease ---------------------------------------------------- */

  // An ended lease with no recorded end cannot be placed in time at all. It is
  // reported rather than skipped: skipping it would quietly hand the instant to
  // the next rule down, which is how a fact ends up attributed to the carrier
  // that was NOT running the equipment.
  const unplaceableLease = input.leases.find(
    (l) => l.status === "ended" && !l.endedAt && covers(leaseStart(l) ?? "", undefined, instant),
  );
  if (unplaceableLease) {
    return refuse(
      "indeterminate_lease",
      `Operating lease ${unplaceableLease.id} on this ${noun} is recorded as ended but has no end date, so whether it covered this moment cannot be established.`,
      [unplaceableLease.id],
    );
  }

  const holding = input.leases.filter((l) => {
    const from = leaseStart(l);
    return from !== undefined && covers(from, l.endedAt, instant);
  });
  if (holding.length > 1) {
    return refuse(
      "conflicting_leases",
      `${holding.length} operating leases on this ${noun} cover the same moment. Exactly one carrier can hold operating authority at a time, so this is inconsistent canonical data.`,
      holding.map((l) => l.id),
    );
  }
  if (holding.length === 1) {
    const lease = holding[0];
    const relationship = input.relationships.find((r) => r.id === lease.relationshipId);
    if (!relationship || !relationshipCovers(relationship, instant)) {
      return refuse(
        "lease_without_relationship",
        `Operating lease ${lease.id} points at a carrier relationship that did not cover this moment, so the lease cannot prove who was operating this ${noun}.`,
        [lease.id, lease.relationshipId],
      );
    }
    return {
      resolved: true,
      basis: "operating_lease",
      operatingCarrierOrganizationId: relationship.organizationId,
      relationship,
      lease,
    };
  }

  /* Relationships covering the instant ------------------------------------ */

  const indeterminate = input.relationships.find((r) => relationshipIndeterminate(r, instant));
  if (indeterminate) {
    return refuse(
      "indeterminate_relationship",
      `Carrier relationship ${indeterminate.id} on this ${noun} is ${indeterminate.status} with no date recorded for it, so whether it covered this moment cannot be established.`,
      [indeterminate.id],
    );
  }

  const active = input.relationships.filter((r) => relationshipCovers(r, instant));
  if (active.length === 0) {
    return refuse(
      "no_relationship",
      `No carrier held an approved relationship with this ${noun} at that moment, so there is no organization the fact can honestly be attributed to.`,
    );
  }

  /* 2. The carrier-owned case --------------------------------------------- */

  const unplaceableOwnership = input.ownership.find(
    (o) => o.status === "ended" && !o.endedAt && covers(o.startedAt, undefined, instant),
  );
  if (unplaceableOwnership) {
    return refuse(
      "indeterminate_ownership",
      `Ownership record ${unplaceableOwnership.id} on this ${noun} is recorded as ended but has no end date, so who owned it at that moment cannot be established.`,
      [unplaceableOwnership.id],
    );
  }

  const owners = input.ownership.filter((o) => covers(o.startedAt, o.endedAt, instant));
  if (owners.length > 1) {
    return refuse(
      "conflicting_ownership",
      `${owners.length} ownership records on this ${noun} cover the same moment. One thing has one owner at a time, so this is inconsistent canonical data.`,
      owners.map((o) => o.id),
    );
  }

  const owner = owners[0];
  if (owner && owner.ownerType === "organization" && owner.ownerRef) {
    const ownerRef = owner.ownerRef;
    const carrierOwned = active.filter(
      (r) => r.organizationId === ownerRef && r.relationshipType === "carrier_owned",
    );
    if (carrierOwned.length > 1) {
      return refuse(
        "conflicting_relationships",
        `The owner of this ${noun} holds ${carrierOwned.length} carrier-owned relationships covering the same moment, so which one it was operating under cannot be established.`,
        carrierOwned.map((r) => r.id),
      );
    }
    if (carrierOwned.length === 1) {
      return {
        resolved: true,
        basis: "carrier_owned",
        operatingCarrierOrganizationId: carrierOwned[0].organizationId,
        relationship: carrierOwned[0],
      };
    }
  }

  /* 3. Exactly one relationship ------------------------------------------- */

  if (active.length > 1) {
    return refuse(
      "conflicting_relationships",
      `${active.length} carriers held an approved relationship with this ${noun} at that moment and none of them owns it or holds a lease on it, so the records do not say which one was operating.`,
      active.map((r) => r.id),
    );
  }
  return {
    resolved: true,
    basis: "sole_approved_relationship",
    operatingCarrierOrganizationId: active[0].organizationId,
    relationship: active[0],
  };
}

/**
 * Was this relationship an approved one at that moment?
 *
 * `approvedAt` rather than `status === "approved"` on purpose: status is today's
 * answer, and a relationship approved last year and ended last month must still
 * prove last summer. A relationship that was never approved has no `approvedAt`
 * and covers nothing, which is what keeps a truck somebody merely ASKED to
 * operate out of every derivation.
 */
function relationshipCovers(r: CarrierRelationshipLike, instant: number): boolean {
  const approved = at(r.approvedAt);
  if (approved === undefined || instant < approved) return false;
  if (relationshipIndeterminate(r, instant)) return false;
  return covers(r.startedAt, r.endedAt, instant);
}

/**
 * States whose history the record cannot pin down.
 *
 * A suspension carries no date, so a suspended relationship cannot say whether
 * it was live last Tuesday; an ended relationship with no end date cannot
 * either. Both are reported rather than assumed in or out.
 */
function relationshipIndeterminate(r: CarrierRelationshipLike, instant: number): boolean {
  if (r.status !== "suspended" && !(r.status === "ended" && !r.endedAt)) return false;
  const approved = at(r.approvedAt);
  if (approved === undefined || instant < approved) return false;
  return covers(r.startedAt, undefined, instant);
}
