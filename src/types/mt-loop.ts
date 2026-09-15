import type { IsoDateTime } from "./common";
import type { AssignmentSource, AssignmentState } from "./responsibility";
import type { FactVerification } from "./propagation";
import type { AvailabilityBasis, AvailabilityState } from "./tracking";
import type { TruckEquipmentType } from "./truck";

/**
 * The MT Loop — the cycle a truck goes through between loads.
 *
 * It starts the moment a truck becomes Expected Available or Available, and it
 * ends when the next load has been completed, unloaded, released and the truck
 * is ready to start another one. Everything a dispatcher does in that gap —
 * picking the work up, handing it over, putting it down, being stopped by a
 * problem — happens inside one loop and is remembered on it.
 *
 * Four identifiers, four jobs, and they are not interchangeable:
 *
 *   loopId   Antcolos's own permanent identity for this one cycle. An immutable
 *            UUID, assigned once when the loop opens and never reused,
 *            rewritten or regenerated — not by a reassignment, not by a pause,
 *            not by a block. A truck that goes empty a second time gets a
 *            SECOND loop with its own id, never the first one reopened.
 *   truckId  The permanent truck the cycle is about.
 *   carrierOrganizationId
 *            Whose authority the truck runs under. Never the dispatch
 *            workspace, even when they happen to be the same organization.
 *   dispatchOrganizationId
 *            The workspace responsible for covering it.
 *
 * A loop belongs to exactly one dispatch workspace, and a truck has at most one
 * OPEN loop at a time anywhere in Antcolos. Those two rules together are what
 * stops two dispatch organizations quietly working the same empty truck.
 */
export interface MtLoop {
  /** Immutable UUID. Never a truck id, unit number or org-scoped code. */
  loopId: string;
  /** The dispatch workspace responsible for covering this truck. */
  dispatchOrganizationId: string;
  /**
   * The carrier whose operating authority the truck runs under.
   *
   * For a carrier owner who dispatches their own trucks this is the same
   * organization as the dispatch workspace — the same person wearing both hats,
   * not a special kind of loop.
   */
  carrierOrganizationId: string;
  carrierName: string;

  truckId: string;
  /** The unit label the responsible workspace knows the truck by. */
  truckUnit: string;
  equipment: TruckEquipmentType;

  /**
   * Whether this cycle needs a trailer at all. A cargo van never does; a
   * tractor always does, and an empty tractor with no trailer is a real problem
   * rather than a blank field.
   */
  trailerRequired: boolean;
  trailerId?: string;
  trailerUnit?: string;

  driverProfileId?: string;
  driverName?: string;

  /**
   * The membership that has personally ACCEPTED this loop. Not who is
   * responsible for it.
   *
   * ★ THE BOUNDARY ★
   * This field used to be called `responsibleMembershipId`, and that name was
   * the whole bug: MT Loop stored one answer to "who is responsible for this
   * empty truck" while the Responsibility Engine computed another, and the two
   * disagreed. A loop nobody had picked up read "Nobody on it" here while the
   * engine had it routed to a named dispatcher.
   *
   * Claiming and being responsible are genuinely different facts:
   *
   *   responsible   who SHOULD be working this truck. Derived by the
   *                 Responsibility Engine from permissions, scope, asset and
   *                 work assignment, availability and delegation. Never stored
   *                 on this record — see `MtLoopCard.responsible`.
   *   claimed       who has SAID they have it. A person's own acceptance, with
   *                 an actor and a time. Absent means nobody has accepted it
   *                 yet, which is not the same as nobody being responsible.
   *
   * A claim is an input to the engine, not a competing answer: claiming writes
   * the canonical override, so the two cannot drift apart again.
   */
  claimedByMembershipId?: string;
  /** Snapshot, so an ended membership still reads sensibly in the history. */
  claimedByName?: string;
  /** When it was accepted. Absent whenever `claimedByMembershipId` is. */
  claimedAt?: IsoDateTime;

  /**
   * The committed rate confirmation behind the booked load, once there is one.
   *
   * Evidence, not a second copy: the record itself lives in the Rate
   * Confirmation module and this is the id to go and read. Its presence is what
   * distinguishes a cycle whose load is CONFIRMED from one whose load is merely
   * booked — the second is not finished and a dispatcher has to be able to see
   * which they are looking at.
   */
  rateConfirmationId?: string;
  rateConfirmationSignedAt?: IsoDateTime;

  /** When the truck goes — or went — empty. */
  expectedEmptyAt?: IsoDateTime;
  expectedEmptyCity?: string;
  expectedEmptyState?: string;

  /**
   * The availability decision this loop was last published from.
   *
   * The loop does not compute availability and does not own it: the decision
   * is made by the availability engine, from evidence across several modules,
   * and PUBLISHED here. What the loop keeps is the conclusion plus enough
   * provenance to argue with it — which state, on whose word, how sure, from
   * which adapter, and which operational cycle it was about.
   *
   * `cycleKey` is the important one. It is what stops one truck going empty
   * from producing two entries on this board: a second decision carrying the
   * same key is a re-reading of this loop, never a new loop.
   */
  availability?: MtLoopAvailability;

  status: MtLoopStatus;

  /** The load booked to close this cycle, once there is one. */
  loadId?: string;
  loadReference?: string;

  /** Set while the loop is blocked. Cleared when it is unblocked. */
  blockReason?: string;
  /**
   * Who put the block on.
   *
   * A block the system raised (expired paperwork, a truck sent to the shop)
   * lifts by itself the moment the cause is gone. A block a person put on does
   * not: only a person takes it off again, because only they know why it went
   * on. Collapsing the two is how a deliberate hold silently disappears.
   */
  blockOrigin?: "system" | "person";
  /** Set while the loop is paused. Cleared when it is resumed. */
  pauseReason?: string;
  pausedUntil?: IsoDateTime;

  /**
   * The service-level deadline: when a responsible person has to have moved
   * this on by. Derived from the expected empty time, never typed in.
   */
  respondBy?: IsoDateTime;

  openedAt: IsoDateTime;
  closedAt?: IsoDateTime;
  closeReason?: string;

  /** Every hand this loop has passed through, oldest first. Never rewritten. */
  assignments: MtLoopAssignment[];
  /** Everything that has happened to it, oldest first. Never rewritten. */
  history: MtLoopEvent[];
}

/**
 * An availability decision, as the loop keeps it.
 *
 * A snapshot, not a link: the decision itself is a value recomputed on every
 * read, and what belongs on the permanent loop record is what was concluded
 * and on what grounds at the moment it was published.
 */
export interface MtLoopAvailability {
  state: AvailabilityState;
  /** `confirmed` only when a person said so. Never reachable from GPS alone. */
  basis: AvailabilityBasis;
  confidence: number;
  /** The one operational cycle this loop is about. The deduplication key. */
  cycleKey: string;
  decidedAt: IsoDateTime;
  /** One sentence a dispatcher can act on without opening the evidence. */
  rationale: string;
  /** What would move this to Empty Confirmed. Absent once it is. */
  awaiting?: string;
  /** The adapter behind it, and whether that adapter is a mock. */
  sourceAdapter: string;
  sourceIsMock: boolean;
}

/**
 * Where a loop is in its cycle.
 *
 * Deliberately about the LOOP, not about the truck and not about the load. A
 * truck can be sitting still while its loop is `covered`, because the load is
 * booked and the driver is on their way to it.
 */
export type MtLoopStatus =
  /**
   * Open, and nobody has ACCEPTED it yet.
   *
   * Never "unassigned": somebody is responsible for every open loop — the
   * engine always produces an answer, even if that answer is the Owner by
   * fallback. This status says only that no person has put their hand up.
   */
  | "unclaimed"
  /** Somebody is responsible and is working out what to put on the truck. */
  | "working"
  /** A load has been booked onto the truck. The cycle has its answer. */
  | "covered"
  /** The booked load is under way. */
  | "running"
  /** Deliberately set aside by a person, with a reason. */
  | "paused"
  /** Stopped by a problem — paperwork, authority, equipment. Not a choice. */
  | "blocked"
  /** Finished. A closed loop is never reopened; the next cycle is a new loop. */
  | "closed";

export const MT_LOOP_STATUS_LABEL: Record<MtLoopStatus, string> = {
  // NOT "Nobody on it". Somebody is always responsible; nobody has accepted.
  unclaimed: "Not claimed",
  working: "Being worked",
  covered: "Covered",
  running: "Running",
  paused: "Paused",
  blocked: "Blocked",
  closed: "Closed",
};

/** The statuses that mean the cycle is still live. */
export const MT_LOOP_OPEN_STATUSES: readonly MtLoopStatus[] = [
  "unclaimed", "working", "covered", "running", "paused", "blocked",
];

export const isMtLoopOpen = (loop: MtLoop) => loop.status !== "closed";

/**
 * One person's spell of responsibility for a loop.
 *
 * Kept as its own dated record rather than a field that gets overwritten,
 * because "who has it now" and "who has had it" are different questions. A
 * reassignment ends one of these and opens another; it never edits the first,
 * so a handoff three days ago is still readable after four more.
 *
 * It points at a MEMBERSHIP, never a user: the same person holding loops in two
 * workspaces holds them as two different memberships, and neither workspace
 * learns about the other.
 */
export interface MtLoopAssignment {
  id: string;
  loopId: string;
  membershipId: string;
  /** Snapshot, so an ended membership still reads sensibly. */
  assigneeName: string;
  assignedAt: IsoDateTime;
  /** The membership that handed it over. Equal to `membershipId` on a claim. */
  assignedByMembershipId: string;
  assignedByName: string;
  endedAt?: IsoDateTime;
  endReason?: string;
}

/** Everything a person — or the system — can do to a loop. */
export type MtLoopAction =
  | "opened"
  | "claimed"
  | "assigned"
  | "reassigned"
  | "released"
  | "paused"
  | "resumed"
  | "blocked"
  | "unblocked"
  | "closed"
  | "load_booked"
  /** The booked load's rate confirmation came back signed. */
  | "load_confirmed"
  | "load_released"
  | "availability_changed";

export const MT_LOOP_ACTION_LABEL: Record<MtLoopAction, string> = {
  opened: "Loop opened",
  claimed: "Claimed",
  assigned: "Assigned",
  reassigned: "Reassigned",
  released: "Handed back",
  paused: "Paused",
  resumed: "Resumed",
  blocked: "Blocked",
  unblocked: "Unblocked",
  closed: "Closed",
  load_booked: "Load booked",
  load_confirmed: "Load confirmed",
  load_released: "Load released",
  availability_changed: "Availability changed",
};

/** One line of a loop's history. Append-only. */
export interface MtLoopEvent {
  id: string;
  loopId: string;
  at: IsoDateTime;
  action: MtLoopAction;
  /** Absent when the system did it rather than a person. */
  actorMembershipId?: string;
  actorName: string;
  note?: string;
  fromStatus?: MtLoopStatus;
  toStatus?: MtLoopStatus;
}

/* -------------------------------------------------------------------------- */
/* The board                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The canonical answer, as a card carries it.
 *
 * `assignmentState` is the responsibility layer's own vocabulary and is passed
 * through unchanged rather than re-worded here, so "Owner fallback" means the
 * same thing on the MT Loop board as it does in Needs You.
 */
export interface MtLoopResponsible {
  membershipId: string;
  displayName: string;
  /** Why they hold it — routed, delegated, chosen by a person, fallback. */
  source: AssignmentSource;
  assignmentState: AssignmentState;
  /** True when nobody in the workspace can do this at all. */
  noEligibleAssignee: boolean;
}

/** One person's recorded acceptance of a loop. */
export interface MtLoopClaim {
  membershipId: string;
  displayName: string;
  at: IsoDateTime;
  /** True when the viewer is the one who accepted it. */
  isMine: boolean;
}

/**
 * What the dashboard shows for one loop.
 *
 * A projection, like FleetTruck: it is what THIS membership may see of the
 * loop, not the loop. Two dispatchers in one organization get two different
 * projections of one record — the difference is `isMine` and what they may do —
 * and a membership in another workspace gets nothing at all.
 */
export interface MtLoopCard {
  loopId: string;
  truckId: string;
  truckUnit: string;
  equipment: TruckEquipmentType;
  carrierName: string;
  status: MtLoopStatus;
  driverName?: string;
  trailerUnit?: string;
  trailerRequired: boolean;
  /**
   * ★ CANONICAL. Who is responsible for covering this truck. ★
   *
   * Derived on every read from the Responsibility service — the same answer
   * `/work`, Needs You and Home show, because it is literally the same call.
   * MT Loop stores nothing about it and decides nothing about it.
   *
   * Absent only when the responsibility layer could not be read at all, which
   * the screen reports rather than papering over with "nobody".
   */
  responsible?: MtLoopResponsible;
  /**
   * Operational acceptance. A different fact, and never an answer to "who is
   * responsible for this truck".
   *
   * Absent means nobody has put their hand up yet. It does NOT mean the loop
   * has no owner — read `responsible` for that.
   */
  claimed?: MtLoopClaim;
  /** True when the viewer's own membership is the canonical responsible. */
  isMine: boolean;
  expectedEmptyAt?: IsoDateTime;
  expectedEmptyCity?: string;
  expectedEmptyState?: string;
  /** True when the expected empty time has already passed. */
  emptyNow: boolean;
  /** The published availability decision, where one has been made. */
  availability?: MtLoopAvailability;
  respondBy?: IsoDateTime;
  loadReference?: string;
  blockReason?: string;
  pauseReason?: string;
  openedAt: IsoDateTime;
  /** How many hands this loop has passed through, this one included. */
  handoffCount: number;

  /* -- Derived on every read. Nothing below is stored. ------------------- */

  /** Where the truck is in this cycle. See `MtLoopStage`. */
  stage: MtLoopStage;
  /** The facts behind the stage, so a dispatcher can argue with it. */
  evidence: MtLoopEvidence[];
  /** The one next thing, or absent when there is honestly nothing to do. */
  nextAction?: MtLoopNextAction;
  /** Everything unresolved standing in the cycle's way. */
  blockers: MtLoopBlocker[];

  /** What this viewer may actually do to it, decided by the service. */
  can: MtLoopAbilities;
}

/**
 * What one membership may do to one loop, worked out beside the records.
 *
 * The screen renders buttons from this and makes no judgements of its own. Each
 * flag is still re-checked inside the mutation, so a stale board cannot be used
 * to do something the person may not do.
 */
export interface MtLoopAbilities {
  claim: boolean;
  assign: boolean;
  reassign: boolean;
  pause: boolean;
  resume: boolean;
  block: boolean;
  unblock: boolean;
  close: boolean;
}

/* -------------------------------------------------------------------------- */
/* The cycle, as a dispatcher reads it                                         */
/* -------------------------------------------------------------------------- */

/**
 * Where this truck is in its empty-to-empty cycle.
 *
 * Deliberately NOT the same thing as `MtLoopStatus`. Status is about the WORK —
 * has somebody picked this up, is it paused, is it stopped. Stage is about the
 * TRUCK's progress through one cycle, which is what a dispatcher scanning a board
 * at 6am is actually asking. A loop can be `working` (somebody is on it) and
 * `finding_work` (no load yet) at the same time, and collapsing the two loses the
 * distinction between "nobody is looking" and "somebody is looking and has not
 * found anything".
 *
 * Derived on every read from the truck, the load, the committed rate confirmation
 * and the driver post. Nothing stores it.
 */
export type MtLoopStage =
  /** Still on a load, with a known time it comes free. */
  | "going_empty"
  /**
   * Empty, and nobody has ACCEPTED the cycle.
   *
   * Somebody is still responsible for it — read `MtLoopCard.responsible`. The
   * distinction this stage draws is whether a person has put their hand up,
   * because a truck whose owner has not started on it is the one worth
   * showing first.
   */
  | "empty_unworked"
  /** Somebody has accepted it and has not found work yet. */
  | "finding_work"
  /** A load is booked but its rate confirmation is not signed and returned. */
  | "booked_unconfirmed"
  /** The rate confirmation is committed. The load is final. */
  | "confirmed"
  /** The driver has the post and is heading for the pickup. */
  | "dispatched"
  /** Loaded and moving. The cycle ends when it is empty again. */
  | "running"
  /** Set aside by a person, or stopped by a problem. */
  | "stopped";

export const MT_LOOP_STAGE_LABEL: Record<MtLoopStage, string> = {
  going_empty: "Going empty",
  // NOT "Empty, nobody on it": every open loop has a responsible party, and
  // the card names them on the line below this badge.
  empty_unworked: "Empty, not claimed",
  finding_work: "Finding work",
  booked_unconfirmed: "Booked, not confirmed",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  running: "Running",
  stopped: "Stopped",
};

/** In cycle order, for a board that groups by stage. */
export const MT_LOOP_STAGE_ORDER: readonly MtLoopStage[] = [
  "stopped", "empty_unworked", "going_empty", "finding_work",
  "booked_unconfirmed", "confirmed", "dispatched", "running",
];

/**
 * One fact behind the stage, with how much it is worth.
 *
 * Evidence is the answer to "why does the board say that". A stage asserted with
 * nothing behind it is a stage a dispatcher cannot argue with, and the whole
 * reason the availability engine keeps provenance is so they can.
 */
export interface MtLoopEvidence {
  /** Short, e.g. "Empty", "Rate confirmation", "Trailer". */
  label: string;
  /** The fact itself, in a sentence. */
  detail: string;
  /** Confirmed, inferred, corrected, pending — kept visibly distinct. */
  verification: FactVerification;
  /** When it was observed, not when it was written up. */
  observedAt?: IsoDateTime;
  /** Where to go and read the record behind it. */
  href?: string;
}

/**
 * What to do next, as one thing rather than a menu.
 *
 * `undefined` means there is genuinely nothing to do — the loop is running and
 * waiting on the road — which is a better answer than inventing busywork.
 */
export interface MtLoopNextAction {
  label: string;
  /** Deep link straight to where it is done. Never a dashboard. */
  href: string;
  /** Why this is the next thing, for a dispatcher who disagrees. */
  reason: string;
  /** What the viewer needs to hold to do it. The board renders accordingly. */
  requires: readonly string[];
  /** True when the viewer cannot do it themselves and must hand it on. */
  notYours?: boolean;
}

/**
 * Something standing in the cycle's way that nobody has cleared.
 *
 * Separate from `blockReason`, which is the single reason the loop is in the
 * `blocked` STATUS. A cycle can be perfectly workable and still have two
 * unresolved problems on it — an expired trailer inspection and no driver — and a
 * board that shows only the one that stopped it hides the other.
 */
export interface MtLoopBlocker {
  /** Stable within a loop, so it can be listed and deep-linked. */
  key: string;
  label: string;
  detail: string;
  /** Whether this alone prevents the truck being dispatched. */
  stopsDispatch: boolean;
  /** Straight to where it is fixed. */
  href?: string;
}

/** The MT Loop section of the dispatch dashboard. */
export interface MtLoopBoard {
  loops: MtLoopCard[];
  counts: {
    open: number;
    /** Open loops nobody has ACCEPTED. Every one still has a responsible party. */
    unclaimed: number;
    mine: number;
    blocked: number;
    paused: number;
    /** Loops whose truck is empty now, or goes empty inside the hour. */
    emptyNow: number;
  };
  /**
   * Somebody the viewer may hand a loop to. Absent in a workspace of one —
   * which is a different statement from "there is nobody available".
   */
  assignableTo?: Array<{ membershipId: string; name: string }>;
}
