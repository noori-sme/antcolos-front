import type { IsoDateTime } from "./common";
import type { PermissionKey } from "./permission";
import type { ActorRef } from "./user";

/**
 * A BROKER WORK POLICY — one organization's private operating decision about
 * one broker.
 *
 * ★ WHAT THIS IS NOT ★
 * It is not a blacklist. There is no global list of bad brokers anywhere in
 * Antcolos and nothing here creates one: every record below is owned by exactly
 * one organization, is readable only by that organization and the users it has
 * delegated to, and says nothing at all about what any other carrier should do.
 * Northline refusing to haul for a broker is a fact about Northline. Baxter's
 * trucks are unaffected, the broker's canonical profile is unaffected, and the
 * broker is never shown another company's opinion of them.
 *
 * It is also not a second directory. The broker is named by the CANONICAL
 * `brokerPartyId` the Directory already resolved from the federal register —
 * see `src/lib/directory/broker-resolution.ts` — plus the MC number that
 * resolution turned on. A policy that could not be tied to a canonical profile
 * would be an accusation attached to a name, which is exactly the thing this
 * module refuses to store.
 *
 * ── THE FOUR THINGS A POLICY CAN DO ───────────────────────────────────────
 * Graded on purpose. "Never again" and "I would rather not" are different
 * operating decisions, and a product that offers only the first one gets used
 * for the second.
 */

/** Whose operating decision this is. */
export type BrokerPolicyScope =
  /**
   * A carrier's own decision about who IT hauls for.
   *
   * The strongest kind, because the carrier is the one whose authority moves
   * the freight and whose invoice goes unpaid. Final authority rests with the
   * Carrier Owner and with nobody else.
   */
  | "carrier"
  /**
   * A dispatch organization's decision about who IT will work with.
   *
   * Real, and narrower: it governs how that dispatch team operates, not what
   * the carrier is allowed to do. It must never be presented as the carrier's
   * own policy, and it can never override one.
   */
  | "dispatch_organization";

export const BROKER_POLICY_SCOPE_LABEL: Record<BrokerPolicyScope, string> = {
  carrier: "Carrier policy",
  dispatch_organization: "Dispatch organization policy",
};

export type BrokerPolicyAction =
  /** Do not present this broker's freight as eligible, and do not book it. */
  | "hard_block"
  /** Keep it visible; rank it below everything else. */
  | "deprioritize"
  /** Keep it visible and bookable; say the thing out loud first. */
  | "warning"
  /**
   * Stop now, decide later — and never silently forever.
   *
   * The one action an authorized dispatcher may put in place WITHOUT an owner,
   * for suspected fraud, an identity conflict or urgent payment risk. It blocks
   * from the moment it is created, it must carry an expiry, and it raises an
   * urgent Needs You item for the owner. Approval turns it into an explicit
   * policy; rejection or expiry lifts it and keeps its history.
   */
  | "temporary_safety_hold";

export const BROKER_POLICY_ACTION_LABEL: Record<BrokerPolicyAction, string> = {
  hard_block: "Hard block",
  deprioritize: "Deprioritize",
  warning: "Warning",
  temporary_safety_hold: "Temporary safety hold",
};

/**
 * Why, in a fixed vocabulary.
 *
 * Categorized rather than free text alone so the list can be filtered and so a
 * screen can say what kind of decision this is without quoting a private
 * sentence. The sentence itself lives in `explanation` and stays private.
 */
export type BrokerPolicyReason =
  /** "We would rather not." No allegation of any kind. */
  | "carrier_preference"
  /** How they actually paid us. Our own history, not an industry rating. */
  | "payment_experience"
  /** Our factor declined this broker for us. Carrier-specific, and dated. */
  | "factoring_rejected"
  | "suspected_fraud"
  /** Two records disagree about who this company is. */
  | "identity_conflict"
  | "service_dispute"
  /** A contract with somebody else stops us working them. */
  | "contract_restriction"
  | "other";

export const BROKER_POLICY_REASON_LABEL: Record<BrokerPolicyReason, string> = {
  carrier_preference: "Carrier preference",
  payment_experience: "Payment experience",
  factoring_rejected: "Factoring declined",
  suspected_fraud: "Suspected fraud",
  identity_conflict: "Identity conflict",
  service_dispute: "Service dispute",
  contract_restriction: "Contract restriction",
  other: "Other",
};

/**
 * Reasons that are an ALLEGATION about the broker rather than a preference of
 * ours.
 *
 * Used for one thing only: nothing carrying one of these may ever be projected
 * onto a shared surface, however the projection is written. A preference can be
 * summarized publicly without harming anybody; "we think they are committing
 * fraud" cannot.
 */
export const ACCUSATORY_REASONS: readonly BrokerPolicyReason[] = [
  "suspected_fraud",
  "identity_conflict",
  "payment_experience",
  "service_dispute",
  "factoring_rejected",
];

export type BrokerPolicyStatus =
  /** Somebody asked for it. It does nothing at all until an owner says yes. */
  | "proposed"
  /** In force. */
  | "active"
  /** An owner said no. Kept forever; it filters nothing. */
  | "rejected"
  /** Its own expiry passed. Kept forever; it filters nothing. */
  | "expired"
  /** An owner took it off. Kept forever; it filters nothing. */
  | "revoked";

export const BROKER_POLICY_STATUS_LABEL: Record<BrokerPolicyStatus, string> = {
  proposed: "Waiting for approval",
  active: "Active",
  rejected: "Rejected",
  expired: "Expired",
  revoked: "Revoked",
};

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A pointer at a record somebody can go and look at.
 *
 * Deliberately a REFERENCE and not a copy. Evidence for "they did not pay" is
 * an invoice id in a module that owns invoices; restating its contents here
 * would create a second version of a fact that can change, and a policy holding
 * a stale copy of somebody's payment history is how a defensible operating
 * decision turns into a defamatory one.
 */
export type BrokerPolicyEvidenceKind =
  | "load"
  | "invoice"
  | "document"
  /** A factoring decision, which is carrier-specific and time-sensitive. */
  | "factoring_result"
  | "audit_event"
  | "rate_confirmation"
  /** A conversation with the broker. */
  | "negotiation";

export interface BrokerPolicyEvidenceRef {
  kind: BrokerPolicyEvidenceKind;
  /** The owning module's own id. Never a copy of what it says. */
  id: string;
  /** What to call it on screen. A reference, not an assertion. */
  label: string;
  /**
   * When the underlying fact was true.
   *
   * Required for a factoring result, and the reason it is required: a factor's
   * answer is good on the day it was given and is not evidence of anything
   * months later. See `isStaleEvidence`.
   */
  observedAt: IsoDateTime;
  /** Who attached it. */
  attachedBy: ActorRef;
  attachedAt: IsoDateTime;
}

/**
 * How long a factoring answer is worth citing.
 *
 * A factor re-scores brokers continuously and its answer is about THIS carrier's
 * receivable, not about the broker. Ninety days is generous; the point of the
 * constant is that there IS one, so a stale decline cannot quietly become a
 * permanent entry.
 */
export const FACTORING_EVIDENCE_FRESH_DAYS = 90;

export function isStaleEvidence(
  evidence: Pick<BrokerPolicyEvidenceRef, "kind" | "observedAt">,
  at: IsoDateTime,
): boolean {
  if (evidence.kind !== "factoring_result") return false;
  const age = Date.parse(at) - Date.parse(evidence.observedAt);
  return age > FACTORING_EVIDENCE_FRESH_DAYS * 86_400_000;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export type BrokerPolicyEventKind =
  /** An owner made it directly. */
  | "created"
  /** Somebody who is not the owner asked for it. */
  | "proposed"
  /** A short-lived hold went straight into force. */
  | "hold_placed"
  /** Nobody eligible could be found to approve it. */
  | "escalated"
  | "approved"
  | "rejected"
  | "revoked"
  | "expired"
  /** A hold an owner turned into an explicit policy. */
  | "converted"
  | "evidence_added"
  /** An owner allowed one booking through anyway. */
  | "exception_granted";

export interface BrokerPolicyEvent {
  /** Stable. The audit ledger derives its own row id from this one. */
  id: string;
  at: IsoDateTime;
  kind: BrokerPolicyEventKind;
  actor: ActorRef;
  /** The organization the actor was working in. Attribution, never authority. */
  actorOrganizationId: string;
  fromStatus?: BrokerPolicyStatus;
  toStatus?: BrokerPolicyStatus;
  /** What a person should read. Never re-derived from anything. */
  note: string;
}

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One owner-authorized way through a policy that would otherwise stop a booking.
 *
 * Scoped, dated and audited. There is no such thing as a standing exception:
 * `expiresAt` is required by the shape, the grant names the exact load it is
 * for, and exactly one immutable audit event is written for each one.
 */
export interface BrokerPolicyException {
  exceptionId: string;
  policyId: string;
  /** The organization the exception lets act. Never "everybody". */
  forOrganizationId: string;
  /** The one booking it covers. */
  negotiationId?: string;
  listingId?: string;
  dispatchCycleId?: string;
  reason: string;
  grantedBy: ActorRef;
  grantedByOrganizationId: string;
  grantedAt: IsoDateTime;
  /** Required. An exception with no end is a policy change nobody approved. */
  expiresAt: IsoDateTime;
  /**
   * True when a CARRIER owner excepted a DISPATCH organization's policy.
   *
   * The carrier may decide the carrier will work this broker. It may not
   * conscript a dispatch company into work that company refuses — so this kind
   * of exception frees the carrier and surfaces a conflict for reassignment
   * rather than forcing the refusing dispatcher to book.
   */
  carrierOverrideOfDispatchPolicy?: boolean;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

export interface BrokerWorkPolicy {
  policyId: string;
  /**
   * The canonical broker profile. THE key, and never a name.
   *
   * Resolved through the Directory's own register-backed resolution, so two
   * organizations writing a policy about the same brokerage are provably
   * writing about the same company and a policy can never attach to the wrong
   * one on a name collision.
   */
  brokerPartyId: string;
  /** Digits only, as the register gave it. Present when identity is verified. */
  verifiedMcNumber?: string;
  /**
   * Digits only, as the proposer's own records had it.
   *
   * Kept beside the verified number rather than instead of it, so a policy
   * written from a rate confirmation that disagreed with the register still
   * says what it was written from.
   */
  reportedMcNumber?: string;
  /** For history that still reads after a rename. Display only. */
  brokerNameSnapshot: string;

  /** The organization whose decision this is. The partition key. */
  organizationId: string;
  organizationNameSnapshot: string;
  scope: BrokerPolicyScope;

  action: BrokerPolicyAction;
  reason: BrokerPolicyReason;
  /**
   * The private sentence. Never published, never projected onto the broker's
   * canonical profile, never shown to another organization.
   */
  explanation: string;
  evidence: BrokerPolicyEvidenceRef[];

  proposedBy: ActorRef;
  /** Where the proposer was working. Never where the policy belongs. */
  proposedByOrganizationId: string;
  proposedAt: IsoDateTime;

  approvedBy?: ActorRef;
  approvedAt?: IsoDateTime;
  decidedByMembershipId?: string;

  effectiveFrom: IsoDateTime;
  /** Required for a temporary safety hold. Optional for everything else. */
  expiresAt?: IsoDateTime;

  status: BrokerPolicyStatus;

  /**
   * The membership this is waiting on, worked out from the SCOPE.
   *
   * A carrier-scoped policy waits on the Carrier Owner; a dispatch-scoped one
   * waits on the Dispatch Company Owner. Never on whoever happened to be signed
   * in when it was proposed.
   */
  approverMembershipId?: string;
  approverNameSnapshot?: string;
  /** The organization the approver belongs to. */
  approverOrganizationId?: string;
  /**
   * True when no eligible approver exists at all.
   *
   * The item still appears, unassigned and marked escalated. Nothing is ever
   * auto-approved because nobody was available to say yes.
   */
  escalated: boolean;

  exceptions: BrokerPolicyException[];
  /** Append-only. Nothing in this module rewrites an entry. */
  history: BrokerPolicyEvent[];

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * The status a policy actually has right now.
 *
 * `status` is what was written down; this is what is true, because an active
 * policy whose expiry has passed is expired whether or not anybody has read it
 * since. Pure, and the one answer every reader uses.
 */
export function effectiveStatus(
  policy: Pick<BrokerWorkPolicy, "status" | "expiresAt" | "effectiveFrom">,
  at: IsoDateTime,
): BrokerPolicyStatus {
  if (policy.status !== "active") return policy.status;
  if (policy.expiresAt && Date.parse(policy.expiresAt) <= Date.parse(at)) return "expired";
  return "active";
}

/** In force right now: active, started, and not run out. */
export function isEnforceable(policy: BrokerWorkPolicy, at: IsoDateTime): boolean {
  if (effectiveStatus(policy, at) !== "active") return false;
  return Date.parse(policy.effectiveFrom) <= Date.parse(at);
}

/**
 * A hold or proposal still waiting on an owner.
 *
 * Both shapes count: a `proposed` policy does nothing until somebody says yes,
 * and a temporary hold does everything until somebody says yes — but they are
 * the same question in the queue, which is "an owner has not decided this".
 */
export function awaitsOwnerDecision(policy: BrokerWorkPolicy, at: IsoDateTime): boolean {
  const status = effectiveStatus(policy, at);
  if (status === "proposed") return true;
  return status === "active"
    && policy.action === "temporary_safety_hold"
    && policy.approvedBy === undefined;
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a policy does to one load, for one carrier, right now.
 *
 * Ordered weakest to strongest so `Math.max` over the ordinal is the whole of
 * "the strongest thing that applies wins".
 */
export type BrokerPolicyEffect = "none" | "warning" | "deprioritize" | "blocked";

export const EFFECT_RANK: Record<BrokerPolicyEffect, number> = {
  none: 0,
  warning: 1,
  deprioritize: 2,
  blocked: 3,
};

export function effectOf(action: BrokerPolicyAction): BrokerPolicyEffect {
  switch (action) {
    case "hard_block": return "blocked";
    // A hold is treated exactly as a block until somebody decides. Anything
    // softer would make "stop, this might be fraud" advisory.
    case "temporary_safety_hold": return "blocked";
    case "deprioritize": return "deprioritize";
    case "warning": return "warning";
  }
}

/**
 * One applying policy, as a reader is allowed to see it.
 *
 * `explanation` is present only when the reader is entitled to it. A dispatch
 * organization's private sentence does not travel to the carrier, and a
 * carrier's does not travel to a dispatch organization that has no delegation
 * covering the truck.
 */
export interface BrokerPolicyNotice {
  policyId: string;
  action: BrokerPolicyAction;
  reason: BrokerPolicyReason;
  scope: BrokerPolicyScope;
  /** WHOSE policy this is. Always shown, so it is never mistaken for another's. */
  owningOrganizationId: string;
  owningOrganizationName: string;
  effect: BrokerPolicyEffect;
  effectiveFrom: IsoDateTime;
  expiresAt?: IsoDateTime;
  /** True while an owner has not decided. Drives the Needs You routing. */
  awaitingApproval: boolean;
  /** Private. Absent for a reader who may not read it. */
  explanation?: string;
  /** Count only — never the references themselves, which point at records. */
  evidenceCount: number;
}

export interface BrokerPolicyEvaluation {
  /** Absent when nothing resolved this broker to a canonical profile. */
  brokerPartyId?: string;
  brokerNameSnapshot: string;
  effect: BrokerPolicyEffect;
  /** Strongest first. Empty when nothing applies, which is the normal case. */
  notices: BrokerPolicyNotice[];
  /**
   * How far down the ranking a deprioritized load goes, 0–1.
   *
   * A multiplier rather than a fixed penalty, so "lower than everything else"
   * stays true whatever the scores happen to be that morning.
   */
  rankMultiplier: number;
  /**
   * True when the listing's broker could not be tied to a canonical profile.
   *
   * Reported rather than swallowed. A policy is never applied on a name match:
   * that is how one company's dispute reaches a different company with a
   * similar name.
   */
  unresolvedBroker: boolean;
  /**
   * What the owning organization has asked for when a broker is unresolved.
   *
   * Carried on the evaluation rather than read by whatever renders it, so the
   * setting has exactly one reader and cannot mean one thing in Load Search and
   * another in the Opportunity. Never `block`: an unknown broker is not a bad
   * broker, and refusing work on missing data is how a search goes quiet for a
   * reason nobody can find.
   */
  unresolvedBehavior: BrokerPolicyDefaults["unknownBrokerBehavior"];
  evaluatedAt: IsoDateTime;
}

/** How much a deprioritized load's score is kept. Low, visible, not hidden. */
export const DEPRIORITIZE_MULTIPLIER = 0.25;

/* -------------------------------------------------------------------------- */
/* Organization settings                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The defaults and authority configuration an organization sets ONCE.
 *
 * Settings holds this and nothing else. Routine policy work — writing one,
 * reading one, approving one — happens in the Directory, in Load Search, in the
 * Opportunity and in Needs You, where the decisions actually come up.
 */
export interface BrokerPolicyDefaults {
  organizationId: string;
  /**
   * What a membership must hold to PROPOSE one.
   *
   * Reuses the existing private-customer-data permission by default: writing a
   * private opinion about a broker is exactly what that key already governs.
   * An owner may raise the bar; they cannot lower it below a real permission.
   */
  proposeRequires: PermissionKey;
  /**
   * Memberships the Owner has additionally authorized to APPROVE.
   *
   * Additive only. The Owner is always an approver and can never be removed
   * from the list, because they are the final authority over whether this
   * organization works with a broker.
   */
  additionalApproverMembershipIds: string[];
  /** How long a temporary safety hold lasts when nobody says otherwise. */
  temporaryHoldHours: number;
  /** Whether an owner may let a single booking through a block. */
  allowOwnerBookingException: boolean;
  /**
   * What a `warning` does when somebody tries to book. NEVER a block.
   *
   * `require_acknowledgement` makes the booking confirmation insist somebody
   * reads the warning and says so before they commit. It does not, and cannot,
   * refuse the booking — a warning that could refuse would be a block nobody
   * approved, which is the distinction the four actions exist to keep.
   */
  warningBookingBehavior: "allow" | "require_acknowledgement";
  /**
   * What a broker nobody could resolve to a canonical profile does.
   *
   * `warn` puts a visible note on the search result rather than leaving it
   * silently unknown. Never a block, for the same reason: no MC number is a
   * gap in what we know, not evidence about the company.
   */
  unknownBrokerBehavior: "allow" | "warn";
  updatedAt: IsoDateTime;
  updatedBy?: ActorRef;
}

/** The longest a temporary hold may run without an owner. Hard ceiling. */
export const MAX_TEMPORARY_HOLD_HOURS = 168;
export const DEFAULT_TEMPORARY_HOLD_HOURS = 48;

export function defaultBrokerPolicyDefaults(
  organizationId: string,
  at: IsoDateTime,
): BrokerPolicyDefaults {
  return {
    organizationId,
    proposeRequires: "customers:private:manage",
    additionalApproverMembershipIds: [],
    temporaryHoldHours: DEFAULT_TEMPORARY_HOLD_HOURS,
    allowOwnerBookingException: true,
    warningBookingBehavior: "allow",
    unknownBrokerBehavior: "allow",
    updatedAt: at,
  };
}

/* -------------------------------------------------------------------------- */
/* What a screen asks for                                                      */
/* -------------------------------------------------------------------------- */

export interface BrokerPolicyFilters {
  status?: BrokerPolicyStatus[];
  action?: BrokerPolicyAction[];
  scope?: BrokerPolicyScope[];
  reason?: BrokerPolicyReason[];
  brokerPartyId?: string;
  /** Only the ones waiting on somebody. */
  awaitingApprovalOnly?: boolean;
  search?: string;
}

/** One row of the Directory → Brokers → Broker policies list. */
export interface BrokerPolicyListing {
  policy: BrokerWorkPolicy;
  /** Recomputed at read time, so an expiry that passed is shown as expired. */
  currentStatus: BrokerPolicyStatus;
  awaitingApproval: boolean;
  /** Whether this reader may see the private explanation. */
  mayReadExplanation: boolean;
}
