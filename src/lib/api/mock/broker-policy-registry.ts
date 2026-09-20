import type {
  ActorRef, BrokerPolicyAction, BrokerPolicyDefaults, BrokerPolicyEvaluation,
  BrokerPolicyEvent, BrokerPolicyEventKind, BrokerPolicyEvidenceRef,
  BrokerPolicyException, BrokerPolicyFilters, BrokerPolicyListing,
  BrokerPolicyReason, BrokerPolicyScope, BrokerPolicyStatus, BrokerWorkPolicy,
  IsoDateTime, Listing, PermissionKey,
} from "@/types";
import {
  awaitsOwnerDecision, defaultBrokerPolicyDefaults, effectiveStatus,
  MAX_TEMPORARY_HOLD_HOURS,
} from "@/types";
import {
  evaluateBrokerPolicies, hasLapsed, holdExpiryFrom, isApprover,
  mayReadExplanation, noticeHeadline as noticeHeadlineFor, owningOrganizationFor,
  resolveBrokerForPolicy, type PolicyAudience, type ResolvedBroker,
} from "@/lib/directory/broker-policy";
import { isEnforceable } from "@/types";
import { NotFoundError, PermissionDeniedError, type ServiceContext } from "../contracts/context";
import { allParties } from "./party-registry";
import {
  memberIn, membersOf, organizationRecordFor, ownerOf,
} from "./membership-directory";
import {
  dispatchGrantsByCarrier, liveDispatchGrantFor, liveDispatchGrantsHeldBy,
} from "./truck-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE canonical Broker Work Policy record, and the authority model over it.
 *
 * ★ ONE STORE, PARTITIONED BY THE ORGANIZATION WHOSE DECISION IT IS ★
 * Load Search, the Opportunity, Booking, Needs You, the Broker profile, the
 * Directory list and Organization Settings all read THIS. None of them keeps a
 * copy, none of them evaluates a second way, and none of them has an approval
 * flow of its own — which is the only way "Search and the Opportunity cannot
 * disagree" is a property of the system rather than a promise somebody has to
 * keep in six files.
 *
 * ── THE AUTHORITY MODEL, IN FULL ──────────────────────────────────────────
 *
 *  CARRIER OWNER
 *      Creates, approves, revokes and changes CARRIER-scoped policies for their
 *      own carrier, directly and without anybody else. Final authority over
 *      whether that carrier works with a broker. Nothing below can be routed
 *      past them and no other organization can decide it for them.
 *
 *  CARRIER EMPLOYEE, OR A DELEGATED DISPATCHER
 *      May PROPOSE a carrier-scoped policy when their own membership already
 *      carries the private-customer permission. The proposal is inert: it
 *      blocks nothing, ranks nothing and warns about nothing. It creates a
 *      Needs You item for the CARRIER OWNER — never for the proposer's own
 *      owner, and never for whoever happens to be signed in.
 *
 *  DISPATCH COMPANY OWNER
 *      Creates and manages DISPATCH-scoped policies for their own team.
 *      Those govern how that team operates and are labelled as theirs
 *      everywhere they appear. They can never override a carrier's block.
 *
 *  DISPATCH COMPANY EMPLOYEE
 *      Proposes dispatch-scoped policies. Routes to the Dispatch Company Owner.
 *
 *  ANY AUTHORIZED PROPOSER, FOR SAFETY ONLY
 *      May place a TEMPORARY SAFETY HOLD, which blocks immediately, must carry
 *      an expiry, raises an urgent item for the correct owner and lapses on its
 *      own if nobody decides. Approval converts it into an explicit policy.
 *
 *  NOBODY
 *      Auto-approves anything. Where no eligible approver exists the item is
 *      raised unassigned and escalated, and the policy stays proposed.
 *
 * ── WHAT THIS DELIBERATELY IS NOT ─────────────────────────────────────────
 * A global broker blacklist. There is no read path here that returns another
 * organization's policies, no aggregate over organizations, and nothing that
 * writes to the canonical `Party`. A factoring decline is EVIDENCE somebody may
 * cite; it never creates a record of its own, and Northline's decline says
 * nothing about Baxter.
 */

const LATENCY_MS = 220;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return rowId("bwp");
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class BrokerPolicyError extends Error {
  constructor(readonly code: BrokerPolicyErrorCode, message: string) {
    super(message);
    this.name = "BrokerPolicyError";
  }
}

export type BrokerPolicyErrorCode =
  | "not_authorized"
  | "unknown_carrier"
  | "unresolved_broker"
  | "needs_explanation"
  | "needs_expiry"
  | "already_decided"
  | "not_proposed"
  | "exception_not_allowed"
  | "exception_needs_expiry";

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface RegistryState {
  /** Keyed by the OWNING organization. There is no cross-organization index. */
  policies: Map<string, BrokerWorkPolicy[]>;
  defaults: Map<string, BrokerPolicyDefaults>;
}

let state: RegistryState = { policies: new Map(), defaults: new Map() };

function bucket(organizationId: string): BrokerWorkPolicy[] {
  let rows = state.policies.get(organizationId);
  if (!rows) {
    rows = [];
    state.policies.set(organizationId, rows);
  }
  return rows;
}

/** Test hook, and the demo reset. Never called by a screen. */
export function resetBrokerPolicies() {
  state = { policies: new Map(), defaults: new Map() };
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export function brokerPolicyDefaults(organizationId: string): BrokerPolicyDefaults {
  let row = state.defaults.get(organizationId);
  if (!row) {
    row = defaultBrokerPolicyDefaults(organizationId, nowIso());
    state.defaults.set(organizationId, row);
  }
  return row;
}

export interface UpdateDefaultsInput {
  proposeRequires?: PermissionKey;
  additionalApproverMembershipIds?: string[];
  temporaryHoldHours?: number;
  allowOwnerBookingException?: boolean;
  warningBookingBehavior?: BrokerPolicyDefaults["warningBookingBehavior"];
  unknownBrokerBehavior?: BrokerPolicyDefaults["unknownBrokerBehavior"];
}

/**
 * Change the organization's defaults. Owner only.
 *
 * Settings is where the AUTHORITY is configured and nowhere else: who may
 * propose, who may approve, how long a hold lasts, whether an exception is
 * allowed at all. It is not where policies are written, which is why nothing
 * here touches a policy record.
 */
export async function updateBrokerPolicyDefaults(
  ctx: ServiceContext,
  input: UpdateDefaultsInput,
): Promise<BrokerPolicyDefaults> {
  await sleep(LATENCY_MS);
  const member = memberIn(ctx.organizationId, ctx.membershipId);
  if (!member?.isOwner) {
    throw new BrokerPolicyError(
      "not_authorized",
      "Only the Owner sets who may propose and approve broker policies.",
    );
  }
  const current = brokerPolicyDefaults(ctx.organizationId);
  const next: BrokerPolicyDefaults = {
    ...current,
    ...input,
    // The ceiling is the product's, not the workspace's. A hold that could be
    // configured to last a year would be a permanent block by another name.
    temporaryHoldHours: Math.min(
      Math.max(1, Math.round(input.temporaryHoldHours ?? current.temporaryHoldHours)),
      MAX_TEMPORARY_HOLD_HOURS,
    ),
    // The Owner is an approver by definition and is never listed, so they can
    // never be removed from the list either.
    additionalApproverMembershipIds: (
      input.additionalApproverMembershipIds ?? current.additionalApproverMembershipIds
    ).filter((id) => memberIn(ctx.organizationId, id)?.isOwner === false),
    updatedAt: nowIso(),
    updatedBy: ctx.actor,
  };
  state.defaults.set(ctx.organizationId, next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Who is this actor, and what may they do?                                    */
/* -------------------------------------------------------------------------- */

export interface PolicyAuthority {
  /** The organization the policy belongs to. Derived, never supplied. */
  owningOrganizationId: string;
  owningOrganizationName: string;
  /** True when this actor may approve for that organization. */
  mayApprove: boolean;
  /** True when this actor may at least ask. */
  mayPropose: boolean;
  /** The membership a proposal must wait on. Absent means nobody eligible. */
  approverMembershipId?: string;
  approverNameSnapshot?: string;
}

const organizationName = (organizationId: string): string =>
  organizationRecordFor(organizationId)?.displayName ?? organizationId;

/**
 * The carriers this workspace is entitled to write a carrier policy for.
 *
 * Its own organization when it is a carrier, plus every carrier that has a LIVE
 * dispatch grant to it. Derived from the grants at the moment of the call, so a
 * provider whose delegation ended cannot propose against a carrier it no longer
 * works for.
 */
export function carriersReachableBy(organizationId: string): string[] {
  const out = new Set<string>();
  const org = organizationRecordFor(organizationId);
  if (org?.type === "CARRIER") out.add(organizationId);
  for (const grant of liveDispatchGrantsHeldBy(organizationId)) {
    out.add(grant.grantedByCarrierOrganizationId);
  }
  return [...out];
}

/**
 * Work out whose decision this would be, and what this actor may do about it.
 *
 * ★ THE ROUTING RULE, IN ONE PLACE ★
 * The owning organization comes from the SCOPE and the carrier the work belongs
 * to. The approver comes from the owning organization's own roster. Neither
 * comes from `ctx`. A Meridian owner proposing a Baxter carrier policy is
 * routed to Baxter's owner, because the policy is Baxter's.
 */
export function policyAuthorityFor(
  ctx: ServiceContext,
  input: { scope: BrokerPolicyScope; carrierOrganizationId?: string },
): PolicyAuthority {
  const owningOrganizationId = owningOrganizationFor(input.scope, {
    carrierOrganizationId: input.carrierOrganizationId,
    workingOrganizationId: ctx.organizationId,
  });
  if (!owningOrganizationId) {
    throw new BrokerPolicyError(
      "unknown_carrier",
      "A carrier-scoped policy needs the carrier it belongs to. It is never "
      + "assumed from whoever is signed in.",
    );
  }
  if (input.scope === "carrier"
    && !carriersReachableBy(ctx.organizationId).includes(owningOrganizationId)) {
    // Indistinguishable from an unknown carrier on purpose: an organization id
    // must not be usable to probe who dispatches for whom.
    throw new BrokerPolicyError(
      "unknown_carrier",
      "That carrier is not one this workspace works for.",
    );
  }

  const defaults = brokerPolicyDefaults(owningOrganizationId);
  const self = memberIn(ctx.organizationId, ctx.membershipId);
  const mayApprove = self !== undefined
    && isApprover(
      { membershipId: self.membershipId, organizationId: self.organizationId, isOwner: self.isOwner },
      owningOrganizationId,
      defaults,
    );

  /*
   * ★ AN APPROVER MUST BE SOMEBODY WHO CAN ACTUALLY DECIDE ★
   *
   * `ownerOf` deliberately falls back to a suspended or departed Owner, because
   * every piece of work needs an accountable name even when nobody is there to
   * do it. That is right for responsibility and wrong for approval: a seat that
   * has left cannot press approve, and assigning the decision to it would leave
   * a block waiting forever on a person who is gone, looking assigned.
   *
   * So approval takes an ACTIVE owner, or an active membership the owner named
   * in settings, and otherwise nobody at all — which raises the item
   * unassigned and escalated rather than approving anything by default.
   */
  const owner = ownerOf(owningOrganizationId);
  const approver = owner?.status === "active"
    ? owner
    : membersOf(owningOrganizationId).find(
      (m) => defaults.additionalApproverMembershipIds.includes(m.membershipId)
        && m.status === "active",
    );

  return {
    owningOrganizationId,
    owningOrganizationName: organizationName(owningOrganizationId),
    mayApprove,
    // A proposer needs the permission the OWNING organization asks for, held in
    // their own membership. A grant never supplies a permission and a
    // permission never supplies reach — both have to be true.
    mayPropose: ctx.permissions.has(defaults.proposeRequires),
    approverMembershipId: approver?.membershipId,
    approverNameSnapshot: approver?.displayName,
  };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

function appendEvent(
  policy: BrokerWorkPolicy,
  kind: BrokerPolicyEventKind,
  actor: ActorRef,
  actorOrganizationId: string,
  note: string,
  transition?: { from?: BrokerPolicyStatus; to?: BrokerPolicyStatus },
): BrokerPolicyEvent {
  const entry: BrokerPolicyEvent = {
    id: rowId("bpe"),
    at: nowIso(),
    kind,
    actor,
    actorOrganizationId,
    fromStatus: transition?.from,
    toStatus: transition?.to,
    note,
  };
  // Append-only. Nothing in this module splices, sorts in place or rewrites.
  policy.history.push(entry);
  policy.updatedAt = entry.at;
  return entry;
}

export interface ProposePolicyInput {
  scope: BrokerPolicyScope;
  /** Required for a carrier-scoped policy. Never inferred from the session. */
  carrierOrganizationId?: string;
  /** The canonical profile. Resolve it with `resolveBrokerFor*` first. */
  brokerPartyId: string;
  action: BrokerPolicyAction;
  reason: BrokerPolicyReason;
  explanation: string;
  evidence?: Omit<BrokerPolicyEvidenceRef, "attachedBy" | "attachedAt">[];
  effectiveFrom?: IsoDateTime;
  expiresAt?: IsoDateTime;
  /** Only read for a temporary safety hold. */
  holdHours?: number;
}

export interface ProposeOutcome {
  policy: BrokerWorkPolicy;
  /** True when the actor's own authority put it straight into force. */
  createdDirectly: boolean;
  /** True when it is waiting on somebody. */
  awaitingApproval: boolean;
  /** Present when nobody eligible could be found. */
  escalated: boolean;
}

/**
 * Write a policy, or ask for one. One door, because there is one record.
 *
 * Whether it comes out `active` or `proposed` is decided HERE, from the actor's
 * authority over the OWNING organization — not from which button a screen
 * offered. A screen that showed "Block broker" to somebody who may only propose
 * still produces a proposal, which is what makes the rule a rule.
 */
export async function proposeBrokerPolicy(
  ctx: ServiceContext,
  input: ProposePolicyInput,
): Promise<ProposeOutcome> {
  await sleep(LATENCY_MS);
  return proposeBrokerPolicySync(ctx, input);
}

export function proposeBrokerPolicySync(
  ctx: ServiceContext,
  input: ProposePolicyInput,
): ProposeOutcome {
  const authority = policyAuthorityFor(ctx, input);
  if (!authority.mayPropose && !authority.mayApprove) {
    throw new PermissionDeniedError([brokerPolicyDefaults(authority.owningOrganizationId).proposeRequires]);
  }
  if (!input.explanation.trim()) {
    throw new BrokerPolicyError(
      "needs_explanation",
      "A broker policy needs a private explanation. An unexplained block is "
      + "something nobody can review, revoke or defend.",
    );
  }

  const party = allParties().find((p) => p.partyId === input.brokerPartyId);
  if (!party) {
    throw new BrokerPolicyError(
      "unresolved_broker",
      "A policy is written against a canonical broker profile. There is no "
      + "profile with that id.",
    );
  }

  const at = nowIso();
  const defaults = brokerPolicyDefaults(authority.owningOrganizationId);
  const isHold = input.action === "temporary_safety_hold";

  /*
   * ★ A HOLD MUST END, AND THE CEILING IS NOT NEGOTIABLE ★
   *
   * The ceiling is computed from the organization's own setting, clamped by the
   * product's `MAX_TEMPORARY_HOLD_HOURS`, and a caller may only ever ask for
   * LESS. That asymmetry is the whole mechanism: "hold it for twenty minutes
   * while I ring them" is a reasonable thing to ask for and is honoured, and
   * "hold it for ten years" is the permanent block this action exists to avoid,
   * so it silently becomes the ceiling instead.
   */
  const ceiling = holdExpiryFrom(defaults, at, input.holdHours);
  const asked = input.expiresAt ? Date.parse(input.expiresAt) : undefined;
  const expiresAt = isHold
    ? (asked !== undefined && asked > Date.parse(at) && asked < Date.parse(ceiling)
      ? input.expiresAt
      : ceiling)
    : input.expiresAt;

  if (!isHold && input.action === "hard_block" && input.expiresAt
    && Date.parse(input.expiresAt) <= Date.parse(at)) {
    throw new BrokerPolicyError("needs_expiry", "An expiry in the past is not an expiry.");
  }

  // An owner (or a configured approver) writing within their own authority
  // creates directly. Everybody else proposes — including a dispatch owner
  // asking for a CARRIER policy, whose own seniority is irrelevant here.
  const createdDirectly = authority.mayApprove && !isHold;
  const status: BrokerPolicyStatus = createdDirectly || isHold ? "active" : "proposed";
  const escalated = !createdDirectly && authority.approverMembershipId === undefined;

  const policy: BrokerWorkPolicy = {
    policyId: uuid(),
    brokerPartyId: party.partyId,
    verifiedMcNumber: party.broker?.official?.mcNumber,
    reportedMcNumber: party.identifiers.mcNumber,
    brokerNameSnapshot: party.dbaName ?? party.legalName,
    organizationId: authority.owningOrganizationId,
    organizationNameSnapshot: authority.owningOrganizationName,
    scope: input.scope,
    action: input.action,
    reason: input.reason,
    explanation: input.explanation.trim(),
    evidence: (input.evidence ?? []).map((e) => ({
      ...e,
      attachedBy: ctx.actor,
      attachedAt: at,
    })),
    proposedBy: ctx.actor,
    proposedByOrganizationId: ctx.organizationId,
    proposedAt: at,
    approvedBy: createdDirectly ? ctx.actor : undefined,
    approvedAt: createdDirectly ? at : undefined,
    decidedByMembershipId: createdDirectly ? ctx.membershipId : undefined,
    effectiveFrom: input.effectiveFrom ?? at,
    expiresAt,
    status,
    approverMembershipId: createdDirectly ? undefined : authority.approverMembershipId,
    approverNameSnapshot: createdDirectly ? undefined : authority.approverNameSnapshot,
    approverOrganizationId: createdDirectly ? undefined : authority.owningOrganizationId,
    escalated,
    exceptions: [],
    history: [],
    createdAt: at,
    updatedAt: at,
  };

  appendEvent(
    policy,
    createdDirectly ? "created" : isHold ? "hold_placed" : "proposed",
    ctx.actor,
    ctx.organizationId,
    createdDirectly
      ? `${authority.owningOrganizationName} set a ${input.action.replace(/_/g, " ")} on ${policy.brokerNameSnapshot}.`
      : isHold
        ? `Temporary safety hold placed on ${policy.brokerNameSnapshot}. It lifts by itself at ${expiresAt} unless ${authority.owningOrganizationName}'s owner decides sooner.`
        : `Proposed a ${input.action.replace(/_/g, " ")} on ${policy.brokerNameSnapshot} for ${authority.owningOrganizationName}.`,
    { to: status },
  );

  if (escalated) {
    appendEvent(
      policy,
      "escalated",
      { userId: "system", membershipId: "system", displayNameSnapshot: "Antcolos", source: "system" },
      authority.owningOrganizationId,
      `No eligible approver could be found at ${authority.owningOrganizationName}. `
      + "This is waiting unassigned rather than being approved by default.",
    );
  }

  bucket(authority.owningOrganizationId).push(policy);
  return {
    policy,
    createdDirectly,
    awaitingApproval: awaitsOwnerDecision(policy, at),
    escalated,
  };
}

export type DecisionOutcome =
  | { status: "ok"; policy: BrokerWorkPolicy; event: BrokerPolicyEvent }
  /** The decision had already been taken. Idempotent, and no second event. */
  | { status: "already_decided"; policy: BrokerWorkPolicy };

function requireApprover(ctx: ServiceContext, policy: BrokerWorkPolicy) {
  const member = memberIn(ctx.organizationId, ctx.membershipId);
  const defaults = brokerPolicyDefaults(policy.organizationId);
  const ok = member !== undefined
    && isApprover(
      { membershipId: member.membershipId, organizationId: member.organizationId, isOwner: member.isOwner },
      policy.organizationId,
      defaults,
    );
  if (!ok) {
    throw new BrokerPolicyError(
      "not_authorized",
      `Only ${organizationName(policy.organizationId)}'s owner decides this policy.`,
    );
  }
}

/**
 * The owner says yes.
 *
 * For a proposal this puts it into force. For a temporary hold it CONVERTS the
 * hold into an explicit policy — same record, so the hold's own history travels
 * with the decision rather than being replaced by a tidier one — and the
 * approver chooses what it becomes and whether it ends.
 *
 * ★ IDEMPOTENT, AND THAT IS A REQUIREMENT ★
 * Two owners pressing approve at the same moment must leave one final state and
 * one event. The second call finds the decision already taken and writes
 * nothing at all, which is what makes the audit row count exactly one.
 */
export async function approveBrokerPolicy(
  ctx: ServiceContext,
  policyId: string,
  input: { action?: BrokerPolicyAction; expiresAt?: IsoDateTime; note?: string } = {},
): Promise<DecisionOutcome> {
  await sleep(LATENCY_MS);
  return approveBrokerPolicySync(ctx, policyId, input);
}

export function approveBrokerPolicySync(
  ctx: ServiceContext,
  policyId: string,
  input: { action?: BrokerPolicyAction; expiresAt?: IsoDateTime; note?: string } = {},
): DecisionOutcome {
  const policy = policyByIdForDecision(ctx, policyId);
  requireApprover(ctx, policy);

  const at = nowIso();
  if (!awaitsOwnerDecision(policy, at)) return { status: "already_decided", policy };

  const wasHold = policy.action === "temporary_safety_hold";
  const from = policy.status;

  if (wasHold) {
    // The hold becomes what the owner actually meant. Default to a hard block:
    // the hold was placed because somebody thought the freight was unsafe to
    // take, and silently downgrading that would be the system deciding.
    policy.action = input.action && input.action !== "temporary_safety_hold"
      ? input.action
      : "hard_block";
    policy.expiresAt = input.expiresAt;
  } else if (input.expiresAt) {
    policy.expiresAt = input.expiresAt;
  }

  policy.status = "active";
  policy.approvedBy = ctx.actor;
  policy.approvedAt = at;
  policy.decidedByMembershipId = ctx.membershipId;
  policy.approverMembershipId = undefined;
  policy.approverNameSnapshot = undefined;
  policy.escalated = false;

  const event = appendEvent(
    policy,
    wasHold ? "converted" : "approved",
    ctx.actor,
    ctx.organizationId,
    input.note?.trim()
      || (wasHold
        ? `The hold on ${policy.brokerNameSnapshot} is now an explicit ${policy.action.replace(/_/g, " ")}.`
        : `Approved. ${policy.organizationNameSnapshot} will treat ${policy.brokerNameSnapshot} as ${policy.action.replace(/_/g, " ")}.`),
    { from, to: "active" },
  );
  return { status: "ok", policy, event };
}

/** The owner says no. The record and its history stay; it filters nothing. */
export async function rejectBrokerPolicy(
  ctx: ServiceContext,
  policyId: string,
  note: string,
): Promise<DecisionOutcome> {
  await sleep(LATENCY_MS);
  return rejectBrokerPolicySync(ctx, policyId, note);
}

export function rejectBrokerPolicySync(
  ctx: ServiceContext,
  policyId: string,
  note: string,
): DecisionOutcome {
  const policy = policyByIdForDecision(ctx, policyId);
  requireApprover(ctx, policy);

  const at = nowIso();
  if (!awaitsOwnerDecision(policy, at)) return { status: "already_decided", policy };

  const from = policy.status;
  policy.status = "rejected";
  policy.decidedByMembershipId = ctx.membershipId;
  policy.approverMembershipId = undefined;
  policy.approverNameSnapshot = undefined;
  policy.escalated = false;

  const event = appendEvent(
    policy, "rejected", ctx.actor, ctx.organizationId,
    note.trim() || `Rejected. ${policy.brokerNameSnapshot} is not restricted for ${policy.organizationNameSnapshot}.`,
    { from, to: "rejected" },
  );
  return { status: "ok", policy, event };
}

/** The owner takes an active policy off. */
export async function revokeBrokerPolicy(
  ctx: ServiceContext,
  policyId: string,
  note: string,
): Promise<DecisionOutcome> {
  await sleep(LATENCY_MS);
  const policy = policyByIdForDecision(ctx, policyId);
  requireApprover(ctx, policy);

  const at = nowIso();
  if (effectiveStatus(policy, at) !== "active") return { status: "already_decided", policy };

  const from = policy.status;
  policy.status = "revoked";
  policy.decidedByMembershipId = ctx.membershipId;
  const event = appendEvent(
    policy, "revoked", ctx.actor, ctx.organizationId,
    note.trim() || `Revoked. ${policy.organizationNameSnapshot} works ${policy.brokerNameSnapshot} again.`,
    { from, to: "revoked" },
  );
  return { status: "ok", policy, event };
}

/**
 * Attach another record somebody can go and look at.
 *
 * Never changes what a policy DOES. A factoring decline arriving does not
 * escalate a warning into a block: that is a decision, and decisions belong to
 * the owner.
 */
export async function attachBrokerPolicyEvidence(
  ctx: ServiceContext,
  policyId: string,
  evidence: Omit<BrokerPolicyEvidenceRef, "attachedBy" | "attachedAt">,
): Promise<BrokerWorkPolicy> {
  await sleep(LATENCY_MS);
  const policy = policyByIdForDecision(ctx, policyId);
  const defaults = brokerPolicyDefaults(policy.organizationId);
  /*
   * The permission, and only the permission.
   *
   * No "unless they are the Owner" bypass: an Owner holds every key their
   * organization has, so the bypass would never have granted anybody anything
   * they did not already have — and it WOULD have made the rule untestable and
   * quietly different from every other permission check in this codebase.
   * Approval is the place authority differs from permission, and it says so
   * there, on its own.
   */
  if (!ctx.permissions.has(defaults.proposeRequires)) {
    throw new PermissionDeniedError([defaults.proposeRequires]);
  }

  policy.evidence.push({ ...evidence, attachedBy: ctx.actor, attachedAt: nowIso() });
  appendEvent(
    policy, "evidence_added", ctx.actor, ctx.organizationId,
    `${evidence.label} attached as evidence. It changes nothing on its own.`,
  );
  return policy;
}

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                  */
/* -------------------------------------------------------------------------- */

export interface ExceptionInput {
  policyId: string;
  reason: string;
  expiresAt: IsoDateTime;
  negotiationId?: string;
  listingId?: string;
  dispatchCycleId?: string;
  /** The carrier whose load this is, when a provider is booking it. */
  carrierOrganizationId?: string;
  /** The organization the exception frees. Defaults to the caller's. */
  forOrganizationId?: string;
}

export type ExceptionOutcome =
  | { status: "ok"; exception: BrokerPolicyException; policy: BrokerWorkPolicy; event: BrokerPolicyEvent }
  /**
   * A carrier owner freed THEIR carrier from a dispatch organization's policy.
   *
   * The carrier may decide the carrier works this broker. It may not order a
   * dispatch company to do work that company refuses, so the booking by that
   * dispatcher stays blocked and this says so, for reassignment.
   */
  | { status: "conflict"; exception: BrokerPolicyException; policy: BrokerWorkPolicy; event: BrokerPolicyEvent; detail: string };

/**
 * Let ONE booking through, on the owner's own authority.
 *
 * ★ WHO MAY, AND WHO MAY NEVER ★
 *  • The owner of the organization that WROTE the policy may except it.
 *  • A carrier owner may except a dispatch organization's policy, for their own
 *    carrier only, and the result is a conflict to reassign rather than an
 *    order to the dispatcher.
 *  • A dispatch organization can NEVER except a carrier's hard block. Not its
 *    owner, not under a grant, not with a reason. The carrier's authority moves
 *    the freight and the carrier said no.
 *
 * Exactly one history entry, which becomes exactly one audit row.
 */
export async function grantBrokerPolicyException(
  ctx: ServiceContext,
  input: ExceptionInput,
): Promise<ExceptionOutcome> {
  await sleep(LATENCY_MS);
  return grantBrokerPolicyExceptionSync(ctx, input);
}

export function grantBrokerPolicyExceptionSync(
  ctx: ServiceContext,
  input: ExceptionInput,
): ExceptionOutcome {
  const policy = policyByIdForDecision(ctx, input.policyId);
  const at = nowIso();

  if (!input.reason.trim()) {
    throw new BrokerPolicyError(
      "exception_not_allowed",
      "An exception needs a reason. Somebody will read it later.",
    );
  }
  if (!input.expiresAt || Date.parse(input.expiresAt) <= Date.parse(at)) {
    throw new BrokerPolicyError(
      "exception_needs_expiry",
      "An exception needs a future expiry. There is no standing exception.",
    );
  }

  const member = memberIn(ctx.organizationId, ctx.membershipId);
  const ownsPolicy = policy.organizationId === ctx.organizationId && member?.isOwner === true;
  const carrierOwnerOverride = policy.scope === "dispatch_organization"
    && member?.isOwner === true
    && input.carrierOrganizationId !== undefined
    && input.carrierOrganizationId === ctx.organizationId;

  if (!ownsPolicy && !carrierOwnerOverride) {
    throw new BrokerPolicyError(
      "not_authorized",
      policy.scope === "carrier"
        ? `${organizationName(policy.organizationId)} is the carrier. Only its owner can let a booking through its own block.`
        : `Only ${organizationName(policy.organizationId)}'s owner can except its policy.`,
    );
  }
  if (ownsPolicy && !brokerPolicyDefaults(policy.organizationId).allowOwnerBookingException) {
    throw new BrokerPolicyError(
      "exception_not_allowed",
      `${organizationName(policy.organizationId)} has turned booking exceptions off in its settings.`,
    );
  }

  const exception: BrokerPolicyException = {
    exceptionId: rowId("bpx"),
    policyId: policy.policyId,
    forOrganizationId: input.forOrganizationId ?? ctx.organizationId,
    negotiationId: input.negotiationId,
    listingId: input.listingId,
    dispatchCycleId: input.dispatchCycleId,
    reason: input.reason.trim(),
    grantedBy: ctx.actor,
    grantedByOrganizationId: ctx.organizationId,
    grantedAt: at,
    expiresAt: input.expiresAt,
    carrierOverrideOfDispatchPolicy: carrierOwnerOverride || undefined,
  };
  policy.exceptions.push(exception);

  const event = appendEvent(
    policy, "exception_granted", ctx.actor, ctx.organizationId,
    `One booking allowed through until ${input.expiresAt}: ${exception.reason}`,
  );

  if (carrierOwnerOverride) {
    return {
      status: "conflict",
      exception,
      policy,
      event,
      detail:
        `${ctx.organizationName} will work ${policy.brokerNameSnapshot}, but `
        + `${policy.organizationNameSnapshot} will not. Move this load to another `
        + "dispatcher or to the carrier's own desk — a dispatch company cannot be "
        + "made to take work it refuses.",
    };
  }
  return { status: "ok", exception, policy, event };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bring lapsed policies into line with their own expiry, once.
 *
 * Runs on every read, like every other reconciliation in this codebase: a
 * policy whose expiry passed is expired whether or not anybody looked, and the
 * history entry that records it should exist exactly once.
 */
function reconcile(organizationId: string): void {
  const at = nowIso();
  for (const policy of bucket(organizationId)) {
    if (!hasLapsed(policy, at)) continue;
    const from = policy.status;
    policy.status = "expired";
    appendEvent(
      policy, "expired",
      { userId: "system", membershipId: "system", displayNameSnapshot: "Antcolos", source: "system" },
      organizationId,
      policy.action === "temporary_safety_hold"
        ? `The temporary hold on ${policy.brokerNameSnapshot} ran out with no decision. It is lifted, and its history is kept.`
        : `This policy reached its own expiry and is no longer in force.`,
      { from, to: "expired" },
    );
  }
}

/**
 * Every organization whose policies this workspace is entitled to READ IN FULL.
 *
 * Its own, plus the carriers it holds a live grant from — a provider that is
 * told "blocked" has to be able to find out by whom, and it is the party being
 * told not to book. Nothing else, ever: there is no path from here to a carrier
 * this workspace does not work for.
 */
function readableOrganizationsFor(ctx: ServiceContext): string[] {
  return [...new Set([ctx.organizationId, ...carriersReachableBy(ctx.organizationId)])];
}

/**
 * Dispatch organizations currently working this carrier's trucks.
 *
 * A carrier is entitled to know which of its dispatch companies is refusing a
 * broker, because that refusal is stopping the carrier's own freight and the
 * carrier has to be able to reassign the load or override it for itself.
 *
 * ★ IN-FORCE POLICIES ONLY, AND NEVER THE PRIVATE SENTENCE ★
 * A dispatch company's proposals, rejected asks and internal history are its
 * own business, and so is its reasoning: `mayReadExplanation` already withholds
 * the explanation from everyone but the owner and a delegate acting for that
 * carrier. What the carrier gets is the fact, the scope and the name — which is
 * exactly what it needs to act, and nothing that would turn one company's
 * private opinion into another company's intelligence.
 */
function delegatesWorkingFor(carrierOrganizationId: string): string[] {
  const org = organizationRecordFor(carrierOrganizationId);
  if (org?.type !== "CARRIER") return [];
  return [...new Set(
    dispatchGrantsByCarrier(carrierOrganizationId).map((g) => g.dispatchOrganizationId),
  )];
}

/** Every policy this workspace may see, with how much of each it may see. */
function readablePolicies(
  ctx: ServiceContext,
): { policy: BrokerWorkPolicy; organizationId: string }[] {
  const out: { policy: BrokerWorkPolicy; organizationId: string }[] = [];

  for (const organizationId of readableOrganizationsFor(ctx)) {
    reconcile(organizationId);
    for (const policy of bucket(organizationId)) out.push({ policy, organizationId });
  }

  const at = nowIso();
  for (const organizationId of delegatesWorkingFor(ctx.organizationId)) {
    if (organizationId === ctx.organizationId) continue;
    reconcile(organizationId);
    for (const policy of bucket(organizationId)) {
      // In force, and about how this dispatch company operates. Anything it is
      // still thinking about stays with it.
      if (policy.scope !== "dispatch_organization") continue;
      if (!isEnforceable(policy, at)) continue;
      out.push({ policy, organizationId });
    }
  }
  return out;
}

/** Every policy in scope for one workspace, newest first. */
export function brokerPoliciesFor(
  ctx: ServiceContext,
  filters: BrokerPolicyFilters = {},
): BrokerPolicyListing[] {
  if (!ctx.permissions.has("customers:view")) return [];
  const at = nowIso();
  const rows: BrokerPolicyListing[] = [];

  for (const { policy, organizationId } of readablePolicies(ctx)) {
    const currentStatus = effectiveStatus(policy, at);
    if (filters.status?.length && !filters.status.includes(currentStatus)) continue;
    if (filters.action?.length && !filters.action.includes(policy.action)) continue;
    if (filters.scope?.length && !filters.scope.includes(policy.scope)) continue;
    if (filters.reason?.length && !filters.reason.includes(policy.reason)) continue;
    if (filters.brokerPartyId && policy.brokerPartyId !== filters.brokerPartyId) continue;
    const awaiting = awaitsOwnerDecision(policy, at);
    if (filters.awaitingApprovalOnly && !awaiting) continue;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay = `${policy.brokerNameSnapshot} ${policy.organizationNameSnapshot}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({
      policy,
      currentStatus,
      awaitingApproval: awaiting,
      mayReadExplanation: mayReadExplanation(policy, {
        workingOrganizationId: ctx.organizationId,
        carrierOrganizationId: organizationId,
        delegatedForCarrier: organizationId !== ctx.organizationId,
      }),
    });
  }

  return rows.sort((a, b) => b.policy.updatedAt.localeCompare(a.policy.updatedAt));
}

/**
 * One policy, for a caller that is about to decide it.
 *
 * A policy belonging to an organization this workspace cannot reach is
 * indistinguishable from one that does not exist, for the same reason a
 * forbidden load is.
 */
function policyByIdForDecision(ctx: ServiceContext, policyId: string): BrokerWorkPolicy {
  const found = readablePolicies(ctx).find((r) => r.policy.policyId === policyId);
  if (found) return found.policy;
  throw new NotFoundError("Broker policy");
}

export function brokerPolicyById(
  ctx: ServiceContext,
  policyId: string,
): BrokerWorkPolicy | undefined {
  try {
    return policyByIdForDecision(ctx, policyId);
  } catch {
    return undefined;
  }
}

/** Every policy anywhere. Internal to the evaluator; never reachable by a screen. */
function allBrokerPoliciesForEvaluation(): readonly BrokerWorkPolicy[] {
  for (const organizationId of state.policies.keys()) reconcile(organizationId);
  return [...state.policies.values()].flat();
}

/** One organization's own policies. The partition, for the audit feed. */
export function brokerPoliciesOwnedBy(organizationId: string): readonly BrokerWorkPolicy[] {
  reconcile(organizationId);
  return bucket(organizationId);
}

/* -------------------------------------------------------------------------- */
/* Evaluation, for Search, the Opportunity and Booking                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve what a load board posting said about its broker to a real profile.
 *
 * Internal: every screen reads the resolution off the match, which carried it
 * from here. A second entry point would be a second chance to resolve a broker
 * differently from the way the search did.
 */
function resolveListingBroker(listing: Pick<Listing, "broker">): ResolvedBroker {
  return resolveBrokerForPolicy(
    { name: listing.broker.name, mcNumber: listing.broker.mcNumber },
    allParties(),
  );
}

export interface EvaluationRequest {
  /** The carrier whose authority would move it. */
  carrierOrganizationId?: string;
  /** Exceptions apply only at booking, where there is a load to except. */
  includeExceptionsFor?: { negotiationId?: string; listingId?: string };
}

/**
 * ★ THE ONE CALL SEARCH, THE OPPORTUNITY AND BOOKING ALL MAKE ★
 *
 * Same store, same pure evaluator, same instant semantics. Booking calls it
 * again immediately before committing, which is what enforces a policy written
 * after the Opportunity was created.
 */
export function evaluateBrokerPolicyFor(
  ctx: ServiceContext,
  listing: Pick<Listing, "broker">,
  request: EvaluationRequest = {},
): BrokerPolicyEvaluation {
  const broker = resolveListingBroker(listing);
  const audience: PolicyAudience & { delegatedForCarrier?: boolean } = {
    carrierOrganizationId: request.carrierOrganizationId,
    workingOrganizationId: ctx.organizationId,
    delegatedForCarrier:
      request.carrierOrganizationId !== undefined
      && request.carrierOrganizationId !== ctx.organizationId,
  };

  const policies = allBrokerPoliciesForEvaluation();
  /*
   * ★ AN EXCEPTION COVERS ONE BOOKING, AND THE MATCH IS NARROWEST-FIRST ★
   *
   * An exception granted for one negotiation must not be picked up by a
   * different truck's negotiation that happens to be about the same listing.
   * So an exception naming a negotiation is honoured ONLY for that negotiation,
   * and the listing is consulted only for an exception that named no
   * negotiation. An exception that scoped itself to neither covers nothing —
   * there is no such thing as a standing exception, and an ORed match would
   * have quietly created one.
   */
  const wanted = request.includeExceptionsFor;
  const exceptions = wanted
    ? policies.flatMap((p) => p.exceptions).filter((e) => {
      if (e.negotiationId !== undefined) return e.negotiationId === wanted.negotiationId;
      if (e.listingId !== undefined) return e.listingId === wanted.listingId;
      return false;
    })
    : [];

  return evaluateBrokerPolicies({
    broker,
    policies,
    audience,
    organizationName,
    at: nowIso(),
    exceptions,
    // The CARRIER's setting governs the carrier's freight. A dispatch workspace
    // reads the setting of the carrier it is working for, not its own, for the
    // same reason it is governed by that carrier's policies.
    unresolvedBehavior: brokerPolicyDefaults(
      request.carrierOrganizationId ?? ctx.organizationId,
    ).unknownBrokerBehavior,
  });
}

/**
 * Whether a provider currently holds a live grant on this truck from this
 * carrier. Used to decide whether a private explanation may travel.
 */
export function delegatedForCarrier(
  organizationId: string,
  truckId: string,
  carrierOrganizationId: string,
): boolean {
  const grant = liveDispatchGrantFor(truckId, organizationId);
  return grant?.grantedByCarrierOrganizationId === carrierOrganizationId;
}

/* -------------------------------------------------------------------------- */
/* Booking                                                                     */
/* -------------------------------------------------------------------------- */

export interface BookingPolicyVerdict {
  evaluation: BrokerPolicyEvaluation;
  outcome: "allow" | "warn" | "blocked" | "conflict";
  /** The sentence the booking screen shows. Present unless the outcome is allow. */
  detail?: string;
  /** What an owner would have to except. Empty unless something is blocking. */
  blockingPolicyIds: string[];
  /**
   * The organization asked that somebody say out loud they read the warning.
   *
   * ★ IT STILL DOES NOT BLOCK ★
   * This is a claim about the confirmation screen and nothing else: the booking
   * is permitted either way, and no code path here turns it into a refusal. A
   * warning that could refuse would be a hard block that skipped an owner, and
   * the four actions exist precisely to keep those apart.
   */
  requiresAcknowledgement?: boolean;
}

/**
 * The last word before a truck is committed.
 *
 * ★ RE-EVALUATED, NOT READ BACK ★
 * It calls the same evaluator over the same canonical store as Search did, at
 * THIS instant, rather than trusting what the Opportunity carried. That is the
 * whole point: a hard block written after the Opportunity was created has to
 * stop the booking, and a revocation written since has to let it through.
 *
 * ★ THE ONE ASYMMETRY WORTH READING ★
 * A carrier's block cannot be excepted by a dispatch organization at all — its
 * owner is the only person who may, and `grantBrokerPolicyException` refuses
 * everybody else. A dispatch organization's OWN policy, once a carrier owner
 * has excepted it for their carrier, produces `conflict` rather than `allow`:
 * the carrier may decide the carrier works this broker, and may not conscript
 * a dispatch company into work it refuses. The load needs another desk.
 */
export function verdictForBooking(
  ctx: ServiceContext,
  listing: Pick<Listing, "broker">,
  request: {
    carrierOrganizationId?: string;
    negotiationId?: string;
    listingId?: string;
  },
): BookingPolicyVerdict {
  const evaluation = evaluateBrokerPolicyFor(ctx, listing, {
    carrierOrganizationId: request.carrierOrganizationId,
    includeExceptionsFor: {
      negotiationId: request.negotiationId,
      listingId: request.listingId,
    },
  });

  if (evaluation.effect !== "blocked") {
    const warns = evaluation.effect === "warning"
      || (evaluation.unresolvedBroker && evaluation.unresolvedBehavior === "warn");
    return {
      evaluation,
      outcome: warns ? "warn" : "allow",
      detail: evaluation.notices[0]
        ? noticeHeadlineFor(evaluation.notices[0])
        : evaluation.unresolvedBroker && warns
          ? `Nothing resolves ${evaluation.brokerNameSnapshot} to a broker profile, so no working policy could be checked against them.`
          : undefined,
      blockingPolicyIds: [],
      requiresAcknowledgement: warns
        && brokerPolicyDefaults(request.carrierOrganizationId ?? ctx.organizationId)
          .warningBookingBehavior === "require_acknowledgement",
    };
  }

  const blocking = evaluation.notices.filter((n) => n.effect === "blocked");
  const at = nowIso();

  // Did the CARRIER's owner already say the carrier will work this broker,
  // against a policy belonging to the dispatch organization that is booking?
  const overridden = blocking.find((n) => {
    if (n.scope !== "dispatch_organization") return false;
    const policy = brokerPolicyById(ctx, n.policyId);
    return policy?.exceptions.some(
      (e) => e.carrierOverrideOfDispatchPolicy === true
        && e.forOrganizationId === request.carrierOrganizationId
        && Date.parse(e.expiresAt) > Date.parse(at),
    ) === true;
  });

  if (overridden) {
    return {
      evaluation,
      outcome: "conflict",
      detail:
        `${organizationName(request.carrierOrganizationId ?? ctx.organizationId)} will work `
        + `${evaluation.brokerNameSnapshot}; ${overridden.owningOrganizationName} will not. `
        + "Move this load to another dispatcher or to the carrier's own desk — a dispatch "
        + "company cannot be made to take work it refuses.",
      blockingPolicyIds: blocking.map((n) => n.policyId),
    };
  }

  return {
    evaluation,
    outcome: "blocked",
    detail: blocking.map(noticeHeadlineFor).join(" "),
    blockingPolicyIds: blocking.map((n) => n.policyId),
  };
}

/* -------------------------------------------------------------------------- */
/* Factoring                                                                   */
/* -------------------------------------------------------------------------- */

export interface FactoringRejectionInput {
  brokerPartyId: string;
  carrierOrganizationId: string;
  /** The factor's own reference. Never the factor's opinion, restated. */
  factoringResultId: string;
  label: string;
  observedAt: IsoDateTime;
  explanation: string;
}

/**
 * A factor declined this broker for THIS carrier.
 *
 * ★ WHAT IT DOES, AND WHAT IT REFUSES TO DO ★
 * It creates one carrier-scoped PROPOSAL, with the factoring result attached as
 * dated evidence, and stops. It does not block anything, it does not touch the
 * canonical broker profile, it does not reach any other carrier, and there is
 * no code path from here to a global list — because no such list exists. A
 * human owner decides, on a record that says exactly what it was decided from
 * and when that was true.
 *
 * The proposal is a WARNING rather than a block for the same reason: a factor
 * declining a receivable is a fact about money, and turning it automatically
 * into "this carrier will never haul for them" would be the system taking a
 * commercial decision nobody made.
 */
export async function recordFactoringRejection(
  ctx: ServiceContext,
  input: FactoringRejectionInput,
): Promise<ProposeOutcome> {
  await sleep(LATENCY_MS);
  return proposeBrokerPolicySync(ctx, {
    scope: "carrier",
    carrierOrganizationId: input.carrierOrganizationId,
    brokerPartyId: input.brokerPartyId,
    action: "warning",
    reason: "factoring_rejected",
    explanation: input.explanation,
    evidence: [{
      kind: "factoring_result",
      id: input.factoringResultId,
      label: input.label,
      observedAt: input.observedAt,
    }],
  });
}

/* -------------------------------------------------------------------------- */
/* Test seam                                                                   */
/* -------------------------------------------------------------------------- */

/** The raw rows for one organization. Tests only; no screen imports this. */
export function brokerPoliciesForTests(organizationId: string): BrokerWorkPolicy[] {
  return bucket(organizationId);
}
