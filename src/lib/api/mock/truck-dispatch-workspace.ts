import type {
  CarrierView, DriverView, FleetTrailer, FleetTruck, MtLoop, MtLoopAbilities,
  MtLoopBlocker, MtLoopCard, Truck, TruckDocument,
} from "@/types";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import { mockStore } from "./store";
import {
  accessReason, fleetSync, truckContextFrom, truckRecord,
  truckDocumentProblems, truckDocumentsFor, type TruckAccessReason,
} from "./truck-registry";
import { trailerFleetSync } from "./trailer-registry";
import { carrierForTruckSync } from "./carrier-registry";
import { driverViewSync, driverDocumentProblems } from "./driver-registry";
import { buildMtLoopBoard, openLoopsFor, type MtLoopContext } from "./mt-loop";
// ★ The one place a blocker is decided, for every screen that shows one. ★
import { blockersFor } from "./mt-loop-cycle";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The contextual dispatch workspace for ONE truck.
 *
 * A dispatcher working several carriers at once should not have to remember
 * which one a truck belongs to, and should certainly not have to sign out and
 * back in to find out. Clicking a truck on the MT Loop board establishes the
 * carrier context from the records: the truck is the question, and the carrier,
 * the driver, the trailer, the paperwork, the authority and the live loop are
 * the answer, gathered in one place.
 *
 * The convenience stops exactly where the entitlement does. Every piece below
 * comes from the registry that owns it, through that registry's own access
 * rules — the carrier registry decides what of the carrier travels, the driver
 * registry decides what of the person travels, and the truck registry decides
 * what of the vehicle travels. This file adds no rule of its own and, crucially,
 * has no way to bypass one: it cannot reach a record except by asking a
 * registry, in this workspace's context.
 *
 * Anything the later milestones will add — opportunities, outreach, the booked
 * load, the trip, the timeline — hangs off `mtLoopId`, which is the same id
 * from the moment the truck goes empty until the cycle closes.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 320;

/* -------------------------------------------------------------------------- */
/* The view                                                                    */
/* -------------------------------------------------------------------------- */

/** A section of the cycle that a later milestone will fill in. */
export interface PlannedSection {
  key: string;
  title: string;
  /** What it will do, said plainly and without implying it exists. */
  description: string;
  /** Which milestone in the roadmap builds it. */
  milestone: number;
}

export interface TruckDispatchWorkspace {
  /** The permanent truck. The subject of this whole page. */
  truck: Truck;
  /** This workspace's operational view of it. */
  fleetTruck: FleetTruck;
  /** Why this workspace may see the truck at all. */
  accessReason: TruckAccessReason;

  /**
   * The carrier whose authority the truck runs under, established from the
   * records rather than from a switcher the person had to find.
   */
  carrier?: CarrierView;
  /** Present when the carrier's record exists but this viewer may not read it. */
  carrierWithheld: boolean;

  trailer?: FleetTrailer;
  /** True when this equipment needs a trailer and has none. */
  trailerMissing: boolean;

  driver?: DriverView;
  /** Paperwork problems on the driver, as this viewer may see them. */
  driverDocumentProblems: ReturnType<typeof driverDocumentProblems>;

  /** Every document on the vehicle this viewer may read. */
  truckDocuments: TruckDocument[];
  /** The subset of those that need somebody to do something. */
  truckDocumentProblems: ReturnType<typeof truckDocumentProblems>;

  /** The live cycle. Absent when the truck is not empty or nearly empty. */
  loop?: MtLoop;
  /** The board's projection of that loop, so the page can render its actions. */
  loopCard?: MtLoopCard;
  /** Every hand the loop has passed through, newest first. */
  handoffs: MtLoop["assignments"];

  /**
   * The one thing standing in the way of dispatching this truck right now, if
   * there is one. Ordered by how badly it stops the work, not alphabetically.
   */
  blockers: MtLoopBlocker[];

  /** What is not built yet, named honestly rather than mocked up. */
  planned: PlannedSection[];

  /** What this membership may do here. Mirrors the loop's own abilities. */
  can: MtLoopAbilities;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

export async function truckDispatchWorkspace(
  truckId: string,
  ctx: MtLoopContext,
): Promise<TruckDispatchWorkspace | undefined> {
  await sleep(LATENCY_MS);
  return truckDispatchWorkspaceFor(truckId, ctx);
}

export async function truckDispatchWorkspaceFor(
  truckId: string,
  ctx: MtLoopContext,
): Promise<TruckDispatchWorkspace | undefined> {
  const workspace = resolveWorkspace(ctx.organization, ctx.membership);
  // A driver is the person this page is about, not the person who works it.
  if (!workspace || workspace.kind === "driver") return undefined;
  if (!ctx.permissions.has("trucks:view") || !ctx.permissions.has("loads:view")) return undefined;
  // Somebody scoped to their own records has no business on a dispatch page.
  if (ctx.scope.loads === "assigned") return undefined;

  const truckCtx = truckContextFrom(ctx);
  const truck = truckRecord(truckId);
  const reason = accessReason(truckId, truckCtx);
  // Unknown truck and forbidden truck are deliberately one answer.
  if (!truck || reason === null) return undefined;

  const fleetTruck = fleetSync(truckCtx).find((t) => t.truckId === truckId);
  if (!fleetTruck) return undefined;

  /* ---- Carrier: established from the records, never from a switcher ---- */
  const carrier = carrierForTruckSync(truckId, truckCtx);

  /* ---- Trailer ---- */
  const trailer = ctx.permissions.has("trailers:view")
    ? trailerFleetSync(truckCtx).find((t) => t.attachedTruckId === truckId)
    : undefined;
  const trailerMissing = fleetTruck.equipment === "tractor" && trailer === undefined;

  /* ---- Driver, through the carrier that granted us the truck ---- */
  const driver = fleetTruck.currentDriverId
    ? driverViewSync(fleetTruck.currentDriverId, truckCtx, carrier?.organizationId)
    : undefined;

  /* ---- The live cycle ---- */
  const loop = openLoopsFor(ctx).find((l) => l.truckId === truckId);
  const loopCard = (await buildMtLoopBoard(ctx)).loops.find((c) => c.truckId === truckId);

  const docProblems = truckDocumentProblems(truckId);
  const driverProblems = driver ? driverDocumentProblems(driver) : [];

  return {
    truck,
    fleetTruck,
    accessReason: reason,
    carrier,
    // The carrier record exists for every carrier in the fixtures; saying so
    // when it is withheld is more honest than showing an empty panel.
    carrierWithheld: carrier === undefined,
    trailer,
    trailerMissing,
    driver,
    driverDocumentProblems: driverProblems,
    truckDocuments: truckDocumentsFor(truckId, truckCtx),
    truckDocumentProblems: docProblems,
    loop,
    loopCard,
    // Newest first: who has it now is the question people ask.
    handoffs: loop ? [...loop.assignments].reverse() : [],
    /*
     * ★ THE SAME LIST THE BOARD RENDERS ★
     * This page used to work out its own blockers from its own inputs, and the
     * two answers disagreed: the board would name a rate confirmation nobody had
     * returned, or a hold a person had deliberately put on, while this page said
     * in green that nothing was standing in the way — and offered the very
     * action the hold existed to prevent. There is one function now. A truck
     * with no open cycle still gets an answer, which is why `loop` is optional.
     */
    blockers: blockersFor({
      loop,
      truck: fleetTruck,
      carrier,
      driver,
      driverProblems,
      trailerAttached: trailer !== undefined,
      // The Responsibility Engine's answer, handed in exactly as the board hands
      // it in. Without it the "not claimed" line here read "Nobody has accepted
      // this cycle yet" while the board named the person it had been routed to —
      // the same two-answers problem in miniature.
      responsibleName: loopCard?.responsible?.displayName,
    }),
    planned: PLANNED_SECTIONS,
    can: loopCard?.can ?? NOTHING_ALLOWED,
  };
}

const NOTHING_ALLOWED: MtLoopAbilities = {
  claim: false, assign: false, reassign: false, pause: false,
  resume: false, block: false, unblock: false, close: false,
  escalateToCarrier: false,
};

/* -------------------------------------------------------------------------- */
/* What comes next                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The rest of the cycle, named rather than mocked.
 *
 * Every one of these hangs off the same `mtLoopId` that is already on this
 * page. They are listed so a dispatcher can see where the work is going and
 * exactly how far it has actually got — which is a different thing from a
 * greyed-out button that looks like it might work.
 */
const PLANNED_SECTIONS: PlannedSection[] = [
  { key: "pickup", milestone: 9, title: "Dispatch and pickup", description: "Load details sent, then dispatched, en route, arrived and loaded." },
  { key: "transit", milestone: 10, title: "In transit", description: "Location, ETA, delays, detention and exceptions, with the dispatcher's follow-ups." },
  { key: "delivery", milestone: 11, title: "Delivery and documents", description: "Arrived, unloaded, proof of delivery, receipts, and anything short or damaged." },
  { key: "release", milestone: 12, title: "Release and next loop", description: "The load completed, the operating lease and equipment locks formally released, and the next cycle opened when the truck is ready." },
];

/** The sections a screen should offer, in roadmap order. */
export function plannedSections(): PlannedSection[] {
  return PLANNED_SECTIONS;
}

/** Recent activity on this truck, from the load timeline this org can see. */
export function truckActivitySync(
  truckId: string,
  ctx: MtLoopContext,
): Array<{ id: string; at: string; summary: string; loadReference?: string; actorName?: string }> {
  if (!ctx.permissions.has("loads:view")) return [];
  const org = mockStore.org(ctx.organizationId);
  const mine = org.loads.filter((l) => l.assignment?.truckId === truckId);
  const byId = new Map(mine.map((l) => [l.id, l.reference]));
  return org.events
    .filter((e) => byId.has(e.loadId))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 8)
    .map((e) => ({
      id: e.id,
      at: e.occurredAt,
      summary: e.payload?.note ?? e.kind.replace(/[._]/g, " "),
      loadReference: byId.get(e.loadId),
      actorName: e.actor?.displayNameSnapshot,
    }));
}
