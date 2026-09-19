import type {
  MtLoop, MtLoopBlocker, MtLoopInlineAction, MtLoopLane, MtLoopPosition,
  MtLoopProgress, MtLoopService, MtLoopStage, Negotiation,
} from "@/types";
import { negotiationsForCycle } from "./negotiation";
import { rateConForCycle } from "./rate-confirmation";
import { sessionForCycle } from "./search-session";
import { cityPoint, latestLocationSignal } from "./tracking-signals";
import {
  isOutOfService, listRequirementsSync, maintenanceContextFrom,
} from "./maintenance-registry";
import type { MtLoopContext } from "./mt-loop";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * What the BOARD needs to say about a cycle, beyond what the cycle itself is.
 *
 * `mt-loop-cycle.ts` answers where the truck is in its cycle, what the evidence
 * is, and what is in the way. That is the cycle's own business and every screen
 * asks it. This file answers the four questions a board — and only a board —
 * has to answer in a single glance:
 *
 *   which lane      what needs me, what is already moving, what cannot move
 *   whose turn      the one badge, read off the search, the conversation and
 *                   the rate confirmation
 *   what it means   one sentence, not a restatement of the truck's profile
 *   where and how   the position at the precision we may know it, and any
 *                   service falling due
 *
 * ★ IT READS. IT DOES NOT DECIDE, AND IT DOES NOT COPY. ★
 * Every fact below comes from the module that owns it, through that module's
 * own reader and this membership's own context — the search session from
 * Opportunities, the rounds from Negotiation, the status from Rate
 * Confirmation, the position from ELD & Telematics, the due point from
 * Maintenance. Nothing is stored, nothing is recomputed from a second
 * interpretation of the same records, and a reader that declines (no
 * permission, no share, not the operator) produces an absent field rather than
 * a cheerful default. Fix the underlying record and the card follows.
 *
 * ★ WHY IT IS A FILE OF ITS OWN ★
 * Negotiation, Rate Confirmation and Search Session all read the loop, so the
 * loop service cannot read them back without importing in a circle. Keeping the
 * board's derivations here means `mt-loop.ts` has one import to make and the
 * cycle stays one way round: the board depends on the work, never the reverse.
 */

/* -------------------------------------------------------------------------- */
/* Lanes                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which lane a cycle belongs in.
 *
 * ★ NOT READY IS A LANE, NOT A DISAPPEARANCE ★
 * A truck with nobody on it, or a carrier whose authority has lapsed, cannot be
 * dispatched, so putting it in front of somebody looking for freight to book is
 * an invitation to waste an hour. It moves out of the working lane — and stays
 * on the board, counted, clickable, with its empty clock still running, because
 * the cycle is open, its id is fixed and somebody is answerable for it.
 *
 * The test is the blocker list, not the loop's status: a cycle can be perfectly
 * `working` and still have no driver on the truck.
 */
export function laneFor(
  stage: MtLoopStage,
  blockers: readonly MtLoopBlocker[],
  confirmed: boolean,
): MtLoopLane {
  /*
   * ★ BOTH, OR IT IS NOT ROLLING ★
   * The rate confirmation is signed and back AND the driver has started. A
   * driver post on a load whose paper is still out is not a truck that has
   * gone — it is a truck somebody is still chasing a broker about, and moving
   * it to Rolling would stop the one person who has to chase from seeing it.
   * A load actually under way is past arguing about.
   */
  if (stage === "running") return "rolling";
  if (stage === "dispatched" && confirmed) return "rolling";

  // `unconfirmed_load` stops a DISPATCH and is exactly what the dispatcher is
  // working on, so it must not push the truck out of the working lane. Every
  // other stopping blocker means searching would be wasted effort.
  if (blockers.some((b) => b.stopsDispatch && b.key !== "unconfirmed_load")) return "not_ready";

  // A person's deliberate hold is not "not ready" in the equipment sense, but
  // nothing can move while it is on, and offering it as workable would invite
  // the very booking the hold exists to prevent.
  if (stage === "stopped") return "not_ready";

  return "needs_load";
}

/* -------------------------------------------------------------------------- */
/* Progress — one truck, one badge                                             */
/* -------------------------------------------------------------------------- */

/** The negotiations that still mean something, newest first. */
function liveNegotiations(rows: readonly Negotiation[]): Negotiation[] {
  return rows.filter(
    (n) => n.status !== "lost" && n.status !== "withdrawn" && n.status !== "expired",
  );
}

interface ProgressInput {
  loop: MtLoop;
  stage: MtLoopStage;
  blockers: readonly MtLoopBlocker[];
  /** Whether a committed rate confirmation exists for the booked load. */
  confirmed: boolean;
}

/**
 * Where the cycle has got to, and whose turn it is.
 *
 * Read in the order the work actually happens, latest state first, so one truck
 * carries one badge. The ladder is deliberately the same one the cards, the
 * lane and the inline action are all read from — a screen that derived "your
 * turn" separately from the button underneath it would eventually disagree with
 * itself, which is the bug this module's neighbours were written to stop.
 */
function progressFor(input: ProgressInput, ctx: MtLoopContext): {
  progress: MtLoopProgress;
  inlineAction?: MtLoopInlineAction;
} {
  const { loop, stage, blockers, confirmed } = input;

  /* ---- Stopped outranks everything. Nothing below it is progressing. ---- */
  if (stage === "stopped") {
    const stopping = blockers.find((b) => b.stopsDispatch);
    return {
      progress: {
        key: "stopped",
        label: loop.status === "paused" ? "Paused" : "Stopped",
        note: stopping?.owner === "dispatcher" ? "yours to lift" : "waiting on somebody",
        detail: loop.pauseReason ?? loop.blockReason,
        // A hold this workspace put on is this workspace's to take off.
        yourTurn: loop.status === "paused" || loop.blockOrigin === "person",
      },
    };
  }

  if (stage === "running" || stage === "dispatched") {
    return {
      progress: {
        key: "rolling",
        label: "Rolling",
        note: "signed and moving",
        detail: loop.loadReference ? `on ${loop.loadReference}` : undefined,
        yourTurn: false,
      },
    };
  }

  /* ---- The paper, once there is a load ---- */
  if (loop.loadId) {
    const workflow = rateConForCycle(loop.loopId, ctx);

    if (confirmed || workflow?.status === "returned") {
      return {
        progress: {
          key: "rate_con_ready",
          label: "Signed and returned",
          note: "waiting on the driver to start",
          detail: loop.loadReference,
          yourTurn: false,
        },
      };
    }

    if (workflow?.status === "ready_to_confirm") {
      return {
        progress: {
          key: "rate_con_ready",
          label: "Rate con ready",
          note: "check and sign",
          detail: loop.loadReference,
          yourTurn: true,
        },
        inlineAction: { label: "Open the rate con", kind: "rate_con", id: loop.loadId },
      };
    }

    return {
      progress: {
        key: "waiting_rate_con",
        label: "Waiting on the rate con",
        note: workflow ? "arrived, being checked" : "booked, not final",
        detail: loop.loadReference,
        // The paper is the broker's to send; chasing it is ours.
        yourTurn: false,
      },
      inlineAction: { label: "Chase the rate con", kind: "rate_con", id: loop.loadId },
    };
  }

  /* ---- The conversation, before there is a load ---- */
  const negotiations = liveNegotiations(negotiationsForCycle(loop.loopId, ctx));

  const agreed = negotiations.find((n) => n.status === "agreed");
  if (agreed) {
    return {
      progress: {
        key: "price_agreed",
        label: "Price agreed",
        note: "not booked yet",
        detail: `${agreed.brokerName} · nothing is committed until it is booked`,
        yourTurn: true,
      },
      inlineAction: { label: "Read the reply", kind: "broker_reply", id: agreed.negotiationId },
    };
  }

  const replied = negotiations.filter((n) => n.status === "waiting_on_you");
  if (replied.length > 0) {
    // Newest reply first: the one a dispatcher is most likely to want.
    const newest = [...replied].sort((a, b) => lastRoundAt(b).localeCompare(lastRoundAt(a)))[0];
    return {
      progress: {
        key: "broker_replied",
        label: replied.length === 1 ? "Broker replied" : `${replied.length} brokers replied`,
        note: "your turn",
        detail: negotiations.length > replied.length
          ? `${replied.length} of ${negotiations.length} have come back`
          : undefined,
        yourTurn: true,
      },
      inlineAction: {
        label: "Read the reply",
        kind: "broker_reply",
        id: newest.negotiationId,
      },
    };
  }

  if (negotiations.length > 0) {
    return {
      progress: {
        key: "asked_brokers",
        label: negotiations.length === 1
          ? "Asked 1 broker"
          : `Asked ${negotiations.length} brokers`,
        note: "waiting on them",
        yourTurn: false,
      },
    };
  }

  /* ---- Before anybody has been asked ---- */
  const session = sessionForCycle(loop.loopId, ctx);
  if (session && session.status === "running") {
    return {
      progress: {
        key: "searching",
        label: "Searching",
        note: session.counts.eligible > 0 ? "opportunities waiting on you" : "nothing worth taking yet",
        detail: session.counts.eligible > 0
          ? `${session.counts.eligible} of ${session.counts.matchesCreated} are worth a look`
          : undefined,
        yourTurn: session.counts.eligible > 0,
      },
    };
  }

  return {
    progress: {
      key: "not_started",
      label: "Find work for it",
      note: session ? "the search is not running" : "nobody has started",
      detail: session?.pauseReason ?? session?.closeReason,
      yourTurn: true,
    },
  };
}

function lastRoundAt(n: Negotiation): string {
  return n.rounds[n.rounds.length - 1]?.at ?? n.openedAt;
}

/* -------------------------------------------------------------------------- */
/* The headline                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The one sentence.
 *
 * ★ A CONCLUSION, NOT A PROFILE ★
 * It never restates the VIN, the equipment specification, the driver's details
 * or the trailer's — every one of those has a permanent record with a page of
 * its own, and copying them here would turn the board into a second, staler
 * copy of four other screens. What it says is what the records MEAN for the
 * next hour: who is waiting on whom, and for what.
 */
function headlineFor(
  input: ProgressInput,
  progress: MtLoopProgress,
  ctx: MtLoopContext,
): { headline: string; detail?: string } {
  const { loop, blockers } = input;

  /*
   * Whatever stops the truck leads, whatever else is true — as the blocker's
   * own LABEL, with its sentence in the detail. A cycle that cannot be
   * dispatched has exactly one thing worth saying about it, and it is already
   * said in three words.
   *
   * `unconfirmed_load` is the one exclusion, and not because it matters less:
   * it is what the dispatcher is actively working, the badge already names it,
   * and the blocker is still listed on the card and still stops the dispatch.
   */
  const stopping = blockers.find((b) => b.stopsDispatch && b.key !== "unconfirmed_load");
  if (stopping) return { headline: stopping.label, detail: stopping.detail };

  switch (progress.key) {
    case "broker_replied":
    case "price_agreed": {
      const rows = liveNegotiations(negotiationsForCycle(loop.loopId, ctx));
      const n = rows.find((r) => r.status === "agreed")
        ?? [...rows.filter((r) => r.status === "waiting_on_you")]
          .sort((a, b) => lastRoundAt(b).localeCompare(lastRoundAt(a)))[0];
      if (!n) break;
      const money = n.agreedRateCents ?? n.onTheTableCents;
      // ★ The two facts that decide whether to take it: who, and how much. ★
      return {
        headline: [n.brokerName, money === undefined ? undefined : dollars(money)]
          .filter(Boolean).join(" · "),
        detail: progress.key === "price_agreed"
          ? `${n.brokerName} agreed ${money === undefined ? "a price" : dollars(money)}. Nothing is committed until it is booked.`
          : `${n.brokerName} came back at ${money === undefined ? "a price" : dollars(money)}.`,
      };
    }

    case "waiting_rate_con":
      // The badge says "Waiting on the rate con" and the detail chip carries
      // the reference. There is nothing left for a sentence to add.
      return {
        headline: "",
        detail: `Booked on ${loop.loadReference ?? "a load"}. Not final until the signed confirmation is back from the broker.`,
      };

    case "rate_con_ready":
      return {
        headline: "",
        detail: `${loop.loadReference ?? "The load"}'s rate confirmation is here. It is not final until it is signed and returned.`,
      };

    case "rolling":
      return {
        headline: [loop.driverName, loop.loadReference].filter(Boolean).join(" · "),
        detail: `${loop.driverName ?? "The driver"} has ${loop.loadReference ?? "the load"} and is moving. The empty clock has stopped.`,
      };

    case "asked_brokers":
    case "searching":
    case "not_started":
      // Every one of these is already fully stated by the badge and its note.
      // A second line saying it again in prose is the clutter this pass removed.
      return { headline: "" };

    case "stopped":
      return {
        headline: loop.status === "paused" ? "Paused by a person" : "Held",
        detail: loop.pauseReason ?? loop.blockReason ?? "This cycle has been set aside.",
      };
  }

  return { headline: "" };
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;


/* -------------------------------------------------------------------------- */
/* Where it is                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The truck's position, at the precision this membership may know it.
 *
 * Through `latestLocationSignal`, which applies the ELD gate first and attaches
 * a coordinate only at exact precision. Two absences mean different things and
 * both are honest:
 *
 *   no position at all   no share, no permission, or no signal. No map.
 *   city_only            a coordinate exists and this membership may not have
 *                        it. A map, and a dashed ring rather than a dot.
 *
 * The city and state on the loop are NOT used as a fallback fix: they say where
 * the truck is expected to come free, which is a different fact from where it
 * is, and drawing one as the other is how a board starts lying quietly.
 */
function positionFor(loop: MtLoop, ctx: MtLoopContext): MtLoopPosition | undefined {
  const signal = latestLocationSignal(ctx, { truckId: loop.truckId, loadId: loop.loadId });
  if (!signal) return undefined;
  return {
    city: signal.city,
    state: signal.state,
    precision: signal.precision,
    // Present only at exact precision — the tracking module already enforces
    // this, and repeating the rule here would be a second place to get it wrong.
    point: signal.point,
    /*
     * Somewhere to put a mark, which is a smaller claim than a position.
     *
     * At exact precision it IS the fix. At city precision it is the city's own
     * coordinates — derived from a name this membership may already read, not
     * from the coordinate it may not — and the board draws it as a dashed ring
     * so it cannot be mistaken for one. Where the city is not one we can place,
     * there is no mark and the board shows no map rather than an empty one.
     */
    mapPoint: signal.point ?? cityPoint(signal.city, signal.state),
    observedAt: signal.observedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* What the shop is waiting for                                                */
/* -------------------------------------------------------------------------- */

/**
 * The next service falling due on this truck, where this workspace may see it.
 *
 * Maintenance decides what is due and how far off: this asks for the truck's
 * requirements, which come back in its own urgency order, and takes the first
 * one that is not already settled. Nothing here computes an interval or reads a
 * meter — a second opinion about when a truck is due is exactly the kind of
 * duplicate this module keeps being cleaned of.
 *
 * Absent has two honest meanings, and neither is "the truck is fine": nothing
 * is due, or this workspace is not the truck's operator and may not be told.
 */
function serviceFor(loop: MtLoop, ctx: MtLoopContext): MtLoopService | undefined {
  if (!ctx.permissions.has("maintenance:view")) return undefined;

  const equipment = { kind: "truck", equipmentId: loop.truckId } as const;
  const mctx = maintenanceContextFrom(ctx);

  let rows;
  try {
    rows = listRequirementsSync(mctx, { equipment });
  } catch {
    // A reader that declines is not a truck with nothing due.
    return undefined;
  }

  const next = rows.find(
    (r) => r.state === "overdue" || r.state === "due_soon" || r.state === "in_service",
  );
  const outOfService = isOutOfService(equipment);
  if (!next) {
    // Out of service with no requirement behind it still has to be said: the
    // truck may not move, and a card that stayed silent would offer it for work.
    return outOfService
      ? { title: "Out of service", due: "until the hold is lifted", state: "in_service", outOfService: true }
      : undefined;
  }

  return {
    title: next.requirement.title,
    // Maintenance's own phrase, in the trigger's own unit. An unanswerable
    // mileage trigger says "no reading" rather than inventing a number.
    due: next.due.unknown ? "no meter reading" : next.due.label,
    state: next.state,
    outOfService,
  };
}

/* -------------------------------------------------------------------------- */
/* The one call the board makes                                                */
/* -------------------------------------------------------------------------- */

export interface MtLoopBoardFacts {
  lane: MtLoopLane;
  headline: string;
  headlineDetail?: string;
  progress: MtLoopProgress;
  inlineAction?: MtLoopInlineAction;
  position?: MtLoopPosition;
  service?: MtLoopService;
}

/**
 * Everything the board adds to a card, for one cycle.
 *
 * The stage and the blockers are handed in rather than recomputed: they are the
 * cycle's own answers, every other screen is already rendering them, and a
 * board that worked them out a second way would be the two-engine bug again in
 * a different file.
 */
export function boardFactsFor(
  input: ProgressInput,
  ctx: MtLoopContext,
): MtLoopBoardFacts {
  const { progress, inlineAction } = progressFor(input, ctx);
  const service = serviceFor(input.loop, ctx);
  const { headline, detail } = headlineFor(input, progress, ctx);
  return {
    // A truck the shop has taken out of service cannot be dispatched whatever
    // the cycle thinks, and the Maintenance module — not this one — is what
    // said so.
    lane: service?.outOfService
      ? "not_ready"
      : laneFor(input.stage, input.blockers, input.confirmed),
    headline,
    headlineDetail: detail,
    progress,
    inlineAction,
    position: positionFor(input.loop, ctx),
    service,
  };
}
