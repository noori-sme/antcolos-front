import type {
  ClaimCostEntry, ClaimEvidenceKind, ClaimFinancials, ClaimStatus, ClaimType,
  Cents, Money,
} from "@/types";

/**
 * The claim lifecycle, and the money arithmetic that hangs off it.
 *
 * Pure and dependency-free so the rules can be tested on their own. The
 * service layer owns permissions and disclosure; this file owns what a claim
 * may legally do next and what its cost lines add up to.
 */

/**
 * Which statuses a claim may move to from each status.
 *
 * `closed` is terminal in this foundation. Re-opening a closed claim belongs
 * with litigation and appeal handling, which is explicitly out of scope — so
 * rather than half-build it, the transition simply is not offered.
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  reported: ["under_review", "closed"],
  under_review: ["investigating", "submitted", "denied", "closed"],
  investigating: ["submitted", "approved", "denied", "closed"],
  submitted: ["investigating", "approved", "denied", "closed"],
  approved: ["paid", "closed"],
  denied: ["under_review", "closed"],
  paid: ["closed"],
  closed: [],
};

/** Statuses that still need somebody to do something. Drives Needs You. */
export const OPEN_CLAIM_STATUSES: readonly ClaimStatus[] = [
  "reported", "under_review", "submitted", "investigating", "approved",
];

export function isOpenClaim(status: ClaimStatus): boolean {
  return OPEN_CLAIM_STATUSES.includes(status);
}

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

/** Why a move is refused, in words an operator can act on. */
export function transitionRefusal(from: ClaimStatus, to: ClaimStatus): string | null {
  if (from === to) return `This claim is already ${CLAIM_STATUS_LABEL[to].toLowerCase()}.`;
  if (canTransition(from, to)) return null;
  if (from === "closed") {
    return "A closed claim cannot be moved. Re-opening belongs with appeals and litigation, which Antcolos does not handle yet.";
  }
  const allowed = CLAIM_TRANSITIONS[from].map((s) => CLAIM_STATUS_LABEL[s].toLowerCase());
  return allowed.length
    ? `A ${CLAIM_STATUS_LABEL[from].toLowerCase()} claim can only move to ${allowed.join(", ")}.`
    : `A ${CLAIM_STATUS_LABEL[from].toLowerCase()} claim cannot be moved.`;
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  reported: "Reported",
  under_review: "Under review",
  submitted: "Submitted",
  investigating: "Investigating",
  approved: "Approved",
  denied: "Denied",
  paid: "Paid",
  closed: "Closed",
};

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What each kind of claim needs before an insurer will look at it.
 *
 * A row with `required: true` and nothing attached is precisely what becomes a
 * "missing evidence" item in Needs You — the queue is derived from this list
 * rather than from a second, hand-maintained one.
 */
export const REQUIRED_EVIDENCE: Record<ClaimType, readonly { kind: ClaimEvidenceKind; label: string }[]> = {
  accident: [
    { kind: "police_report", label: "Police report" },
    { kind: "photo", label: "Scene and damage photos" },
    { kind: "repair_estimate", label: "Repair estimate" },
  ],
  cargo_damage: [
    { kind: "bill_of_lading", label: "Bill of lading" },
    { kind: "proof_of_delivery", label: "Signed proof of delivery noting the damage" },
    { kind: "photo", label: "Photos of the damaged freight" },
  ],
  property_damage: [
    { kind: "photo", label: "Photos of the damage" },
    { kind: "repair_estimate", label: "Repair or replacement estimate" },
  ],
  bodily_injury: [
    { kind: "police_report", label: "Police report" },
    { kind: "medical_report", label: "Medical report" },
  ],
  theft: [
    { kind: "police_report", label: "Police report" },
    { kind: "bill_of_lading", label: "Bill of lading" },
  ],
  vandalism: [
    { kind: "police_report", label: "Police report" },
    { kind: "photo", label: "Photos of the damage" },
  ],
  weather: [
    { kind: "photo", label: "Photos of the damage" },
    { kind: "repair_estimate", label: "Repair estimate" },
  ],
  equipment_damage: [
    { kind: "photo", label: "Photos of the damage" },
    { kind: "repair_estimate", label: "Repair estimate" },
  ],
  other: [
    { kind: "photo", label: "Supporting photos" },
  ],
};

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

const usd = (amount: Cents): Money => ({ amount, currency: "USD" });

/**
 * The money view of a claim, derived from its cost lines.
 *
 * Never stored, because a stored total is a total that goes stale. Reversal
 * lines are subtracted rather than deleting the line they correct, which is
 * what keeps the cost history append-only and auditable.
 */
export function claimFinancials(
  costs: readonly ClaimCostEntry[],
  deductible: Money = usd(0),
): ClaimFinancials {
  const reversed = new Set(
    costs.map((c) => c.reversesCostId).filter((id): id is string => Boolean(id)),
  );
  const live = costs.filter((c) => !reversed.has(c.id) && !c.reversesCostId);

  const sum = (rows: readonly ClaimCostEntry[]) =>
    rows.reduce((total, c) => total + c.amount.amount, 0);

  const reserves = live.filter((c) => c.kind === "reserve");
  const recoveries = live.filter(
    (c) => c.kind === "salvage_credit" || c.bearer === "third_party",
  );
  const realCosts = live.filter((c) => c.kind !== "reserve" && !recoveries.includes(c));
  const paid = realCosts.filter((c) => c.paidAt);

  const totalIncurred = sum(realCosts);
  const carrierBorne = sum(realCosts.filter((c) => c.bearer === "carrier"));

  return {
    totalIncurred: usd(totalIncurred),
    totalPaid: usd(sum(paid)),
    outstandingReserve: usd(Math.max(0, sum(reserves) - totalIncurred)),
    deductible,
    deductibleApplied: usd(Math.min(carrierBorne, deductible.amount)),
    insurerPaid: usd(sum(realCosts.filter((c) => c.bearer === "insurer" && c.paidAt))),
    recovered: usd(sum(recoveries)),
  };
}

/** Adds two claim financial summaries. Used for organization-wide totals. */
export function addFinancials(a: ClaimFinancials, b: ClaimFinancials): ClaimFinancials {
  const plus = (x: Money, y: Money) => usd(x.amount + y.amount);
  return {
    totalIncurred: plus(a.totalIncurred, b.totalIncurred),
    totalPaid: plus(a.totalPaid, b.totalPaid),
    outstandingReserve: plus(a.outstandingReserve, b.outstandingReserve),
    deductible: plus(a.deductible, b.deductible),
    deductibleApplied: plus(a.deductibleApplied, b.deductibleApplied),
    insurerPaid: plus(a.insurerPaid, b.insurerPaid),
    recovered: plus(a.recovered, b.recovered),
  };
}

export const ZERO_FINANCIALS: ClaimFinancials = {
  totalIncurred: usd(0),
  totalPaid: usd(0),
  outstandingReserve: usd(0),
  deductible: usd(0),
  deductibleApplied: usd(0),
  insurerPaid: usd(0),
  recovered: usd(0),
};
