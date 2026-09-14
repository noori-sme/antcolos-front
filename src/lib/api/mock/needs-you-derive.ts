import {
  missingRequiredDocuments,
  type Load, type Membership, type MtLoop, type NeedsYouCategory,
  type NeedsYouEntityRef, type NeedsYouItem, type NeedsYouRecommendedAction,
  type NeedsYouSeverity, type NeedsYouSource, type Organization,
  type PermissionKey,
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
import { openLoopsFor, type MtLoopContext } from "./mt-loop";
import { nowIso } from "./time";

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
const idFor = (key: string) => `${ID_PREFIX}${key}`;
const isDerived = (item: NeedsYouItem) => item.id.startsWith(ID_PREFIX);

const HOUR = 3_600_000;
const hoursUntil = (iso?: string) =>
  iso === undefined ? Number.POSITIVE_INFINITY : (new Date(iso).getTime() - Date.now()) / HOUR;

/* -------------------------------------------------------------------------- */
/* MT Loop rules                                                               */
/* -------------------------------------------------------------------------- */

function loopEntity(loop: MtLoop): NeedsYouEntityRef {
  const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");
  return {
    kind: "mt_loop",
    id: loop.loopId,
    label: `Unit ${loop.truckUnit}${where ? ` · ${where}` : ""}`,
    // The board lives on Home. There is no separate loop screen yet, and
    // pointing at one that does not exist would be worse than pointing here.
    href: "/home",
  };
}

const LOOP_PERMS: PermissionKey[] = ["trucks:view", "loads:view"];

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

    /* ---- Nobody has taken responsibility for it ---- */
    if (!loop.responsibleMembershipId && loop.status !== "closed") {
      out.push({
        key: `loop-unassigned-${loop.truckId}`,
        category: "unassigned_loop",
        // A truck already sitting empty is losing money now. One going empty
        // later today is not yet, and saying both are critical means neither is.
        severity: emptyIn <= 0 ? "high" : emptyIn <= 6 ? "medium" : "low",
        title: `${unit} ${emptyPhrase} and nobody is on it`,
        reason: where
          ? `The MT Loop for ${unit} in ${where} has no responsible dispatcher.`
          : `The MT Loop for ${unit} has no responsible dispatcher.`,
        detail: `Running under ${loop.carrierName}.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "assign_loop",
          label: "Take this loop",
          requires: ["loads:view"],
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
          : `Put on by ${loop.responsibleName ?? "somebody in this workspace"}. Only a person can take it off.`,
        entity: loopEntity(loop),
        recommendedAction: {
          kind: "review",
          label: "Open the truck",
          requires: ["trucks:view"],
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
          label: "Open the truck",
          requires: ["trucks:view"],
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
          label: "Open trailers",
          requires: ["trailers:view"],
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
      loop.responsibleMembershipId
      && loop.expectedEmptyAt !== undefined
      && (loop.status === "working" || loop.status === "unassigned")
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
        detail: `${loop.responsibleName ?? "Somebody"} is responsible for this loop.`,
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
    items.push(...loopRules(openLoopsFor(ctx as MtLoopContext)));
    items.push(...equipmentRules(ctx));
  }
  items.push(...loadRules(ctx));

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
    const id = idFor(d.key);
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
