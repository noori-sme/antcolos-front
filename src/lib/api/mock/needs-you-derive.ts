import {
  missingRequiredDocuments, TEMPLATE_LABEL,
  type Load, type Membership, type MtLoop, type NeedsYouCategory,
  type NeedsYouEntityRef, type NeedsYouItem, type NeedsYouRecommendedAction,
  type NeedsYouSeverity, type NeedsYouSource, type Organization,
  type PermissionKey, type CarrierView, type DriverView,
} from "@/types";
import { DOCUMENT_KIND_LABEL } from "@/config/documents";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import type { ServiceContext } from "../contracts/context";
import { mockStore } from "./store";
import {
  fleetSync, truckContextFrom, truckDispatchGrants, truckDocumentProblems,
  truckOperatingCarrier,
} from "./truck-registry";
import { carrierEscalationsFor, openLoopsFor, type MtLoopContext } from "./mt-loop";
import { allMatches } from "./opportunity-matching";
import { carriersForWorkspaceSync } from "./carrier-registry";
import { sessionForCycle } from "./search-session";
import { draftsFor } from "./outreach-drafts";
import { openNegotiations } from "./negotiation";
import { bookingsForWorkspace } from "./booking";
import { threadsFor } from "./communications";
import { progressOf, rateConsFor } from "./rate-confirmation";
import { reviewsFor } from "./driver-review";
import { driversForWorkspaceSync, driverDocumentProblems } from "./driver-registry";
import { nowIso } from "./time";
import { readableEvent, readableProjections } from "@/lib/propagation";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Needs You, generated from what is actually true.
 *
 * Nothing in this file is a card somebody wrote. Every item is the output of a
 * rule reading live records — the truck registry, the MT Loops, the loads, the
 * documents — and every item carries a stable KEY derived from the thing it is
 * about. That key is the whole mechanism:
 *
 *   the condition is true   → an item with that key exists
 *   the condition goes away → the item with that key is removed
 *
 * So an item disappears because the problem is gone, not because somebody
 * dismissed it, and it cannot be dismissed while the problem is still there. A
 * person can still SNOOZE one — that is a statement about when they want to
 * look at it, not a claim that it is fixed — and a snooze survives regeneration
 * along with the item's history and its assignee.
 *
 * Reconciliation runs on every read. It is synchronous and cheap, and doing it
 * any other way gives you a queue that is right only until somebody changes
 * something.
 */

/* -------------------------------------------------------------------------- */
/* The shape a rule produces                                                   */
/* -------------------------------------------------------------------------- */

interface Derived {
  /**
   * Stable for as long as the condition is. Built from the rule and the thing
   * it is about — never from a counter, a timestamp or a random value, because
   * an id that changes on every read is an item that can never be snoozed.
   */
  key: string;
  category: NeedsYouCategory;
  severity: NeedsYouSeverity;
  title: string;
  reason: string;
  detail?: string;
  entity: NeedsYouEntityRef;
  relatedEntities?: NeedsYouEntityRef[];
  recommendedAction: NeedsYouRecommendedAction;
  dueAt?: string;
  source: NeedsYouSource;
  requires: PermissionKey[];
}

/** The context the rules read from: a membership acting in an organization. */
export interface DeriveContext extends ServiceContext {
  organization: Organization;
  membership: Membership;
}

const ID_PREFIX = "ny_d_";
/**
 * Derived ids are scoped to the organization.
 *
 * A rule's key names the thing the item is about — a truck, a document — and
 * two organizations can legitimately both see the same one. Without the
 * organization in the id they would produce the SAME id in two different
 * buckets, which is not a data leak (every read is still scoped) but does
 * break the invariant that an item id identifies one item.
 */
const idFor = (organizationId: string, key: string) => `${ID_PREFIX}${organizationId}-${key}`;
const isDerived = (item: NeedsYouItem) => item.id.startsWith(ID_PREFIX);

const HOUR = 3_600_000;
const hoursUntil = (iso?: string) =>
  iso === undefined ? Number.POSITIVE_INFINITY : (new Date(iso).getTime() - Date.now()) / HOUR;

/* -------------------------------------------------------------------------- */
/* Propagation rules — exceptions the data flow itself produced                 */
/* -------------------------------------------------------------------------- */

/** Where each projection's own work is finished, per subscriber. */
const PROJECTION_RESOLUTION: Record<string, { href: string; label: string; requires: PermissionKey[] }> = {
  directory_parties: {
    href: "/directory/review",
    label: "Resolve the companies",
    requires: ["customers:resolve"],
  },
  driver_workflow: {
    href: "/loads",
    label: "Open the load",
    requires: ["loads:view"],
  },
  fuel_economy: {
    href: "/fuel/transactions",
    label: "Correct the purchase",
    requires: ["fuel:correct"],
  },
  ifta_preparation: {
    href: "/fuel/ifta",
    label: "Open the IFTA period",
    requires: ["ifta:view"],
  },
  maintenance_meter: {
    href: "/maintenance",
    label: "Check the odometer",
    requires: ["maintenance:view"],
  },
};

/**
 * Everything the propagation layer could not finish on its own.
 *
 * This is the rule that makes Needs You the surface for the whole data flow
 * rather than for a handful of modules. When a canonical record changes, every
 * authorized projection runs; the ones that FAILED or that need a person to
 * decide something appear here, deep-linked to where that decision is made.
 *
 * `pending` projections are deliberately NOT here. A projection waiting for a
 * module that has not been built is the honest state of this build, not
 * something a dispatcher can do anything about, and a queue full of items
 * nobody can action is a queue people stop reading.
 */
function propagationRules(ctx: DeriveContext): Derived[] {
  const out: Derived[] = [];

  for (const record of readableProjections(ctx, { state: ["failed", "needs_review"] })) {
    const event = readableEvent(ctx, record.eventId);
    if (!event) continue;

    const resolution = PROJECTION_RESOLUTION[record.subscriberId];
    const subject = event.subjectKind === "load"
      ? { kind: "load" as const, id: event.subjectId, label: `Load ${event.subjectId.slice(-6)}` }
      : event.subjectKind === "fuel_transaction"
        ? { kind: "fuel_transaction" as const, id: event.subjectId, label: "Fuel purchase" }
        : { kind: "truck" as const, id: event.subjectId, label: `Equipment ${event.subjectId.slice(-6)}` };

    out.push({
      // Stable for as long as the projection is in this state. Fix it, re-run it,
      // and the item stops existing — the same mechanism as every other rule.
      key: `projection-${record.state}-${record.subscriberId}-${record.eventId}`,
      category: record.state === "failed" ? "projection_failed" : "projection_needs_review",
      // A failure is a thing that should have worked and did not. A decision is a
      // thing that was always going to need a person, so it is not an alarm.
      severity: record.state === "failed" ? "high" : "medium",
      title: record.state === "failed"
        ? `${record.subscriberLabel} was not updated`
        : `${record.subscriberLabel} needs your decision`,
      reason: record.reason ?? record.detail,
      detail: `${record.detail} Ran ${record.attempts} time${record.attempts === 1 ? "" : "s"}.${record.retryable ? " Running it again could change the outcome." : ""}${record.mock ? " The receiving module is a labelled mock on this branch." : ""}`,
      entity: {
        ...subject,
        href: resolution?.href ?? "/audit/events",
      },
      recommendedAction: {
        kind: "review",
        label: resolution?.label ?? "Look at it",
        requires: resolution?.requires ?? ["audit:view"],
        href: resolution?.href,
        // Honest about the ones whose destination this branch does not have.
        deferred: !resolution,
      },
      source: "system",
      requires: resolution?.requires ?? ["audit:view"],
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* MT Loop rules                                                               */
/* -------------------------------------------------------------------------- */

function loopEntity(loop: MtLoop): NeedsYouEntityRef {
  const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");
  return {
    kind: "mt_loop",
    id: loop.loopId,
    label: `Unit ${loop.truckUnit}${where ? ` · ${where}` : ""}`,
    /*
     * The truck's own dispatch workspace, which is where a cycle is actually
     * worked — not the Home board it happens to be listed on.
     *
     * Every rule below also sets `recommendedAction.href`, which takes a person
     * to the thing that FIXES it: trailers for a missing trailer, rate
     * confirmations for an unconfirmed load, the truck for expired paperwork.
     * That is the difference between a queue and a to-do list.
     */
    href: `/dispatch/trucks/${loop.truckId}`,
  };
}

const LOOP_PERMS: PermissionKey[] = ["trucks:view", "loads:view"];

/**
 * A dispatch organization has raised one of this carrier's trucks back to them.
 *
 * ★ HOW WORK REACHES A CARRIER OWNER ACROSS AN ORGANIZATION BOUNDARY ★
 * It does not route. Routing never looks outside a workspace, which is what
 * stops a dispatcher's ordinary bad day landing on the carrier who hired them.
 * Work crosses when somebody in the dispatch organization decides it has to,
 * and this turns that decision into an item in the carrier's own queue — where
 * the ordinary rules then apply to it, so it reaches whoever at the carrier can
 * actually act rather than being addressed to "the Owner" by name.
 *
 * Scoped to loops on THIS carrier's trucks that somebody else is dispatching.
 * The item says what was asked and by whom; it does not expose anything about
 * how the dispatch organization has arranged itself internally, which is
 * theirs and none of the carrier's business.
 */
function carrierEscalationRules(ctx: DeriveContext): Derived[] {
  const loops = carrierEscalationsFor(ctx.organizationId);
  return loops.map((loop) => {
    const escalation = loop.carrierEscalation!;
    return {
      key: `carrier-escalation-${loop.truckId}`,
      category: "dispatch_escalation" as const,
      // Somebody has deliberately asked for the carrier. That is not a
      // background condition to be triaged later.
      severity: "high" as const,
      title: `${escalation.fromOrganizationName} needs you on unit ${loop.truckUnit}`,
      reason: `${escalation.byName} at ${escalation.fromOrganizationName} escalated this to you: "${escalation.note}"`,
      detail: `They are still covering the truck. Escalating asks for a decision; it does not hand the cycle back.`,
      entity: loopEntity(loop),
      recommendedAction: {
        kind: "assign_loop" as const,
        label: "Look at this truck",
        requires: LOOP_PERMS,
        href: `/fleet/trucks/${loop.truckId}`,
      },
      requires: LOOP_PERMS,
      source: "system" as const,
    };
  });
}

/**
 * Everything wrong with the loops this workspace is responsible for.
 *
 * Read straight off the loops, which have themselves just been reconciled
 * against the trucks. That ordering is deliberate: fix a truck, the loop
 * follows, and the Needs You item goes with it — one direction, no second copy
 * of the rules.
 */
function loopRules(loops: MtLoop[]): Derived[] {
  const out: Derived[] = [];

  for (const loop of loops) {
    const unit = `Unit ${loop.truckUnit}`;
    const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");
    const emptyIn = hoursUntil(loop.expectedEmptyAt);
    const emptyPhrase = loop.expectedEmptyAt === undefined
      ? "is empty"
      : emptyIn <= 0
        ? "is empty now"
        : `goes empty in about ${Math.round(emptyIn)} ${Math.round(emptyIn) === 1 ? "hour" : "hours"}`;

    /* ---- Nobody has ACCEPTED it ---- */
    //
    // Not "nobody is responsible for it". The Responsibility Engine has an
    // answer for every open loop, and this item goes to that person: what is
    // missing is somebody saying they have picked it up, which is a real thing
    // to chase and a different thing from having no owner.
    if (!loop.claimedByMembershipId && loop.status !== "closed") {
      out.push({
        key: `loop-unassigned-${loop.truckId}`,
        category: "unassigned_loop",
        // A truck already sitting empty is losing money now. One going empty
        // later today is not yet, and saying both are critical means neither is.
        severity: emptyIn <= 0 ? "high" : emptyIn <= 6 ? "medium" : "low",
        title: `${unit} ${emptyPhrase} and nobody has picked it up`,
        reason: where
          ? `Nobody has taken on the MT Loop for ${unit} in ${where}.`
          : `Nobody has taken on the MT Loop for ${unit}.`,
        detail: `Running under ${loop.carrierName}.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "assign_loop",
          label: "Take this loop",
          requires: ["loads:view"],
          // The board is where a loop is claimed, and it is on Home.
          href: "/home",
        },
        dueAt: loop.respondBy,
        source: "system",
        requires: LOOP_PERMS,
      });
    }

    /* ---- Stopped by a problem ---- */
    if (loop.status === "blocked") {
      out.push({
        key: `loop-blocked-${loop.truckId}`,
        category: "blocked_loop",
        severity: "high",
        title: `${unit} is blocked`,
        reason: loop.blockReason ?? "This MT Loop is blocked.",
        detail: loop.blockOrigin === "system"
          ? "Raised automatically. It clears itself the moment the underlying problem is fixed."
          : `Put on by ${loop.claimedByName ?? "somebody in this workspace"}. Only a person can take it off.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "review",
          label: "Open the truck",
          requires: ["trucks:view"],
          // A system block clears when the underlying record is fixed, and the
          // record is on the truck.
          href: `/dispatch/trucks/${loop.truckId}`,
        },
        dueAt: loop.respondBy,
        source: "system",
        requires: LOOP_PERMS,
      });
    }

    /* ---- We do not know when or where it goes empty ---- */
    const noWhen = loop.expectedEmptyAt === undefined;
    const noWhere = !loop.expectedEmptyCity && !loop.expectedEmptyState;
    if ((noWhen || noWhere) && loop.status !== "closed" && loop.status !== "running") {
      const missing = noWhen && noWhere
        ? "no empty time and no location"
        : noWhen ? "no empty time" : "no location";
      out.push({
        key: `loop-availability-${loop.truckId}`,
        category: "missing_availability",
        severity: noWhere ? "high" : "medium",
        title: `${unit} has ${missing} recorded`,
        reason: noWhere
          ? `Nobody has recorded where ${unit} will be when it goes empty, so it cannot be matched to anything.`
          : `Nobody has recorded when ${unit} goes empty, so it cannot be planned around.`,
        detail: `Running under ${loop.carrierName}.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "update_availability",
          label: "Record where and when it goes empty",
          requires: ["trucks:view"],
          href: `/dispatch/trucks/${loop.truckId}`,
        },
        source: "system",
        requires: LOOP_PERMS,
      });
    }

    /* ---- A tractor with nothing behind it ---- */
    if (loop.trailerRequired && !loop.trailerUnit && loop.status !== "closed") {
      out.push({
        key: `loop-trailer-${loop.truckId}`,
        category: "missing_equipment",
        severity: emptyIn <= 6 ? "high" : "medium",
        title: `${unit} has no trailer on it`,
        reason: `${unit} is a tractor and nothing is hooked up to it, so it cannot take a load.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "review",
          label: "Find a trailer for it",
          requires: ["trailers:view"],
          href: "/fleet/trailers",
        },
        dueAt: loop.respondBy,
        source: "system",
        requires: LOOP_PERMS,
      });
    }

    /* ---- Somebody has it, and the clock is running out ---- */
    // Only when we actually know when the truck goes empty. Without that there
    // is no deadline to be approaching, and the loop already carries an item
    // saying exactly that — reporting both would be the same gap twice.
    if (
      loop.claimedByMembershipId
      && loop.expectedEmptyAt !== undefined
      && (loop.status === "working" || loop.status === "unclaimed")
      && hoursUntil(loop.respondBy) <= 4
    ) {
      const late = hoursUntil(loop.respondBy) <= 0;
      out.push({
        key: `loop-sla-${loop.truckId}`,
        category: "sla_deadline",
        severity: late ? "high" : "medium",
        title: late
          ? `${unit} is empty and still has nothing on it`
          : `${unit} needs an answer within the hour`,
        reason: late
          ? `${unit} went empty${where ? ` in ${where}` : ""} and no load has been booked on it.`
          : `${unit} ${emptyPhrase}${where ? ` in ${where}` : ""} and no load has been booked on it.`,
        detail: `${loop.claimedByName ?? "Somebody"} is responsible for this loop.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "start_search",
          label: "Find a load",
          requires: ["loads:view"],
          // Said plainly rather than pretended: load search is not built yet.
          deferred: true,
        },
        dueAt: loop.respondBy,
        source: "system",
        requires: LOOP_PERMS,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Equipment and authority rules                                               */
/* -------------------------------------------------------------------------- */

const DOC_NAME: Record<string, string> = {
  registration: "Registration",
  title: "Title",
  insurance: "Insurance certificate",
  annual_inspection: "Annual inspection",
  cab_card: "Cab card",
  lease_agreement: "Lease agreement",
  other: "Document",
};

const DOC_SEVERITY: Record<string, NeedsYouSeverity> = {
  expired: "high",
  rejected: "high",
  missing: "medium",
  expiring_soon: "low",
};

const DOC_PHRASE: Record<string, string> = {
  expired: "has expired",
  rejected: "was rejected",
  missing: "has never been provided",
  expiring_soon: "expires soon",
};

/**
 * Paperwork and authority problems on the equipment this workspace can see.
 *
 * Deliberately about the FLEET rather than about the loops: a truck with an
 * expired registration is a problem whether or not it happens to be empty this
 * afternoon, and waiting for it to go empty to mention it is how a truck ends
 * up sitting on a Friday.
 */
function equipmentRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("trucks:view")) return [];
  const out: Derived[] = [];
  const trucks = fleetSync(truckContextFrom(ctx));

  for (const truck of trucks) {
    const truckEntity: NeedsYouEntityRef = {
      kind: "truck",
      id: truck.truckId,
      label: `Unit ${truck.unit}${truck.carrierName ? ` · ${truck.carrierName}` : ""}`,
      href: "/fleet/trucks",
    };

    /* ---- Documents ---- */
    for (const problem of truckDocumentProblems(truck.truckId)) {
      const name = DOC_NAME[problem.kind] ?? "Document";
      out.push({
        key: `truck-doc-${truck.truckId}-${problem.id}`,
        // Two different questions: is the document THERE, and is it still
        // good? Expired and expiring-soon are both the second one.
        category: problem.status === "expiring_soon" || problem.status === "expired"
          ? "expiring_document"
          : "missing_document",
        severity: DOC_SEVERITY[problem.status] ?? "medium",
        title: `${name} for unit ${truck.unit} ${DOC_PHRASE[problem.status] ?? "needs attention"}`,
        reason: problem.rejectionReason
          ?? (problem.expiresAt
            ? `${name} dated ${new Date(problem.expiresAt).toLocaleDateString()}.`
            : `${name} is not on file for unit ${truck.unit}.`),
        entity: truckEntity,
        recommendedAction: {
          kind: "request_document",
          label: "Open the truck",
          requires: ["trucks:view"],
        },
        dueAt: problem.expiresAt,
        source: "system",
        requires: ["trucks:view"],
      });
    }

    /* ---- Operating Authority ---- */
    // The carrier that handed us the truck is not the carrier running it. Both
    // records are genuine; they disagree, and dispatching on the wrong one puts
    // freight under an authority that never agreed to carry it.
    const grants = truckDispatchGrants(truck.truckId);
    const mine = grants.find((g) => g.dispatchOrganizationId === ctx.organizationId);
    const operator = truckOperatingCarrier(truck.truckId);
    if (mine && operator && operator.organizationId !== mine.grantedByCarrierOrganizationId) {
      out.push({
        key: `authority-${truck.truckId}`,
        category: "operating_authority",
        severity: "critical",
        title: `Unit ${truck.unit} is running under a different authority`,
        reason:
          `${mine.grantedByCarrierName} gave you dispatch access to unit ${truck.unit}, `
          + "but the truck is currently operating under another carrier's authority.",
        detail:
          "Nothing should be booked on this truck until the two records agree. "
          + "Who holds the lease is not shown here on purpose.",
        entity: truckEntity,
        recommendedAction: {
          kind: "review_authority",
          label: "Open the truck",
          requires: ["trucks:view"],
        },
        source: "system",
        requires: ["trucks:view"],
      });
    }

    /* ---- Two agencies, one truck ---- */
    if (mine && grants.length > 1) {
      out.push({
        key: `dispatch-conflict-${truck.truckId}`,
        category: "assignment_conflict",
        severity: "high",
        title: `Unit ${truck.unit} has been given to more than one dispatch workspace`,
        reason:
          `${grants.length} workspaces hold active dispatch access to unit ${truck.unit}. `
          + "Only the oldest grant holds its MT Loop, so the others cannot cover it.",
        detail:
          mine.id === grants[0].id
            ? "This workspace holds the oldest grant, so this truck's loop is yours."
            : "This workspace does not hold the oldest grant, so this truck's loop is not yours to work.",
        entity: truckEntity,
        recommendedAction: {
          kind: "review_authority",
          label: "Open the truck",
          requires: ["trucks:view"],
        },
        source: "system",
        requires: ["trucks:view"],
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Load rules                                                                  */
/* -------------------------------------------------------------------------- */

const LIVE_STATUSES = new Set<Load["status"]>([
  "verifying", "planned", "offered", "accepted", "assigned", "dispatched",
  "at_pickup", "loaded", "in_transit", "at_delivery",
]);

const MOVING_STATUSES = new Set<Load["status"]>([
  "loaded", "in_transit", "at_delivery", "delivered",
]);

function loadEntity(load: Load, driverView: boolean): NeedsYouEntityRef {
  const origin = load.stops.find((s) => s.kind === "pickup") ?? load.stops[0];
  const destination = [...load.stops].reverse().find((s) => s.kind === "delivery")
    ?? load.stops[load.stops.length - 1];
  return {
    kind: "load",
    id: load.id,
    label: `${load.reference} · ${origin.address.city}, ${origin.address.state} → ${destination.address.city}, ${destination.address.state}`,
    href: driverView ? "/driver/loads" : "/loads",
  };
}

/**
 * Everything the loads themselves are asking for.
 *
 * These run for every workspace, drivers included — a driver's Needs You is the
 * same generator narrowed by record scope, not a separate set of cards written
 * for them. What a driver ends up seeing is decided by `visibleTo` in the Needs
 * You service, which already knows which loads are theirs.
 */
function loadRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];
  const org = mockStore.org(ctx.organizationId);
  const driverView = ctx.scope.loads === "assigned";
  const live = org.loads.filter((l) => LIVE_STATUSES.has(l.status));

  for (const load of live) {
    const entity = loadEntity(load, driverView);
    const pickup = load.stops.find((s) => s.kind === "pickup") ?? load.stops[0];

    /* ---- Nothing is carrying it ---- */
    const covered = Boolean(load.assignment?.truckId || load.assignment?.carrierOrganizationId);
    if (!covered && hoursUntil(pickup.appointmentAt) <= 36) {
      const hours = Math.max(0, Math.round(hoursUntil(pickup.appointmentAt)));
      out.push({
        key: `load-uncovered-${load.id}`,
        category: "unassigned_load",
        severity: hours <= 6 ? "high" : hours <= 18 ? "medium" : "low",
        title: hours <= 0
          ? `${load.reference} was due to pick up and has no truck`
          : `${load.reference} picks up in ${hours} ${hours === 1 ? "hour" : "hours"} with no truck`,
        reason: `${pickup.address.city}, ${pickup.address.state} pickup. Nothing is assigned to carry it.`,
        entity,
        recommendedAction: {
          kind: "assign_load",
          label: "Open the load",
          requires: ["loads:assign"],
        },
        dueAt: pickup.appointmentAt,
        source: "system",
        requires: ["loads:view"],
      });
    }

    /* ---- The driver has not said yes ---- */
    if (load.assignment?.consent.status === "pending") {
      out.push({
        key: `load-consent-${load.id}`,
        category: "status_confirmation",
        severity: "high",
        title: `${load.reference} is waiting to be accepted`,
        reason: "This organization requires the driver to accept before the load is dispatched.",
        entity,
        recommendedAction: {
          kind: "confirm_status",
          label: "Open the load",
          requires: ["loads:status:update"],
        },
        dueAt: pickup.appointmentAt,
        source: "system",
        requires: ["loads:view"],
      });
    }

    /* ---- Somebody needs to check the rate confirmation ---- */
    if (load.status === "verifying") {
      out.push({
        key: `load-verifying-${load.id}`,
        category: "rate_con_verification",
        severity: "medium",
        title: `${load.reference} is waiting on rate confirmation checks`,
        reason: "The load is in verification and has not been released to planning.",
        entity,
        recommendedAction: { kind: "verify", label: "Open the load", requires: ["loads:edit"] },
        dueAt: pickup.appointmentAt,
        source: "system",
        requires: ["loads:view"],
      });
    }

    /* ---- Late to an appointment it has not left ---- */
    const overdue = load.stops.find(
      (s) => !s.departedAt && hoursUntil(s.appointmentAt) < 0,
    );
    if (overdue && (load.status === "in_transit" || load.status === "at_delivery" || load.status === "dispatched")) {
      out.push({
        key: `load-late-${load.id}-${overdue.id}`,
        category: "eta_risk",
        severity: "high",
        title: `${load.reference} is past its ${overdue.kind === "pickup" ? "pickup" : "delivery"} appointment`,
        reason: `The ${overdue.address.city}, ${overdue.address.state} appointment has passed and the truck has not left the stop.`,
        entity,
        recommendedAction: {
          kind: "contact_driver", label: "Open the load", requires: ["loads:view"],
        },
        dueAt: overdue.appointmentAt,
        source: "system",
        requires: ["loads:view"],
      });
    }
  }

  /* ---- Paperwork the load is short of, once it is actually moving ---- */
  if (ctx.permissions.has("documents:view")) {
    for (const load of org.loads) {
      if (!MOVING_STATUSES.has(load.status)) continue;
      for (const missing of missingRequiredDocuments(load)) {
        const name = DOCUMENT_KIND_LABEL[missing.kind];
        out.push({
          key: `load-doc-${load.id}-${missing.kind}`,
          category: "missing_document",
          severity: load.status === "delivered" ? "medium" : "low",
          title: `${name} missing on ${load.reference}`,
          reason: load.status === "delivered"
            ? `${load.reference} delivered and the ${name.toLowerCase()} has not come through.`
            : `${load.reference} is under way and the ${name.toLowerCase()} is not on file.`,
          entity: loadEntity(load, driverView),
          recommendedAction: {
            kind: "request_document",
            label: "Open the load",
            requires: ["documents:view"],
          },
          source: "system",
          requires: ["documents:view"],
        });
      }
    }
  }

  /* ---- Detention that has started and not ended ---- */
  const detentionStarted = org.events.filter((e) => e.kind === "exception.detention_started");
  for (const event of detentionStarted) {
    const ended = org.events.some(
      (e) => e.kind === "exception.detention_ended"
        && e.loadId === event.loadId
        && e.occurredAt > event.occurredAt,
    );
    if (ended) continue;
    const load = org.loads.find((l) => l.id === event.loadId);
    if (!load || !LIVE_STATUSES.has(load.status)) continue;
    out.push({
      key: `load-detention-${load.id}`,
      category: "detention",
      severity: "medium",
      title: `${load.reference} is sitting past its free time`,
      reason: event.payload?.note
        ? String(event.payload.note)
        : "Detention started and has not been closed out.",
      entity: loadEntity(load, driverView),
      recommendedAction: {
        kind: "contact_customer", label: "Open the load", requires: ["loads:view"],
      },
      source: "eld",
      requires: ["loads:view"],
    });
  }

  /* ---- Two live loads on one truck ---- */
  const byTruck = new Map<string, Load[]>();
  for (const load of live) {
    const truckId = load.assignment?.truckId;
    if (!truckId || load.assignment?.endedAt) continue;
    byTruck.set(truckId, [...(byTruck.get(truckId) ?? []), load]);
  }
  for (const [truckId, loads] of byTruck) {
    if (loads.length < 2) continue;
    const references = loads.map((l) => l.reference).sort();
    out.push({
      key: `load-conflict-${truckId}`,
      category: "assignment_conflict",
      severity: "high",
      title: `${references.join(" and ")} are both on one truck`,
      reason: `${loads.length} live loads are assigned to the same truck at the same time.`,
      detail: "One of them has to move to another truck, or be released.",
      entity: {
        kind: "truck", id: truckId,
        label: references.join(" · "),
        href: driverView ? "/driver/loads" : "/fleet/trucks",
      },
      relatedEntities: loads.map((l) => loadEntity(l, driverView)),
      recommendedAction: {
        kind: "assign_load", label: "Open the loads", requires: ["loads:assign"],
      },
      source: "system",
      requires: ["loads:view"],
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Carrier rules                                                               */
/* -------------------------------------------------------------------------- */

const CARRIER_DOC_NAME: Record<string, string> = {
  operating_authority: "Operating authority letter",
  certificate_of_insurance: "Certificate of insurance",
  w9: "W-9",
  carrier_packet: "Carrier packet",
  safety_rating: "Safety rating",
  other: "Document",
};

function carrierEntity(carrier: CarrierView): NeedsYouEntityRef {
  return {
    kind: "carrier",
    id: carrier.organizationId,
    label: carrier.displayName,
    href: "/home",
  };
}

/**
 * What is wrong with the carriers this workspace dispatches for.
 *
 * The most consequential rule in the file is the first one: a carrier without
 * active operating authority cannot legally haul, so every truck it owns is
 * unbookable no matter how good it looks on the board. That is a critical item
 * about the CARRIER rather than one repeated on each of its trucks — five
 * copies of one problem is five times the noise and no extra information.
 */
function carrierRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("trucks:view")) return [];
  const out: Derived[] = [];

  for (const carrier of carriersForWorkspaceSync(truckContextFrom(ctx))) {
    const trucks = carrier.truckCount;
    const unit = trucks === 1 ? "truck" : "trucks";

    /* ---- Cannot legally haul ---- */
    if (!carrier.canHaul) {
      const unrecorded = carrier.authority.status === "not_recorded";
      out.push({
        key: `carrier-authority-${carrier.organizationId}`,
        category: "operating_authority",
        severity: "critical",
        title: unrecorded
          ? `${carrier.displayName}'s operating authority has never been recorded`
          : `${carrier.displayName} cannot legally haul`,
        reason: unrecorded
          ? `Nothing confirms ${carrier.displayName} may run freight, and ${trucks} ${unit} of theirs are on your board.`
          : `${carrier.displayName}'s authority is ${carrier.authority.status === "inactive" ? "not active" : carrier.authority.status}. Nothing should be booked on their ${trucks} ${unit}.`,
        detail: carrier.authority.note,
        entity: carrierEntity(carrier),
        recommendedAction: {
          kind: "review_authority",
          label: "Open a truck of theirs",
          requires: ["trucks:view"],
        },
        source: "system",
        requires: ["trucks:view"],
      });
    }

    /* ---- The carrier's own paperwork ---- */
    for (const document of carrier.documents) {
      const name = CARRIER_DOC_NAME[document.kind] ?? "Document";
      if (document.status === "expired" || document.status === "missing") {
        out.push({
          key: `carrier-doc-${document.id}`,
          category: document.status === "missing" ? "missing_document" : "expiring_document",
          // Insurance is the one that stops freight outright.
          severity: document.kind === "certificate_of_insurance" ? "critical" : "high",
          title: document.status === "missing"
            ? `${carrier.displayName} has no ${name.toLowerCase()} on file`
            : `${carrier.displayName}'s ${name.toLowerCase()} has expired`,
          reason: document.status === "missing"
            ? `Nobody has provided it, so there is nothing to check ${carrier.displayName} against.`
            : `Lapsed ${document.expiresAt ? new Date(document.expiresAt).toLocaleDateString() : "some time ago"}.`,
          entity: carrierEntity(carrier),
          recommendedAction: {
            kind: "request_document", label: "Open a truck of theirs", requires: ["trucks:view"],
          },
          dueAt: document.expiresAt,
          source: "system",
          requires: ["trucks:view"],
        });
      } else if (document.status === "expiring_soon") {
        out.push({
          key: `carrier-doc-${document.id}`,
          category: "expiring_document",
          severity: "medium",
          title: `${carrier.displayName}'s ${name.toLowerCase()} expires soon`,
          reason: `Lapses ${document.expiresAt ? new Date(document.expiresAt).toLocaleDateString() : "shortly"}. Freight stops when it does.`,
          entity: carrierEntity(carrier),
          recommendedAction: {
            kind: "request_document", label: "Open a truck of theirs", requires: ["trucks:view"],
          },
          dueAt: document.expiresAt,
          source: "system",
          requires: ["trucks:view"],
        });
      }
    }

    /* ---- Nobody to call ---- */
    if (carrier.contacts.length === 0) {
      out.push({
        key: `carrier-contact-${carrier.organizationId}`,
        category: "missing_availability",
        severity: "medium",
        title: `There is nobody to call at ${carrier.displayName}`,
        reason: `No contact is recorded, so there is no way to reach them about their ${trucks} ${unit}.`,
        entity: carrierEntity(carrier),
        recommendedAction: {
          kind: "contact_customer", label: "Open a truck of theirs", requires: ["trucks:view"],
        },
        source: "system",
        requires: ["trucks:view"],
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Driver rules                                                                */
/* -------------------------------------------------------------------------- */

function driverEntity(driver: DriverView): NeedsYouEntityRef {
  return {
    kind: "driver",
    id: driver.driverProfileId,
    label: `${driver.legalName} · ${driver.carrierName}`,
    href: "/people/drivers",
  };
}

/**
 * What is wrong with the people.
 *
 * Only ever about documents the driver actually SHARED with the carrier. A
 * document they kept to themselves is not a gap in the carrier's file and must
 * never be reported as one — the driver registry already refuses to call it
 * missing, and this rule inherits that.
 */
function driverRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("drivers:view")) return [];
  const out: Derived[] = [];

  for (const driver of driversForWorkspaceSync(truckContextFrom(ctx))) {
    for (const problem of driverDocumentProblems(driver)) {
      const severity: NeedsYouSeverity =
        problem.status === "expired" || problem.status === "rejected" || problem.status === "missing"
          ? "high"
          : "medium";
      out.push({
        key: `driver-doc-${driver.driverProfileId}-${problem.requirementKey}`,
        category: problem.status === "expiring_soon" ? "expiring_document" : "missing_document",
        severity,
        title: `${driver.legalName}'s ${problem.label.toLowerCase()} ${
          problem.status === "rejected" ? "was rejected"
            : problem.status === "expired" ? "has expired"
              : problem.status === "missing" ? "has not been provided"
                : "expires soon"
        }`,
        reason: problem.rejectionReason
          ?? (problem.expiresAt
            ? `Dated ${new Date(problem.expiresAt).toLocaleDateString()}. They cannot run once it lapses.`
            : `${driver.carrierName} needs it before ${driver.legalName} can be dispatched.`),
        entity: driverEntity(driver),
        recommendedAction: {
          kind: "contact_driver", label: "Call the driver", requires: ["drivers:view"],
        },
        dueAt: problem.expiresAt,
        source: "system",
        requires: ["drivers:view"],
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Search and outreach rules                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Nobody is looking for a load for a truck that is empty.
 *
 * The single most expensive thing this system can catch. A truck with an open
 * cycle, somebody responsible for it, and no search running is a truck that is
 * costing money while everyone assumes somebody else has it. Deliberately NOT
 * raised for a loop nobody holds — that already has its own item, and two cards
 * about one truck is how a queue stops being read.
 */
function searchRules(ctx: DeriveContext, loops: MtLoop[]): Derived[] {
  const out: Derived[] = [];
  for (const loop of loops) {
    if (loop.status === "closed" || loop.status === "paused" || loop.status === "blocked") continue;
    if (loop.status === "covered" || loop.status === "running") continue;
    // A loop with nobody on it is a different problem, already reported.
    if (!loop.claimedByMembershipId) continue;
    if (sessionForCycle(loop.loopId, ctx as MtLoopContext)) continue;

    const emptyIn = hoursUntil(loop.expectedEmptyAt);
    out.push({
      key: `no-search-${loop.truckId}`,
      category: "no_search",
      severity: emptyIn <= 0 ? "high" : emptyIn <= 8 ? "medium" : "low",
      title: `Nobody is looking for a load for unit ${loop.truckUnit}`,
      reason: `${loop.claimedByName ?? "Somebody"} is responsible for this cycle and no search has been started.`,
      detail: `Running under ${loop.carrierName}.`,
      entity: loopEntity(loop),
      recommendedAction: {
        kind: "start_search", label: "Open the truck and start looking", requires: ["loads:view"],
      },
      dueAt: loop.respondBy,
      source: "system",
      requires: LOOP_PERMS,
    });
  }
  return out;
}

/**
 * A prepared message nobody has read.
 *
 * Drafts are only worth preparing if somebody reads them, and a load does not
 * wait. The severity follows the PICKUP, not the age of the draft: a message
 * about a load picking up in three hours is urgent however recently it was
 * written.
 */
function draftRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];

  for (const draft of draftsFor(ctx as MtLoopContext)) {
    if (draft.status !== "ready") continue;
    out.push({
      key: `draft-${draft.draftId}`,
      category: draft.blockedReason ? "missing_availability" : "draft_waiting",
      severity: draft.blockedReason ? "high" : "medium",
      title: draft.blockedReason
        ? `The message to ${draft.toName ?? "the broker"} for ${draft.carrierName} cannot go out`
        : `A message for ${draft.carrierName} is waiting for you to read it`,
      reason: draft.blockedReason
        ?? `${draft.subject} — covering ${draft.truckUnits.length === 1 ? "unit" : "units"} ${draft.truckUnits.join(", ")}. Nothing is sent until you approve it.`,
      entity: {
        kind: "draft",
        id: draft.draftId,
        label: `${draft.carrierName} · ${draft.truckUnits.join(", ")}`,
        href: "/dispatch/opportunities",
      },
      recommendedAction: {
        kind: "review_draft", label: "Read it", requires: ["loads:view"],
      },
      source: "system",
      requires: ["loads:view"],
    });
  }
  return out;
}

/**
 * A load worth having that is about to become unbookable.
 *
 * Only ever raised for something a dispatcher actually picked out. Every
 * eligible load is eventually about to expire, and saying so about all of them
 * would bury the ones somebody has already decided they want.
 */
function opportunityRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];

  for (const row of allMatches(ctx as MtLoopContext)) {
    if (row.match.status !== "shortlisted") continue;
    if (row.listing.status !== "open") continue;
    const hours = hoursUntil(row.listing.pickupAt);
    if (hours > 6) continue;

    out.push({
      key: `expiring-${row.match.matchId}`,
      category: "expiring_opportunity",
      severity: hours <= 2 ? "high" : "medium",
      title: `${row.listing.origin.city} → ${row.listing.destination.city} picks up in ${Math.max(0, Math.round(hours))}h`,
      reason: `You short-listed this for unit ${row.match.truckUnit} and it has not been booked.`,
      detail: `${row.listing.broker.name}${row.listing.broker.phone ? ` · ${row.listing.broker.phone}` : ""}`,
      entity: {
        kind: "listing",
        id: row.listing.listingId,
        label: `${row.listing.origin.city}, ${row.listing.origin.state} → ${row.listing.destination.city}, ${row.listing.destination.state}`,
        href: "/dispatch/opportunities",
      },
      recommendedAction: {
        kind: "contact_customer", label: "Ring the broker", requires: ["loads:view"],
      },
      dueAt: row.listing.pickupAt,
      source: "system",
      requires: ["loads:view"],
    });
  }
  return out;
}

/**
 * A conversation with a broker that is waiting on us.
 *
 * The most time-sensitive thing in the whole module. A broker who has come back
 * with a number and heard nothing for an hour gives the load to somebody else,
 * and the dispatcher who opened the conversation is usually looking at a
 * different screen by then.
 */
function negotiationRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];

  for (const negotiation of openNegotiations(ctx as MtLoopContext)) {
    if (negotiation.status === "waiting_on_you") {
      const hours = negotiation.offerExpiresAt
        ? hoursUntil(negotiation.offerExpiresAt)
        : undefined;
      const expiring = hours !== undefined && hours <= 2;
      out.push({
        key: `negotiation-${negotiation.negotiationId}`,
        category: expiring ? "offer_expiring" : "broker_replied",
        severity: expiring ? "critical" : "high",
        title: expiring
          ? `${negotiation.brokerName}'s number on unit ${negotiation.truckUnit} lapses in ${Math.max(0, Math.round(hours))}h`
          : `${negotiation.brokerName} answered about unit ${negotiation.truckUnit}`,
        reason: negotiation.onTheTableCents !== undefined
          ? `${money(negotiation.onTheTableCents)} is on the table. You asked ${money(negotiation.askedRateCents)}.`
          : "They have come back to you and nobody has answered.",
        detail: lastWord(negotiation),
        entity: {
          kind: "negotiation",
          id: negotiation.negotiationId,
          label: `${negotiation.brokerName} · unit ${negotiation.truckUnit}`,
          href: "/dispatch/opportunities",
        },
        recommendedAction: {
          kind: "answer_broker", label: "Answer them", requires: ["loads:view"],
        },
        dueAt: negotiation.offerExpiresAt,
        source: "system",
        requires: ["loads:view"],
      });
      continue;
    }

    if (negotiation.status === "agreed") {
      out.push({
        key: `agreed-${negotiation.negotiationId}`,
        category: "agreed_not_booked",
        severity: "high",
        title: `${money(negotiation.agreedRateCents ?? 0)} agreed with ${negotiation.brokerName}, nothing booked`,
        reason: `Unit ${negotiation.truckUnit} is still empty as far as the rest of Antcolos is concerned. Booking it is what creates the load.`,
        detail: negotiation.belowFloorReason
          ? `Agreed under ${negotiation.carrierName}'s floor. ${negotiation.belowFloorReason}`
          : undefined,
        entity: {
          kind: "negotiation",
          id: negotiation.negotiationId,
          label: `${negotiation.brokerName} · unit ${negotiation.truckUnit}`,
          href: "/dispatch/opportunities",
        },
        recommendedAction: {
          kind: "book_load", label: "Book it", requires: ["loads:create"],
        },
        source: "system",
        requires: ["loads:view"],
      });
    }
  }
  return out;
}

/**
 * What a booked load is still waiting for.
 *
 * Two conditions, and they are different problems with different owners. A
 * driver who has not accepted is a person to ring; a broker with no permanent
 * profile is a record to link, and it stays raised because the profile system
 * that owns that linking is not part of this workspace yet.
 */
function bookingRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];

  for (const booking of bookingsForWorkspace(ctx as MtLoopContext)) {
    if (booking.consent === "pending") {
      out.push({
        key: `consent-${booking.bookingId}`,
        category: "driver_consent",
        severity: "critical",
        title: `${booking.driverName ?? "The driver"} has not accepted ${booking.loadReference}`,
        reason: `${booking.truckUnit} is booked and the carrier requires the driver to accept before it is assigned.`,
        entity: {
          kind: "booking",
          id: booking.bookingId,
          label: `${booking.loadReference} · unit ${booking.truckUnit}`,
          href: "/dispatch/opportunities",
        },
        recommendedAction: {
          kind: "ask_driver", label: "Record their answer", requires: ["loads:create"],
        },
        source: "system",
        requires: ["loads:view"],
      });
    }

    if (booking.consent === "declined") {
      out.push({
        key: `declined-${booking.bookingId}`,
        category: "driver_consent",
        severity: "critical",
        title: `${booking.driverName ?? "The driver"} declined ${booking.loadReference}`,
        reason: `${booking.truckUnit} is committed to a broker and has nobody to drive it. The broker has to be told.`,
        entity: {
          kind: "booking",
          id: booking.bookingId,
          label: `${booking.loadReference} · unit ${booking.truckUnit}`,
          href: "/dispatch/opportunities",
        },
        recommendedAction: {
          kind: "contact_customer", label: "Ring the broker", requires: ["loads:view"],
        },
        source: "system",
        requires: ["loads:view"],
      });
    }

    if (!booking.brokerProfileLinked) {
      out.push({
        key: `broker-profile-${booking.bookingId}`,
        category: "broker_profile_unlinked",
        severity: "low",
        title: `${booking.brokerName} on ${booking.loadReference} is not a saved profile yet`,
        reason: "The load carries the name exactly as the market gave it. Linking it to the permanent broker record is a person's decision, not a guess.",
        detail: "The Broker, Shipper and Receiver profiles are built in their own module and are not in this workspace yet.",
        entity: {
          kind: "booking",
          id: booking.bookingId,
          label: `${booking.brokerName} · ${booking.loadReference}`,
          href: "/dispatch/opportunities",
        },
        recommendedAction: {
          kind: "review", label: "Link the profile", requires: ["loads:view"], deferred: true,
        },
        source: "system",
        requires: ["loads:view"],
      });
    }
  }
  return out;
}

/** The last thing anybody said, for the queue's one-line detail. */
function lastWord(negotiation: { rounds: { note?: string; byName: string }[] }): string | undefined {
  const last = [...negotiation.rounds].reverse().find((r) => r.note);
  return last ? `${last.byName}: ${last.note}` : undefined;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", {
  minimumFractionDigits: 0, maximumFractionDigits: 0,
})}`;

/**
 * Messages nobody has read, and rate confirmations nobody has checked.
 *
 * Both are the same kind of problem: Antcolos has done the preparing and is now
 * waiting on a person, and until that person acts, a broker is waiting on
 * silence. The rate confirmation rules are the sharper of the two — an unsigned
 * confirmation means the load is not really confirmed, and a confirmation that
 * disagrees with the booking is money about to be lost.
 */
function messageRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];

  for (const thread of threadsFor(ctx as MtLoopContext)) {
    for (const message of thread.messages) {
      if (message.status !== "draft") continue;
      // The opening inquiry has its own queue item already, from the drafts
      // service. Raising it twice would put the same job on the list twice.
      if (message.templateKey === "load_inquiry") continue;
      out.push({
        key: `message-${message.messageId}`,
        category: "message_waiting",
        severity: message.blockedReason ? "high" : "medium",
        title: message.blockedReason
          ? `The ${TEMPLATE_LABEL[message.templateKey].toLowerCase()} to ${thread.brokerName} cannot go out`
          : `A ${TEMPLATE_LABEL[message.templateKey].toLowerCase()} for ${thread.brokerName} is waiting for you`,
        reason: message.blockedReason
          ?? message.preparedBecause
          ?? `${message.subject} — nothing is sent until you have read it.`,
        detail: `From ${thread.carrierName}${thread.loadReference ? ` · ${thread.loadReference}` : ""}`,
        entity: {
          kind: "message",
          id: message.messageId,
          label: `${thread.brokerName} · ${TEMPLATE_LABEL[message.templateKey]}`,
          href: "/dispatch/opportunities",
        },
        recommendedAction: {
          kind: "read_message", label: "Read it", requires: ["loads:view"],
        },
        source: "system",
        requires: ["loads:view"],
      });
    }
  }
  return out;
}

function rateConRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];
  const workflows = rateConsFor(ctx as MtLoopContext);

  for (const w of workflows) {
    if (w.status === "returned" || w.status === "rejected") continue;
    const progress = progressOf(w);

    if (progress.disagreements > 0) {
      out.push({
        key: `ratecon-diff-${w.rateConId}`,
        category: "ratecon_disagrees",
        severity: "critical",
        title: `${w.brokerName}'s rate confirmation does not match ${w.loadReference}`,
        reason: `${progress.disagreements} thing${progress.disagreements === 1 ? "" : "s"} on the document disagree${progress.disagreements === 1 ? "s" : ""} with what was booked. Signing it as it stands agrees to their version.`,
        entity: {
          kind: "rate_confirmation",
          id: w.rateConId,
          label: `${w.loadReference} · ${w.brokerName}`,
          href: `/dispatch/rate-confirmations/${w.rateConId}`,
        },
        recommendedAction: {
          kind: "check_ratecon", label: "Check it", requires: ["loads:view"],
        },
        source: "ocr",
        requires: ["loads:view"],
      });
    }

    out.push({
      key: `ratecon-${w.rateConId}`,
      category: "ratecon_waiting",
      severity: progress.canConfirm ? "high" : "medium",
      title: progress.canConfirm
        ? `${w.loadReference} is checked and waiting for your confirmation`
        : `${w.loadReference} has a rate confirmation nobody has checked`,
      reason: progress.canConfirm
        ? `Every field has been looked at. ${w.carrierName}'s signature goes on only when you confirm.`
        : `${progress.reviewed} of ${progress.required} fields checked. Nothing is signed until all of them are.`,
      entity: {
        kind: "rate_confirmation",
        id: w.rateConId,
        label: `${w.loadReference} · ${w.brokerName}`,
        href: `/dispatch/rate-confirmations/${w.rateConId}`,
      },
      recommendedAction: {
        kind: "check_ratecon",
        label: progress.canConfirm ? "Confirm and sign" : "Check it",
        requires: ["loads:view"],
      },
      source: "ocr",
      requires: ["loads:view"],
    });
  }

  /* ---- Booked, and nothing has arrived ---- */
  for (const booking of bookingsForWorkspace(ctx as MtLoopContext)) {
    if (workflows.some((w) => w.bookingId === booking.bookingId && w.status !== "rejected")) continue;
    out.push({
      key: `ratecon-missing-${booking.bookingId}`,
      category: "ratecon_missing",
      severity: "medium",
      title: `No rate confirmation yet for ${booking.loadReference}`,
      reason: `${booking.brokerName} has not sent one. A load without a signed confirmation is not a confirmed load, whatever was agreed on the phone.`,
      entity: {
        kind: "booking",
        id: booking.bookingId,
        label: `${booking.loadReference} · ${booking.brokerName}`,
        href: "/dispatch/opportunities",
      },
      recommendedAction: {
        kind: "contact_customer", label: "Chase the broker", requires: ["loads:view"],
      },
      source: "system",
      requires: ["loads:view"],
    });
  }

  return out;
}

/**
 * Opportunities sitting with a driver.
 *
 * The most easily forgotten thing in the whole module: a dispatcher sends a
 * load to a driver, moves on to the next truck, and neither of them comes back
 * to it. The load goes to somebody else and nobody notices until the board is
 * empty. Every one of these clears by itself the moment the driver answers.
 */
function driverReviewRules(ctx: DeriveContext): Derived[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const out: Derived[] = [];

  for (const review of reviewsFor(ctx as MtLoopContext)) {
    if (review.status === "withdrawn" || review.status === "approved") continue;

    const common = {
      entity: {
        kind: "driver_review" as const,
        id: review.reviewId,
        label: `${review.driverName} · unit ${review.truckUnit}`,
        href: `/dispatch/trucks/${review.dispatchCycleId}`,
      },
      source: "system" as const,
      requires: ["loads:view"] as PermissionKey[],
    };

    if (review.status === "waiting") {
      const hours = (Date.now() - Date.parse(review.sentAt)) / 3_600_000;
      out.push({
        ...common,
        key: `driver-review-${review.reviewId}`,
        category: "driver_review_waiting",
        severity: hours >= 2 ? "high" : "medium",
        title: `${review.driverName} has not answered about unit ${review.truckUnit}`,
        reason: `${review.sent.originCity} → ${review.sent.destinationCity} was sent for their approval. Nobody may negotiate it until they answer.`,
        detail: review.sent.note,
        recommendedAction: {
          kind: "chase_driver", label: "Chase them", requires: ["loads:view"],
        },
        dueAt: review.sent.pickupAt,
      });
      continue;
    }

    const last = [...review.decisions].reverse().find((d) => d.comment);
    if (review.status === "countered") {
      out.push({
        ...common,
        key: `driver-countered-${review.reviewId}`,
        category: "driver_countered",
        severity: "high",
        title: `${review.driverName} will take unit ${review.truckUnit}'s load at a different number`,
        reason: last?.comment ?? "They countered without saying why.",
        recommendedAction: {
          kind: "answer_broker", label: "Go and negotiate it", requires: ["loads:view"],
        },
      });
      continue;
    }

    // Declined or paused: the truck is still empty and nobody is working it.
    out.push({
      ...common,
      key: `driver-blocked-${review.reviewId}`,
      category: "driver_blocked",
      severity: "high",
      title: review.status === "declined"
        ? `${review.driverName} declined unit ${review.truckUnit}'s load`
        : `${review.driverName} has a question about unit ${review.truckUnit}'s load`,
      reason: last?.comment
        ?? (review.status === "declined" ? "No reason was recorded." : "No question was recorded."),
      detail: "The truck is still empty and this load is not being worked.",
      recommendedAction: {
        kind: "chase_driver", label: "Answer them", requires: ["loads:view"],
      },
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

/** Every rule, for one membership in one organization. */
function derive(ctx: DeriveContext): Derived[] {
  const workspace = resolveWorkspace(ctx.organization, ctx.membership);
  const items: Derived[] = [];

  // Loop rules only where there are loops: a dispatch workspace, or a carrier
  // dispatching its own trucks. A driver has none, and neither does anybody
  // scoped to their own records — `openLoopsFor` returns nothing for them.
  if (workspace && workspace.kind !== "driver" && ctx.scope.loads !== "assigned") {
    const loops = openLoopsFor(ctx as MtLoopContext);
    items.push(...loopRules(loops));
    items.push(...equipmentRules(ctx));
    items.push(...carrierRules(ctx));
    items.push(...driverRules(ctx));
    items.push(...searchRules(ctx, loops));
    items.push(...draftRules(ctx));
    items.push(...opportunityRules(ctx));
    items.push(...negotiationRules(ctx));
    items.push(...bookingRules(ctx));
    items.push(...messageRules(ctx));
    items.push(...rateConRules(ctx));
    items.push(...driverReviewRules(ctx));
  }
  /*
   * Runs for every workspace, outside the block above.
   *
   * A carrier that has handed all its dispatch to an agency has no loops of
   * its own, so `openLoopsFor` gives it nothing and none of those rules apply
   * — and it is exactly that carrier who most needs to hear when the agency
   * escalates. Putting this inside the block would have hidden it from the
   * only people it is for.
   */
  items.push(...carrierEscalationRules(ctx));
  items.push(...loadRules(ctx));
  // Last, because it is about what the OTHER rules' records did when they
  // changed, and reading it after them keeps the reasoning in one direction.
  items.push(...propagationRules(ctx));

  return items;
}

/**
 * Bring the stored Needs You items in line with what the rules say right now.
 *
 * Three cases, and the third is the one that matters:
 *
 *   new condition   → an item appears
 *   same condition  → the item is refreshed in place, keeping its status, its
 *                     snooze, its assignee and its whole history
 *   gone condition  → the item is removed, because the problem is gone
 *
 * A person resolving a derived item by hand does NOT make it go away while the
 * condition holds; it comes back on the next read with a line in its history
 * saying why. That is not stubbornness, it is the only honest answer: the queue
 * is a view of reality, and clicking a button did not change reality.
 */
export function syncDerivedNeedsYou(ctx: DeriveContext): void {
  const wanted = derive(ctx);
  const bucket = mockStore.needsYouBucket(ctx.organizationId);
  const at = nowIso();

  const seen = new Set<string>();
  for (const d of wanted) {
    const id = idFor(ctx.organizationId, d.key);
    seen.add(id);
    const existing = bucket.find((n) => n.id === id);

    if (!existing) {
      bucket.push({
        id,
        organizationId: ctx.organizationId,
        status: "open",
        createdAt: at,
        category: d.category,
        severity: d.severity,
        title: d.title,
        reason: d.reason,
        detail: d.detail,
        entity: d.entity,
        relatedEntities: d.relatedEntities,
        recommendedAction: d.recommendedAction,
        dueAt: d.dueAt,
        source: d.source,
        requires: d.requires,
        history: [
          {
            id: `nyh_${id}`,
            at,
            actor: {
              userId: "system", membershipId: "system",
              displayNameSnapshot: "Antcolos", source: "system",
            },
            action: "created",
            note: d.reason,
          },
        ],
      });
      continue;
    }

    // Refresh what the rule owns. Everything a PERSON owns — status, snooze,
    // assignee, history — is left exactly as it is.
    existing.category = d.category;
    existing.severity = d.severity;
    existing.title = d.title;
    existing.reason = d.reason;
    existing.detail = d.detail;
    existing.entity = d.entity;
    existing.relatedEntities = d.relatedEntities;
    existing.recommendedAction = d.recommendedAction;
    existing.dueAt = d.dueAt;

    if (existing.status === "resolved") {
      existing.status = "open";
      existing.resolvedAt = undefined;
      existing.resolutionNote = undefined;
      existing.history = [
        ...existing.history,
        {
          id: `nyh_${id}_${existing.history.length}`,
          at,
          actor: {
            userId: "system", membershipId: "system",
            displayNameSnapshot: "Antcolos", source: "system",
          },
          action: "reopened",
          note: "This was marked done, but the problem it is about is still there.",
        },
      ];
    }
  }

  // Anything derived that no rule produced this time is, by definition, fixed.
  for (let i = bucket.length - 1; i >= 0; i--) {
    const item = bucket[i];
    if (isDerived(item) && !seen.has(item.id)) bucket.splice(i, 1);
  }
}

/* -------------------------------------------------------------------------- */
/* Adapting a plain ServiceContext                                             */
/* -------------------------------------------------------------------------- */

/**
 * Fills in the organization and membership a plain ServiceContext does not
 * carry.
 *
 * The Needs You contract takes a ServiceContext, and it should stay that way —
 * the workspace shape is a mock-layer concern, not something every caller
 * should have to know about. The session fixtures are the mock's own directory
 * of organizations and memberships, and the ids on the context came from there
 * in the first place, so this is a lookup rather than a guess. It returns null
 * for anything it cannot find, and the caller simply skips derivation.
 */
export function deriveContextFrom(ctx: ServiceContext): DeriveContext | null {
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === ctx.organizationId);
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === ctx.membershipId);
  if (!organization || !membership) return null;
  return { ...ctx, organization, membership };
}

/** Regenerate this organization's derived items, if the caller can be resolved. */
export function syncDerivedNeedsYouFor(ctx: ServiceContext): void {
  const derived = deriveContextFrom(ctx);
  if (derived) syncDerivedNeedsYou(derived);
}
