import type {
  BrokerPolicyDefaults, BrokerPolicyEffect, BrokerPolicyEvaluation,
  BrokerPolicyException, BrokerPolicyNotice, BrokerPolicyScope,
  BrokerWorkPolicy, IsoDateTime, Party, ReportedBrokerFields,
} from "@/types";
import {
  DEPRIORITIZE_MULTIPLIER, EFFECT_RANK, MAX_TEMPORARY_HOLD_HOURS,
  effectOf, effectiveStatus, isEnforceable,
} from "@/types";
import { canonicalForMc } from "./broker-resolution";
import { normalizeMcNumber } from "./normalize";

/**
 * ★ EVERY BROKER-WORK-POLICY DECISION, AS PURE FUNCTIONS ★
 *
 * No store, no clock, no permission and no organization of its own. Policies
 * come in, an instant comes in, and an answer comes out — which is what makes
 * "Carrier A's block does not touch Carrier B" and "a proposed policy filters
 * nothing" provable rather than asserted.
 *
 * It lives beside `broker-resolution.ts` on purpose. A policy is a statement
 * about a CANONICAL broker profile, and the rule that binds one to the other —
 * the MC number the register confirmed — is the rule that file already owns.
 * Putting the policy logic anywhere else would invite a second way of deciding
 * which broker a load board posting refers to, and two answers to that question
 * is precisely how one company's private dispute lands on another company.
 *
 * ── THE THREE THINGS IT REFUSES TO DO ─────────────────────────────────────
 *  1. Match a broker on a name. No MC, no policy. An unresolved broker is
 *     REPORTED as unresolved rather than quietly matched against something that
 *     looked similar.
 *  2. Let one organization's policy reach another's work. A carrier policy
 *     applies to that carrier's trucks; a dispatch policy applies while that
 *     dispatch organization is the one working the load. Neither widens.
 *  3. Treat anything but `active` as in force. Proposed, rejected, expired and
 *     revoked filter nothing, ever, and the only place that is decided is here.
 */

/* -------------------------------------------------------------------------- */
/* Which broker is this?                                                       */
/* -------------------------------------------------------------------------- */

export interface ResolvedBroker {
  /** Present only when the register-backed profile was actually found. */
  partyId?: string;
  /** Digits only, as the register has it. */
  verifiedMcNumber?: string;
  /** Digits only, as the posting or document had it. */
  reportedMcNumber?: string;
  nameSnapshot: string;
  /** Why it could not be resolved, when it could not. For a person to read. */
  unresolvedReason?: string;
}

/**
 * Tie what a load board posting said to the canonical broker profile.
 *
 * ★ MC NUMBER OR NOTHING ★
 * The same resolution rule the Directory uses for a rate confirmation, for the
 * same reason: a name is not an identity. "Apex Logistics" on a board posting
 * and "Apex Logistics" in somebody's notes are two strings, and applying a
 * fraud suspicion to the wrong company on the strength of a string match would
 * be both wrong and defamatory.
 */
export function resolveBrokerForPolicy(
  reported: Pick<ReportedBrokerFields, "name" | "mcNumber">,
  parties: readonly Party[],
): ResolvedBroker {
  const mcNumber = normalizeMcNumber(reported.mcNumber);
  if (!mcNumber) {
    return {
      nameSnapshot: reported.name,
      unresolvedReason:
        "This posting carried no MC number, so it cannot be tied to a broker "
        + "profile. No policy is applied on a name alone.",
    };
  }

  const party = canonicalForMc(mcNumber, parties);
  if (!party) {
    return {
      nameSnapshot: reported.name,
      reportedMcNumber: mcNumber,
      unresolvedReason:
        `No canonical broker profile resolves MC ${mcNumber} yet. A policy is `
        + "written against the profile, so there is nothing here to apply.",
    };
  }

  return {
    partyId: party.partyId,
    verifiedMcNumber: party.broker?.official?.mcNumber,
    reportedMcNumber: mcNumber,
    nameSnapshot: party.dbaName ?? party.legalName,
  };
}

/* -------------------------------------------------------------------------- */
/* Which policies reach this piece of work?                                    */
/* -------------------------------------------------------------------------- */

export interface PolicyAudience {
  /** The carrier whose truck and authority would move the freight. */
  carrierOrganizationId?: string;
  /** The organization actually working it. The carrier itself, or a provider. */
  workingOrganizationId: string;
}

/**
 * Does this policy govern this piece of work at all?
 *
 * Two rules, and their asymmetry IS the authority model:
 *
 *   A CARRIER policy reaches every load that would run under that carrier's
 *   authority, whoever is working it. That is the point — the carrier's refusal
 *   is not something a dispatch organization can step around by being the one
 *   holding the mouse.
 *
 *   A DISPATCH ORGANIZATION policy reaches only the work that dispatch
 *   organization is doing. It governs how that team operates. The carrier can
 *   still take the load itself or give it to somebody else, because a dispatch
 *   company's preference is not the carrier's decision and must never be
 *   presented as one.
 */
export function policyApplies(
  policy: Pick<BrokerWorkPolicy, "scope" | "organizationId">,
  audience: PolicyAudience,
): boolean {
  if (policy.scope === "carrier") {
    return policy.organizationId === audience.carrierOrganizationId;
  }
  return policy.organizationId === audience.workingOrganizationId;
}

/**
 * Whether a reader is entitled to the private sentence on a policy.
 *
 * The owning organization always is. A provider working that carrier's truck
 * under a live delegation is too — it is the party being told not to book, and
 * "blocked, and you may not know why" is an instruction nobody can act on. Any
 * other reader gets the action, the scope and the owner, and no explanation at
 * all.
 */
export function mayReadExplanation(
  policy: Pick<BrokerWorkPolicy, "organizationId" | "scope">,
  audience: PolicyAudience & { delegatedForCarrier?: boolean },
): boolean {
  if (policy.organizationId === audience.workingOrganizationId) return true;
  if (policy.scope !== "carrier") return false;
  // A provider is entitled only while it is actually working for that carrier.
  return policy.organizationId === audience.carrierOrganizationId
    && audience.delegatedForCarrier === true;
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

export interface EvaluateInput {
  broker: ResolvedBroker;
  /** Every policy the caller could possibly be governed by. Filtered here. */
  policies: readonly BrokerWorkPolicy[];
  audience: PolicyAudience & { delegatedForCarrier?: boolean };
  /** Resolves an organization id to a name, for the notice. */
  organizationName: (organizationId: string) => string;
  at: IsoDateTime;
  /**
   * What the OWNING organization asked for when a broker cannot be resolved.
   *
   * Passed in rather than defaulted here, so the setting has one reader and
   * this module stays free of any notion of where settings live.
   */
  unresolvedBehavior?: BrokerPolicyDefaults["unknownBrokerBehavior"];
  /**
   * Exceptions already granted for THIS booking.
   *
   * Passed in rather than read off the policy, because an exception is scoped
   * to one load and evaluation for a search has no load. A search therefore
   * never sees an exception, which is right: an exception lets one booking
   * through, it does not put the load back on the board.
   */
  exceptions?: readonly BrokerPolicyException[];
}

/**
 * The one evaluation Search, the Opportunity and Booking all call.
 *
 * ★ ONE FUNCTION, THREE CALLERS, ONE ANSWER ★
 * The requirement that Search and the Opportunity must not disagree is not met
 * by remembering to keep two pieces of code in step; it is met by there being
 * one piece of code. Booking calls it again with the same policies at a later
 * instant, which is how a policy written after an Opportunity was created is
 * enforced when somebody finally presses Book.
 */
export function evaluateBrokerPolicies(input: EvaluateInput): BrokerPolicyEvaluation {
  const { broker, audience, at } = input;

  if (!broker.partyId) {
    return {
      brokerNameSnapshot: broker.nameSnapshot,
      effect: "none",
      notices: [],
      rankMultiplier: 1,
      unresolvedBroker: true,
      unresolvedBehavior: input.unresolvedBehavior ?? "allow",
      evaluatedAt: at,
    };
  }

  const excused = new Set(
    (input.exceptions ?? [])
      .filter((e) => Date.parse(e.expiresAt) > Date.parse(at))
      // An exception frees the organization it was granted to, and nobody else.
      .filter((e) => e.forOrganizationId === audience.workingOrganizationId)
      .map((e) => e.policyId),
  );

  const notices: BrokerPolicyNotice[] = [];
  for (const policy of input.policies) {
    if (policy.brokerPartyId !== broker.partyId) continue;
    if (!policyApplies(policy, audience)) continue;
    if (!isEnforceable(policy, at)) continue;
    if (excused.has(policy.policyId)) continue;

    notices.push({
      policyId: policy.policyId,
      action: policy.action,
      reason: policy.reason,
      scope: policy.scope,
      owningOrganizationId: policy.organizationId,
      owningOrganizationName: input.organizationName(policy.organizationId),
      effect: effectOf(policy.action),
      effectiveFrom: policy.effectiveFrom,
      expiresAt: policy.expiresAt,
      awaitingApproval:
        policy.action === "temporary_safety_hold" && policy.approvedBy === undefined,
      explanation: mayReadExplanation(policy, audience) ? policy.explanation : undefined,
      evidenceCount: policy.evidence.length,
    });
  }

  notices.sort((a, b) => EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect]);

  const effect: BrokerPolicyEffect = notices.reduce<BrokerPolicyEffect>(
    (worst, n) => (EFFECT_RANK[n.effect] > EFFECT_RANK[worst] ? n.effect : worst),
    "none",
  );

  return {
    brokerPartyId: broker.partyId,
    brokerNameSnapshot: broker.nameSnapshot,
    effect,
    notices,
    // Deprioritize alone changes ranking. A block does not need a multiplier —
    // the load is not eligible — and a warning must not move anything, or
    // "visible with a warning" would quietly become "buried".
    rankMultiplier: effect === "deprioritize" ? DEPRIORITIZE_MULTIPLIER : 1,
    unresolvedBroker: false,
    unresolvedBehavior: input.unresolvedBehavior ?? "allow",
    evaluatedAt: at,
  };
}

/**
 * The single sentence a screen puts on a blocked or warned load.
 *
 * Always names the OWNING organization and the scope, because the one thing a
 * dispatcher must never conclude is that their carrier refuses a broker when it
 * is actually their own dispatch company that does — or the other way round.
 */
export function noticeHeadline(notice: BrokerPolicyNotice): string {
  const owner = notice.scope === "carrier"
    ? `${notice.owningOrganizationName} (carrier policy)`
    : `${notice.owningOrganizationName} (dispatch organization policy)`;
  switch (notice.action) {
    case "hard_block":
      return `Blocked by ${owner}.`;
    case "temporary_safety_hold":
      return `Temporary safety hold by ${owner}. Waiting on an owner decision.`;
    case "deprioritize":
      return `Ranked down by ${owner}.`;
    case "warning":
      return `${owner} has a warning on this broker.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * WHICH ORGANIZATION owns a policy of this scope, for this actor.
 *
 * ★ NEVER `ctx.organizationId` ★
 * A dispatcher working a Baxter truck who proposes a carrier policy is
 * proposing a BAXTER policy, and it waits on Baxter's owner — not on the
 * dispatcher's own company, however senior they are inside it. Answering this
 * from the session is the bug the whole routing rule exists to prevent, so the
 * answer is derived from the scope and the carrier the work actually belongs
 * to, and a carrier scope with no carrier is refused rather than guessed.
 */
export function owningOrganizationFor(
  scope: BrokerPolicyScope,
  input: { carrierOrganizationId?: string; workingOrganizationId: string },
): string | undefined {
  return scope === "carrier" ? input.carrierOrganizationId : input.workingOrganizationId;
}

/** Whether a membership is an approver for an organization's policies. */
export function isApprover(
  member: { membershipId: string; organizationId: string; isOwner: boolean },
  owningOrganizationId: string,
  defaults: Pick<BrokerPolicyDefaults, "additionalApproverMembershipIds">,
): boolean {
  if (member.organizationId !== owningOrganizationId) return false;
  if (member.isOwner) return true;
  return defaults.additionalApproverMembershipIds.includes(member.membershipId);
}

/* -------------------------------------------------------------------------- */
/* Temporary holds                                                             */
/* -------------------------------------------------------------------------- */

/**
 * When a hold placed now must stop.
 *
 * Always a real instant, always bounded by `MAX_TEMPORARY_HOLD_HOURS`, and
 * never open-ended however the settings are configured. That ceiling is the
 * whole mechanism behind "it cannot silently become permanent": if nobody
 * approves it, the arithmetic ends it.
 */
export function holdExpiryFrom(
  defaults: Pick<BrokerPolicyDefaults, "temporaryHoldHours">,
  at: IsoDateTime,
  requestedHours?: number,
): IsoDateTime {
  const asked = requestedHours ?? defaults.temporaryHoldHours;
  const hours = Math.min(Math.max(1, Math.round(asked)), MAX_TEMPORARY_HOLD_HOURS);
  return new Date(Date.parse(at) + hours * 3_600_000).toISOString();
}

/** A policy whose recorded status has fallen behind its own expiry. */
export function hasLapsed(policy: BrokerWorkPolicy, at: IsoDateTime): boolean {
  return policy.status === "active" && effectiveStatus(policy, at) === "expired";
}
