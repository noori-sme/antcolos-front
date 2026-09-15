import {
  ASSIGNABLE_ROLES, KEEP_QUIETS_REMINDER_MINUTES,
} from "@/config/responsibility";
import {
  appendTimeline, attentionFor, buildQueues, escalationsFor, fleetProfileFor,
  hasEscalated, isAtRisk, nextEligibleAfter, pendingMoves, policyFor,
  queueCounts, routeResponsibility, seedPolicies, slaFor,
  type CandidateWorkload, type QueueInput, type ResponsibilityCandidate,
  type RoutingResult,
} from "@/lib/responsibility";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import type {
  ApprovalState, AssignmentSource, AssignmentState, AttentionReason,
  EligibilityVerdict, EscalationPolicy,
  FleetProfile, Membership,
  MtLoop, NeedsYouItem, Organization, PermissionKey, ResponsibilityAbilities,
  ResponsibilityAssignment, ResponsibilityBoard, ResponsibilityContext,
  ResponsibilityHolder, ResponsibilityTimelineAction, ResponsibilityTimelineEntry,
  ResponsibilityWorkKind,
} from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  ApprovalDecisionInput, AttentionViews, BoardOptions, MoveWorkInput,
  PolicyPatch, ResponsibilityService, WatcherInput, WorkKey,
} from "../contracts/responsibility";
import { mockAuditService } from "./audit";
import {
  memberIn, membersOf, membershipRecordFor, organizationRecordFor, ownerOf,
} from "./membership-directory";
import { type MtLoopContext, openLoopsFor } from "./mt-loop";
import { mockNeedsYouService } from "./needs-you";
import {
  responsibilityContextForLoop, responsibilityContextForNeedsYou,
} from "./responsibility-context";
import { nowIso } from "./time";
import { fleetCount, truckContextFrom } from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The responsibility, delegation and escalation service.
 *
 * Read `../contracts/responsibility.ts` first: it states what this is not — no
 * timers, no delivery, no enforcement, no persistence — and everything below
 * keeps to it.
 *
 * Three rules hold this file together:
 *
 *  1. NOTHING IS SEEDED. Assignments are RECONCILED against live MT Loop and
 *     Needs You state on every read, the same way the MT Loop board reconciles
 *     against the truck registry. Fix the work and the responsibility record
 *     follows; there is no fixture anybody has to keep in step.
 *
 *  2. ONLY THE ANSWER TO "WHO" IS STORED. A record here holds the overrides a
 *     person made, the acknowledgement, the approval, the watchers and the
 *     timeline. Everything else — the roles, the SLA, the escalation level, the
 *     abilities — is derived on every read, because a stored SLA state is a
 *     stale SLA state the moment somebody acts in another tab.
 *
 *  3. NO WORK IS OWNERLESS. Every path out of `routeResponsibility` produces an
 *     accountable membership, and the reconciliation below re-routes work whose
 *     holder has been suspended or removed rather than leaving it pointing at
 *     somebody who is gone. Nothing is deleted when that happens — the timeline
 *     keeps the whole chain.
 */

const LATENCY_MS = 220;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The stored half of an assignment. Deliberately small — see rule 2.
 */
interface StoredRecord {
  id: string;
  organizationId: string;
  workKind: ResponsibilityWorkKind;
  workId: string;
  /** A person's explicit choice of who does it. */
  override?: {
    membershipId: string;
    source: "manual" | "escalation" | "takeover" | "fallback";
    note: string;
    /**
     * True when this came from somebody accepting the work themselves — an MT
     * Loop claim, a Needs You item taken — rather than from an authorized
     * person handing it out.
     *
     * The two are treated differently on purpose. A manager may deliberately
     * give work to somebody the default routing would have passed over, and
     * that choice stands. Accepting work yourself is not a licence to keep it
     * after you can no longer do it, so a claim is re-checked on every read and
     * released the moment the claimer stops being eligible.
     */
    fromClaim?: boolean;
    /**
     * When the choice was made.
     *
     * Load-bearing, not bookkeeping. A person's acceptance in MT Loop or Needs
     * You and a manager's delegation here are both explicit choices, and the
     * only honest way to settle which one applies is which came last. Without
     * this, a dispatcher who pressed Claim after a delegation would be told
     * they had the loop while every other surface still named somebody else —
     * the same disagreement in a new place.
     */
    at: string;
  };
  /** A person's explicit choice of who answers for it. */
  accountableOverride?: { membershipId: string; note: string; pinned?: boolean };
  watchers: string[];
  acknowledgedAt?: string;
  acknowledgedByMembershipId?: string;
  keptAt?: string;
  approvalState: ApprovalState;
  approverMembershipId?: string;
  timeline: readonly ResponsibilityTimelineEntry[];
}

interface OrgState {
  policies: EscalationPolicy[];
  /** The answer to onboarding's one question, when somebody has given one. */
  truckCountOverride?: number;
  records: Map<string, StoredRecord>;
}

let state: Map<string, OrgState> | null = null;

function db(): Map<string, OrgState> {
  if (!state) state = new Map();
  return state;
}

function org(organizationId: string): OrgState {
  const all = db();
  let existing = all.get(organizationId);
  if (!existing) {
    existing = {
      policies: seedPolicies(organizationId, nowIso()),
      records: new Map(),
    };
    all.set(organizationId, existing);
  }
  return existing;
}

/** Test hook and demo reset. Never called during a normal render. */
export function resetResponsibility() {
  state = null;
}

const keyFor = (kind: ResponsibilityWorkKind, id: string) => `resp_${kind}_${id}`;

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The MT Loop service needs the organization and membership records themselves,
 * not just their ids. Rebuilt here from the directory rather than threaded
 * through every caller, so a screen never assembles one by hand.
 */
function loopContextFrom(ctx: ServiceContext): MtLoopContext | undefined {
  const organization = organizationRecordFor(ctx.organizationId);
  const membership = membershipRecordFor(ctx.membershipId);
  if (!organization || !membership) return undefined;
  if (membership.organizationId !== ctx.organizationId) return undefined;
  return { ...ctx, organization, membership };
}

/** Everybody in the workspace, in the shape the engine expects. */
function candidatesFor(organizationId: string): ResponsibilityCandidate[] {
  return membersOf(organizationId);
}

/**
 * Whether this viewer may see other people's work at all.
 *
 * Two things, and both are needed: the authority to see the roster, and a
 * record scope that is not narrowed to their own. A driver holds the second
 * against them however many permissions they collect.
 */
function maySeeTeamWork(ctx: ServiceContext): boolean {
  return ctx.scope.loads === "all" && ctx.permissions.has("members:view");
}

/** The authority to move work from one person to another. */
function mayMoveWork(ctx: ServiceContext): boolean {
  if (!maySeeTeamWork(ctx)) return false;
  return ctx.permissions.has("loads:assign") || ctx.permissions.has("members:edit");
}

/** The authority to change targets, ladders and policy. Behind settings. */
function mayCustomize(ctx: ServiceContext): boolean {
  return ctx.permissions.has("organization:manage") || ctx.permissions.has("permissions:manage");
}

function viewerIsOwner(ctx: ServiceContext): boolean {
  return memberIn(ctx.organizationId, ctx.membershipId)?.isOwner === true;
}

/* -------------------------------------------------------------------------- */
/* Fleet profile                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How many trucks this workspace runs.
 *
 * The truck registry is the source of truth. The override exists for the ONE
 * onboarding question — a Carrier who has said "I have three trucks" before
 * registering any of them should get the three-truck shape immediately rather
 * than the shape of an empty fleet.
 */
function truckCountFor(ctx: ServiceContext): number {
  const stored = org(ctx.organizationId).truckCountOverride;
  if (stored !== undefined) return stored;
  try {
    return fleetCount(truckContextFrom(ctx));
  } catch {
    // A workspace whose fleet cannot be read is not a workspace with no
    // responsibility model — it is a workspace we know nothing about the size
    // of, and the smallest shape is the safe default.
    return 0;
  }
}

function profileFor(ctx: ServiceContext): FleetProfile {
  return fleetProfileFor({
    organizationId: ctx.organizationId,
    truckCount: truckCountFor(ctx),
    members: candidatesFor(ctx.organizationId),
    sizeAnswered: org(ctx.organizationId).truckCountOverride !== undefined,
  });
}

/* -------------------------------------------------------------------------- */
/* Gathering the work                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every piece of work in this workspace, as typed responsibility context.
 *
 * Both sources emit their own context — see `responsibility-context.ts` — and
 * neither is asked who should hold it. A failure in one source never withholds
 * the other: a dispatch workspace whose truck registry is unreadable still gets
 * its Needs You queue, and says so by showing fewer rows rather than none.
 */
async function gatherWork(ctx: ServiceContext): Promise<ResponsibilityContext[]> {
  const contexts: ResponsibilityContext[] = [];

  const loopCtx = loopContextFrom(ctx);
  if (loopCtx) {
    try {
      const loops: MtLoop[] = openLoopsFor(loopCtx);
      for (const loop of loops) contexts.push(responsibilityContextForLoop(loop));
    } catch {
      // Deliberately silent: a board that cannot read one source is still worth
      // showing for the other. The MT Loop screen reports its own failures.
    }
  }

  try {
    const items: NeedsYouItem[] = await mockNeedsYouService.list(ctx);
    for (const item of items) {
      if (item.status === "resolved") continue;
      contexts.push(responsibilityContextForNeedsYou(item));
    }
  } catch {
    // As above.
  }

  return contexts;
}

/**
 * What each membership is already holding, for the continuity signal and the
 * tie-break.
 *
 * Computed from the same contexts the board is about to route, so it reflects
 * the world as it is this instant rather than a count somebody maintained.
 */
function workloadsFrom(
  contexts: readonly ResponsibilityContext[],
  organizationId: string,
): Map<string, CandidateWorkload> {
  const out = new Map<string, CandidateWorkload>();
  for (const context of contexts) {
    const record = org(organizationId).records.get(keyFor(context.work.kind, context.work.id));
    const holder = record?.override?.membershipId;
    if (!holder || context.resolvedAt) continue;

    const existing = out.get(holder)
      ?? { membershipId: holder, truckIds: [], loadIds: [], openCount: 0 };
    out.set(holder, {
      membershipId: holder,
      truckIds: context.truckId
        ? [...new Set([...existing.truckIds, context.truckId])]
        : existing.truckIds,
      loadIds: context.loadId
        ? [...new Set([...existing.loadIds, context.loadId])]
        : existing.loadIds,
      openCount: existing.openCount + 1,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

function recordFor(context: ResponsibilityContext): StoredRecord {
  const bucket = org(context.organizationId).records;
  const id = keyFor(context.work.kind, context.work.id);
  let record = bucket.get(id);
  if (!record) {
    record = {
      id,
      organizationId: context.organizationId,
      workKind: context.work.kind,
      workId: context.work.id,
      watchers: [],
      approvalState: context.approvalRequired ? "requested" : "not_required",
      timeline: [],
    };
    bucket.set(id, record);
  }
  return record;
}

/**
 * A membership or relationship has ended. Move the work, keep the history.
 *
 * The milestone is precise: "If a Membership or relationship ends, safely route
 * unresolved work to the next eligible Membership or Owner fallback without
 * deleting history." So nothing is deleted — the override is REPLACED and the
 * timeline gains two lines, one saying who lost it and why, one saying who has
 * it now. A week later the chain still reads.
 *
 * This is the one place the service moves work without a person asking, and it
 * is not an escalation: it is the fallback that keeps the no-ownerless-work
 * invariant true when somebody walks out.
 */
function rerouteIfHolderGone(
  record: StoredRecord,
  context: ResponsibilityContext,
  candidates: readonly ResponsibilityCandidate[],
  fleetProfile: FleetProfile,
  workloads: ReadonlyMap<string, CandidateWorkload>,
): void {
  const holderId = record.override?.membershipId;
  if (!holderId || context.resolvedAt) return;

  const holder = candidates.find((c) => c.membershipId === holderId);
  // The ONE condition that moves work without a person asking: the seat has
  // ended. The milestone is specific — "if a Membership or relationship ends,
  // safely route unresolved work to the next eligible Membership or Owner
  // fallback" — and everything else that might tempt a reroute is deliberately
  // NOT here:
  //
  //   on leave, off shift    an escalation trigger, not a reason to take
  //                          somebody's work off them while they are away.
  //   lost a permission      also an escalation trigger, and listed in the
  //                          milestone as one. Rerouting on it would silently
  //                          undo a deliberate assignment somebody made ahead
  //                          of granting the permission, which is a normal
  //                          thing for a manager to do.
  if (holder && holder.status === "active") return;

  const next = nextEligibleAfter(
    { context, members: candidates, fleetProfile, workloads },
    holderId,
  );
  if (!next) return;

  const gone = holder?.displayName ?? "The previous assignee";
  const why = `${gone} is no longer an active member of this workspace.`;

  record.timeline = appendTimeline(record.timeline, {
    action: "fallback_applied",
    actorName: "Antcolos",
    subjectMembershipId: holderId,
    subjectName: gone,
    note: `${why} The work was routed on rather than left without an owner.`,
  });
  record.timeline = appendTimeline(record.timeline, {
    action: "reassigned",
    actorName: "Antcolos",
    subjectMembershipId: next.membershipId,
    subjectName: next.displayName,
    note: `Routed to ${next.displayName}, the next eligible member.`,
  });
  record.override = {
    membershipId: next.membershipId,
    source: "fallback",
    note: why,
    at: nowIso(),
  };
}

/**
 * Somebody accepted this work in the module that owns it. Make that the
 * canonical answer.
 *
 * ★ THE FIX FOR THE MT LOOP SEAM ★
 * MT Loop and Needs You both let a person say "I have this". Before this
 * existed, that acceptance lived only in the module: the MT Loop board read it
 * and called that person "responsible", the engine never saw it and routed the
 * loop somewhere else, and two screens gave two answers to one question.
 *
 * Now there is one store for "a person chose" — `record.override` — and this
 * is how a module's acceptance gets into it. Three rules keep it honest:
 *
 *   • An EXISTING override always wins. It is a later, deliberate decision by
 *     somebody with the authority to move work (or by the engine's own
 *     fallback), and a stale claim must not undo it. Claiming afresh writes
 *     the override directly — see `setWorkOverride` — so a new claim does win.
 *   • The claimer must still be ELIGIBLE. Somebody who has lost the
 *     permission, left the workspace, or whose relationship has ended does not
 *     become responsible because a field still has their name in it. The work
 *     routes on, and nothing is deleted from either record.
 *   • It is recorded as `manual`, because that is what it is: a person chose.
 */
function canStillDoIt(
  candidate: ResponsibilityCandidate | undefined,
  context: ResponsibilityContext,
): candidate is ResponsibilityCandidate {
  if (!candidate || candidate.status !== "active") return false;
  return context.requires.every((k) => candidate.permissions.has(k));
}

/**
 * ★ THE FIX FOR THE MT LOOP SEAM ★
 *
 * Which explicit choice of who does this work applies right now — the one
 * stored here, or the acceptance recorded in the module that holds the work.
 *
 * MT Loop and Needs You both let a person say "I have this". MT Loop used to
 * treat that as its own answer to "who is responsible", render it, and never
 * tell the engine; the engine routed the same loop elsewhere, and two screens
 * gave two answers to one question. Now an acceptance is a FACT the module
 * reports and this function decides what it means. There is one routing engine
 * and one place that settles precedence, which is here.
 *
 * ★ PURE ON PURPOSE ★
 * It returns a value and writes nothing. That is not tidiness: reading the
 * board used to be able to write overrides, and because the workload tie-break
 * reads overrides, the second read of an unchanged workspace gave a different
 * answer from the first — fifteen items moved between two reads that asked the
 * same question. A derivation that mutates the thing it derives from cannot be
 * stable, and four surfaces agreeing is worth nothing if the answer changes
 * each time somebody looks.
 *
 * Four rules, in order:
 *
 *   1. No acceptance, or one with no time on it → whatever is stored stands.
 *   2. The later choice wins. A delegation made here and an acceptance made in
 *      MT Loop are both a person choosing; neither outranks the other by
 *      virtue of which screen it was made on, so the tie-break is time.
 *   3. The accepter must still be able to do the work. Permission loss,
 *      suspension, a membership ending and a relationship ending all take
 *      effect on the next read, with no timer and nothing scheduled. Nothing
 *      is deleted: the acceptance stays on the module's record, and the engine
 *      simply stops agreeing that it decides anything.
 *   4. Accepting what was already yours is not an override. If routing would
 *      have picked this person anyway, recording "a person chose" would
 *      replace the real reason — "follows the delegation that gave them this
 *      carrier" — with something circular, and would outlive the delegation it
 *      hid.
 */
function effectiveOverrideFor(
  record: StoredRecord,
  context: ResponsibilityContext,
  candidates: readonly ResponsibilityCandidate[],
  fleetProfile: FleetProfile,
  workloads: ReadonlyMap<string, CandidateWorkload>,
): StoredRecord["override"] {
  const stored = record.override;
  const claimed = context.claimedByMembershipId;
  const claimedAt = context.claimedAt;

  if (!claimed || !claimedAt || context.resolvedAt) return stored;          // 1

  const supersedes = !stored
    || stored.membershipId === claimed
    || Date.parse(claimedAt) > Date.parse(stored.at);
  if (!supersedes) return stored;                                           // 2

  const claimer = candidates.find((c) => c.membershipId === claimed);
  if (!canStillDoIt(claimer, context)) {                                    // 3
    // If what is stored IS this acceptance, it goes with it and the work is
    // routed again. A choice somebody else made stands.
    return stored?.fromClaim ? undefined : stored;
  }

  if (stored?.membershipId === claimed && !stored.fromClaim) return stored;

  const wouldBe = routeResponsibility({                                     // 4
    context, members: candidates, fleetProfile, workloads,
    accountableOverride: record.accountableOverride,
  }).responsible.membershipId;
  if (wouldBe === claimed) return undefined;

  return {
    membershipId: claimed,
    source: "manual",
    note: `${claimer.displayName} took this on.`,
    fromClaim: true,
    at: claimedAt,
  };
}

/**
 * An escalation rung that MOVES work, honoured only because a policy said so.
 *
 * Almost always a no-op — no seeded policy contains a step that moves work, and
 * that is the default the milestone asks for. When a Carrier has deliberately
 * added one, this is where it takes effect, and it is recorded as an escalation
 * rather than disguised as a routing decision.
 */
function applyPolicyMoves(
  record: StoredRecord,
  routing: RoutingResult,
  context: ResponsibilityContext,
  candidates: readonly ResponsibilityCandidate[],
  fleetProfile: FleetProfile,
  workloads: ReadonlyMap<string, CandidateWorkload>,
  escalations: ReturnType<typeof escalationsFor>,
): boolean {
  const moves = pendingMoves(escalations);
  if (moves.length === 0) return false;

  const current = routing.responsible.membershipId;
  const next = nextEligibleAfter(
    { context, members: candidates, fleetProfile, workloads },
    current,
  );
  if (!next || next.membershipId === current) return false;

  const { trigger, step } = moves[0];
  record.override = {
    membershipId: next.membershipId,
    source: "escalation",
    note: `Moved by the escalation policy at level ${step.level}.`,
    at: nowIso(),
  };
  record.timeline = appendTimeline(record.timeline, {
    action: "reassigned",
    actorName: "Antcolos",
    subjectMembershipId: next.membershipId,
    subjectName: next.displayName,
    note: `The escalation policy for "${trigger}" moves work at level ${step.level}, so it went to ${next.displayName}.`,
    trigger,
    level: step.level,
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Building one assignment                                                     */
/* -------------------------------------------------------------------------- */

function abilitiesFor(
  ctx: ServiceContext,
  routing: RoutingResult,
  record: StoredRecord,
  candidates: readonly ResponsibilityCandidate[],
  context: ResponsibilityContext,
): ResponsibilityAbilities {
  const me = ctx.membershipId;
  const open = !context.resolvedAt;
  const mine = routing.responsible.membershipId === me;
  const answersForIt = routing.accountable.membershipId === me;
  const move = mayMoveWork(ctx);
  const owner = viewerIsOwner(ctx);

  const myself = candidates.find((c) => c.membershipId === me);
  // Taking work over means doing it, so the taker has to be able to do it.
  // Being senior is not a substitute for holding the permission.
  const couldDoIt = Boolean(myself) && context.requires.every((k) => ctx.permissions.has(k));

  return {
    acknowledge: open && (mine || answersForIt) && !record.acknowledgedAt,
    keep: open && mine,
    delegate: open && move,
    reassign: open && move,
    changeAccountable: open && move && (owner || ctx.permissions.has("members:edit")),
    requestApproval: open && (mine || answersForIt) && record.approvalState !== "requested",
    approve: open
      && record.approvalState === "requested"
      && routing.approver?.membershipId === me,
    escalate: open && (mine || answersForIt || move),
    // Asking for a hand is the assignee's move, and the one way work reaches
    // somebody above them without a policy or a manager doing it.
    requestHelp: open && mine,
    takeOver: open && move && !mine && couldDoIt,
    addWatcher: open && maySeeTeamWork(ctx),
    customizePolicy: mayCustomize(ctx),
  };
}

/**
 * The watchers on one record: the ones the engine adds, plus the ones people
 * did.
 *
 * Deduplicated by membership, first entry winning, so the Owner who watches
 * everything by default is not listed twice after somebody adds them by hand.
 */
/**
 * What the assignment amounts to, in a word a screen may show.
 *
 * "Unassigned" is deliberately not among them. Work the Owner holds because
 * nobody else qualified has a name, an accountable membership and a timeline;
 * calling that unassigned told an Owner nothing except that the product could
 * not tell the two apart. `owner_fallback` and `needs_assignment` say which
 * kind of fallback it actually is.
 */
function assignmentStateFor(
  routing: RoutingResult,
  responsibleIsOwner: boolean,
): AssignmentState {
  if (routing.noEligibleAssignee) return "needs_assignment";
  if (routing.responsible.source === "fallback" && responsibleIsOwner) return "owner_fallback";
  if (routing.responsible.source === "delegation") return "delegated";
  if (routing.responsible.source === "default_policy") return "routed";
  return "manual";
}

function watcherHolders(
  record: StoredRecord,
  candidates: readonly ResponsibilityCandidate[],
  routed: readonly ResponsibilityHolder[],
): ResponsibilityHolder[] {
  const explicit = record.watchers
    .map((id) => candidates.find((c) => c.membershipId === id))
    .filter((c): c is ResponsibilityCandidate => Boolean(c))
    .map<ResponsibilityHolder>((c) => ({
      membershipId: c.membershipId,
      displayName: c.displayName,
      title: c.title,
      role: "watcher",
      source: "manual",
      reason: "Added as a watcher by a person.",
      available: c.takesWork,
    }));

  return [...routed, ...explicit].filter(
    (h, i, all) => all.findIndex((x) => x.membershipId === h.membershipId) === i,
  );
}

interface BuildInput {
  ctx: ServiceContext;
  context: ResponsibilityContext;
  candidates: readonly ResponsibilityCandidate[];
  fleetProfile: FleetProfile;
  workloads: ReadonlyMap<string, CandidateWorkload>;
}

function buildAssignment(
  input: BuildInput,
): { assignment: ResponsibilityAssignment; verdicts: EligibilityVerdict[] } {
  const { ctx, context, candidates, fleetProfile, workloads } = input;
  const record = recordFor(context);
  const policy = policyFor(org(context.organizationId).policies, context);

  rerouteIfHolderGone(record, context, candidates, fleetProfile, workloads);

  // The stored choice, or the module's acceptance where that is the later and
  // better answer. Derived, never written back — see `effectiveOverrideFor`.
  const override = effectiveOverrideFor(
    record, context, candidates, fleetProfile, workloads,
  );

  let routing = routeResponsibility({
    context, members: candidates, fleetProfile, workloads,
    override,
    accountableOverride: record.accountableOverride,
  });

  // The engine's very first answer is worth writing down: it is what the
  // "routed by default" line on the timeline refers to, and without it a record
  // that was later overridden has no evidence of what the default had been.
  if (record.timeline.length === 0) {
    record.timeline = appendTimeline(record.timeline, {
      action: routing.usedFallback ? "fallback_applied" : "routed",
      actorName: "Antcolos",
      subjectMembershipId: routing.responsible.membershipId,
      subjectName: routing.responsible.displayName,
      note: routing.responsible.reason,
      at: context.openedAt,
    });
  }

  const acknowledgedAt = record.acknowledgedAt ?? context.acknowledgedAt;
  const withAck: ResponsibilityContext = { ...context, acknowledgedAt };

  const sla = slaFor({ ...withAck, severity: context.severity }, policy);

  const responsibleCandidate = candidates.find(
    (c) => c.membershipId === routing.responsible.membershipId,
  );
  let escalations = escalationsFor({
    context: withAck, policy, sla, fleetProfile,
    responsible: responsibleCandidate,
    noEligibleAssignee: routing.noEligibleAssignee,
    keptAt: record.keptAt,
  });

  // A policy that deliberately moves work does it here, and the routing is
  // recomputed so the card shows where the work actually is.
  if (applyPolicyMoves(
    record, routing, context, candidates, fleetProfile, workloads, escalations,
  )) {
    routing = routeResponsibility({
      context, members: candidates, fleetProfile, workloads,
      override: record.override ?? override,
      accountableOverride: record.accountableOverride,
    });
    escalations = escalationsFor({
      context: withAck, policy, sla, fleetProfile,
      responsible: candidates.find(
        (c) => c.membershipId === routing.responsible.membershipId,
      ),
      noEligibleAssignee: routing.noEligibleAssignee,
      keptAt: record.keptAt,
    });
  }

  const approver = routing.approver;
  const approvalState: ApprovalState = context.approvalRequired
    ? record.approvalState
    : (record.approvalState === "not_required" ? "not_required" : record.approvalState);

  const responsibleIsOwner = Boolean(
    candidates.find((c) => c.membershipId === routing.responsible.membershipId)?.isOwner,
  );
  const assignmentState = assignmentStateFor(routing, responsibleIsOwner);

  const assignment: ResponsibilityAssignment = {
    id: record.id,
    organizationId: context.organizationId,
    work: context.work,
    functionKey: context.functionKey,
    severity: context.severity,
    scope: context.scope,
    responsible: routing.responsible,
    accountable: routing.accountable,
    approver,
    watchers: watcherHolders(record, candidates, routing.watchers),
    policyId: policy.id,
    policyName: policy.name,
    openedAt: context.openedAt,
    dueAt: context.dueAt,
    acknowledgedAt,
    acknowledgedByMembershipId: record.acknowledgedByMembershipId,
    resolvedAt: context.resolvedAt,
    approvalState,
    sla,
    escalations,
    atRisk: isAtRisk(sla) || hasEscalated(escalations),
    assignmentState,
    noEligibleAssignee: routing.noEligibleAssignee,
    // Filled in below: `attentionFor` reads the finished record, including the
    // assignment state and the timeline, so it cannot be computed inline.
    attention: [],
    can: abilitiesFor(ctx, routing, record, candidates, context),
    timeline: [...record.timeline],
  };

  assignment.attention = attentionFor(assignment, ctx.membershipId);

  return { assignment, verdicts: routing.candidates };
}

/* -------------------------------------------------------------------------- */
/* Assembling the board                                                        */
/* -------------------------------------------------------------------------- */

interface Assembled {
  assignments: ResponsibilityAssignment[];
  verdicts: Map<string, EligibilityVerdict[]>;
  fleetProfile: FleetProfile;
  contexts: Map<string, ResponsibilityContext>;
}

async function assemble(ctx: ServiceContext): Promise<Assembled> {
  const contexts = await gatherWork(ctx);
  const candidates = candidatesFor(ctx.organizationId);
  const fleetProfile = profileFor(ctx);
  const workloads = workloadsFrom(contexts, ctx.organizationId);

  const assignments: ResponsibilityAssignment[] = [];
  const verdicts = new Map<string, EligibilityVerdict[]>();
  const byKey = new Map<string, ResponsibilityContext>();

  for (const context of contexts) {
    const built = buildAssignment({ ctx, context, candidates, fleetProfile, workloads });
    assignments.push(built.assignment);
    verdicts.set(built.assignment.id, built.verdicts);
    byKey.set(built.assignment.id, context);
  }

  return { assignments, verdicts, fleetProfile, contexts: byKey };
}

function queueInputFor(
  ctx: ServiceContext,
  assignments: ResponsibilityAssignment[],
  fleetProfile: FleetProfile,
): QueueInput {
  return {
    assignments,
    viewerMembershipId: ctx.membershipId,
    viewerIsOwner: viewerIsOwner(ctx),
    maySeeTeamWork: maySeeTeamWork(ctx),
    mayMoveWork: mayMoveWork(ctx),
    fleetProfile,
  };
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Finds one assignment, re-deriving everything about it.
 *
 * Every mutation goes through here rather than reading a stored row, so a
 * button pressed on a board that has been open since this morning is still
 * checked against what the person may do right now.
 */
async function load(
  ctx: ServiceContext,
  work: WorkKey,
): Promise<{
  assignment: ResponsibilityAssignment;
  record: StoredRecord;
  context: ResponsibilityContext;
  candidates: ResponsibilityCandidate[];
  fleetProfile: FleetProfile;
}> {
  const assembled = await assemble(ctx);
  const id = keyFor(work.kind, work.id);
  const assignment = assembled.assignments.find((a) => a.id === id);
  const context = assembled.contexts.get(id);
  if (!assignment || !context) throw new NotFoundError("Work item");

  const record = org(ctx.organizationId).records.get(id);
  if (!record) throw new NotFoundError("Work item");

  return {
    assignment,
    record,
    context,
    candidates: candidatesFor(ctx.organizationId),
    fleetProfile: assembled.fleetProfile,
  };
}

function refuse(required: PermissionKey[]): never {
  throw new PermissionDeniedError(required);
}

/** The membership acting, by name, for the timeline. */
function actorName(ctx: ServiceContext): string {
  return memberIn(ctx.organizationId, ctx.membershipId)?.displayName
    ?? ctx.actor.displayNameSnapshot;
}

function requireTarget(ctx: ServiceContext, membershipId: string): ResponsibilityCandidate {
  const member = memberIn(ctx.organizationId, membershipId);
  // A membership in another workspace and one that does not exist are the same
  // answer, for the same reason a forbidden truck and an unknown one are.
  if (!member) throw new NotFoundError("Membership");
  return member;
}

function requireNote(note: string, what: string): string {
  const trimmed = note.trim();
  if (!trimmed) throw new Error(`${what} needs a reason.`);
  return trimmed;
}

/**
 * Projects one responsibility change into THE audit ledger.
 *
 * Antcolos has one ledger and this module does not keep a second. What it keeps
 * beside it is the per-assignment timeline, which is finer-grained than an audit
 * event needs to be — every rung of every ladder — and belongs with the record
 * rather than in a workspace-wide log.
 *
 * Silent on failure on purpose: a ledger that cannot be written is not a reason
 * to refuse somebody the ability to hand their work over.
 */
function project(
  ctx: ServiceContext,
  assignment: ResponsibilityAssignment,
  summary: string,
  subject?: { membershipId: string; displayName: string },
): void {
  void mockAuditService.record(ctx, {
    module: "dispatch",
    action: "dispatch.assignment_changed",
    sourceAction: "responsibility.changed",
    entity: {
      kind: "membership",
      id: subject?.membershipId ?? assignment.responsible.membershipId,
      label: subject?.displayName ?? assignment.responsible.displayName,
    },
    summary,
  }).catch(() => {
    // See above.
  });
}

function mutate(
  record: StoredRecord,
  ctx: ServiceContext,
  action: ResponsibilityTimelineAction,
  note: string,
  subject?: { membershipId: string; displayName: string },
): void {
  record.timeline = appendTimeline(record.timeline, {
    action,
    actorMembershipId: ctx.membershipId,
    actorName: actorName(ctx),
    subjectMembershipId: subject?.membershipId,
    subjectName: subject?.displayName,
    note,
  });
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockResponsibilityService: ResponsibilityService = {
  async board(ctx: ServiceContext, options: BoardOptions = {}): Promise<ResponsibilityBoard> {
    await wait();
    const { assignments, fleetProfile } = await assemble(ctx);
    const input = queueInputFor(ctx, assignments, fleetProfile);

    const all = buildQueues(input);
    const queues = options.queue ? all.filter((q) => q.queue === options.queue) : all;

    return {
      organizationId: ctx.organizationId,
      fleetProfile,
      queues,
      counts: queueCounts(input),
      // Absent, not empty, in a workspace where there is nobody to hand work to.
      assignableTo: input.mayMoveWork
        ? membersOf(ctx.organizationId)
          .filter((m) => m.status === "active")
          .map((m) => ({
            membershipId: m.membershipId, displayName: m.displayName, title: m.title,
          }))
        : undefined,
      mayCustomize: mayCustomize(ctx),
    };
  },

  async attention(ctx) {
    await wait();
    return attentionViewsFor(ctx);
  },

  async get(ctx, work) {
    await wait();
    const { assignment } = await load(ctx, work);
    return assignment;
  },

  async explain(ctx, work) {
    await wait();
    const assembled = await assemble(ctx);
    const verdicts = assembled.verdicts.get(keyFor(work.kind, work.id));
    if (!verdicts) throw new NotFoundError("Work item");
    return verdicts;
  },

  async acknowledge(ctx, work) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.acknowledge) refuse(assignment.work.kind === "mt_loop" ? ["loads:view"] : []);

    record.acknowledgedAt = nowIso();
    record.acknowledgedByMembershipId = ctx.membershipId;
    mutate(record, ctx, "acknowledged", "Seen. The acknowledgement clock stops here.");
    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `Acknowledged ${assignment.work.label}.`);
    return next;
  },

  async keep(ctx, work, note) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.keep) refuse([]);

    record.keptAt = nowIso();
    // Keeping is also an acknowledgement: you cannot say a thing is yours
    // without having seen it.
    record.acknowledgedAt ??= record.keptAt;
    record.acknowledgedByMembershipId ??= ctx.membershipId;
    mutate(
      record, ctx, "kept",
      note?.trim()
        || `Kept. Reminders are quiet for ${KEEP_QUIETS_REMINDER_MINUTES} minutes; the resolution target is unchanged.`,
    );
    return (await load(ctx, work)).assignment;
  },

  async delegate(ctx, work, input: MoveWorkInput) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.delegate) refuse(["loads:assign"]);
    const note = requireNote(input.note, "A delegation");
    const target = requireTarget(ctx, input.toMembershipId);

    // Delegation moves who DOES it and leaves who ANSWERS for it alone, which
    // is the whole difference between this method and `reassign`. Pinning the
    // accountable membership is what makes that true rather than stated.
    record.accountableOverride ??= {
      membershipId: assignment.accountable.membershipId,
      note: "Kept where it was when the work was delegated.",
      // A PIN, not a naming. It stops accountability following the work to the
      // delegate; it does not make the accountable person's queue longer. See
      // `RoutingInput.accountableOverride.pinned` — handing out twenty loops
      // must not hand twenty cards back.
      pinned: true,
    };
    record.override = {
      membershipId: target.membershipId, source: "manual", note, at: nowIso(),
    };
    mutate(
      record, ctx, "delegated",
      `${note} ${assignment.accountable.displayName} still answers for the result.`,
      target,
    );

    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `Delegated ${assignment.work.label} to ${target.displayName}.`, target);
    return next;
  },

  async reassign(ctx, work, input: MoveWorkInput) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.reassign) refuse(["loads:assign"]);
    const note = requireNote(input.note, "A reassignment");
    const target = requireTarget(ctx, input.toMembershipId);

    // Unlike a delegation, accountability re-derives from wherever the work
    // lands — unless a person has deliberately pinned it.
    record.override = {
      membershipId: target.membershipId, source: "manual", note, at: nowIso(),
    };
    mutate(record, ctx, "reassigned", note, target);

    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `Reassigned ${assignment.work.label} to ${target.displayName}.`, target);
    return next;
  },

  async takeOver(ctx, work, note) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.takeOver) refuse(["loads:assign"]);
    const reason = requireNote(note, "A takeover");
    const me = requireTarget(ctx, ctx.membershipId);

    const from = assignment.responsible.displayName;
    record.override = {
      membershipId: ctx.membershipId, source: "takeover", note: reason, at: nowIso(),
    };
    mutate(record, ctx, "taken_over", `Taken from ${from}. ${reason}`, me);

    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `Took over ${assignment.work.label} from ${from}.`, me);
    return next;
  },

  async changeAccountable(ctx, work, input: MoveWorkInput) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.changeAccountable) refuse(["members:edit"]);
    const note = requireNote(input.note, "Changing who is accountable");
    const target = requireTarget(ctx, input.toMembershipId);

    record.accountableOverride = { membershipId: target.membershipId, note };
    mutate(
      record, ctx, "accountable_changed",
      `${note} ${assignment.responsible.displayName} is still doing the work.`,
      target,
    );

    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `${target.displayName} now answers for ${assignment.work.label}.`, target);
    return next;
  },

  async requestApproval(ctx, work, input) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.requestApproval) refuse([]);
    const note = requireNote(input.note, "An approval request");

    const approver = input.approverMembershipId
      ? requireTarget(ctx, input.approverMembershipId)
      : undefined;
    if (approver) record.approverMembershipId = approver.membershipId;
    record.approvalState = "requested";
    mutate(
      record, ctx, "approval_requested",
      `${note} Nothing is sent: this shows on the approver's queue.`,
      approver,
    );
    return (await load(ctx, work)).assignment;
  },

  async decideApproval(ctx, work, input: ApprovalDecisionInput) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.approve) refuse([]);
    const note = requireNote(input.note, "An approval decision");

    record.approvalState = input.decision === "approve" ? "approved" : "declined";
    mutate(
      record, ctx,
      input.decision === "approve" ? "approved" : "approval_declined",
      note,
    );

    const next = (await load(ctx, work)).assignment;
    project(
      ctx, next,
      `${input.decision === "approve" ? "Approved" : "Declined"} ${assignment.work.label}.`,
    );
    return next;
  },

  async requestHelp(ctx, work, note) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.requestHelp) refuse([]);
    const reason = requireNote(note, "A request for help");

    // Asking for a hand does not hand the work over: the asker is still
    // responsible afterwards. What it does is put the item on the accountable
    // person's PERSONAL list, which a computed escalation rung deliberately
    // cannot do — see `attention.ts`.
    const asked = assignment.accountable;
    mutate(
      record, ctx, "help_requested",
      `${reason} ${assignment.responsible.displayName} is still responsible.`,
      { membershipId: asked.membershipId, displayName: asked.displayName },
    );

    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `Help asked of ${asked.displayName} on ${assignment.work.label}.`);
    return next;
  },

  async escalate(ctx, work, note) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.escalate) refuse([]);
    const reason = requireNote(note, "An escalation");

    // ★ Escalation is not reassignment. ★
    // The accountable membership becomes a watcher; the responsible membership
    // is untouched. If this method ever starts writing `record.override`, the
    // central promise of the module is gone.
    const accountable = assignment.accountable;
    if (!record.watchers.includes(accountable.membershipId)) {
      record.watchers.push(accountable.membershipId);
    }
    mutate(
      record, ctx, "escalated",
      `${reason} ${assignment.responsible.displayName} is still responsible; ${accountable.displayName} can now see it.`,
      { membershipId: accountable.membershipId, displayName: accountable.displayName },
    );

    const next = (await load(ctx, work)).assignment;
    project(ctx, next, `Escalated ${assignment.work.label} to ${accountable.displayName}.`);
    return next;
  },

  async addWatcher(ctx, work, input: WatcherInput) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.addWatcher) refuse(["members:view"]);
    const target = requireTarget(ctx, input.membershipId);

    if (!record.watchers.includes(target.membershipId)) {
      record.watchers.push(target.membershipId);
      mutate(
        record, ctx, "watcher_added",
        input.note?.trim() || "Added as a watcher. Watchers own nothing and are never escalated to.",
        target,
      );
    }
    return (await load(ctx, work)).assignment;
  },

  async removeWatcher(ctx, work, membershipId) {
    await wait();
    const { assignment, record } = await load(ctx, work);
    if (!assignment.can.addWatcher) refuse(["members:view"]);
    const target = requireTarget(ctx, membershipId);

    const before = record.watchers.length;
    record.watchers = record.watchers.filter((id) => id !== membershipId);
    if (record.watchers.length !== before) {
      mutate(record, ctx, "watcher_removed", "No longer watching.", target);
    }
    return (await load(ctx, work)).assignment;
  },

  async fleetProfile(ctx) {
    await wait();
    return profileFor(ctx);
  },

  async setFleetSize(ctx, truckCount) {
    await wait();
    if (!Number.isFinite(truckCount) || truckCount < 0) {
      throw new Error("A fleet size is a whole number of trucks, zero or more.");
    }
    org(ctx.organizationId).truckCountOverride = Math.floor(truckCount);
    return profileFor(ctx);
  },

  async policies(ctx) {
    await wait();
    if (!mayCustomize(ctx)) refuse(["organization:manage"]);
    return org(ctx.organizationId).policies.map((p) => ({ ...p }));
  },

  async updatePolicy(ctx, policyId, patch: PolicyPatch) {
    await wait();
    if (!mayCustomize(ctx)) refuse(["organization:manage"]);

    const bucket = org(ctx.organizationId).policies;
    const index = bucket.findIndex((p) => p.id === policyId);
    if (index < 0) throw new NotFoundError("Escalation policy");

    // Notice what is missing from this service: there is no `deletePolicy`. A
    // workspace with no policy is a workspace where nothing escalates, and that
    // is not a state somebody should be able to reach by tidying up.
    const next: EscalationPolicy = {
      ...bucket[index],
      ...patch,
      steps: patch.steps ? patch.steps.map((s) => ({ ...s, notify: [...s.notify] })) : bucket[index].steps,
      triggers: patch.triggers ? [...patch.triggers] : bucket[index].triggers,
      updatedAt: nowIso(),
    };
    bucket[index] = next;

    void mockAuditService.record(ctx, {
      module: "organization",
      action: "organization.settings_changed",
      sourceAction: "responsibility.policy_changed",
      entity: { kind: "organization", id: ctx.organizationId, label: ctx.organizationName },
      summary: `Escalation policy "${next.name}" was changed.`,
    }).catch(() => {});

    return { ...next };
  },

  async assignable(ctx, role) {
    await wait();
    if (!maySeeTeamWork(ctx)) {
      // A workspace of one, or somebody scoped to their own records: the honest
      // answer is themselves, not an empty list.
      const me = memberIn(ctx.organizationId, ctx.membershipId);
      return me
        ? [{
            membershipId: me.membershipId, displayName: me.displayName,
            title: me.title, available: me.takesWork,
          }]
        : [];
    }
    const wanted = role && ASSIGNABLE_ROLES.includes(role) ? role : undefined;
    return membersOf(ctx.organizationId)
      .filter((m) => m.status === "active")
      // Only the accountable and approver roles may sit with somebody who is
      // away: work still has to answer to somebody while they are on leave.
      .filter((m) => m.takesWork || wanted === "accountable" || wanted === "approver")
      .map((m) => ({
        membershipId: m.membershipId,
        displayName: m.displayName,
        title: m.title,
        available: m.takesWork,
      }));
  },
};

/* -------------------------------------------------------------------------- */
/* THE shared derivation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The three views, derived once for one membership.
 *
 * ★ Home and the Needs You page both come through here. ★
 *
 * Before this existed, Home built its own Needs You list — everything the
 * membership could see, sliced to four — while the queue built another. A
 * Carrier Owner saw "142 open" on Home and 119 items in their personal queue,
 * neither of which was a list of things needing them. One derivation is the
 * only way two surfaces can be made to agree, so there is exactly one, and
 * `tests/responsibility/attention.test.ts` asserts Home's numbers come from it.
 */
export async function attentionViewsFor(ctx: ServiceContext): Promise<AttentionViews> {
  const { assignments, fleetProfile } = await assemble(ctx);
  const input = queueInputFor(ctx, assignments, fleetProfile);
  const queues = buildQueues(input);
  const counts = queueCounts(input);

  const of = (q: string) => queues.find((x) => x.queue === q)?.items ?? [];
  const myNeedsYou = assignments.filter(
    (a) => !a.resolvedAt && attentionFor(a, ctx.membershipId).length > 0,
  );
  const teamOversight = of("team_oversight");
  const allOrganization = of("all_organization");

  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    myNeedsYou,
    teamOversight,
    allOrganization,
    maySeeTeam: maySeeTeamWork(ctx),
    teamOversightApplies: queues.some((q) => q.queue === "team_oversight"),
    counts: {
      myNeedsYou: myNeedsYou.length,
      myNeedsYouCritical: myNeedsYou.filter((a) => a.severity === "critical").length,
      teamOversight: teamOversight.length,
      teamOversightAtRisk: teamOversight.filter((a) => a.atRisk).length,
      allOrganization: allOrganization.length,
      ownerFallback: counts.ownerFallback,
      needsAssignment: counts.needsAssignment,
      trulyUnassigned: counts.trulyUnassigned,
      escalated: counts.escalated,
    },
  };
}

/**
 * The Needs You items that need this person, as the items themselves.
 *
 * What Home and the Needs You page render. Returned in the queue's own urgency
 * order, and NEVER a count of everything the person may see.
 */
export async function personalNeedsYouIds(ctx: ServiceContext): Promise<string[]> {
  const views = await attentionViewsFor(ctx);
  return views.myNeedsYou
    .filter((a) => a.work.kind === "needs_you")
    .map((a) => a.work.id);
}

/* -------------------------------------------------------------------------- */
/* For the modules that ask                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE CANONICAL ANSWER, for a module that has to show it. ★
 *
 * Who is responsible for every piece of work of one kind in this workspace,
 * computed by the one routing engine this app has. The MT Loop board reads its
 * `responsible` line from here, which is what stops MT Loop and Needs You
 * giving two answers to "who is on this truck" — the failure this replaced.
 *
 * It runs the same `assemble` the board runs, so there is no second code path
 * that could drift: a caller gets exactly what `/work` would show. It is
 * deliberately NOT queue-filtered — queue visibility is about whose personal
 * list something belongs on, and the MT Loop board applies its own dispatch-
 * organization scope, which is the correct boundary for a board of trucks.
 */
export async function canonicalHolders(
  ctx: ServiceContext,
  kind: ResponsibilityWorkKind,
): Promise<Map<string, CanonicalHolder>> {
  const out = new Map<string, CanonicalHolder>();
  const { assignments } = await assemble(ctx);
  for (const a of assignments) {
    if (a.work.kind !== kind) continue;
    out.set(a.work.id, {
      membershipId: a.responsible.membershipId,
      displayName: a.responsible.displayName,
      source: a.responsible.source,
      assignmentState: a.assignmentState,
      noEligibleAssignee: a.noEligibleAssignee,
      accountableMembershipId: a.accountable.membershipId,
      accountableName: a.accountable.displayName,
      attention: a.attention,
    });
  }
  return out;
}

export interface CanonicalHolder {
  membershipId: string;
  displayName: string;
  source: AssignmentSource;
  assignmentState: AssignmentState;
  noEligibleAssignee: boolean;
  accountableMembershipId: string;
  accountableName: string;
  /**
   * Why this work needs the CALLER personally, or empty when it does not.
   *
   * ★ THE ONE PERSONAL-ATTENTION DERIVATION ★
   * Straight from `attentionFor` — the same seven reasons that decide the Needs
   * You page's My Needs You tab, Home's Needs You block and the nav badge. It
   * travels with the holder so a module can present work at the right level of
   * detail without inventing a rule about whose problem something is. Home used
   * to render every open loop in the workspace as a full operational card,
   * including healthy ones delegated to a dispatcher; this is what that panel
   * reads instead.
   */
  attention: AttentionReason[];
}

/** The workspace's Owner, for a caller that needs the fallback by name. */
export function ownerFallbackFor(organizationId: string) {
  return ownerOf(organizationId);
}

/** Re-exported so the workspace shape is derived the one way, never twice. */
export function workspaceFor(organization: Organization, membership: Membership) {
  return resolveWorkspace(organization, membership);
}
