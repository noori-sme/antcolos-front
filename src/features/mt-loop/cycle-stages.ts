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

/** One number, with what it counts. The unit this spine is read in. */
export interface StageMetric {
  /** Two or three characters where possible: "Rate", "Dupes", "Rounds". */
  label: string;
  value: string;
  tone?: "muted" | "good" | "warn" | "bad";
  /** The long form, for the tooltip on the metric. */
  title?: string;
}

export interface CycleStage {
  key: CycleStageKey;
  title: string;
  state: CycleStageState;
  /**
   * The state, in three or four words. Never a sentence.
   *
   * ★ THE RULE THIS FILE WAS REWRITTEN UNDER ★
   * A stage used to read "24 listings from 3 sources, 10 the same load" — a
   * sentence a dispatcher has to READ. The numbers now live in `metrics`,
   * where they are SEEN, and line up between one stage and the next. What is
   * left here is the label for the state itself.
   */
  summary: string;
  /** The numbers behind the state. Rendered as key-value pairs, not prose. */
  metrics?: StageMetric[];
  /** Shown in the node when the stage has a countable thing in it. */
  count?: number;
  /**
   * The long form: a carrier's rule, a refusal's cause, what is not connected.
   *
   * Lives in a tooltip, NOT in the layout — except where `noteVisible` says
   * otherwise. Anything in here is also in the actions panel, so nothing is
   * reachable only by hovering.
   */
  note?: string;
  /**
   * Keep `note` on the page rather than in the tooltip.
   *
   * Set for a refusal and for a skipped stage, and for nothing else: "this
   * stage will never run on this carrier" and "Antcolos refused to search"
   * are the two cases where a reader who does not hover would be left
   * guessing at something they have to act on.
   */
  noteVisible?: boolean;
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
      ? { ...stage, summary: "Blocked upstream" }
      : stage,
  );
}

/* ---- 1. The search ------------------------------------------------------- */

function searchStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const session = input.opportunities?.session;

  // ★ A REFUSAL, NOT A GREYED-OUT BUTTON ★
  // Antcolos will not look for freight it could not dispatch. The label says
  // refused and the cause stays on the page — it is the one thing a reader has
  // to act on, so it is not put behind a hover.
  if (halt && !session) {
    return {
      key: "search",
      title: "Load search",
      state: "stopped",
      summary: "Refused",
      note: halt.detail,
      noteVisible: true,
    };
  }

  if (!session) {
    return { key: "search", title: "Load search", state: "active", summary: "Not started" };
  }

  const sources = session.sources ?? [];
  const searched = sources.filter((s) => s.status === "searched").length;
  const unconnected = sources.filter((s) => s.status === "not_connected").length;
  const failed = sources.filter((s) => s.status === "failed").length;
  const c = session.counts;

  const metrics: StageMetric[] = [
    { label: "Seen", value: String(c.listingsSeen) },
    {
      label: "Sources",
      value: `${searched}/${sources.length}`,
      // Not a footnote. A source that was never read is a slice of the market
      // nobody looked at, and a bare "3 sources" implies it was covered.
      tone: unconnected + failed > 0 ? "warn" : "good",
      title: unconnected + failed > 0
        ? `${unconnected} not connected${failed > 0 ? `, ${failed} failed` : ""}`
        : undefined,
    },
    ...(c.duplicatesFolded > 0
      ? [{ label: "Dupes", value: String(c.duplicatesFolded) } as StageMetric]
      : []),
    { label: "Matched", value: String(c.matchesCreated), tone: c.matchesCreated > 0 ? "good" : "muted" },
  ];

  if (session.status === "paused") {
    return {
      key: "search", title: "Load search", state: "waiting", summary: "Paused",
      metrics, count: c.matchesCreated, note: session.pauseReason ?? "Paused by a person.",
    };
  }
  if (session.status === "closed") {
    return {
      key: "search", title: "Load search", state: "done", summary: "Closed",
      metrics, count: c.matchesCreated, note: session.closeReason,
    };
  }

  return {
    key: "search",
    title: "Load search",
    // Running with nothing found is still where the work is.
    state: c.matchesCreated > 0 ? "done" : "active",
    summary: c.matchesCreated > 0 ? "Searched" : "Nothing found",
    metrics,
    count: c.matchesCreated,
  };
}

/* ---- 2. The shortlist ---------------------------------------------------- */

const NOT_SENT = "Nothing is emailed from Antcolos. A message is prepared and a person sends it.";

function shortlistStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const o = input.opportunities;
  const asked = o?.drafts.length ?? 0;
  const eligible = o?.counts.eligible ?? 0;
  const ineligible = o?.counts.ineligible ?? 0;

  if (!o || o.counts.considered === 0) {
    return {
      key: "shortlist", title: "Opportunities", state: "upcoming",
      summary: halt ? "Blocked upstream" : "Nothing found yet",
    };
  }

  const metrics: StageMetric[] = [
    { label: "Seen", value: String(o.counts.considered) },
    { label: "Eligible", value: String(eligible), tone: eligible > 0 ? "good" : "muted" },
    ...(ineligible > 0
      ? [{
        label: "Refused",
        value: String(ineligible),
        tone: "warn",
        title: "Loads this truck may not legally haul. Open the list for which check each failed.",
      } as StageMetric]
      : []),
  ];

  /*
   * ★ ONCE ONE IS TAKEN, THE LIVE COUNT IS HISTORY ★
   * A booked match stops being "eligible", so the count falls to zero and an
   * honest-looking "0 eligible" appears on a truck that is already rolling.
   * What this stage did is pick one.
   */
  if (input.card?.loadReference || o.booking) {
    return {
      key: "shortlist", title: "Opportunities", state: "done", summary: "One taken",
      metrics, count: o.counts.considered,
    };
  }

  if (asked > 0) {
    return {
      key: "shortlist", title: "Opportunities", state: "done", summary: "Shortlisted",
      metrics, count: eligible, note: NOT_SENT,
    };
  }

  return {
    key: "shortlist",
    title: "Opportunities",
    state: eligible > 0 ? "active" : "waiting",
    summary: eligible > 0 ? "Ready to ask" : "Nothing eligible",
    metrics,
    count: eligible,
  };
}

/* ---- 3. The driver ------------------------------------------------------- */

function driverStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const reviews = input.opportunities?.driverReviews ?? [];

  /*
   * ★ A CARRIER'S RULE, NAMED AS THEIRS ★
   * Whether a driver is asked at all is `driver_consent_required` on the
   * carrier's own record — not a setting in this workspace. A skipped stage
   * with no reason on the page reads as a step somebody forgot, so this one
   * keeps its note visible rather than hiding it behind a hover.
   */
  if (input.driverConsentRequired === false && reviews.length === 0) {
    return {
      key: "driver",
      title: "Driver",
      state: "skipped",
      summary: "Not required",
      note: input.driverConsentRule
        ?? `${input.carrierName ?? "This carrier"} has no driver-consent rule. Read from their carrier record, not set here.`,
      noteVisible: true,
    };
  }

  if (reviews.length === 0) {
    return {
      key: "driver", title: "Driver", state: "upcoming",
      summary: halt ? "Blocked upstream" : "Not asked",
    };
  }

  const waiting = reviews.filter((r) => r.status === "waiting").length;
  const approved = reviews.filter((r) => r.status === "approved").length;
  const answered = reviews.filter(
    (r) => r.status === "declined" || r.status === "countered" || r.status === "paused",
  ).length;

  const metrics: StageMetric[] = [
    { label: "Sent", value: String(reviews.length) },
    ...(approved > 0 ? [{ label: "Accepted", value: String(approved), tone: "good" } as StageMetric] : []),
    ...(waiting > 0 ? [{ label: "Waiting", value: String(waiting), tone: "warn" } as StageMetric] : []),
    ...(answered > 0 ? [{ label: "Replies", value: String(answered), tone: "warn" } as StageMetric] : []),
  ];

  if (waiting > 0) {
    return { key: "driver", title: "Driver", state: "waiting", summary: "Waiting on driver", metrics, count: reviews.length };
  }
  if (answered > 0) {
    return { key: "driver", title: "Driver", state: "active", summary: "Answer to read", metrics, count: reviews.length };
  }
  return { key: "driver", title: "Driver", state: "done", summary: "Driver accepted", metrics, count: reviews.length };
}

/* ---- 4. The brokers ------------------------------------------------------ */

const NOT_EMAILED = "Nothing is emailed from Antcolos. A broker's reply is recorded by a person.";

function brokerStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const rows = input.opportunities?.negotiations ?? [];
  const live = rows.filter(
    (r) => r.negotiation.status !== "withdrawn"
      && r.negotiation.status !== "lost"
      && r.negotiation.status !== "expired",
  );

  if (live.length === 0) {
    return {
      key: "brokers", title: "Brokers", state: "upcoming",
      summary: halt ? "Blocked upstream" : rows.length > 0 ? "All closed" : "None open",
      metrics: rows.length > 0 ? [{ label: "Closed", value: String(rows.length) }] : undefined,
    };
  }

  const yourTurn = live.filter((r) => r.negotiation.status === "waiting_on_you").length;
  const agreed = live.filter((r) => r.negotiation.status === "agreed").length;
  const outstanding = live.filter((r) => r.negotiation.status === "waiting_on_broker").length;
  const booked = live.find((r) => r.negotiation.status === "booked");

  const rounds = live.reduce((n, r) => n + r.negotiation.rounds.length, 0);
  const base: StageMetric[] = [
    { label: "Open", value: String(live.length) },
    { label: "Rounds", value: String(rounds) },
  ];

  /*
   * ★ A CONVERSATION THAT ENDED IN A BOOKING IS FINISHED, NOT SILENT ★
   * `booked` is neither open nor lost, so counting only the open statuses made
   * a cycle that had argued five rounds read as "none open" — on a truck
   * already rolling on the load that conversation produced.
   */
  if (booked) {
    const n = booked.negotiation;
    const money = n.agreedRateCents ?? n.onTheTableCents;
    return {
      key: "brokers", title: "Brokers", state: "done", summary: "Agreed",
      metrics: [
        { label: "With", value: n.brokerName },
        { label: "Rounds", value: String(n.rounds.length) },
        ...(money === undefined ? [] : [{ label: "Rate", value: money_(money), tone: "good" } as StageMetric]),
      ],
      count: live.length, note: NOT_EMAILED,
    };
  }

  if (agreed > 0) {
    return {
      key: "brokers", title: "Brokers", state: "active", summary: "Agreed, not booked",
      metrics: base, count: live.length, note: NOT_EMAILED,
    };
  }
  if (yourTurn > 0) {
    return {
      key: "brokers", title: "Brokers", state: "active", summary: "Your turn",
      metrics: [{ label: "Replied", value: `${yourTurn}/${live.length}`, tone: "good" }, ...base.slice(1)],
      count: live.length, note: NOT_EMAILED,
    };
  }
  return {
    key: "brokers", title: "Brokers", state: "waiting", summary: "Waiting on brokers",
    metrics: [{ label: "Asked", value: String(outstanding), tone: "warn" }, ...base.slice(1)],
    count: live.length, note: NOT_EMAILED,
  };
}

const money_ = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/* ---- 5. The booking ------------------------------------------------------ */

const BOOK_GATE = "Every blocker is re-checked at the moment of booking, not from this screen.";

function bookStage(input: CycleSpineInput, halt?: MtLoopBlocker): CycleStage {
  const booking = input.opportunities?.booking;
  const reference = input.card?.loadReference;

  if (booking || reference) {
    return {
      key: "book", title: "Booking", state: "done", summary: "Booked",
      metrics: reference ? [{ label: "Load", value: reference, tone: "good" }] : undefined,
      note: BOOK_GATE,
    };
  }

  const agreed = (input.opportunities?.negotiations ?? []).some(
    (r) => r.negotiation.status === "agreed",
  );

  return {
    key: "book",
    title: "Booking",
    state: agreed && !halt ? "active" : "upcoming",
    summary: agreed && !halt ? "Ready to book" : "Needs a price",
    note: BOOK_GATE,
  };
}

/* ---- 6. The paper -------------------------------------------------------- */

const NO_MAILBOX = "No mailbox is connected, so a rate confirmation is recorded when somebody puts it in.";

function rateConStage(input: CycleSpineInput): CycleStage {
  const workflow = input.opportunities?.rateCon;
  const booked = Boolean(input.card?.loadReference || input.opportunities?.booking);

  if (!booked) {
    return { key: "ratecon", title: "Rate con", state: "upcoming", summary: "Not booked yet" };
  }

  if (!workflow) {
    return {
      key: "ratecon", title: "Rate con", state: "waiting", summary: "Not arrived",
      note: NO_MAILBOX,
    };
  }

  /*
   * ★ THE REQUIRED ONES, WHICH ARE THE ONES THAT GATE IT ★
   * Counting every extracted field read "Checked 14/19" beside "Signed &
   * returned" — a confirmation that looked incomplete on a load that was
   * final. A rate confirmation cannot be confirmed until every REQUIRED field
   * has been looked at; the optional ones never blocked anything.
   */
  const required = workflow.fields.filter((f) => f.required);
  const reviewed = required.filter((f) => f.reviewedAt).length;
  const fields: StageMetric = {
    label: "Checked",
    value: `${reviewed}/${required.length}`,
    tone: reviewed === required.length ? "good" : "warn",
    title: `${workflow.fields.length} fields were extracted; ${required.length} are required before it can be confirmed.`,
  };

  if (workflow.status === "returned") {
    return {
      key: "ratecon", title: "Rate con", state: "done", summary: "Signed & returned",
      metrics: [fields],
    };
  }
  if (workflow.status === "rejected") {
    return {
      key: "ratecon", title: "Rate con", state: "stopped", summary: "Stopped",
      note: workflow.rejectedReason ?? "No reason was recorded.",
      noteVisible: true,
    };
  }

  return {
    key: "ratecon",
    title: "Rate con",
    state: "active",
    summary: workflow.status === "ready_to_confirm" ? "Ready to sign" : "Checking",
    metrics: [fields],
    count: required.length - reviewed || undefined,
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
