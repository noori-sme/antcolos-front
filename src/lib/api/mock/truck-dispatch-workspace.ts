import type {
  CarrierView, DriverView, FleetTrailer, FleetTruck, MtLoop, MtLoopAbilities,
  MtLoopCard, Truck, TruckDocument,
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
import { mtLoopBoardSync, openLoopsFor, type MtLoopContext } from "./mt-loop";

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
  blockers: DispatchBlocker[];

  /** What is not built yet, named honestly rather than mocked up. */
  planned: PlannedSection[];

  /** What this membership may do here. Mirrors the loop's own abilities. */
  can: MtLoopAbilities;
}

/**
 * Something that stops this truck being dispatched.
 *
 * Each one names what is wrong, whose it is to fix, and where to go. A blocker
 * is not a warning: every entry here means a load should not be booked on this
 * truck until it is sorted out.
 */
export interface DispatchBlocker {
  key: string;
  severity: "critical" | "high" | "medium";
  title: string;
  detail: string;
  /** Who has to act: the carrier, the driver, or this dispatch workspace. */
  owner: "carrier" | "driver" | "dispatcher";
  href?: string;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

export async function truckDispatchWorkspace(
  truckId: string,
  ctx: MtLoopContext,
): Promise<TruckDispatchWorkspace | undefined> {
  await sleep(LATENCY_MS);
  return truckDispatchWorkspaceSync(truckId, ctx);
}

export function truckDispatchWorkspaceSync(
  truckId: string,
  ctx: MtLoopContext,
): TruckDispatchWorkspace | undefined {
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
  const loopCard = mtLoopBoardSync(ctx).loops.find((c) => c.truckId === truckId);

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
    blockers: blockersFor({ carrier, driver, driverProblems, docProblems, fleetTruck, trailerMissing }),
    planned: PLANNED_SECTIONS,
    can: loopCard?.can ?? NOTHING_ALLOWED,
  };
}

const NOTHING_ALLOWED: MtLoopAbilities = {
  claim: false, assign: false, reassign: false, pause: false,
  resume: false, block: false, unblock: false, close: false,
};

/* -------------------------------------------------------------------------- */
/* Blockers                                                                    */
/* -------------------------------------------------------------------------- */

const DOC_NAME: Record<string, string> = {
  registration: "registration",
  title: "title",
  insurance: "insurance certificate",
  annual_inspection: "annual inspection",
  cab_card: "cab card",
  lease_agreement: "lease agreement",
  other: "document",
};

/**
 * Everything standing between this truck and its next load.
 *
 * Assembled in one place so the page can lead with it, and ordered by how hard
 * each one stops the work: a carrier that may not legally haul comes before a
 * medical card that lapses in three weeks, because one of them means nothing
 * can move at all.
 */
function blockersFor(input: {
  carrier?: CarrierView;
  driver?: DriverView;
  driverProblems: ReturnType<typeof driverDocumentProblems>;
  docProblems: ReturnType<typeof truckDocumentProblems>;
  fleetTruck: FleetTruck;
  trailerMissing: boolean;
}): DispatchBlocker[] {
  const out: DispatchBlocker[] = [];
  const { carrier, driver, driverProblems, docProblems, fleetTruck, trailerMissing } = input;

  /* ---- The carrier may not legally haul ---- */
  if (carrier && !carrier.canHaul) {
    out.push({
      key: "carrier-authority",
      severity: "critical",
      title:
        carrier.authority.status === "not_recorded"
          ? `${carrier.displayName}'s operating authority has never been recorded`
          : `${carrier.displayName}'s operating authority is ${carrier.authority.status === "inactive" ? "not active" : carrier.authority.status}`,
      detail:
        carrier.authority.note
        ?? "Nothing should be booked on this carrier's trucks until the authority is confirmed.",
      owner: "carrier",
    });
  }

  /* ---- The carrier's own paperwork ---- */
  for (const doc of carrier?.documents ?? []) {
    if (doc.status === "expired" || doc.status === "missing") {
      out.push({
        key: `carrier-doc-${doc.id}`,
        severity: doc.kind === "certificate_of_insurance" ? "critical" : "high",
        title:
          doc.status === "missing"
            ? `${carrier!.displayName} has no ${CARRIER_DOC[doc.kind]} on file`
            : `${carrier!.displayName}'s ${CARRIER_DOC[doc.kind]} has expired`,
        detail:
          doc.status === "missing"
            ? "Nobody has provided it, so there is nothing to check against."
            : `Lapsed ${doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString() : "some time ago"}.`,
        owner: "carrier",
      });
    }
  }

  /* ---- The truck itself ---- */
  for (const problem of docProblems) {
    if (problem.status !== "expired" && problem.status !== "rejected") continue;
    out.push({
      key: `truck-doc-${problem.id}`,
      severity: "high",
      title: `Unit ${fleetTruck.unit}'s ${DOC_NAME[problem.kind] ?? "document"} ${problem.status === "expired" ? "has expired" : "was rejected"}`,
      detail: problem.rejectionReason ?? "The truck cannot be dispatched until this is put right.",
      owner: "carrier",
      href: `/fleet/trucks/${fleetTruck.truckId}`,
    });
  }

  /* ---- The person ---- */
  if (driver) {
    for (const problem of driverProblems) {
      if (problem.status === "expiring_soon") continue;
      out.push({
        key: `driver-doc-${problem.requirementKey}`,
        severity: "high",
        title: `${driver.legalName}'s ${problem.label.toLowerCase()} ${problem.status === "rejected" ? "was rejected" : problem.status === "expired" ? "has expired" : "is missing"}`,
        detail: problem.rejectionReason ?? "The driver cannot be dispatched until this is put right.",
        owner: "driver",
      });
    }
    if (driver.availability.status === "inactive") {
      out.push({
        key: "driver-inactive",
        severity: "high",
        title: `${driver.legalName} is not working`,
        detail: "The truck needs a driver before anything can be booked on it.",
        owner: "carrier",
      });
    }
  } else {
    out.push({
      key: "no-driver",
      severity: "medium",
      title: `Unit ${fleetTruck.unit} has nobody on it`,
      detail: "A load cannot be dispatched to a truck with no driver assigned.",
      owner: "carrier",
      href: `/fleet/trucks/${fleetTruck.truckId}`,
    });
  }

  /* ---- The equipment ---- */
  if (trailerMissing) {
    out.push({
      key: "no-trailer",
      severity: "medium",
      title: `Unit ${fleetTruck.unit} has no trailer on it`,
      detail: "This is a tractor, so it needs a trailer before it can take a load.",
      owner: "dispatcher",
      href: "/fleet/trailers",
    });
  }

  const ORDER = { critical: 0, high: 1, medium: 2 };
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

const CARRIER_DOC: Record<string, string> = {
  operating_authority: "operating authority letter",
  certificate_of_insurance: "certificate of insurance",
  w9: "W-9",
  carrier_packet: "carrier packet",
  safety_rating: "safety rating",
  other: "document",
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
  { key: "outreach", milestone: 5, title: "Outreach", description: "Actually sending the prepared messages, plus reusable templates for follow-ups, in-transit updates and thank-yous. Drafts are prepared and conversations are recorded today; nothing is sent." },
  { key: "ratecon", milestone: 7, title: "Rate confirmation", description: "The broker's rate confirmation matched to this load, read field by field beside the original, signed with the carrier's authorised signature and returned." },
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
