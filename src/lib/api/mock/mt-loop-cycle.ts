import type {
  FleetTruck, MtLoop, MtLoopBlocker, MtLoopEvidence, MtLoopNextAction,
  MtLoopStage,
} from "@/types";
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

export interface CycleInput {
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
export function blockersFor(input: CycleInput): MtLoopBlocker[] {
  // The truck's own operational status is deliberately not read here: the loop's
  // reconciliation already turns "in the shop" and "unavailable" into
  // `blockReason`, and reading it again would list the same problem twice.
  const { loop } = input;
  const out: MtLoopBlocker[] = [];

  if (loop.blockReason) {
    out.push({
      key: "loop_blocked",
      label: loop.blockOrigin === "system" ? "Stopped by the records" : "Stopped by a person",
      detail: loop.blockReason,
      stopsDispatch: true,
      href: loop.blockOrigin === "system" ? `/fleet/trucks/${loop.truckId}` : undefined,
    });
  }

  if (loop.pauseReason) {
    out.push({
      key: "loop_paused",
      label: "Paused",
      detail: loop.pauseReason,
      stopsDispatch: false,
    });
  }

  // Document problems come from the truck registry's own rules, not from a
  // second opinion held here.
  for (const problem of truckDocumentProblems(loop.truckId)) {
    // Expired and rejected stop a truck; expiring soon is a warning. The truck
    // registry decides which status is which — this only reads it.
    const stops = problem.status === "expired" || problem.status === "rejected";
    out.push({
      key: `truck_document:${problem.kind}`,
      label: "Truck paperwork",
      detail: `${DOCUMENT_LABEL[problem.kind] ?? problem.kind} is ${problem.status.replace(/_/g, " ")}${problem.expiresAt ? ` (${problem.expiresAt.slice(0, 10)})` : ""}.${problem.rejectionReason ? ` ${problem.rejectionReason}` : ""}`,
      stopsDispatch: stops,
      href: `/dispatch/trucks/${loop.truckId}`,
    });
  }

  if (loop.trailerRequired && !loop.trailerId) {
    out.push({
      key: "no_trailer",
      label: "No trailer",
      detail: `Unit ${loop.truckUnit} is a tractor and has no trailer on it. It cannot be dispatched.`,
      stopsDispatch: true,
      href: `/fleet/trailers`,
    });
  }

  if (!loop.driverProfileId) {
    out.push({
      key: "no_driver",
      label: "No driver",
      detail: `Nobody is on unit ${loop.truckUnit}. A load cannot be dispatched, and no Driver Load Post can be published.`,
      stopsDispatch: true,
      href: `/people/drivers`,
    });
  }

  if (loop.loadId && !loop.rateConfirmationId) {
    out.push({
      key: "unconfirmed_load",
      label: "Rate confirmation outstanding",
      detail: `${loop.loadReference ?? "The booked load"} has no signed rate confirmation back from the broker. Until it does, the load is not final and the driver has nothing to run.`,
      stopsDispatch: true,
      // The truck's own dispatch workspace, which is where THIS cycle's rate
      // confirmation panel is. There is no rate-confirmation index route, and
      // linking to one that does not exist is worse than linking one level up.
      href: `/dispatch/trucks/${loop.truckId}`,
    });
  }

  // Paperwork the load still owes. Not a dispatch blocker — a truck can roll
  // without a POD — but it is what stops the load being billed, and a cycle that
  // ends with an unbillable load is not a cycle that paid for itself.
  for (const kind of loadMissingDocuments(loop.dispatchOrganizationId, loop.loadId)) {
    out.push({
      key: `load_document:${kind}`,
      label: "Paperwork outstanding",
      detail: `${loop.loadReference ?? "The load"} still owes ${kind.replace(/_/g, " ")} before it can be invoiced.`,
      stopsDispatch: false,
      href: loop.loadId ? `/loads/${loop.loadId}` : undefined,
    });
  }

  if (!loop.claimedByMembershipId) {
    out.push({
      key: "unclaimed",
      // NOT "Nobody on it". Somebody is responsible for every open loop; what
      // is missing is a person saying they have accepted it.
      label: "Not claimed",
      detail: input.responsibleName
        ? `${input.responsibleName} is responsible for unit ${loop.truckUnit}'s cycle and has not accepted it yet.`
        : `Nobody has accepted unit ${loop.truckUnit}'s cycle yet.`,
      stopsDispatch: false,
    });
  }

  return out;
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
