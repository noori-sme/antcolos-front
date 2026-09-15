import type { IsoDateTime } from "./common";
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
   * The membership responsible for this loop right now. Absent means nobody has
   * picked it up — which is a problem to be surfaced, not an empty column.
   */
  responsibleMembershipId?: string;
  /** Snapshot, so an ended membership still reads sensibly in the history. */
  responsibleName?: string;

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
  /** Open, and nobody has taken responsibility for it yet. */
  | "unassigned"
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
  unassigned: "Nobody on it",
  working: "Being worked",
  covered: "Covered",
  running: "Running",
  paused: "Paused",
  blocked: "Blocked",
  closed: "Closed",
};

/** The statuses that mean the cycle is still live. */
export const MT_LOOP_OPEN_STATUSES: readonly MtLoopStatus[] = [
  "unassigned", "working", "covered", "running", "paused", "blocked",
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
  responsibleName?: string;
  responsibleMembershipId?: string;
  /** True when the viewer's own membership is responsible. */
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

/** The MT Loop section of the dispatch dashboard. */
export interface MtLoopBoard {
  loops: MtLoopCard[];
  counts: {
    open: number;
    unassigned: number;
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
