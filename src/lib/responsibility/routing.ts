import type {
  AssignmentSource, EligibilityVerdict, FleetProfile, ResponsibilityContext,
  ResponsibilityHolder,
} from "@/types";
import type { CandidateWorkload, ResponsibilityCandidate } from "./candidate";
import { rankCandidates } from "./eligibility";

/**
 * Who holds this work, and who answers for it.
 *
 * The routing engine. A domain module hands it a `ResponsibilityContext` — what
 * the work is, what it takes, which truck and carrier it is about — and gets
 * back four roles filled in. The module never names a person and the engine
 * never reads a role label, which is the separation that keeps "assign it to
 * the dispatcher" out of six feature components with six different ideas of who
 * that is.
 *
 * ★ THE INVARIANT ★
 * `accountable` is never absent. Not when nobody is eligible, not when the
 * assignee has been suspended, not when the workspace has one member and no
 * setup. Where nothing else resolves, the Owner holds it — computed, not
 * seeded, so there is no row anybody could delete to create ownerless work.
 *
 * Note what routing does NOT decide: whether the accountable person sees this
 * in their own daily queue. That is `queues.ts`, and keeping them apart is how
 * an Owner stays accountable for everything without every routine item landing
 * in their personal list.
 */

export interface RoutingInput {
  context: ResponsibilityContext;
  /** Everybody in the workspace, suspended and away memberships included. */
  members: readonly ResponsibilityCandidate[];
  fleetProfile: FleetProfile;
  /** What each membership already holds, for continuity and the tie-break. */
  workloads?: ReadonlyMap<string, CandidateWorkload>;
  /**
   * A person's explicit choice, which beats everything the engine would decide.
   * Absent on a first routing; set once somebody has delegated, reassigned or
   * taken the work over.
   */
  override?: { membershipId: string; source: AssignmentSource; note?: string };
  /** The accountable membership, where a person has changed it by hand. */
  accountableOverride?: {
    membershipId: string;
    note?: string;
    /**
     * True when this only PINS what was already derived, rather than naming
     * somebody new.
     *
     * ★ THE DIFFERENCE IS WHOSE PROBLEM IT BECOMES ★
     * Delegating pins accountability so it cannot drift to the delegate — that
     * is what makes "delegation moves who does it, not who answers for it"
     * true rather than merely stated. But a pin is a decision about the WORK,
     * and being named accountable by hand is a decision about a PERSON: the
     * second puts the work on their personal queue (`explicit_accountable`),
     * and the first must not, or delegating twenty loops hands the delegator
     * twenty cards straight back.
     */
    pinned?: boolean;
  };
}

export interface RoutingResult {
  responsible: ResponsibilityHolder;
  accountable: ResponsibilityHolder;
  approver?: ResponsibilityHolder;
  watchers: ResponsibilityHolder[];
  /** Everybody considered, best first. The answer to "why me?". */
  candidates: EligibilityVerdict[];
  /** True when nobody in the workspace could do this and the Owner took it. */
  usedFallback: boolean;
  /** True when nobody at all was eligible — an escalation trigger of its own. */
  noEligibleAssignee: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function holder(
  candidate: ResponsibilityCandidate,
  role: ResponsibilityHolder["role"],
  source: AssignmentSource,
  reason: string,
): ResponsibilityHolder {
  return {
    membershipId: candidate.membershipId,
    displayName: candidate.displayName,
    title: candidate.title,
    role,
    source,
    reason,
    available: candidate.takesWork,
  };
}

/**
 * The membership that carries the workspace when nothing else does.
 *
 * An active Owner, then any Owner — a suspended Owner still produces a name on
 * the record rather than ownerless work — then, for a workspace that somehow
 * has no Owner at all, any active member. The last two rungs are ugly and they
 * are deliberate: this function is what the no-ownerless-work invariant rests
 * on, and an invariant with an `undefined` in it is not an invariant.
 */
function ownerOf(
  members: readonly ResponsibilityCandidate[],
): ResponsibilityCandidate | undefined {
  return members.find((m) => m.isOwner && m.status === "active")
    ?? members.find((m) => m.isOwner)
    ?? members.find((m) => m.status === "active" && !m.driverProfileId)
    ?? members.find((m) => m.status === "active")
    ?? members[0];
}

/**
 * Why the engine picked this person, in words the Owner can disagree with.
 *
 * Built from the verdict's own reasons rather than written twice, so the
 * sentence on the screen and the score behind it can never drift apart.
 */
function reasonFrom(verdict: EligibilityVerdict): string {
  if (verdict.reasons.length === 0) return "The only person who can do this.";
  return verdict.reasons.join(" ");
}

/**
 * Where the assignment came from, read off the reasons that won it.
 *
 * "Follows a delegation" and "routed by default" are different facts and a
 * person acting on the record needs to know which they are looking at: undoing
 * a delegation means changing the grant, and undoing a default means overriding
 * the policy.
 */
function sourceFrom(verdict: EligibilityVerdict): AssignmentSource {
  const delegated = verdict.reasons.some(
    (r) => r.includes("delegation") || r.includes("given this truck"),
  );
  return delegated ? "delegation" : "default_policy";
}

/* -------------------------------------------------------------------------- */
/* Accountability                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Who answers for the result.
 *
 * The nearest ACTIVE supervisor above whoever is responsible, walking up until
 * somebody active is found and ending at the Owner. Never the responsible
 * membership itself — a person cannot be their own escalation — except in the
 * one workspace where that is the honest answer: an Owner working alone is
 * accountable for their own work, and pretending otherwise would invent a
 * manager who does not exist.
 *
 * Cycle-safe. A directory that somehow said two people supervise each other
 * would otherwise hang here, and the ladder would never reach the Owner.
 */
function accountableFor(
  responsible: ResponsibilityCandidate,
  members: readonly ResponsibilityCandidate[],
  fleetProfile: FleetProfile,
): { candidate: ResponsibilityCandidate; reason: string } | undefined {
  const byId = new Map(members.map((m) => [m.membershipId, m]));
  const owner = ownerOf(members);

  if (fleetProfile.supervisorsEnabled) {
    const seen = new Set<string>([responsible.membershipId]);
    let current: ResponsibilityCandidate | undefined = responsible;

    while (current?.supervisorMembershipId && !seen.has(current.supervisorMembershipId)) {
      seen.add(current.supervisorMembershipId);
      const next: ResponsibilityCandidate | undefined = byId.get(current.supervisorMembershipId);
      if (!next) break;
      if (next.status === "active") {
        return {
          candidate: next,
          reason: `Oversees ${responsible.displayName}, so the result is theirs to answer for.`,
        };
      }
      current = next;
    }
  }

  if (owner && owner.membershipId !== responsible.membershipId) {
    return {
      candidate: owner,
      reason: "Owns the workspace, so unfinished work comes back here.",
    };
  }
  if (owner) {
    return {
      candidate: owner,
      reason: "You own this workspace and you are working this yourself.",
    };
  }
  return undefined;
}

/**
 * Who has to approve, when the work says an approval is required.
 *
 * The accountable membership, unless they are the same person who did the work
 * — in which case it walks one further up, because approving your own work is
 * not an approval. Falls back to the Owner, and to nobody at all only in a
 * workspace of one, where the honest answer is that there is nobody to ask.
 */
function approverFor(
  responsible: ResponsibilityCandidate,
  accountable: ResponsibilityCandidate | undefined,
  members: readonly ResponsibilityCandidate[],
): { candidate: ResponsibilityCandidate; reason: string } | undefined {
  if (accountable && accountable.membershipId !== responsible.membershipId) {
    return {
      candidate: accountable,
      reason: "Answers for the result, so the approval is theirs to give.",
    };
  }
  const owner = ownerOf(members);
  if (owner && owner.membershipId !== responsible.membershipId) {
    return { candidate: owner, reason: "Owns the workspace." };
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* The engine                                                                  */
/* -------------------------------------------------------------------------- */

export function routeResponsibility(input: RoutingInput): RoutingResult {
  const { context, members, fleetProfile } = input;
  const inWorkspace = members.filter((m) => m.organizationId === context.organizationId);

  const candidates = rankCandidates(
    inWorkspace,
    { context, supervisorsEnabled: fleetProfile.supervisorsEnabled },
    input.workloads,
  );
  const eligible = candidates.filter((c) => c.eligible);
  const owner = ownerOf(inWorkspace);
  const byId = new Map(inWorkspace.map((m) => [m.membershipId, m]));

  /* -- Responsible ------------------------------------------------------ */

  let responsibleCandidate: ResponsibilityCandidate | undefined;
  let responsibleSource: AssignmentSource = "default_policy";
  let responsibleReason = "";
  let usedFallback = false;

  // A person's explicit choice beats everything the engine would decide.
  // It is honoured even when the engine would not have picked them — an
  // authorized Owner or Manager may hand work to somebody the default would
  // have passed over, and the record says who chose and why.
  const chosen = input.override ? byId.get(input.override.membershipId) : undefined;
  if (chosen) {
    responsibleCandidate = chosen;
    responsibleSource = input.override!.source;
    responsibleReason = input.override!.note
      ?? "A person chose this, overriding the default.";
  } else if (eligible.length > 0) {
    // ★ THE OWNER IS A FALLBACK, NOT A COMPETITOR ★
    //
    // An Owner holds every permission in the workspace by definition, so they
    // are eligible for everything and score well on everything. Left to compete
    // on points they win most ties, and a Carrier who has hired a bookkeeper
    // still finds every invoice in their own queue — the exact overload the
    // milestone forbids.
    //
    // So the Owner is removed from the field whenever anybody else can do the
    // work. `ROUTING_WEIGHTS.owner` still orders them last among owners; this is
    // what makes "last" mean "only if nobody else".
    const others = eligible.filter((c) => !byId.get(c.membershipId)?.isOwner);
    const winner = others[0] ?? eligible[0];
    responsibleCandidate = byId.get(winner.membershipId);
    responsibleReason = reasonFrom(winner);

    if (others.length === 0 && responsibleCandidate?.isOwner) {
      // The Owner took it. WHY they took it is the interesting part: in a
      // workspace of one it is simply their work, and in a workspace with
      // colleagues it means none of them could do it — which belongs in the
      // Unassigned queue where somebody will notice.
      const othersExist = inWorkspace.some(
        (m) => !m.isOwner && m.status === "active" && !m.driverProfileId,
      );
      responsibleSource = othersExist ? "fallback" : "default_policy";
      usedFallback = othersExist;
      if (othersExist) {
        responsibleReason =
          "Nobody else in this workspace can do this, so it sits with the Owner.";
      }
    } else {
      responsibleSource = sourceFrom(winner);
    }
  }

  // Nobody eligible. The Owner takes it rather than the work becoming
  // ownerless — and `noEligibleAssignee` below makes sure that shows up as an
  // escalation trigger instead of being quietly absorbed.
  if (!responsibleCandidate && owner) {
    responsibleCandidate = owner;
    responsibleSource = "fallback";
    responsibleReason =
      "Nobody else in this workspace can do this yet, so it sits with the Owner.";
    usedFallback = true;
  }

  if (!responsibleCandidate) {
    // A workspace with no members at all cannot exist in the product — an
    // organization is created by its Owner — so this is a defensive branch, not
    // a state the UI can reach.
    throw new Error(
      `No membership at all in ${context.organizationId}: work cannot be routed.`,
    );
  }

  /* -- Accountable ------------------------------------------------------ */

  const accountableChoice = input.accountableOverride
    ? byId.get(input.accountableOverride.membershipId)
    : undefined;

  const derivedAccountable = accountableFor(responsibleCandidate, inWorkspace, fleetProfile);
  const accountableCandidate = accountableChoice ?? derivedAccountable?.candidate ?? owner
    ?? responsibleCandidate;
  const accountableReason = accountableChoice
    ? (input.accountableOverride!.note ?? "Changed by hand.")
    : (derivedAccountable?.reason ?? "Owns the workspace.");

  /* -- Approver --------------------------------------------------------- */

  const approverChoice = context.approvalRequired
    ? approverFor(responsibleCandidate, accountableCandidate, inWorkspace)
    : undefined;

  /* -- Watchers --------------------------------------------------------- */

  // Oversight without ownership. The Owner watches work they are neither
  // responsible nor accountable for — which is how "the Owner retains
  // organization-wide oversight after delegating" is true without the Owner
  // being handed every routine item. A watcher is never escalated to.
  const watchers: ResponsibilityHolder[] = [];
  if (
    owner
    && owner.membershipId !== responsibleCandidate.membershipId
    && owner.membershipId !== accountableCandidate.membershipId
  ) {
    watchers.push(holder(
      owner,
      "watcher",
      "default_policy",
      "Owns the workspace and can see everything in it.",
    ));
  }

  return {
    responsible: holder(
      responsibleCandidate, "responsible", responsibleSource, responsibleReason,
    ),
    accountable: holder(
      accountableCandidate, "accountable",
      accountableChoice && !input.accountableOverride?.pinned
        ? "manual"
        : (usedFallback ? "fallback" : "default_policy"),
      accountableReason,
    ),
    approver: approverChoice
      ? holder(approverChoice.candidate, "approver", "default_policy", approverChoice.reason)
      : undefined,
    watchers,
    candidates,
    usedFallback,
    noEligibleAssignee: eligible.length === 0,
  };
}

/**
 * The next eligible membership after the one who has it, for a safe re-route.
 *
 * Used when a membership or relationship ENDS: the work moves to the next
 * person who can actually do it, and to the Owner when there is nobody. It
 * never deletes anything — the outgoing holder stays on the timeline, which is
 * what makes "route it safely without losing history" true rather than claimed.
 */
export function nextEligibleAfter(
  input: RoutingInput,
  excludeMembershipId: string,
): ResponsibilityCandidate | undefined {
  const { context, members, fleetProfile } = input;
  const inWorkspace = members.filter(
    (m) => m.organizationId === context.organizationId
      && m.membershipId !== excludeMembershipId,
  );
  const ranked = rankCandidates(
    inWorkspace,
    { context, supervisorsEnabled: fleetProfile.supervisorsEnabled },
    input.workloads,
  ).filter((c) => c.eligible);

  const byId = new Map(inWorkspace.map((m) => [m.membershipId, m]));
  return ranked.length > 0 ? byId.get(ranked[0].membershipId) : ownerOf(inWorkspace);
}
