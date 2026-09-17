import type {
  Document, Load, LoadEvent, LoadStatus, Page, PageRequest, PermissionKey,
} from "@/types";
import { missingRequiredDocuments } from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  ApplyRateConfirmationInput, CreateBookedLoadInput, FinalizeLoadResult,
  LoadFilters, LoadSort, LoadsService, RecordConsentInput,
} from "../contracts/loads";
import {
  applyRateConfirmationToLoad, createBookedLoad, recordLoadConsent,
} from "./load-commands";
import { mockStore } from "./store";
import {
  attributedActor, loadReachFor, requireLoadWriteAuthority,
} from "./dispatch-delegation";
import { liveDispatchGrantsHeldBy } from "./truck-registry";

const LATENCY_MS = 160;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/**
 * Money is removed at the SERVICE, not hidden in the UI. A caller without
 * rates:view receives loads with no `financials` object at all, so there is
 * nothing for a rendering bug to leak.
 */
export function redactFinancials(ctx: ServiceContext, load: Load): Load {
  if (ctx.permissions.has("rates:view")) return load;
  const rest: Load = { ...load };
  delete rest.financials;
  return rest;
}

/**
 * Every load the caller may see, and the ONE place that is decided.
 *
 * Three narrowings, in order:
 *
 *  1. The membership must hold `loads:view` at all.
 *  2. The organization's own loads, PLUS any load a live dispatch grant reaches
 *     — a provider working a carrier's freight reads the carrier's canonical
 *     load, it does not get a copy of it. Reach is asked per load through
 *     `loadReachFor`, which checks a grant from the load's OWN carrier on the
 *     load's OWN truck. A grant from some other carrier reaches nothing.
 *  3. A driver membership sees only its own assigned loads, whichever
 *     organization they belong to.
 *
 * `loads.get`, `loads.events`, `loads.documents`, `recordConsent`,
 * `applyRateConfirmation` and reporting all narrow through this, so there is no
 * second path where one of the three could be forgotten.
 */
function scopedLoads(ctx: ServiceContext): Load[] {
  if (!ctx.permissions.has("loads:view")) throw new PermissionDeniedError(["loads:view"]);
  const own = mockStore.org(ctx.organizationId).loads;

  // Only look outside when this workspace actually holds a grant from someone.
  const delegated: Load[] = [];
  const carriers = new Set(
    liveDispatchGrantsHeldBy(ctx.organizationId)
      .map((g) => g.grantedByCarrierOrganizationId),
  );
  for (const carrierId of carriers) {
    // A carrier that has granted dispatch access but holds no seeded loads is
    // an empty list, not a fault — see `maybeOrg`.
    for (const load of mockStore.maybeOrg(carrierId)?.loads ?? []) {
      if (loadReachFor(ctx, load) !== null) delegated.push(load);
    }
  }

  const all = delegated.length > 0 ? [...own, ...delegated] : own;
  if (ctx.scope.loads === "assigned" && ctx.driverProfileId) {
    return all.filter((l) => l.assignment?.driverId === ctx.driverProfileId);
  }
  return all;
}

const ACTIVE: LoadStatus[] = [
  "assigned", "dispatched", "at_pickup", "loaded", "in_transit", "at_delivery",
];
const UPCOMING: LoadStatus[] = ["draft", "verifying", "planned", "offered", "accepted"];
const COMPLETED: LoadStatus[] = ["delivered", "ready_to_invoice", "invoiced", "paid"];

function pickupAt(load: Load) {
  return new Date(load.stops[0].appointmentAt).getTime();
}
function deliveryAt(load: Load) {
  return new Date(load.stops[load.stops.length - 1].appointmentAt).getTime();
}

function inView(load: Load, view: LoadFilters["view"]): boolean {
  switch (view) {
    case "active": return ACTIVE.includes(load.status);
    case "upcoming": return UPCOMING.includes(load.status);
    case "completed": return COMPLETED.includes(load.status);
    case "cancelled": return load.status === "cancelled";
    case "exceptions":
      return (
        missingRequiredDocuments(load).length > 0 ||
        (!load.assignment && !["cancelled", "paid"].includes(load.status))
      );
    default: return true;
  }
}

function matches(load: Load, f: LoadFilters): boolean {
  if (f.view && !inView(load, f.view)) return false;
  if (f.status?.length && !f.status.includes(load.status)) return false;
  if (f.customerId && load.customer.id !== f.customerId) return false;
  if (f.truckId && load.assignment?.truckId !== f.truckId) return false;
  if (f.driverId && load.assignment?.driverId !== f.driverId) return false;
  if (f.missingDocuments && missingRequiredDocuments(load).length === 0) return false;
  if (f.pickupFrom && pickupAt(load) < new Date(f.pickupFrom).getTime()) return false;
  if (f.pickupTo && pickupAt(load) > new Date(f.pickupTo).getTime()) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const stops = load.stops
      .map((s) => `${s.address.city} ${s.address.state} ${s.facilityName ?? ""}`)
      .join(" ");
    const hay =
      `${load.reference} ${load.customerReference ?? ""} ${load.customer.name} ${stops} ${load.commodity ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function compare(a: Load, b: Load, sort: LoadSort): number {
  const dir = sort.direction === "asc" ? 1 : -1;
  switch (sort.field) {
    case "reference": return a.reference.localeCompare(b.reference) * dir;
    case "status": return a.status.localeCompare(b.status) * dir;
    case "customer": return a.customer.name.localeCompare(b.customer.name) * dir;
    case "deliveryAt": return (deliveryAt(a) - deliveryAt(b)) * dir;
    case "rate":
      return (
        ((a.financials?.totalRateCents ?? 0) - (b.financials?.totalRateCents ?? 0)) * dir
      );
    case "pickupAt":
    default: return (pickupAt(a) - pickupAt(b)) * dir;
  }
}

export const mockLoadsService: LoadsService = {
  async list(ctx, filters = {}, sort, page: PageRequest = {}): Promise<Page<Load>> {
    await wait();
    const all = scopedLoads(ctx)
      .filter((l) => matches(l, filters))
      .sort((a, b) => compare(a, b, sort ?? { field: "pickupAt", direction: "desc" }))
      .map((l) => redactFinancials(ctx, l));

    const limit = page.limit ?? 50;
    const start = page.cursor ? Number(page.cursor) : 0;
    const items = all.slice(start, start + limit);
    const next = start + limit;

    return {
      items,
      totalCount: all.length,
      nextCursor: next < all.length ? String(next) : undefined,
    };
  },

  async get(ctx, loadId) {
    await wait();
    const load = scopedLoads(ctx).find((l) => l.id === loadId);
    // A load outside the caller's organization, grant or scope is NOT FOUND,
    // never "forbidden" — a 403 would confirm the record exists.
    //
    // `assertOwned` used to stand here and cannot any more: a provider working
    // under a live grant legitimately reads a load its own organization does
    // not own, and the ownership question is now asked by `scopedLoads`
    // through `loadReachFor` — which checks a grant from THIS load's carrier on
    // THIS load's truck, and is a stronger test than equality ever was.
    if (!load) throw new NotFoundError("Load");
    return redactFinancials(ctx, load);
  },

  async events(ctx, loadId): Promise<LoadEvent[]> {
    await wait();
    const load = scopedLoads(ctx).find((l) => l.id === loadId);
    if (!load) throw new NotFoundError("Load");
    // The OWNING organization's timeline, not the caller's. Reading the
    // caller's store here would hand a provider an empty array for a load it
    // may legitimately see — a silent wrong answer rather than a refusal.
    return mockStore
      .org(load.organizationId)
      .events.filter((e) => e.loadId === loadId)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  },

  async documents(ctx, loadId): Promise<Document[]> {
    await wait();
    if (!ctx.permissions.has("documents:view")) {
      throw new PermissionDeniedError(["documents:view"]);
    }
    const load = scopedLoads(ctx).find((l) => l.id === loadId);
    if (!load) throw new NotFoundError("Load");
    // The owning organization's documents, for the same reason as `events`.
    return mockStore
      .org(load.organizationId)
      .documents.filter((d) =>
        d.links.some((l) => l.entityKind === "load" && l.entityId === loadId),
      )
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  },

  /* -- Commands ---------------------------------------------------------- */

  async createBooked(ctx: ServiceContext, input: CreateBookedLoadInput): Promise<Load> {
    await wait();
    // Checked HERE, at the seam, not in whichever screen happened to call it.
    if (!ctx.permissions.has("loads:create")) {
      throw new PermissionDeniedError(["loads:create"]);
    }
    /*
     * When the booking names a truck, WHOSE load it is must be proved rather
     * than assumed from the caller's organization — that is the whole of the
     * delegated case. Without a truck there is nothing to prove against and the
     * caller is booking its own freight, which is the pre-existing behaviour.
     */
    const truckId = input.assignment?.truckId;
    const at = new Date().toISOString();
    const authority = truckId
      ? requireLoadWriteAuthority(ctx, {
          truckId,
          instant: at,
          requires: ["loads:create"],
        })
      : undefined;

    const load = createBookedLoad({
      organizationId: authority?.owningOrganizationId ?? ctx.organizationId,
      pinnedCarrierOrganizationId: authority?.pinnedCarrierOrganizationId,
      operatingLeaseId: authority?.operatingLeaseId,
      dispatchedByOrganizationId:
        authority?.basis === "dispatch_delegation" ? ctx.organizationId : undefined,
      actor: authority
        ? attributedActor(ctx.actor, authority, ctx.organizationName)
        : ctx.actor,
      loadId: nextLoadId(),
      ...input,
    });
    return redactFinancials(ctx, load);
  },

  async recordConsent(ctx: ServiceContext, input: RecordConsentInput): Promise<Load> {
    await wait();
    // `loads:assign` rather than `loads:edit`: answering for a driver is a
    // dispatch act, and somebody who may correct a reference number is not
    // thereby entitled to accept work on a driver's behalf.
    if (!ctx.permissions.has("loads:assign")) {
      throw new PermissionDeniedError(["loads:assign"]);
    }
    // Scoped, so a membership that cannot see the load cannot answer for it.
    const target = scopedLoads(ctx).find((l) => l.id === input.loadId);
    if (!target) throw new NotFoundError("Load");

    /*
     * Two questions, never collapsed: whose load is it (PINNED, a fact about
     * when it was booked) and may this actor answer for a driver on it NOW.
     * Passing the pin stops the guard re-deriving ownership from whoever
     * operates the truck today — which is what would hand a carrier's finished
     * load to whoever the truck moved to next.
     */
    const authority = requireLoadWriteAuthority(ctx, {
      truckId: target.assignment?.truckId ?? "",
      instant: target.createdAt,
      requires: ["loads:assign"],
      pinnedOwnerOrganizationId: target.pinnedCarrierOrganizationId,
    });

    const load = recordLoadConsent({
      organizationId: authority.owningOrganizationId,
      actor: attributedActor(ctx.actor, authority, ctx.organizationName),
      ...input,
    });
    return redactFinancials(ctx, load);
  },

  async applyRateConfirmation(
    ctx: ServiceContext,
    input: ApplyRateConfirmationInput,
  ): Promise<FinalizeLoadResult> {
    await wait();
    // Writing the agreed money requires being allowed to see it. Somebody who
    // may not read a rate has no business setting one.
    const needed: PermissionKey[] = ["loads:edit", "rates:view"];
    const missing = needed.filter((k) => !ctx.permissions.has(k));
    if (missing.length > 0) throw new PermissionDeniedError(missing);
    const target = scopedLoads(ctx).find((l) => l.id === input.loadId);
    if (!target) throw new NotFoundError("Load");

    /*
     * ★ ONLY THE CARRIER FINALIZES ★
     *
     * Finalizing publishes `load.finalized`, and A6's EVENT_SCOPE_MATRIX is
     * explicit about that event: `crossOrganizationWrite: null`, and "no
     * canonical grant lets one organization finalize another's load". A
     * dispatch provider may prepare and submit a rate confirmation — that is
     * most of the work — but the act that commits the carrier's signature is
     * the carrier's own, and M1 keeps A6 exactly as it stands rather than
     * widening it.
     *
     * This is not a dead end: the carrier gets a Needs You item the moment a
     * provider submits one, so a booking can never sit finalizable-by-nobody.
     */
    if (target.organizationId !== ctx.organizationId) {
      throw new NotFoundError("Load");
    }
    mockStore.assertOwned(ctx.organizationId, input.record.organizationId);

    const outcome = await applyRateConfirmationToLoad({
      organizationId: ctx.organizationId,
      actor: ctx.actor,
      ...input,
    });
    return {
      load: redactFinancials(ctx, outcome.load),
      duplicate: outcome.duplicate,
      eventId: outcome.eventId,
    };
  },
};

let loadSeq = 0;
const nextLoadId = () => `ld_${(++loadSeq).toString(36)}${Date.now().toString(36)}`;
