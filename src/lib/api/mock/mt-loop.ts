import type {
  AvailabilityDecision, AvailabilityPublication, FleetTruck, Membership, MtLoop,
  MtLoopAbilities, MtLoopAction, MtLoopAssignment, MtLoopAvailability, MtLoopBoard,
  MtLoopCard, MtLoopEvent, MtLoopStatus, Organization, TruckDocumentKind, Workspace,
} from "@/types";
import { AVAILABILITY_STATE_LABEL } from "@/types";
import { isPublishableAvailability } from "@/lib/tracking";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import type { ServiceContext } from "../contracts/context";
import { mockStore } from "./store";
import {
  fleetSync, truckCarrierFor, truckContextFrom, truckDispatchGrants,
  truckDocumentProblems, truckOperatingCarrier, truckApprovedCarriers,
} from "./truck-registry";
import { trailerFleetSync } from "./trailer-registry";
import { nowIso } from "./time";
import {
  blockersFor, cycleInputFor, evidenceFor, nextActionFor, stageOf,
} from "./mt-loop-cycle";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The MT Loop service.
 *
 * An MT Loop is one truck's cycle between loads: it opens when the truck
 * becomes Expected Available or Available, and it closes when the next load has
 * run and the truck is empty again and ready to start another one. The loop is
 * the thing a dispatcher actually works, and it is what carries responsibility
 * from one person to the next.
 *
 * Three rules hold this file together, and every function below exists to keep
 * one of them true:
 *
 *  1. ONE ACTIVE LOOP PER TRUCK, anywhere in Antcolos. The registry is global
 *     for the same reason the truck registry is: the truck is one physical
 *     vehicle, so "is anybody already working it" is one question with one
 *     answer, not one answer per organization.
 *
 *  2. ONE RESPONSIBLE WORKSPACE PER TRUCK, decided by the records rather than
 *     by whoever opened the dashboard first. A carrier that has handed a truck
 *     to a dispatch agency is not the one covering it; a carrier that has
 *     handed it to nobody is dispatching it itself. See
 *     `responsibleOrganizationFor`.
 *
 *  3. RESPONSIBILITY IS A DATED RECORD, never an overwritten field. A
 *     reassignment ends one MtLoopAssignment and opens another, and the history
 *     keeps both. You can always answer "who had this at 04:00" a week later.
 *
 * Loops are not stored by hand. They are RECONCILED against the truck registry
 * on every read: the truck's real status decides whether a loop should exist,
 * what state it is in, and whether a problem is standing in its way. That is
 * what makes the board self-correcting — fix the truck and the loop follows.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 300;

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/**
 * RFC-4122-shaped v4 identifier for the loop itself.
 *
 * A loop id is permanent and public-facing in the same way a truckId is, so it
 * gets a real UUID rather than a sequence number that leaks how many loops the
 * system has ever opened.
 */
function uuid(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface LoopRegistry {
  loops: MtLoop[];
}

let registry: LoopRegistry | null = null;

function db(): LoopRegistry {
  if (!registry) registry = { loops: [] };
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetMtLoops() {
  registry = null;
  seededAlready.clear();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The caller: a membership acting inside an organization, plus the organization
 * and membership the workspace shape is derived from.
 *
 * Structurally identical to the dispatch workspace's context on purpose — the
 * dashboard passes the one it already has — but declared here so this service
 * does not depend on the dashboard.
 */
export interface MtLoopContext extends ServiceContext {
  organization: Organization;
  membership: Membership;
}

/**
 * Whether this membership is working in a place that has MT Loops at all.
 *
 * MT Loop belongs to the DISPATCH workflow. Both dispatch workspaces have it,
 * and so does a carrier owner who dispatches their own trucks — they are doing
 * the same job, not a lesser version of it. A driver never has one: they are
 * the person the loop is about, not the person working it.
 */
export function dispatchesTrucks(workspace: Workspace | null): boolean {
  if (!workspace) return false;
  return workspace.kind !== "driver";
}

function workspaceOf(ctx: MtLoopContext): Workspace | null {
  return resolveWorkspace(ctx.organization, ctx.membership);
}

/**
 * Can this membership see an MT Loop board?
 *
 * Seeing empty trucks is a trucks question and covering them is a loads
 * question, so it takes both. A membership scoped to its own records is
 * excluded outright: the board is by definition about other people's equipment.
 */
function maySeeBoard(ctx: MtLoopContext, workspace: Workspace | null): boolean {
  if (!dispatchesTrucks(workspace)) return false;
  if (ctx.scope.loads === "assigned") return false;
  return ctx.permissions.has("trucks:view") && ctx.permissions.has("loads:view");
}

/* -------------------------------------------------------------------------- */
/* Who is responsible for a truck                                              */
/* -------------------------------------------------------------------------- */

/**
 * The ONE workspace that owns a truck's MT Loop.
 *
 * Worked out from the records rather than from who asked, so two workspaces
 * looking at the same truck at the same moment get the same answer and only one
 * of them gets a loop:
 *
 *   1. A carrier that has granted dispatch access has delegated the job. The
 *      dispatch workspace holding the OLDEST active grant is responsible.
 *   2. Otherwise the carrier holding the operating lease dispatches it itself.
 *   3. Otherwise the carrier whose operating relationship started first — the
 *      truck's home carrier.
 *
 * Rule 1 also explains why a carrier's own board goes quiet for a delegated
 * truck: it is not missing, it is somebody else's to cover, and pretending
 * otherwise would have two people calling the same broker about it.
 */
export function responsibleOrganizationFor(truckId: string): string | undefined {
  const grants = truckDispatchGrants(truckId);
  if (grants.length > 0) return grants[0].dispatchOrganizationId;
  const operator = truckOperatingCarrier(truckId);
  if (operator) return operator.organizationId;
  return truckApprovedCarriers(truckId)[0]?.organizationId;
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

/** The truck states that mean a cycle is live: empty now, or empty soon. */
const EMPTY_STATUSES = new Set(["available", "expected_available"]);

const DOC_LABEL: Record<TruckDocumentKind, string> = {
  registration: "The registration",
  title: "The title",
  insurance: "The insurance certificate",
  annual_inspection: "The annual inspection",
  cab_card: "The cab card",
  lease_agreement: "The lease agreement",
  other: "A required document",
};

function openLoopForTruck(truckId: string): MtLoop | undefined {
  return db().loops.find((l) => l.truckId === truckId && l.status !== "closed");
}

function record(loop: MtLoop, action: MtLoopAction, opts: {
  actorMembershipId?: string;
  actorName: string;
  note?: string;
  fromStatus?: MtLoopStatus;
  toStatus?: MtLoopStatus;
}) {
  const event: MtLoopEvent = {
    id: rowId("mle"), loopId: loop.loopId, at: nowIso(), action, ...opts,
  };
  loop.history.push(event);
}

function setStatus(loop: MtLoop, next: MtLoopStatus, action: MtLoopAction, opts: {
  actorMembershipId?: string;
  actorName: string;
  note?: string;
}) {
  if (loop.status === next) return;
  const from = loop.status;
  loop.status = next;
  record(loop, action, { ...opts, fromStatus: from, toStatus: next });
}

/**
 * Responsibility handed to somebody at the moment a loop opens.
 *
 * A stand-in for work that has not been built yet — there is no routing engine
 * and no on-call rota — kept in one obvious place rather than sprinkled through
 * the fixtures. Everything not listed here opens with NOBODY on it, which is
 * the honest default and is exactly what Needs You is meant to catch.
 */
const SEEDED_RESPONSIBILITY: Record<string, { membershipId: string; name: string }> = {
  "org_summit:131": { membershipId: "mem_summit_owner", name: "Sam Murtaza" },
  "org_meridian:B-04": { membershipId: "mem_meridian_dispatcher", name: "Sam Murtaza" },
  "org_meridian:A-18": { membershipId: "mem_meridian_lane", name: "Lane Okafor" },
  "org_northline:104": { membershipId: "mem_northline_owner", name: "Sam Murtaza" },
  "org_solo:47": { membershipId: "mem_solo_dispatcher", name: "Sam Murtaza" },
};

/** Which seeds have already been handed out. Cleared with the registry. */
const seededAlready = new Set<string>();

function openLoop(truck: FleetTruck, organizationId: string): MtLoop {
  const carrier = truckCarrierFor(truck.truckId, organizationId);
  const at = nowIso();
  const loop: MtLoop = {
    loopId: uuid(),
    dispatchOrganizationId: organizationId,
    carrierOrganizationId: carrier?.organizationId ?? organizationId,
    carrierName: carrier?.name ?? "This carrier",
    truckId: truck.truckId,
    truckUnit: truck.unit,
    equipment: truck.equipment,
    // Only a tractor is useless without something behind it. A van is not
    // "missing a trailer", it simply does not take one.
    trailerRequired: truck.equipment === "tractor",
    status: "unassigned",
    openedAt: at,
    assignments: [],
    history: [],
  };
  record(loop, "opened", {
    actorName: "Antcolos",
    note: `${truck.unit} became ${truck.status === "available" ? "available" : "expected available"}.`,
    toStatus: "unassigned",
  });

  // Once, and only for the first loop a truck opens in this session. A cycle
  // that has been closed and started again is genuinely nobody's until somebody
  // takes it, and quietly handing it back to the same person would hide exactly
  // the gap this board exists to show.
  const seedKey = `${organizationId}:${truck.unit}`;
  const seeded = seededAlready.has(seedKey) ? undefined : SEEDED_RESPONSIBILITY[seedKey];
  seededAlready.add(seedKey);
  if (seeded) {
    takeResponsibility(loop, seeded.membershipId, seeded.name, {
      byMembershipId: seeded.membershipId,
      byName: seeded.name,
      action: "claimed",
    });
  }

  db().loops.push(loop);
  return loop;
}

/**
 * Give a loop to a membership, ending whoever had it before.
 *
 * The previous spell is CLOSED rather than edited, so the handoff chain stays
 * readable: two rows, two dates, and a reason on the one that ended.
 */
function takeResponsibility(
  loop: MtLoop,
  membershipId: string,
  assigneeName: string,
  by: { byMembershipId: string; byName: string; action: MtLoopAction; note?: string },
) {
  const at = nowIso();
  const current = loop.assignments.find((a) => !a.endedAt);
  if (current) {
    current.endedAt = at;
    current.endReason = by.note
      ?? (by.action === "released" ? "Handed back to the queue." : `Handed to ${assigneeName}.`);
  }

  if (membershipId) {
    const next: MtLoopAssignment = {
      id: rowId("mla"),
      loopId: loop.loopId,
      membershipId,
      assigneeName,
      assignedAt: at,
      assignedByMembershipId: by.byMembershipId,
      assignedByName: by.byName,
    };
    loop.assignments.push(next);
    loop.responsibleMembershipId = membershipId;
    loop.responsibleName = assigneeName;
    if (loop.status === "unassigned") loop.status = "working";
  } else {
    loop.responsibleMembershipId = undefined;
    loop.responsibleName = undefined;
    if (loop.status === "working") loop.status = "unassigned";
  }

  record(loop, by.action, {
    actorMembershipId: by.byMembershipId,
    actorName: by.byName,
    note: by.note,
    toStatus: loop.status,
  });
}

function closeLoop(loop: MtLoop, reason: string, actor?: { membershipId: string; name: string }) {
  const at = nowIso();
  const current = loop.assignments.find((a) => !a.endedAt);
  if (current) {
    current.endedAt = at;
    current.endReason = reason;
  }
  setStatus(loop, "closed", "closed", {
    actorMembershipId: actor?.membershipId,
    actorName: actor?.name ?? "Antcolos",
    note: reason,
  });
  loop.closedAt = at;
  loop.closeReason = reason;
}

/** A problem the SYSTEM can see standing in the way of dispatching this truck. */
function systemBlockReason(truck: FleetTruck): string | undefined {
  if (truck.status === "maintenance") return "The truck is in the shop.";
  if (truck.status === "unavailable") return "The carrier has marked this truck unavailable.";
  const expired = truckDocumentProblems(truck.truckId).find((d) => d.status === "expired");
  if (expired) return `${DOC_LABEL[expired.kind]} has expired. The truck cannot be dispatched.`;
  const rejected = truckDocumentProblems(truck.truckId).find((d) => d.status === "rejected");
  if (rejected) return `${DOC_LABEL[rejected.kind]} was rejected and has not been replaced.`;
  return undefined;
}

/**
 * Bring one loop back in line with what the truck, the trailers and the loads
 * actually say right now.
 *
 * This is the self-correcting part: nothing here asks what the loop used to
 * think. It reads the records and writes down what they mean, so fixing the
 * underlying problem is the only thing needed to clear the loop — and the only
 * thing that CAN clear it.
 */
function refresh(loop: MtLoop, truck: FleetTruck, ctx: MtLoopContext) {
  const before = {
    at: loop.expectedEmptyAt, city: loop.expectedEmptyCity, state: loop.expectedEmptyState,
  };
  // A loop that has never had availability recorded is not "changing" it the
  // first time it is filled in — that is just the loop opening.
  const hadAvailability = before.at !== undefined || before.city !== undefined;

  loop.truckUnit = truck.unit;
  loop.equipment = truck.equipment;
  loop.trailerRequired = truck.equipment === "tractor";
  loop.expectedEmptyAt = truck.estimatedEmptyAt;
  loop.expectedEmptyCity = truck.currentCity;
  loop.expectedEmptyState = truck.currentState;
  loop.driverProfileId = truck.currentDriverId;
  loop.driverName = truck.currentDriverName;
  // The deadline is not a policy number: the truck is empty when it is empty,
  // and that is when it needs an answer.
  loop.respondBy = truck.estimatedEmptyAt ?? loop.openedAt;

  if (
    before.at !== loop.expectedEmptyAt
    || before.city !== loop.expectedEmptyCity
    || before.state !== loop.expectedEmptyState
  ) {
    if (hadAvailability) {
      record(loop, "availability_changed", {
        actorName: "Antcolos",
        note: loop.expectedEmptyAt
          ? `Expected empty ${new Date(loop.expectedEmptyAt).toLocaleString()}.`
          : "No expected empty time recorded.",
      });
    }
  }

  /* ---- The trailer under it, when this workspace may see trailers ---- */
  if (loop.trailerRequired && ctx.permissions.has("trailers:view")) {
    const trailer = trailerFleetSync(truckContextFrom(ctx))
      .find((t) => t.attachedTruckId === truck.truckId);
    loop.trailerId = trailer?.trailerId;
    loop.trailerUnit = trailer?.unit;
  }

  /* ---- The load booked onto this truck, if any ---- */
  const load = mockStore.org(ctx.organizationId).loads.find(
    (l) => l.assignment?.truckId === truck.truckId
      && !l.assignment.endedAt
      && l.status !== "delivered" && l.status !== "cancelled"
      && l.status !== "invoiced" && l.status !== "paid",
  );
  if (load && load.id !== loop.loadId) {
    loop.loadId = load.id;
    loop.loadReference = load.reference;
    record(loop, "load_booked", {
      actorName: "Antcolos",
      note: `${load.reference} is on this truck.`,
    });
    if (loop.status === "unassigned" || loop.status === "working") {
      setStatus(loop, "covered", "load_booked", { actorName: "Antcolos" });
    }
  } else if (!load && loop.loadId) {
    loop.loadId = undefined;
    loop.loadReference = undefined;
    record(loop, "load_released", { actorName: "Antcolos", note: "The load came off this truck." });
    if (loop.status === "covered") {
      setStatus(loop, loop.responsibleMembershipId ? "working" : "unassigned", "load_released", {
        actorName: "Antcolos",
      });
    }
  }

  /* ---- Blocks the system raised, and lifts by itself ---- */
  const blocker = systemBlockReason(truck);
  if (blocker) {
    if (loop.status !== "blocked") {
      loop.blockReason = blocker;
      loop.blockOrigin = "system";
      setStatus(loop, "blocked", "blocked", { actorName: "Antcolos", note: blocker });
    } else if (loop.blockOrigin === "system" && loop.blockReason !== blocker) {
      loop.blockReason = blocker;
    }
  } else if (loop.status === "blocked" && loop.blockOrigin === "system") {
    // The cause is gone, so the block goes with it. A block a PERSON put on
    // stays until a person takes it off — they know something we do not.
    loop.blockReason = undefined;
    loop.blockOrigin = undefined;
    setStatus(loop, loop.responsibleMembershipId ? "working" : "unassigned", "unblocked", {
      actorName: "Antcolos",
      note: "The problem that stopped this loop is gone.",
    });
  }

  /* ---- A pause that has run out ---- */
  if (loop.status === "paused" && loop.pausedUntil && new Date(loop.pausedUntil) <= new Date()) {
    loop.pauseReason = undefined;
    loop.pausedUntil = undefined;
    setStatus(loop, loop.responsibleMembershipId ? "working" : "unassigned", "resumed", {
      actorName: "Antcolos",
      note: "The pause ran out.",
    });
  }
}

/**
 * Bring every loop this workspace is responsible for up to date.
 *
 * Runs on every read. It is cheap, it is synchronous, and doing it any other
 * way means a board that is right only until somebody changes a truck.
 */
export function syncMtLoops(ctx: MtLoopContext): MtLoop[] {
  const workspace = workspaceOf(ctx);
  if (!maySeeBoard(ctx, workspace)) return [];

  const trucks = fleetSync(truckContextFrom(ctx));
  const mine = new Set<string>();

  for (const truck of trucks) {
    if (responsibleOrganizationFor(truck.truckId) !== ctx.organizationId) continue;
    mine.add(truck.truckId);

    const existing = openLoopForTruck(truck.truckId);
    // Rule 1, enforced on the way in: a truck another workspace is already
    // working never gets a second loop here.
    if (existing && existing.dispatchOrganizationId !== ctx.organizationId) continue;

    let loop = existing;
    const empty = EMPTY_STATUSES.has(truck.status);

    if (empty) {
      // Only a loop that was RUNNING closes here. A covered loop sitting on an
      // empty truck is the normal state of affairs — the load is booked and the
      // driver has not picked it up yet — and treating that as the end of the
      // cycle would close and reopen the same loop on every single read,
      // throwing away its identity and its history each time.
      if (loop && loop.status === "running") {
        // The load ran and the truck is empty again. That is the end of this
        // cycle, and the start of a different one with its own identity.
        closeLoop(loop, "The load was completed and the truck is empty again.");
        loop = undefined;
      }
      if (!loop) loop = openLoop(truck, ctx.organizationId);
      refresh(loop, truck, ctx);
    } else if (loop) {
      // The truck picked something up: the cycle has its answer and is running.
      if (truck.status === "loaded" && loop.status !== "paused" && loop.status !== "blocked") {
        setStatus(loop, "running", "load_booked", { actorName: "Antcolos" });
      }
      refresh(loop, truck, ctx);
    }
  }

  // A truck that left this workspace — grant revoked, relationship ended —
  // takes its loop with it rather than leaving a card nobody can act on.
  for (const loop of db().loops) {
    if (loop.dispatchOrganizationId !== ctx.organizationId) continue;
    if (loop.status === "closed") continue;
    if (!mine.has(loop.truckId)) {
      closeLoop(loop, "This truck is no longer dispatched by this workspace.");
    }
  }

  return db().loops.filter(
    (l) => l.dispatchOrganizationId === ctx.organizationId && l.status !== "closed",
  );
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Who this workspace can hand a loop to.
 *
 * A stand-in until the members service is wired to the dashboard, in the same
 * spirit as the team counts on the workspace summary. A workspace of one is
 * absent from this map on purpose: there is nobody to hand anything to, which
 * is a different statement from "the list is empty".
 */
const TEAM_ROSTER: Record<string, Array<{ membershipId: string; name: string }>> = {
  org_summit: [
    { membershipId: "mem_summit_owner", name: "Sam Murtaza" },
    { membershipId: "mem_summit_rosa", name: "Rosa Delgado" },
    { membershipId: "mem_summit_dev", name: "Devon Pike" },
  ],
  org_meridian: [
    { membershipId: "mem_meridian_dispatcher", name: "Sam Murtaza" },
    { membershipId: "mem_meridian_lane", name: "Lane Okafor" },
    { membershipId: "mem_meridian_ines", name: "Inés Vidal" },
  ],
  org_northline: [
    { membershipId: "mem_northline_owner", name: "Sam Murtaza" },
    { membershipId: "mem_northline_paige", name: "Paige Ellery" },
  ],
};

/**
 * What one membership may do to one loop.
 *
 * Worked out here, beside the records, and re-checked inside every mutation.
 * The screen renders buttons from these flags and makes no judgement of its
 * own; a board that has gone stale in a tab therefore cannot be used to do
 * anything the person may not currently do.
 */
function abilitiesFor(
  loop: MtLoop,
  ctx: MtLoopContext,
  workspace: Workspace,
): MtLoopAbilities {
  const open = loop.status !== "closed";
  const mine = loop.responsibleMembershipId === ctx.membershipId;
  const held = Boolean(loop.responsibleMembershipId);
  // Handing work to another person needs the authority to move work AND
  // somewhere to move it to. In a workspace of one there is no such thing.
  const mayMoveWork = workspace.supportsTeam && ctx.permissions.has("loads:assign");
  // You may act on a loop you hold. Somebody who may move work may act on any
  // of them — that is what being able to move work means.
  const mayAct = open && (mine || mayMoveWork);

  return {
    claim: open && !held,
    assign: open && !held && mayMoveWork,
    reassign: open && held && mayMoveWork,
    pause: mayAct && held && loop.status !== "paused" && loop.status !== "blocked",
    resume: mayAct && loop.status === "paused",
    block: mayAct && loop.status !== "blocked",
    // A block the system raised is not a person's to lift: fix the truck.
    unblock: mayAct && loop.status === "blocked" && loop.blockOrigin === "person",
    close: mayAct && open,
  };
}

function toCard(
  loop: MtLoop,
  ctx: MtLoopContext,
  workspace: Workspace,
  truck?: FleetTruck,
): MtLoopCard {
  const emptyAt = loop.expectedEmptyAt ? new Date(loop.expectedEmptyAt).getTime() : undefined;
  const isMine = loop.responsibleMembershipId === ctx.membershipId;
  // Derived on every read from records other modules own. See `mt-loop-cycle.ts`.
  const cycle = cycleInputFor(loop, truck);
  return {
    loopId: loop.loopId,
    truckId: loop.truckId,
    truckUnit: loop.truckUnit,
    equipment: loop.equipment,
    carrierName: loop.carrierName,
    status: loop.status,
    driverName: loop.driverName,
    trailerUnit: loop.trailerUnit,
    trailerRequired: loop.trailerRequired,
    responsibleName: loop.responsibleName,
    responsibleMembershipId: loop.responsibleMembershipId,
    isMine,
    expectedEmptyAt: loop.expectedEmptyAt,
    expectedEmptyCity: loop.expectedEmptyCity,
    expectedEmptyState: loop.expectedEmptyState,
    availability: loop.availability,
    emptyNow: emptyAt === undefined ? true : emptyAt <= Date.now(),
    respondBy: loop.respondBy,
    loadReference: loop.loadReference,
    blockReason: loop.blockReason,
    pauseReason: loop.pauseReason,
    openedAt: loop.openedAt,
    handoffCount: loop.assignments.length,
    stage: stageOf(cycle),
    evidence: evidenceFor(cycle),
    nextAction: nextActionFor(cycle, {
      isMine,
      held: Boolean(loop.responsibleMembershipId),
    }),
    blockers: blockersFor(cycle),
    can: abilitiesFor(loop, ctx, workspace),
  };
}

/** Soonest to go empty first; a truck already sitting is the most urgent of all. */
function byUrgency(a: MtLoopCard, b: MtLoopCard): number {
  const at = a.expectedEmptyAt ? new Date(a.expectedEmptyAt).getTime() : 0;
  const bt = b.expectedEmptyAt ? new Date(b.expectedEmptyAt).getTime() : 0;
  return at - bt;
}

export async function mtLoopBoard(ctx: MtLoopContext): Promise<MtLoopBoard> {
  await sleep(LATENCY_MS);
  return mtLoopBoardSync(ctx);
}

export function mtLoopBoardSync(ctx: MtLoopContext): MtLoopBoard {
  const workspace = workspaceOf(ctx);
  if (!maySeeBoard(ctx, workspace)) {
    return {
      loops: [],
      counts: { open: 0, unassigned: 0, mine: 0, blocked: 0, paused: 0, emptyNow: 0 },
    };
  }

  const loops = syncMtLoops(ctx);
  // The trucks are read once and handed to each card, so the board does not do
  // one registry lookup per loop to answer the same question.
  const trucks = new Map(
    fleetSync(truckContextFrom(ctx)).map((t) => [t.truckId, t] as const),
  );
  const cards = loops
    .map((l) => toCard(l, ctx, workspace!, trucks.get(l.truckId)))
    .sort(byUrgency);
  const mayMoveWork = workspace!.supportsTeam && ctx.permissions.has("loads:assign");

  return {
    loops: cards,
    counts: {
      open: cards.length,
      unassigned: cards.filter((c) => !c.responsibleMembershipId).length,
      mine: cards.filter((c) => c.isMine).length,
      blocked: cards.filter((c) => c.status === "blocked").length,
      paused: cards.filter((c) => c.status === "paused").length,
      emptyNow: cards.filter((c) => c.emptyNow).length,
    },
    // Absent, not empty, in a workspace of one.
    assignableTo: mayMoveWork ? (TEAM_ROSTER[ctx.organizationId] ?? []) : undefined,
  };
}

/** The loops this workspace holds right now, for callers that derive from them. */
export function openLoopsFor(ctx: MtLoopContext): MtLoop[] {
  return syncMtLoops(ctx);
}

/** One loop, with its full history — for a detail view or a test. */
export function mtLoopById(loopId: string, ctx: MtLoopContext): MtLoop | undefined {
  const workspace = workspaceOf(ctx);
  if (!maySeeBoard(ctx, workspace)) return undefined;
  const loop = db().loops.find((l) => l.loopId === loopId);
  // A loop in another workspace and a loop that does not exist are one answer.
  if (!loop || loop.dispatchOrganizationId !== ctx.organizationId) return undefined;
  return loop;
}

/**
 * A load was booked onto this cycle.
 *
 * Lives here rather than in the booking service because a loop's status and its
 * history belong to the loop: every other transition in this module goes
 * through `setStatus`, and letting one caller set `status = "covered"` by hand
 * is how a history ends up with a gap in it. The booking service owns the load;
 * this owns what that does to the cycle.
 *
 * The loop id does not change. It is the same cycle it was when the truck went
 * empty, and it stays that way until the load is delivered and released.
 */
export function markLoopBooked(loop: MtLoop, opts: {
  loadId: string;
  loadReference: string;
  actorMembershipId?: string;
  actorName: string;
  note?: string;
}) {
  loop.loadId = opts.loadId;
  loop.loadReference = opts.loadReference;
  setStatus(loop, "covered", "load_booked", {
    actorMembershipId: opts.actorMembershipId,
    actorName: opts.actorName,
    note: opts.note,
  });
}

/**
 * Record that the loop's load is CONFIRMED, not merely booked.
 *
 * Booked and confirmed are different states of the same cycle, and a dispatcher
 * needs to see the difference: a booked load whose rate confirmation never came
 * back is exactly the cycle that is not finished. The loop keeps the confirmation
 * as its own dated event and as evidence on the card.
 *
 * Unscoped by design — it is called by a projection of a `load.finalized` event,
 * which already established who signed what and under whose authority. Returns
 * `undefined` when the loop cannot be read, which the projection reports as a
 * failure rather than swallowing.
 */
export function recordFinalizationOnLoop(
  loopId: string,
  opts: {
    loadId: string;
    loadReference: string;
    actorName: string;
    actorMembershipId?: string;
    rateConfirmationId: string;
    signedAt: string;
  },
): MtLoop | undefined {
  const loop = db().loops.find((l) => l.loopId === loopId);
  if (!loop) return undefined;

  loop.loadId = opts.loadId;
  loop.loadReference = opts.loadReference;
  loop.rateConfirmationId = opts.rateConfirmationId;
  loop.rateConfirmationSignedAt = opts.signedAt;

  // Appended once. Re-publishing the same finalization does not add a second
  // line to a truck's history.
  const already = loop.history.some(
    (e) => e.action === "load_confirmed" && e.note?.includes(opts.rateConfirmationId),
  );
  if (!already) {
    record(loop, "load_confirmed", {
      actorMembershipId: opts.actorMembershipId,
      actorName: opts.actorName,
      note: `${opts.loadReference} confirmed: the rate confirmation was signed and returned to the broker. Record ${opts.rateConfirmationId}.`,
    });
  }

  // A cycle that was merely covered is now covered on a confirmed load. It does
  // not jump to `running` — the driver has not started rolling.
  if (loop.status === "working" || loop.status === "unassigned") {
    setStatus(loop, "covered", "load_booked", {
      actorMembershipId: opts.actorMembershipId,
      actorName: opts.actorName,
      note: `${opts.loadReference} is confirmed.`,
    });
  }

  return loop;
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export type MtLoopOutcome =
  | { status: "ok"; loop: MtLoop }
  | { status: "already_held"; responsibleName: string }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "needs_reason" };

/**
 * Find a loop the caller is entitled to act on.
 *
 * Returns the same nothing for "no such loop" and "not yours", because anything
 * else turns a loop id field into a directory of other workspaces' empty trucks.
 */
function actableLoop(loopId: string, ctx: MtLoopContext): MtLoop | undefined {
  const workspace = workspaceOf(ctx);
  if (!maySeeBoard(ctx, workspace)) return undefined;
  const loop = db().loops.find((l) => l.loopId === loopId);
  if (!loop || loop.dispatchOrganizationId !== ctx.organizationId) return undefined;
  if (loop.status === "closed") return undefined;
  return loop;
}

function mayActOn(loop: MtLoop, ctx: MtLoopContext): boolean {
  const workspace = workspaceOf(ctx);
  if (!workspace) return false;
  if (loop.responsibleMembershipId === ctx.membershipId) return true;
  return workspace.supportsTeam && ctx.permissions.has("loads:assign");
}

/**
 * Take responsibility for a loop nobody is holding.
 *
 * Claiming is a lower bar than handing work to somebody else: anybody who can
 * see the board may pick one up, while assigning to another person needs the
 * authority to move work. The check and the write happen with no await between
 * them, so two dispatchers pressing Claim in the same second cannot both end up
 * holding it — the second one is told who got there first.
 */
export async function claimLoop(loopId: string, ctx: MtLoopContext): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);

  /* ---- critical section: no awaits from here to the return ---- */
  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };

  if (loop.responsibleMembershipId) {
    return loop.responsibleMembershipId === ctx.membershipId
      ? { status: "ok", loop }
      : { status: "already_held", responsibleName: loop.responsibleName ?? "Somebody else" };
  }

  takeResponsibility(loop, ctx.membershipId, ctx.actor.displayNameSnapshot, {
    byMembershipId: ctx.membershipId,
    byName: ctx.actor.displayNameSnapshot,
    action: "claimed",
  });
  /* ---- end critical section ---- */
  return { status: "ok", loop };
}

/**
 * Hand a loop to somebody in this workspace.
 *
 * One function for assigning and reassigning, because they are one operation:
 * the difference is only whether anybody held it before, and the history says
 * which it was.
 */
export async function assignLoop(
  loopId: string,
  membershipId: string,
  assigneeName: string,
  ctx: MtLoopContext,
): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  const workspace = workspaceOf(ctx);
  if (!workspace?.supportsTeam) return { status: "not_permitted" };
  if (!ctx.permissions.has("loads:assign")) return { status: "not_permitted" };

  /* ---- critical section ---- */
  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };

  const wasHeld = Boolean(loop.responsibleMembershipId);
  if (loop.responsibleMembershipId === membershipId) return { status: "ok", loop };

  takeResponsibility(loop, membershipId, assigneeName, {
    byMembershipId: ctx.membershipId,
    byName: ctx.actor.displayNameSnapshot,
    action: wasHeld ? "reassigned" : "assigned",
    note: wasHeld
      ? `Moved from ${loop.responsibleName ?? "nobody"} to ${assigneeName}.`
      : `Given to ${assigneeName}.`,
  });
  /* ---- end critical section ---- */
  return { status: "ok", loop };
}

/** Put a loop back where anybody in the workspace can pick it up. */
export async function releaseLoop(loopId: string, ctx: MtLoopContext): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };
  if (!mayActOn(loop, ctx)) return { status: "not_permitted" };

  takeResponsibility(loop, "", "", {
    byMembershipId: ctx.membershipId,
    byName: ctx.actor.displayNameSnapshot,
    action: "released",
    note: "Handed back to the queue.",
  });
  return { status: "ok", loop };
}

/**
 * Set a loop aside on purpose, with a reason and for a stated length of time.
 *
 * A pause is a decision, so it always carries why. It is also not a block: the
 * truck is fine, the paperwork is fine, somebody has simply chosen to come back
 * to it. Calling one the other loses the only thing worth knowing.
 */
export async function pauseLoop(
  loopId: string,
  reason: string,
  hours: number,
  ctx: MtLoopContext,
): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  if (!reason.trim()) return { status: "needs_reason" };

  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };
  if (!mayActOn(loop, ctx)) return { status: "not_permitted" };
  if (loop.status === "blocked") return { status: "not_permitted" };

  loop.pauseReason = reason.trim();
  loop.pausedUntil = new Date(Date.now() + Math.max(1, hours) * 3_600_000).toISOString();
  setStatus(loop, "paused", "paused", {
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    note: reason.trim(),
  });
  return { status: "ok", loop };
}

export async function resumeLoop(loopId: string, ctx: MtLoopContext): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };
  if (!mayActOn(loop, ctx)) return { status: "not_permitted" };
  if (loop.status !== "paused") return { status: "not_permitted" };

  loop.pauseReason = undefined;
  loop.pausedUntil = undefined;
  setStatus(loop, loop.responsibleMembershipId ? "working" : "unassigned", "resumed", {
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
  });
  return { status: "ok", loop };
}

/**
 * Stop a loop because something is genuinely in the way.
 *
 * Recorded as a person's block, which is why it does not lift by itself: the
 * system did not see the problem and cannot see it go away.
 */
export async function blockLoop(
  loopId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  if (!reason.trim()) return { status: "needs_reason" };

  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };
  if (!mayActOn(loop, ctx)) return { status: "not_permitted" };

  loop.blockReason = reason.trim();
  loop.blockOrigin = "person";
  loop.pauseReason = undefined;
  loop.pausedUntil = undefined;
  setStatus(loop, "blocked", "blocked", {
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    note: reason.trim(),
  });
  return { status: "ok", loop };
}

export async function unblockLoop(loopId: string, ctx: MtLoopContext): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };
  if (!mayActOn(loop, ctx)) return { status: "not_permitted" };
  if (loop.status !== "blocked") return { status: "not_permitted" };
  // A block the system raised is cleared by fixing the truck, not by a button.
  if (loop.blockOrigin !== "person") return { status: "not_permitted" };

  loop.blockReason = undefined;
  loop.blockOrigin = undefined;
  setStatus(loop, loop.responsibleMembershipId ? "working" : "unassigned", "unblocked", {
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
  });
  return { status: "ok", loop };
}

/**
 * End a cycle by hand.
 *
 * A closed loop is never reopened. If the truck goes empty again it gets a new
 * loop with a new immutable id, and this one stays exactly as it was — which is
 * the whole reason the history is worth keeping.
 */
export async function closeLoopById(
  loopId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<MtLoopOutcome> {
  await sleep(LATENCY_MS);
  if (!reason.trim()) return { status: "needs_reason" };

  const loop = actableLoop(loopId, ctx);
  if (!loop) return { status: "not_found" };
  if (!mayActOn(loop, ctx)) return { status: "not_permitted" };

  closeLoop(loop, reason.trim(), {
    membershipId: ctx.membershipId,
    name: ctx.actor.displayNameSnapshot,
  });
  return { status: "ok", loop };
}

/* -------------------------------------------------------------------------- */
/* Availability decisions arrive here                                          */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE ONE DOOR AVAILABILITY COMES THROUGH ★
 *
 * The availability engine decides; this publishes. There is no second MT Loop
 * record system anywhere in the tracking module, and there is no other way for
 * a decision to become a board entry — which is the whole point of putting
 * this function in this file rather than beside the engine.
 *
 * Deduplication is the substance of it. Availability is recomputed constantly:
 * on every board read, every new position, every workflow event. Each of those
 * is a fresh reading of ONE cycle, and a naive publish would open a loop every
 * time, leaving a board with six entries for one empty truck and six people
 * ringing the same broker. Three rules stop that:
 *
 *  1. A truck has at most one OPEN loop. A decision about a truck that already
 *     has one updates that loop; it never opens a second.
 *  2. A decision carries `cycleKey`. A key this workspace has already run a
 *     loop for — even a closed one — never opens another.
 *  3. A decision that changes nothing writes nothing, so the loop's history
 *     records movement rather than heartbeat.
 *
 * And the honest part: only `expected_available`, `likely_available` and
 * `empty_confirmed` are publishable at all. `availability_uncertain` produces
 * no entry, because putting a truck on the empty board when Antcolos cannot
 * tell whether it is empty is exactly the fabrication this milestone exists to
 * avoid. It stays visible on the tracking board, where it belongs, with its
 * reason attached.
 */
export function publishAvailabilityDecision(
  decision: AvailabilityDecision,
  ctx: MtLoopContext,
): AvailabilityPublication {
  const workspace = workspaceOf(ctx);
  if (!maySeeBoard(ctx, workspace)) {
    return {
      outcome: "not_responsible",
      reason: "This membership cannot work an MT Loop board in this workspace.",
    };
  }

  if (responsibleOrganizationFor(decision.truckId) !== ctx.organizationId) {
    return {
      outcome: "not_responsible",
      reason:
        "Another workspace is responsible for covering this truck, so its cycle is not this board's to open.",
    };
  }

  if (!isPublishableAvailability(decision.state)) {
    return {
      outcome: "not_publishable",
      reason:
        decision.state === "unavailable"
          ? "The truck is not free, so there is no cycle to open."
          : "Antcolos cannot tell whether this truck is empty, and will not put a guess on the board.",
    };
  }

  const snapshot: MtLoopAvailability = {
    state: decision.state,
    basis: decision.basis,
    confidence: decision.confidence,
    cycleKey: decision.cycleKey,
    decidedAt: decision.decidedAt,
    rationale: decision.rationale,
    awaiting: decision.awaiting,
    sourceAdapter: decision.provenance.adapter,
    sourceIsMock: decision.provenance.mock,
  };

  const open = openLoopForTruck(decision.truckId);

  if (open) {
    if (open.dispatchOrganizationId !== ctx.organizationId) {
      return {
        outcome: "not_responsible",
        reason: "This truck's open cycle belongs to another dispatch workspace.",
      };
    }

    const before = open.availability;
    const unchanged = before
      && before.cycleKey === snapshot.cycleKey
      && before.state === snapshot.state
      && before.basis === snapshot.basis;

    if (unchanged) {
      // Keep the freshest reasoning without writing a history line for a
      // heartbeat. The conclusion has not moved, so nothing happened.
      open.availability = { ...snapshot, decidedAt: decision.decidedAt };
      return {
        outcome: "unchanged",
        loopId: open.loopId,
        reason: `Still ${AVAILABILITY_STATE_LABEL[snapshot.state].toLowerCase()}. Nothing to record.`,
      };
    }

    open.availability = snapshot;
    if (decision.expectedEmptyAt) open.expectedEmptyAt = decision.expectedEmptyAt;
    if (decision.expectedEmptyCity) open.expectedEmptyCity = decision.expectedEmptyCity;
    if (decision.expectedEmptyState) open.expectedEmptyState = decision.expectedEmptyState;

    record(open, "availability_changed", {
      actorName: decision.basis === "confirmed" ? "Antcolos (confirmed)" : "Antcolos (inferred)",
      note:
        `${AVAILABILITY_STATE_LABEL[snapshot.state]} — ${snapshot.basis}, `
        + `confidence ${(snapshot.confidence * 100).toFixed(0)}%. ${snapshot.rationale}`,
    });

    return {
      outcome: "loop_updated",
      loopId: open.loopId,
      reason: `${AVAILABILITY_STATE_LABEL[snapshot.state]} published to the existing cycle.`,
    };
  }

  // Rule 2: a cycle this workspace has already run is never re-opened. The
  // check spans CLOSED loops too — that is what makes it a real deduplication
  // rather than a race window.
  const alreadyRan = db().loops.find(
    (l) => l.dispatchOrganizationId === ctx.organizationId
      && l.availability?.cycleKey === snapshot.cycleKey,
  );
  if (alreadyRan) {
    return {
      outcome: "duplicate_suppressed",
      loopId: alreadyRan.loopId,
      reason:
        "A cycle has already run for this truck and this operational cycle. A second entry is not opened.",
    };
  }

  const truck = fleetSync(truckContextFrom(ctx)).find((t) => t.truckId === decision.truckId);
  if (!truck) {
    return {
      outcome: "not_responsible",
      reason: "This workspace cannot see the truck, so it cannot open a cycle for it.",
    };
  }

  const loop = openLoop(truck, ctx.organizationId);
  loop.availability = snapshot;
  if (decision.expectedEmptyAt) loop.expectedEmptyAt = decision.expectedEmptyAt;
  if (decision.expectedEmptyCity) loop.expectedEmptyCity = decision.expectedEmptyCity;
  if (decision.expectedEmptyState) loop.expectedEmptyState = decision.expectedEmptyState;
  loop.respondBy = decision.expectedEmptyAt ?? loop.openedAt;

  record(loop, "availability_changed", {
    actorName: decision.basis === "confirmed" ? "Antcolos (confirmed)" : "Antcolos (inferred)",
    note:
      `Cycle opened from a ${snapshot.basis} availability decision: `
      + `${AVAILABILITY_STATE_LABEL[snapshot.state]}. ${snapshot.rationale}`,
  });

  return {
    outcome: "loop_opened",
    loopId: loop.loopId,
    reason: `A cycle was opened for ${truck.unit} from ${AVAILABILITY_STATE_LABEL[snapshot.state].toLowerCase()}.`,
  };
}

/** The loop carrying a given operational cycle, open or closed. For tests and audit. */
export function loopForCycle(cycleKey: string, organizationId: string): MtLoop | undefined {
  return db().loops.find(
    (l) => l.dispatchOrganizationId === organizationId && l.availability?.cycleKey === cycleKey,
  );
}
