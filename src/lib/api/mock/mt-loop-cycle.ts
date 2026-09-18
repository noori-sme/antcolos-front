import type {
  CarrierView, DriverView, FleetTruck, MtLoop, MtLoopBlocker, MtLoopEvidence,
  MtLoopNextAction, MtLoopStage,
} from "@/types";
import { CARRIER_DOCUMENT_LABEL } from "@/types";
import { rateConfirmationForLoad } from "./rate-confirmation-record";
import { driverWorkflowStore } from "./driver-workflow-store";
import { truckDocumentProblems } from "./truck-registry";
import { DOCUMENT_LABEL } from "@/lib/fleet/equipment";
import { mockStore } from "./store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The empty-to-empty cycle, read off the records.
 *
 * MT Loop is meant to be one of the two surfaces a day's work actually happens
 * on, which means a card has to answer four questions without the dispatcher
 * opening anything: where is this truck in its cycle, what makes us say so, what
 * is the next thing, and what is standing in the way.
 *
 * Every answer here is DERIVED on read from records other modules own — the
 * truck, the load, the committed rate confirmation, the driver post, the
 * document requirements. Nothing in this file is stored, and nothing in it is a
 * second source of truth. Fix the underlying record and the card follows, which
 * is the same property that makes Needs You self-correcting.
 */

/* -------------------------------------------------------------------------- */
/* Stage                                                                       */
/* -------------------------------------------------------------------------- */

/** One entry of `driverDocumentProblems`, without importing the registry for it. */
export interface DriverDocumentProblem {
  requirementKey: string;
  label: string;
  status: string;
  expiresAt?: string;
  rejectionReason?: string;
}

/**
 * What it takes to work out everything standing in a truck's way.
 *
 * ★ THE LOOP IS OPTIONAL, AND THAT IS THE POINT ★
 * A truck with no open cycle still has an expired registration and a driver
 * whose medical card lapsed. Its dispatch workspace is reachable directly, and
 * before this type existed that page computed a second, private blocker list of
 * its own so it could say something on those trucks. Making the loop optional
 * here is what let that second list be deleted: one function answers for a truck
 * whether or not a cycle is open on it, and both screens ask it.
 */
export interface BlockerInput {
  loop?: MtLoop;
  truck?: FleetTruck;
  /**
   * The carrier whose authority the truck runs under, AS THIS VIEWER MAY SEE IT.
   *
   * A scoped projection, never the registry record: a dispatch workspace that
   * may not read a carrier's paperwork must not be handed a blocker naming it.
   * Absent means "not established or not visible", which is why nothing below
   * treats its absence as "the carrier is fine".
   */
  carrier?: CarrierView;
  /** The driver on the truck, as this viewer may see them. Same rule. */
  driver?: DriverView;
  /** Computed from `driver` by its own registry, which knows what is required. */
  driverProblems?: readonly DriverDocumentProblem[];
  /**
   * Whether a trailer is hooked up. Only consulted when there is no loop to read
   * it from — a loop carries its own `trailerId`.
   */
  trailerAttached?: boolean;
  responsibleName?: string;
}

export interface CycleInput extends BlockerInput {
  loop: MtLoop;
  truck?: FleetTruck;
  /** Whether a committed rate confirmation exists for the booked load. */
  confirmed: boolean;
  /** Whether a Driver Load Post exists, i.e. the driver has the work. */
  hasPost: boolean;
  /**
   * Who the Responsibility Engine says is responsible for this loop.
   *
   * Handed in rather than read off the loop, because the loop does not know:
   * it stores who ACCEPTED the cycle, and that is a different question. Absent
   * only when the responsibility layer could not be read.
   */
  responsibleName?: string;
}

/**
 * Where the truck is in this cycle.
 *
 * Order matters. `stopped` wins because a paused or blocked cycle is not
 * progressing whatever else is true of it, and showing "Finding work" on a truck
 * nobody may dispatch is the kind of thing that gets a load booked onto an
 * out-of-service tractor.
 */
export function stageOf(input: CycleInput): MtLoopStage {
  const { loop } = input;
  if (loop.status === "blocked" || loop.status === "paused") return "stopped";
  if (loop.status === "running") return "running";

  if (loop.loadId) {
    if (input.hasPost) return "dispatched";
    return input.confirmed ? "confirmed" : "booked_unconfirmed";
  }

  // No load yet. The question is whether the truck is free and whether anybody
  // is on it.
  const emptyAt = loop.expectedEmptyAt ? Date.parse(loop.expectedEmptyAt) : undefined;
  const emptyNow = emptyAt === undefined ? true : emptyAt <= Date.now();
  if (!emptyNow) return "going_empty";
  return loop.claimedByMembershipId ? "finding_work" : "empty_unworked";
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

const ago = (iso?: string) => iso;

/**
 * The facts behind the stage.
 *
 * Each one carries its verification state, because "GPS thinks this truck is
 * empty" and "the driver said this truck is empty" are different claims and a
 * dispatcher acts on them differently. That distinction already exists in the
 * availability engine; this surfaces it on the card instead of two screens away.
 */
export function evidenceFor(input: CycleInput): MtLoopEvidence[] {
  const { loop, truck } = input;
  const out: MtLoopEvidence[] = [];

  if (loop.availability) {
    out.push({
      label: "Empty",
      detail: `${loop.availability.rationale}${loop.availability.sourceIsMock ? ` (${loop.availability.sourceAdapter}, a mock adapter)` : ""}`,
      // The availability engine's own distinction, carried through rather than
      // flattened: `confirmed` is only ever reachable from a person saying so,
      // and GPS alone can never produce it.
      verification: loop.availability.basis === "confirmed" ? "confirmed" : "inferred",
      observedAt: ago(loop.availability.decidedAt),
      href: `/dispatch/trucks/${loop.truckId}`,
    });
  } else if (loop.expectedEmptyAt) {
    out.push({
      label: "Empty",
      detail: `Expected free${loop.expectedEmptyCity ? ` in ${loop.expectedEmptyCity}, ${loop.expectedEmptyState}` : ""}. No availability decision has been published.`,
      verification: "pending",
      observedAt: ago(loop.expectedEmptyAt),
    });
  }

  if (loop.trailerRequired) {
    out.push(
      loop.trailerUnit
        ? {
          label: "Trailer",
          detail: `${loop.trailerUnit} is on the truck.`,
          verification: "confirmed",
          href: `/fleet/trailers/${loop.trailerId}`,
        }
        : {
          label: "Trailer",
          detail: "This truck needs a trailer and has none.",
          verification: "failed",
        },
    );
  }

  out.push(
    loop.driverName
      ? {
        label: "Driver",
        detail: `${loop.driverName} is on the truck.`,
        verification: "confirmed",
        href: `/people/drivers/${loop.driverProfileId}`,
      }
      : {
        label: "Driver",
        detail: "Nobody is on this truck.",
        verification: "pending",
      },
  );

  if (loop.loadId) {
    out.push({
      label: "Load",
      detail: `${loop.loadReference ?? "A load"} is booked onto this truck.`,
      verification: "confirmed",
      href: `/loads/${loop.loadId}`,
    });
    out.push(
      loop.rateConfirmationId
        ? {
          label: "Rate confirmation",
          detail: `Signed with the carrier's authorized signature and returned to the broker.`,
          verification: "confirmed",
          observedAt: loop.rateConfirmationSignedAt,
          href: `/loads/${loop.loadId}`,
        }
        : {
          label: "Rate confirmation",
          detail: "Booked, but no signed confirmation has come back. This cycle is not finished.",
          verification: "pending",
        },
    );
  }

  if (truck && truck.status) {
    out.push({
      label: "Truck",
      detail: `The fleet records read ${truck.status.replace(/_/g, " ")}.`,
      verification: "confirmed",
      href: `/fleet/trucks/${loop.truckId}`,
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Blockers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything unresolved standing in this cycle's way.
 *
 * Deliberately a LIST, not the one reason the loop is in the `blocked` status. A
 * cycle can be perfectly workable and still have an expired trailer inspection
 * and no driver on it, and a board showing only whichever one stopped it hides
 * the other until the first is fixed.
 */
export function blockersFor(input: BlockerInput): MtLoopBlocker[] {
  // The truck's own operational status is deliberately not read here: the loop's
  // reconciliation already turns "in the shop" and "unavailable" into
  // `blockReason`, and reading it again would list the same problem twice.
  const { loop, truck, carrier, driver } = input;
  const out: MtLoopBlocker[] = [];

  const truckId = loop?.truckId ?? truck?.truckId;
  const unit = loop?.truckUnit ?? truck?.unit ?? "this truck";

  /* ---- The cycle's own state. Only a loop has one. ---- */

  if (loop?.blockReason) {
    out.push({
      key: "loop_blocked",
      label: loop.blockOrigin === "system" ? "Stopped by the records" : "Stopped by a person",
      detail: loop.blockReason,
      // A block the records raised is the carrier's to clear; one a person put
      // on is the workspace's own hold, and only a person takes it off again.
      owner: loop.blockOrigin === "system" ? "carrier" : "dispatcher",
      severity: "critical",
      stopsDispatch: true,
      href: loop.blockOrigin === "system" && truckId ? `/fleet/trucks/${truckId}` : undefined,
    });
  }

  if (loop?.pauseReason) {
    out.push({
      key: "loop_paused",
      label: "Paused",
      detail: loop.pauseReason,
      owner: "dispatcher",
      severity: "medium",
      stopsDispatch: false,
    });
  }

  /* ---- The carrier whose authority the truck runs under ---- */

  if (carrier && !carrier.canHaul) {
    out.push({
      key: "carrier_authority",
      label: "Operating authority",
      detail:
        carrier.authority.note
        ?? `${carrier.displayName}'s operating authority is ${carrier.authority.status.replace(/_/g, " ")}. Nothing should be booked on this carrier's trucks until it is confirmed.`,
      owner: "carrier",
      severity: "critical",
      stopsDispatch: true,
    });
  }

  for (const doc of carrier?.documents ?? []) {
    if (doc.status !== "expired" && doc.status !== "missing") continue;
    out.push({
      key: `carrier_document:${doc.kind}`,
      label: "Carrier paperwork",
      detail:
        doc.status === "missing"
          ? `${carrier!.displayName} has no ${CARRIER_DOCUMENT_LABEL[doc.kind]} on file, so there is nothing to check against.`
          : `${carrier!.displayName}'s ${CARRIER_DOCUMENT_LABEL[doc.kind]} lapsed${doc.expiresAt ? ` (${doc.expiresAt.slice(0, 10)})` : ""}.`,
      owner: "carrier",
      // Insurance is the one that stops everything; the rest are serious.
      severity: doc.kind === "certificate_of_insurance" ? "critical" : "high",
      stopsDispatch: true,
    });
  }

  /* ---- The truck's own paperwork ---- */

  // Document problems come from the truck registry's own rules, not from a
  // second opinion held here.
  for (const problem of truckId ? truckDocumentProblems(truckId) : []) {
    // Expired and rejected stop a truck; expiring soon is a warning. The truck
    // registry decides which status is which — this only reads it.
    const stops = problem.status === "expired" || problem.status === "rejected";
    out.push({
      key: `truck_document:${problem.kind}`,
      label: "Truck paperwork",
      detail: `${DOCUMENT_LABEL[problem.kind] ?? problem.kind} is ${problem.status.replace(/_/g, " ")}${problem.expiresAt ? ` (${problem.expiresAt.slice(0, 10)})` : ""}.${problem.rejectionReason ? ` ${problem.rejectionReason}` : ""}`,
      owner: "carrier",
      severity: stops ? "high" : "medium",
      stopsDispatch: stops,
      href: truckId ? `/dispatch/trucks/${truckId}` : undefined,
    });
  }

  /* ---- The equipment ---- */

  const trailerRequired = loop ? loop.trailerRequired : truck?.equipment === "tractor";
  const trailerAttached = loop ? Boolean(loop.trailerId) : Boolean(input.trailerAttached);
  if (trailerRequired && !trailerAttached) {
    out.push({
      key: "no_trailer",
      label: "No trailer",
      detail: `Unit ${unit} is a tractor and has no trailer on it. It cannot be dispatched.`,
      owner: "dispatcher",
      severity: "medium",
      stopsDispatch: true,
      href: `/fleet/trailers`,
    });
  }

  /* ---- The person ---- */

  // The ID, not the view: a driver this viewer may not READ is not the same
  // thing as a truck with nobody on it, and saying "nobody is on unit 118"
  // about somebody's colleague is worse than saying nothing.
  const driverId = loop?.driverProfileId ?? truck?.currentDriverId;
  if (!driverId) {
    out.push({
      key: "no_driver",
      label: "No driver",
      detail: `Nobody is on unit ${unit}. A load cannot be dispatched, and no Driver Load Post can be published.`,
      owner: "carrier",
      severity: "medium",
      stopsDispatch: true,
      href: `/people/drivers`,
    });
  }

  for (const problem of input.driverProblems ?? []) {
    // Expiring soon is a warning the driver's own profile carries. Only what has
    // actually lapsed or been rejected stops a dispatch.
    if (problem.status === "expiring_soon" || problem.status === "approved") continue;
    out.push({
      key: `driver_document:${problem.requirementKey}`,
      label: "Driver paperwork",
      detail: `${driver?.legalName ?? "The driver"}'s ${problem.label.toLowerCase()} ${
        problem.status === "rejected" ? "was rejected" : problem.status === "expired" ? "has expired" : "is missing"
      }.${problem.rejectionReason ? ` ${problem.rejectionReason}` : ""}`,
      owner: "driver",
      severity: "high",
      stopsDispatch: true,
    });
  }

  if (driver?.availability.status === "inactive") {
    out.push({
      key: "driver_inactive",
      label: "Driver not working",
      detail: `${driver.legalName} is not working. The truck needs a driver before anything can be booked on it.`,
      owner: "carrier",
      severity: "high",
      stopsDispatch: true,
    });
  }

  /* ---- The load on the cycle ---- */

  if (loop?.loadId && !loop.rateConfirmationId) {
    out.push({
      key: "unconfirmed_load",
      label: "Rate confirmation outstanding",
      detail: `${loop.loadReference ?? "The booked load"} has no signed rate confirmation back from the broker. Until it does, the load is not final and the driver has nothing to run.`,
      owner: "dispatcher",
      severity: "high",
      stopsDispatch: true,
      // The truck's own dispatch workspace, which is where THIS cycle's rate
      // confirmation panel is. There is no rate-confirmation index route, and
      // linking to one that does not exist is worse than linking one level up.
      href: truckId ? `/dispatch/trucks/${truckId}` : undefined,
    });
  }

  // Paperwork the load still owes. Not a dispatch blocker — a truck can roll
  // without a POD — but it is what stops the load being billed, and a cycle that
  // ends with an unbillable load is not a cycle that paid for itself.
  for (const kind of loop ? loadMissingDocuments(loop.dispatchOrganizationId, loop.loadId) : []) {
    out.push({
      key: `load_document:${kind}`,
      label: "Paperwork outstanding",
      detail: `${loop!.loadReference ?? "The load"} still owes ${kind.replace(/_/g, " ")} before it can be invoiced.`,
      owner: "dispatcher",
      severity: "medium",
      stopsDispatch: false,
      href: loop!.loadId ? `/loads/${loop!.loadId}` : undefined,
    });
  }

  if (loop && !loop.claimedByMembershipId) {
    out.push({
      key: "unclaimed",
      // NOT "Nobody on it". Somebody is responsible for every open loop; what
      // is missing is a person saying they have accepted it.
      label: "Not claimed",
      detail: input.responsibleName
        ? `${input.responsibleName} is responsible for unit ${unit}'s cycle and has not accepted it yet.`
        : `Nobody has accepted unit ${unit}'s cycle yet.`,
      owner: "dispatcher",
      severity: "medium",
      stopsDispatch: false,
    });
  }

  // Hardest first, so a page can lead with the one that means nothing can move.
  // `sort` is stable, so entries of equal severity keep the order above.
  const ORDER = { critical: 0, high: 1, medium: 2 } as const;
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/* -------------------------------------------------------------------------- */
/* Next action                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The one next thing, deep-linked.
 *
 * One, not a menu: a board that offers six options at every stage is a board
 * nobody can work from. Where the next thing is genuinely somebody else's, the
 * action says so through `notYours` rather than offering a button that will be
 * refused.
 */
export function nextActionFor(
  input: CycleInput,
  viewer: {
    /** The canonical responsible party is the viewer. */
    isMine: boolean;
    /** Anybody has accepted it. */
    claimed: boolean;
    /** The viewer is the one who accepted it. */
    claimedByMe: boolean;
    /** Who the engine says is responsible, for copy that names them. */
    responsibleName?: string;
  },
): MtLoopNextAction | undefined {
  const { loop } = input;
  const stage = stageOf(input);
  const blockers = blockersFor(input);
  const stopping = blockers.find((b) => b.stopsDispatch && b.key !== "unconfirmed_load");

  // A problem that stops dispatch outranks everything. Finding work for a truck
  // that may not legally move is wasted effort.
  if (stopping) {
    return {
      label: `Fix: ${stopping.label.toLowerCase()}`,
      href: stopping.href ?? `/dispatch/trucks/${loop.truckId}`,
      reason: stopping.detail,
      requires: ["trucks:view"],
    };
  }

  switch (stage) {
    case "stopped":
      return loop.status === "paused"
        ? {
          label: "Resume the cycle",
          href: "/home",
          reason: loop.pauseReason ?? "It was set aside by a person.",
          requires: ["loads:assign"],
          notYours: !viewer.isMine,
        }
        : undefined;

    case "empty_unworked":
      return {
        label: viewer.isMine ? "Take this cycle" : "Take this cycle",
        href: "/home",
        // "Nobody has picked it up" is true. "Nobody is on it" was not, and
        // that is what this used to imply — the loop has a responsible party
        // whether or not anybody has put their hand up, so the copy names them.
        reason: viewer.responsibleName
          ? `Unit ${loop.truckUnit} is empty. ${viewer.responsibleName} is responsible for it and nobody has accepted it yet.`
          : `Unit ${loop.truckUnit} is empty and nobody has accepted it yet.`,
        requires: ["trucks:view"],
        notYours: !viewer.isMine,
      };

    case "going_empty":
    case "finding_work":
      return {
        label: "Find work for it",
        href: `/dispatch/trucks/${loop.truckId}`,
        reason: loop.expectedEmptyAt
          ? `Unit ${loop.truckUnit} is free from ${new Date(loop.expectedEmptyAt).toISOString().slice(0, 16).replace("T", " ")}.`
          : `Unit ${loop.truckUnit} is empty and has no load.`,
        requires: ["loads:view"],
        notYours: !viewer.isMine,
      };

    case "booked_unconfirmed":
      return {
        label: "Check the rate confirmation",
        href: `/dispatch/trucks/${loop.truckId}`,
        reason: `${loop.loadReference ?? "The booked load"} is not final until the confirmation is reviewed, signed and returned to the broker.`,
        requires: ["loads:create"],
        notYours: !viewer.isMine,
      };

    case "confirmed":
      return {
        label: "Open broker tracking",
        href: `/dispatch/tracking/${loop.loadId}`,
        reason: `${loop.loadReference ?? "The load"} is confirmed. Opening tracking is what the broker will ask for next, and it is a person's decision because it discloses the truck's position.`,
        requires: ["tracking:share"],
        notYours: !viewer.isMine,
      };

    case "dispatched":
      return {
        label: "Watch the trip",
        href: `/dispatch/tracking/${loop.loadId}`,
        reason: `${loop.driverName ?? "The driver"} has the load and is heading for the pickup.`,
        requires: ["tracking:view"],
      };

    case "running":
      // Nothing to do. Inventing busywork for a moving truck is how a board
      // stops meaning anything.
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Assembling the input                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Read the two cross-module facts the cycle depends on.
 *
 * Kept in one function so the board does not learn how to read the rate
 * confirmation store or the driver workflow store — it asks this, and this asks
 * them through their own readers.
 */
export function cycleInputFor(
  loop: MtLoop,
  truck?: FleetTruck,
  responsibleName?: string,
): CycleInput {
  const confirmed = loop.loadId
    ? rateConfirmationForLoad(loop.dispatchOrganizationId, loop.loadId) !== undefined
    : false;

  let hasPost = false;
  if (loop.loadId) {
    try {
      hasPost = driverWorkflowStore.org(loop.dispatchOrganizationId)
        .postByLoad.has(loop.loadId);
    } catch {
      // An organization with no driver workflow data has no posts. Not an error.
      hasPost = false;
    }
  }

  return { loop, truck, confirmed, hasPost, responsibleName };
}

/** Whether the load still owes required paperwork, for a blocker line. */
export function loadMissingDocuments(organizationId: string, loadId?: string): string[] {
  if (!loadId) return [];
  try {
    const load = mockStore.org(organizationId).loads.find((l) => l.id === loadId);
    return (load?.documentRequirements ?? [])
      .filter((r) => r.required && !r.satisfiedByDocumentId)
      .map((r) => r.kind);
  } catch {
    return [];
  }
}
