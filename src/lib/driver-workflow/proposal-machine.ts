import type {
  ActorRef, Counteroffer, EventSource, IdempotencyKey, IsoDateTime,
  LoadProposal, ProposalAction, ProposalActionKind, ProposalEvent,
  ProposalEventType, ProposalPause, ProposalPolicy, ProposalStatus,
} from "@/types";
import { CLOSED_PROPOSAL_STATUSES } from "@/types";
import type { ProposalCommand } from "./commands";
import {
  DuplicateSubmissionError, InvalidTransitionError, PolicyDeniedError,
  StalePauseError, StaleVersionError,
} from "./errors";
import { assertCounterofferAllowed, assertPauseDurationAllowed } from "./policy";

/**
 * The proposal state machine. Pure: it takes a proposal, a command and the
 * clock, and returns the next proposal plus the events that explain the
 * change. It reads no store, writes nothing, and calls no service — which is
 * what lets the same rules run behind a web request, a Telegram callback and a
 * unit test without being reimplemented three times.
 *
 * Ids, sequence numbers and persistence belong to the adapter. Decisions
 * belong here.
 */

export interface ProposalEventDraft {
  type: ProposalEventType;
  occurredAt: IsoDateTime;
  actor: ActorRef;
  source: EventSource;
  idempotencyKey?: IdempotencyKey;
  payload?: ProposalEvent["payload"];
}

export interface ProposalDecision {
  next: LoadProposal;
  events: ProposalEventDraft[];
}

export interface ProposalCommandContext {
  actor: ActorRef;
  source: EventSource;
  now: IsoDateTime;
  policy: ProposalPolicy;
  policyLabel: string;
  /** Supplies the id for a new pause, comment or counteroffer. */
  newId: (prefix: string) => string;
}

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

export function isClosed(status: ProposalStatus): boolean {
  return CLOSED_PROPOSAL_STATUSES.includes(status);
}

/** The pause that is currently running, if any. */
export function activePause(
  proposal: LoadProposal,
  now: IsoDateTime,
): ProposalPause | undefined {
  const pause = proposal.pauses.find((p) => !p.endedAt);
  if (!pause) return undefined;
  return new Date(pause.expiresAt).getTime() > new Date(now).getTime() ? pause : undefined;
}

/**
 * Bring a stored proposal up to date with the clock, WITHOUT interpreting the
 * silence.
 *
 * An expired pause returns the proposal to "Awaiting Driver Response" — it is
 * never read as approval and never read as rejection. Timing out is not an
 * answer, and pretending it is would be the single most damaging thing this
 * module could do.
 */
export function settleClock(proposal: LoadProposal, now: IsoDateTime): ProposalDecision {
  const events: ProposalEventDraft[] = [];
  let next = proposal;
  const nowMs = new Date(now).getTime();

  if (next.status === "paused") {
    const live = next.pauses.find((p) => !p.endedAt);
    if (!live || new Date(live.expiresAt).getTime() <= nowMs) {
      const expiredAt = live?.expiresAt ?? now;
      next = {
        ...next,
        status: "awaiting_driver_response",
        pauses: next.pauses.map((p) =>
          p.id === live?.id
            ? { ...p, endedAt: expiredAt, endedReason: "expired" as const }
            : p,
        ),
      };
      events.push({
        type: "proposal.pause_expired",
        occurredAt: expiredAt,
        actor: SYSTEM_ACTOR,
        source: "system",
        payload: {
          pauseId: live?.id,
          previousStatus: "paused",
          newStatus: "awaiting_driver_response",
          note: "The pause ran out. The proposal is waiting for an answer again — it was not treated as approved or rejected.",
        },
      });
    }
  }

  if (
    next.status === "awaiting_driver_response" &&
    next.respondByAt &&
    new Date(next.respondByAt).getTime() <= nowMs
  ) {
    events.push({
      type: "proposal.expired",
      occurredAt: next.respondByAt,
      actor: SYSTEM_ACTOR,
      source: "system",
      payload: {
        previousStatus: next.status,
        newStatus: "expired",
        reason: "The deadline dispatch set passed with no answer.",
      },
    });
    next = { ...next, status: "expired" };
  }

  return { next, events };
}

function assertOpen(proposal: LoadProposal, action: string) {
  if (isClosed(proposal.status)) {
    throw new InvalidTransitionError(
      action,
      proposal.status,
      `This proposal is ${STATUS_PHRASE[proposal.status]}. Its history is kept, but it can no longer be answered.`,
    );
  }
}

const STATUS_PHRASE: Record<ProposalStatus, string> = {
  awaiting_driver_response: "waiting for your answer",
  paused: "paused",
  approved: "approved for continued negotiation",
  rejected: "rejected",
  withdrawn: "withdrawn by dispatch",
  expired: "expired",
  unavailable: "no longer available",
  finalized: "finalized — the trip has taken over",
};

function assertVersion(proposal: LoadProposal, expected?: number) {
  if (expected != null && expected !== proposal.version) {
    throw new StaleVersionError(expected, proposal.version);
  }
}

/** Ends a running pause because the driver did something decisive instead. */
function endLivePause(
  proposal: LoadProposal,
  at: IsoDateTime,
  reason: ProposalPause["endedReason"],
): LoadProposal {
  const live = proposal.pauses.find((p) => !p.endedAt);
  if (!live) return proposal;
  return {
    ...proposal,
    pauses: proposal.pauses.map((p) =>
      p.id === live.id ? { ...p, endedAt: at, endedReason: reason } : p,
    ),
  };
}

/**
 * Apply one driver command. The proposal handed in must already have been
 * through `settleClock`, so a command never lands on a pause that has quietly
 * run out.
 */
export function applyProposalCommand(
  proposal: LoadProposal,
  command: ProposalCommand,
  ctx: ProposalCommandContext,
): ProposalDecision {
  assertVersion(proposal, command.expectedVersion);
  const at = command.occurredAt ?? ctx.now;
  const bump = (p: LoadProposal): LoadProposal => ({ ...p, version: p.version + 1 });

  switch (command.type) {
    case "approve": {
      assertOpen(proposal, "Approve");
      if (proposal.status === "approved") {
        throw new DuplicateSubmissionError("This proposal");
      }
      const consent = ctx.policy.approvalGrantsBookingConsent
        ? ("granted" as const)
        : ("not_granted" as const);
      let next = endLivePause(proposal, at, "resumed_by_driver");
      next = bump({
        ...next,
        status: "approved",
        approval: {
          at,
          by: ctx.actor,
          source: ctx.source,
          note: command.note,
          // Frozen at the moment of approval. A later policy change must never
          // turn "keep negotiating" into "you agreed to be booked".
          bookingConsent: consent,
          policyLabelSnapshot: ctx.policyLabel,
        },
      });
      return {
        next,
        events: [
          {
            type: "proposal.approved",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            payload: {
              note: command.note,
              previousStatus: proposal.status,
              newStatus: "approved",
              reason:
                consent === "granted"
                  ? "Carrier policy treats this approval as consent to be booked."
                  : "Approval to keep negotiating. It is not consent to be booked.",
            },
          },
        ],
      };
    }

    case "reject": {
      assertOpen(proposal, "Reject");
      if (!ctx.policy.allowReject) {
        throw new PolicyDeniedError("reject", `${ctx.policyLabel} does not allow rejecting a proposal outright. Leave a comment or a counteroffer instead.`);
      }
      let next = endLivePause(proposal, at, "resumed_by_driver");
      next = bump({
        ...next,
        status: "rejected",
        rejection: { at, by: ctx.actor, source: ctx.source, reason: command.reason },
      });
      return {
        next,
        events: [
          {
            type: "proposal.rejected",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            // A reason is optional by design. Requiring one produces "no" as
            // the reason, which is worse than an honest blank.
            payload: {
              reason: command.reason,
              previousStatus: proposal.status,
              newStatus: "rejected",
            },
          },
        ],
      };
    }

    case "pause": {
      assertOpen(proposal, "Pause");
      assertPauseDurationAllowed(ctx.policy, command.minutes, ctx.policyLabel);
      if (proposal.status !== "awaiting_driver_response") {
        throw new InvalidTransitionError(
          "Pause",
          proposal.status,
          `There is nothing to pause: this proposal is ${STATUS_PHRASE[proposal.status]}.`,
        );
      }
      if (proposal.pauses.length >= ctx.policy.maxPauses) {
        throw new PolicyDeniedError(
          "max_pauses",
          `${ctx.policyLabel} allows ${ctx.policy.maxPauses} pause${ctx.policy.maxPauses === 1 ? "" : "s"} on one proposal. You have used them all.`,
        );
      }
      const pause: ProposalPause = {
        id: ctx.newId("pause"),
        startedAt: at,
        expiresAt: new Date(new Date(at).getTime() + command.minutes * 60_000).toISOString(),
        minutes: command.minutes,
        reason: command.reason,
        by: ctx.actor,
        source: ctx.source,
      };
      return {
        next: bump({ ...proposal, status: "paused", pauses: [...proposal.pauses, pause] }),
        events: [
          {
            type: "proposal.paused",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            payload: {
              minutes: command.minutes,
              pauseId: pause.id,
              reason: command.reason,
              previousStatus: proposal.status,
              newStatus: "paused",
            },
          },
        ],
      };
    }

    case "resume": {
      assertOpen(proposal, "Resume");
      const target = proposal.pauses.find((p) => p.id === command.pauseId);
      if (!target) {
        throw new StalePauseError(command.pauseId, "it is not a pause on this proposal.");
      }
      // The three ways a pause action goes stale, each named rather than
      // silently succeeding on the wrong pause.
      if (target.endedAt) {
        throw new StalePauseError(
          command.pauseId,
          target.endedReason === "expired"
            ? "it already ran out, and the proposal is waiting for your answer again."
            : "it was already ended.",
        );
      }
      if (proposal.status !== "paused") {
        throw new StalePauseError(
          command.pauseId,
          `the proposal is ${STATUS_PHRASE[proposal.status]}.`,
        );
      }
      return {
        next: bump({
          ...endLivePause(proposal, at, "resumed_by_driver"),
          status: "awaiting_driver_response",
        }),
        events: [
          {
            type: "proposal.resumed",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            payload: {
              pauseId: target.id,
              previousStatus: "paused",
              newStatus: "awaiting_driver_response",
            },
          },
        ],
      };
    }

    case "comment": {
      assertOpen(proposal, "Comment");
      if (!ctx.policy.allowComments) {
        throw new PolicyDeniedError("comment", `${ctx.policyLabel} does not accept comments on a proposal.`);
      }
      const body = command.body.trim();
      if (!body) throw new PolicyDeniedError("comment_empty", "A comment needs something in it.");
      const comment = {
        id: ctx.newId("cmt"),
        proposalId: proposal.id,
        body,
        at,
        by: ctx.actor,
        source: ctx.source,
      };
      return {
        next: bump({ ...proposal, comments: [...proposal.comments, comment] }),
        events: [
          {
            type: "proposal.comment_added",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            payload: { commentId: comment.id, note: body },
          },
        ],
      };
    }

    case "counteroffer": {
      assertOpen(proposal, "Counteroffer");
      assertCounterofferAllowed(ctx.policy, command.kind, ctx.policyLabel);
      const message = command.message.trim();
      if (!message) {
        throw new PolicyDeniedError(
          "counteroffer_empty",
          "Say what you are asking for. A number on its own does not explain the ask.",
        );
      }
      const open = proposal.counteroffers.filter((c) => c.status === "submitted");
      if (open.length >= ctx.policy.maxOpenCounteroffers) {
        throw new PolicyDeniedError(
          "max_counteroffers",
          `${ctx.policyLabel} allows ${ctx.policy.maxOpenCounteroffers} open counteroffer${ctx.policy.maxOpenCounteroffers === 1 ? "" : "s"} at a time. Withdraw one before adding another.`,
        );
      }
      const counter: Counteroffer = {
        id: ctx.newId("co"),
        proposalId: proposal.id,
        kind: command.kind,
        proposedAmountCents: command.proposedAmountCents,
        message,
        status: "submitted",
        submittedAt: at,
        submittedBy: ctx.actor,
        source: ctx.source,
      };
      return {
        next: bump({ ...proposal, counteroffers: [...proposal.counteroffers, counter] }),
        events: [
          {
            type: "proposal.counteroffer_submitted",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            payload: { counterofferId: counter.id, note: message },
          },
        ],
      };
    }

    case "withdraw_counteroffer": {
      assertOpen(proposal, "Withdraw counteroffer");
      const target = proposal.counteroffers.find((c) => c.id === command.counterofferId);
      if (!target) {
        throw new InvalidTransitionError(
          "Withdraw counteroffer",
          proposal.status,
          "That counteroffer is not on this proposal.",
        );
      }
      if (target.status !== "submitted") {
        throw new DuplicateSubmissionError("That counteroffer");
      }
      return {
        next: bump({
          ...proposal,
          counteroffers: proposal.counteroffers.map((c) =>
            c.id === target.id ? { ...c, status: "withdrawn" as const, respondedAt: at } : c,
          ),
        }),
        events: [
          {
            type: "proposal.counteroffer_withdrawn",
            occurredAt: at,
            actor: ctx.actor,
            source: ctx.source,
            idempotencyKey: command.idempotencyKey,
            payload: { counterofferId: target.id },
          },
        ],
      };
    }
  }
}

/**
 * A different load was finalized over this driver or this equipment. The
 * proposal becomes unavailable — it is NOT deleted, and every comment,
 * counteroffer and pause on it stays exactly where it was.
 */
export function markUnavailable(
  proposal: LoadProposal,
  input: {
    at: IsoDateTime;
    conflictingLoadId: string;
    conflictKind: "driver" | "equipment";
    reason: string;
  },
): ProposalDecision {
  if (isClosed(proposal.status)) return { next: proposal, events: [] };
  return {
    next: {
      ...proposal,
      status: "unavailable",
      version: proposal.version + 1,
      unavailability: {
        at: input.at,
        reason: input.reason,
        conflictingLoadId: input.conflictingLoadId,
        conflictKind: input.conflictKind,
      },
    },
    events: [
      {
        type: "proposal.marked_unavailable",
        occurredAt: input.at,
        actor: SYSTEM_ACTOR,
        source: "system",
        payload: {
          previousStatus: proposal.status,
          newStatus: "unavailable",
          conflictingLoadId: input.conflictingLoadId,
          conflictReason: input.reason,
        },
      },
    ],
  };
}

/** This proposal's own load was finalized. The trip workflow takes over. */
export function markFinalized(
  proposal: LoadProposal,
  input: { at: IsoDateTime; loadId: string; actor: ActorRef },
): ProposalDecision {
  return {
    next: {
      ...proposal,
      status: "finalized",
      version: proposal.version + 1,
    },
    events: [
      {
        type: "proposal.finalized",
        occurredAt: input.at,
        actor: input.actor,
        source: "web",
        payload: {
          previousStatus: proposal.status,
          newStatus: "finalized",
          conflictingLoadId: input.loadId,
          note: "The rate confirmation was approved, signed and sent. The finalized load post and trip workflow were created.",
        },
      },
    ],
  };
}

/** Two service windows overlap. Half-open, so touching ends do not conflict. */
export function windowsOverlap(
  a: { startAt: IsoDateTime; endAt: IsoDateTime },
  b: { startAt: IsoDateTime; endAt: IsoDateTime },
): boolean {
  const aStart = new Date(a.startAt).getTime();
  const aEnd = new Date(a.endAt).getTime();
  const bStart = new Date(b.startAt).getTime();
  const bEnd = new Date(b.endAt).getTime();
  return aStart < bEnd && bStart < aEnd;
}

/**
 * What this driver may do right now — computed by the same module that
 * enforces it, so the dashboard cannot offer a button the service refuses and
 * a disabled button always has a reason attached to it.
 */
export function availableActions(
  proposal: LoadProposal,
  policy: ProposalPolicy,
  now: IsoDateTime,
): ProposalAction[] {
  const closed = isClosed(proposal.status);
  const closedReason = closed
    ? `This proposal is ${STATUS_PHRASE[proposal.status]}.`
    : undefined;
  const live = activePause(proposal, now);
  const openCounters = proposal.counteroffers.filter((c) => c.status === "submitted").length;

  const make = (
    kind: ProposalActionKind,
    enabled: boolean,
    disabledReason?: string,
  ): ProposalAction => ({ kind, enabled, disabledReason: enabled ? undefined : disabledReason });

  return [
    make(
      "approve",
      !closed && proposal.status !== "approved",
      closedReason ??
        (proposal.status === "approved" ? "You have already approved continued negotiation." : undefined),
    ),
    make(
      "reject",
      !closed && policy.allowReject,
      closedReason ?? "Carrier policy does not offer an outright rejection here.",
    ),
    make(
      "pause",
      !closed &&
        policy.allowPause &&
        proposal.status === "awaiting_driver_response" &&
        proposal.pauses.length < policy.maxPauses,
      closedReason ??
        (!policy.allowPause
          ? "Carrier policy does not allow pausing this proposal."
          : proposal.status !== "awaiting_driver_response"
            ? `There is nothing to pause: this proposal is ${STATUS_PHRASE[proposal.status]}.`
            : `You have used all ${policy.maxPauses} pauses on this proposal.`),
    ),
    make("resume", !closed && Boolean(live), closedReason ?? "This proposal is not paused."),
    make(
      "comment",
      !closed && policy.allowComments,
      closedReason ?? "Carrier policy does not accept comments on this proposal.",
    ),
    make(
      "counteroffer",
      !closed &&
        policy.allowedCounterofferKinds.length > 0 &&
        openCounters < policy.maxOpenCounteroffers,
      closedReason ??
        (policy.allowedCounterofferKinds.length === 0
          ? "Carrier policy does not accept counteroffers from you on this load."
          : `You already have ${openCounters} open counteroffer${openCounters === 1 ? "" : "s"}, which is the limit. Withdraw one to add another.`),
    ),
  ];
}

export { STATUS_PHRASE as PROPOSAL_STATUS_PHRASE };
