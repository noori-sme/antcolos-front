import type { MtLoopBlocker, MtLoopCard } from "@/types";
import type { TruckOpportunities } from "@/lib/api/mock/opportunity-service";

/**
 * The empty-to-empty cycle, as a spine of stages.
 *
 * ★ WHY A SPINE AND NOT A STACK OF PANELS ★
 *
 * This page used to be seven full-width panels in a column — search,
 * opportunities, the driver, the brokers, the rate confirmation, the messages,
 * then five reference panels about the truck. Every one of them was the same
 * size and the same weight whether it was the thing being worked on or a stage
 * nobody had reached, so the page never answered the only question somebody
 * opens it with: where is this truck up to, and what do I do next.
 *
 * A spine answers it in the shape. One stage is open because that is where the
 * work is; the ones behind it are a line each because they are done; the ones
 * ahead are a line each because they have not happened. The PANELS are
 * unchanged — each stage still renders the module that owns it — and what
 * changed is which one is open.
 *
 * ★ IT DERIVES, IT DOES NOT DECIDE ★
 *
 * Every state below is read off a record another module owns: the search
 * session from Opportunities, the matches and drafts from the same, the review
 * from Driver Workflow, the rounds from Negotiation, the booking from Booking,
 * the workflow from Rate Confirmation. Nothing here is stored and nothing is a
 * second opinion. In particular it never re-derives the BLOCKERS — those come
 * from the one list every screen shows — and never re-derives WHERE THE CYCLE
 * IS, which the board already worked out as `card.progress`.
 *
 * ★ STAGES RUN TOGETHER, AND SOME NEVER RUN ★
 *
 * The cycle is not a wizard. Brokers answer while the driver is still looking;
 * a carrier that does not ask its drivers skips that stage entirely and always
 * will. So `done` is not "everything before it is done", `skipped` carries the
 * reason and the carrier rule it came from, and more than one stage can be
 * live at once.
 */

export type CycleStageKey =
  | "search"
  | "shortlist"
  | "driver"
  | "brokers"
  | "book"
  | "ratecon";

export type CycleStageState =
  /** Finished, and a record says so. */
  | "done"
  /** Where the work is right now, and the ball is with this workspace. */
  | "active"
  /** Started, and the ball is with a broker, a driver or a carrier. */
  | "waiting"
  /** Not reached yet. */
  | "upcoming"
  /**
   * Deliberately not needed on this cycle.
   *
   * Never silent: a skipped stage carries the reason and says whose rule it
   * was. A dispatcher who cannot see why the driver was not asked has no way
   * to tell a carrier policy from a bug.
   */
  | "skipped"
  /** Something is in the way. Nothing here can start until it is cleared. */
  | "stopped";

export interface CycleStage {
  key: CycleStageKey;
  title: string;
  state: CycleStageState;
  /** One line: what has happened, or what is being waited on. */
  summary: string;
  /** Shown in the node when the stage has a countable thing in it. */
  count?: number;
  /** Required when `state` is "skipped" or "stopped". Never a bare label. */
  reason?: string;
  /**
   * Something the stage has to admit.
   *
   * Two search sources are not connected; nothing is emailed from Antcolos.
   * These are not footnotes — a dispatcher reading "6 sources searched" without
   * them would believe the market had been covered when a third of it was not.
   */
  caveat?: string;
}

export interface CycleSpineInput {
  card?: MtLoopCard;
  blockers: readonly MtLoopBlocker[];
  opportunities?: TruckOpportunities;
  /** Whether this carrier asks its drivers to accept before dispatch. */
  driverConsentRequired?: boolean;
  carrierName?: string;
  /** The carrier's own wording of that rule, where the record carries one. */
  driverConsentRule?: string;
}

/**
 * What stops everything.
 *
 * `unconfirmed_load` is excluded for the same reason the board excludes it from
 * its lane test: it is the work in hand rather than an obstacle to it, and the
 * rate confirmation stage names it itself.
 */
function haltingBlocker(blockers: readonly MtLoopBlocker[]): MtLoopBlocker | undefined {
  return blockers.find((b) => b.stopsDispatch && b.key !== "unconfirmed_load");
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/* -------------------------------------------------------------------------- */

export function cycleStages(input: CycleSpineInput): CycleStage[] {
  const { blockers, opportunities: o } = input;
  const halt = haltingBlocker(blockers);

  return [
    searchStage(input, halt),
    shortlistStage(input, halt),
    driverStage(input, halt),
    brokerStage(input, halt),
    bookStage(input, halt),
    rateConStage(input),
  ].map((stage) =>
    // Nothing downstream of a halt is "upcoming" in the ordinary sense — it is
    // waiting on the halt. Saying so once, at the top, beats repeating the
    // blocker on six cards.
    halt && stage.state === "upcoming" && !o
      ? { ...stage, summary: `Waiting on the one thing above.` }
      : stage,
  );
}

/* ---- 1. The search ------------------------------------------------------- */

function searchStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const session = input.opportunities?.session;

  // ★ A REFUSAL, NOT A GREYED-OUT BUTTON ★
  // Antcolos will not look for freight it could not dispatch, and it says that
  // rather than letting somebody spend an hour finding a load for a truck with
  // nobody on it.
  if (halt && !session) {
    return {
      key: "search",
      title: "Search for a load",
      state: "stopped",
      summary: "Antcolos will not look for freight it could not dispatch.",
      reason: halt.detail,
    };
  }

  if (!session) {
    return {
      key: "search",
      title: "Search for a load",
      state: "active",
      summary: "Nothing has been searched for this truck yet.",
    };
  }

  const sources = session.sources ?? [];
  const searched = sources.filter((s) => s.status === "searched").length;
  const unconnected = sources.filter((s) => s.status === "not_connected").length;
  const failed = sources.filter((s) => s.status === "failed").length;

  const caveat = [
    unconnected > 0 ? `${unconnected} not connected` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
  ].filter(Boolean).join(" · ") || undefined;

  const summary = `${plural(session.counts.listingsSeen, "listing")} from ${plural(searched, "source")}`
    + (session.counts.duplicatesFolded > 0
      ? `, ${session.counts.duplicatesFolded} the same load`
      : "");

  if (session.status === "paused") {
    return {
      key: "search", title: "Search for a load", state: "waiting",
      summary, count: session.counts.matchesCreated,
      reason: session.pauseReason ?? "Paused by a person.",
      caveat,
    };
  }
  if (session.status === "closed") {
    return {
      key: "search", title: "Search for a load", state: "done",
      summary, count: session.counts.matchesCreated,
      reason: session.closeReason, caveat,
    };
  }

  return {
    key: "search",
    title: "Search for a load",
    // Running with nothing found is still where the work is.
    state: session.counts.matchesCreated > 0 ? "done" : "active",
    summary,
    count: session.counts.matchesCreated,
    caveat,
  };
}

/* ---- 2. The shortlist ---------------------------------------------------- */

function shortlistStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const o = input.opportunities;
  const asked = o?.drafts.length ?? 0;
  const eligible = o?.counts.eligible ?? 0;
  const ineligible = o?.counts.ineligible ?? 0;

  if (!o || o.counts.considered === 0) {
    return {
      key: "shortlist", title: "Pick the ones worth asking about", state: "upcoming",
      summary: halt
        ? "Nothing can be shortlisted until the truck can be dispatched."
        : "Nothing has been found to shortlist yet.",
    };
  }

  /*
   * ★ ONCE ONE IS TAKEN, THE COUNT IS HISTORY ★
   * A booked match stops being "eligible" — it is spoken for — so the live
   * count falls to zero and the honest-looking sentence "0 loads this truck
   * can legally take, 13 it cannot" appears on a truck that is already
   * rolling. What this stage did is pick one, and that is what it should say.
   */
  if (input.card?.loadReference || input.opportunities?.booking) {
    return {
      key: "shortlist", title: "Pick the ones worth asking about", state: "done",
      summary: `${plural(o.counts.considered, "load")} considered, one taken`
        + (ineligible > 0 ? `, ${ineligible} this truck could not legally haul` : "") + ".",
      count: o.counts.considered,
    };
  }

  const summary = `${plural(eligible, "load")} this truck can legally take`
    + (ineligible > 0 ? `, ${ineligible} it cannot` : "");

  if (asked > 0) {
    return {
      key: "shortlist", title: "Pick the ones worth asking about", state: "done",
      summary, count: eligible,
      caveat: "Nothing is emailed from Antcolos — a message is prepared, and a person sends it.",
    };
  }

  return {
    key: "shortlist",
    title: "Pick the ones worth asking about",
    state: eligible > 0 ? "active" : "waiting",
    summary: eligible > 0 ? summary : `${summary}. Nothing is worth asking about yet.`,
    count: eligible,
  };
}

/* ---- 3. The driver ------------------------------------------------------- */

function driverStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const reviews = input.opportunities?.driverReviews ?? [];

  /*
   * ★ A CARRIER'S RULE, NAMED AS THEIRS ★
   * Whether a driver is asked before a price is agreed is `driver_consent_
   * required` on the carrier's own record — not a setting in this workspace and
   * not something a dispatcher may turn off. A skipped stage that did not say
   * whose rule it was would read like a step somebody forgot.
   */
  if (input.driverConsentRequired === false && reviews.length === 0) {
    return {
      key: "driver",
      title: "Ask the driver",
      state: "skipped",
      summary: "This carrier does not ask its drivers before a price is agreed.",
      reason: input.driverConsentRule
        ?? `${input.carrierName ?? "The carrier"} has no driver-consent rule on its record. `
          + "Read from their carrier record — not a setting in this workspace.",
    };
  }

  if (reviews.length === 0) {
    return {
      key: "driver", title: "Ask the driver", state: "upcoming",
      summary: halt
        ? "Nobody can be asked until the truck can be dispatched."
        : "No load has been put to the driver yet.",
    };
  }

  const waiting = reviews.filter((r) => r.status === "waiting").length;
  const approved = reviews.filter((r) => r.status === "approved").length;
  const answered = reviews.filter(
    (r) => r.status === "declined" || r.status === "countered" || r.status === "paused",
  ).length;

  if (waiting > 0) {
    return {
      key: "driver", title: "Ask the driver", state: "waiting",
      summary: `${plural(waiting, "load")} with the driver, unanswered.`,
      count: reviews.length,
    };
  }
  if (answered > 0) {
    return {
      key: "driver", title: "Ask the driver", state: "active",
      summary: `${plural(answered, "answer")} to read.`,
      count: reviews.length,
    };
  }
  return {
    key: "driver", title: "Ask the driver", state: "done",
    summary: `${plural(approved, "load")} the driver accepted.`,
    count: reviews.length,
  };
}

/* ---- 4. The brokers ------------------------------------------------------ */

function brokerStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const rows = input.opportunities?.negotiations ?? [];
  const live = rows.filter(
    (r) => r.negotiation.status !== "withdrawn"
      && r.negotiation.status !== "lost"
      && r.negotiation.status !== "expired",
  );

  if (live.length === 0) {
    return {
      key: "brokers", title: "Talk to brokers", state: "upcoming",
      summary: halt
        ? "No conversation can be opened until the truck can be dispatched."
        : rows.length > 0
          ? `${plural(rows.length, "conversation")} finished, none open.`
          : "No conversation has been opened yet.",
    };
  }

  const yourTurn = live.filter((r) => r.negotiation.status === "waiting_on_you").length;
  const agreed = live.filter((r) => r.negotiation.status === "agreed").length;
  const outstanding = live.filter((r) => r.negotiation.status === "waiting_on_broker").length;
  const booked = live.find((r) => r.negotiation.status === "booked");

  const caveat = "Nothing is emailed from Antcolos — a reply is recorded by a person.";

  /*
   * ★ A CONVERSATION THAT ENDED IN A BOOKING IS FINISHED, NOT SILENT ★
   * `booked` is neither open nor lost, so counting only the open statuses
   * made a cycle that had argued three rounds and shaken hands read as
   * "0 brokers asked, none has answered" — on a truck already rolling on the
   * load that conversation produced.
   */
  if (booked) {
    const n = booked.negotiation;
    const money = n.agreedRateCents ?? n.onTheTableCents;
    return {
      key: "brokers", title: "Talk to brokers", state: "done",
      summary: `${n.brokerName} agreed`
        + (money === undefined ? "" : ` $${(money / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
        + ` after ${plural(n.rounds.length, "round")}.`,
      count: live.length, caveat,
    };
  }

  if (agreed > 0) {
    return {
      key: "brokers", title: "Talk to brokers", state: "active",
      summary: `${plural(agreed, "price")} agreed. Nothing is committed until it is booked.`,
      count: live.length, caveat,
    };
  }
  if (yourTurn > 0) {
    return {
      key: "brokers", title: "Talk to brokers", state: "active",
      summary: `${yourTurn} of ${live.length} have come back. Your turn.`,
      count: live.length, caveat,
    };
  }
  return {
    key: "brokers", title: "Talk to brokers", state: "waiting",
    summary: `${plural(outstanding, "broker")} asked, none has answered.`,
    count: live.length, caveat,
  };
}

/* ---- 5. The booking ------------------------------------------------------ */

function bookStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const booking = input.opportunities?.booking;
  const reference = input.card?.loadReference;

  if (booking || input.card?.loadReference) {
    return {
      key: "book", title: "Book it", state: "done",
      summary: `${reference ?? "A load"} is booked onto this truck.`,
    };
  }

  const agreed = (input.opportunities?.negotiations ?? []).some(
    (r) => r.negotiation.status === "agreed",
  );

  return {
    key: "book",
    title: "Book it",
    state: agreed && !halt ? "active" : "upcoming",
    summary: agreed && !halt
      ? "A price is agreed and nothing is committed yet."
      : "Needs a price agreed first.",
    // ★ SAID BEFORE THE BUTTON, NOT AFTER THE REFUSAL ★
    caveat: "Every blocker is re-checked at the moment of booking, not from this screen.",
  };
}

/* ---- 6. The paper -------------------------------------------------------- */

function rateConStage(input: CycleSpineInput): CycleStage {
  const workflow = input.opportunities?.rateCon;
  const booked = Boolean(input.card?.loadReference || input.opportunities?.booking);
  const outstanding = input.blockers.find((b) => b.key === "unconfirmed_load");

  if (!booked) {
    return {
      key: "ratecon", title: "Rate confirmation", state: "upcoming",
      summary: "The load is not final until the signed copy is back.",
    };
  }

  if (!workflow) {
    return {
      key: "ratecon",
      title: "Rate confirmation",
      state: "waiting",
      summary: outstanding
        ? "Nothing has come back from the broker. The load is not final and the driver has nothing to run."
        : "Nothing has come back from the broker yet.",
      caveat: "No mailbox is connected, so one is recorded when somebody puts it in.",
    };
  }

  if (workflow.status === "returned") {
    return {
      key: "ratecon", title: "Rate confirmation", state: "done",
      summary: "Signed with the carrier's authorized signature and returned to the broker.",
    };
  }
  if (workflow.status === "rejected") {
    return {
      key: "ratecon", title: "Rate confirmation", state: "stopped",
      summary: "A person stopped this rate confirmation. The original is kept.",
      reason: workflow.rejectedReason ?? "No reason was recorded.",
    };
  }

  const reviewed = workflow.fields.filter((f) => f.reviewedAt).length;
  return {
    key: "ratecon",
    title: "Rate confirmation",
    state: workflow.status === "ready_to_confirm" ? "active" : "active",
    summary: workflow.status === "ready_to_confirm"
      ? "Every required field has been looked at. One confirmation left."
      : `${reviewed} of ${workflow.fields.length} fields checked.`,
    count: workflow.fields.length - reviewed || undefined,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Which stage the page should open.
 *
 * The first one the work is actually at — a stopped stage before an active one,
 * because a refusal is the thing to read. Nothing open means the cycle has run
 * past everything Antcolos can do, and the tail says so instead.
 */
export function openStageOf(stages: readonly CycleStage[]): CycleStageKey | undefined {
  return stages.find((s) => s.state === "stopped")?.key
    ?? stages.find((s) => s.state === "active")?.key
    ?? stages.find((s) => s.state === "waiting")?.key;
}
