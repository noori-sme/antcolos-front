import {
  MAX_SNOOZE_HOURS, SEVERITY_ORDER,
  type NeedsYouFilters, type NeedsYouHistoryEntry, type NeedsYouItem,
  type PermissionKey,
} from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  EscalateInput, NeedsYouService, SnoozeInput,
} from "../contracts/needs-you";
import {
  complianceNeedsYouItems, isComplianceItemId, replaceComplianceNeedsYou,
} from "./compliance-needs-you";
import { isDerivedSettlementItem, settlementNeedsYouItems } from "./settlement-needs-you";
import { ensureInvoiceNeedsYou } from "./invoice-registry";
import { mockStore } from "./store";
import { syncFuelNeedsYou } from "./fuel-needs-you";
import {
  insuranceContextFrom, insuranceNeedsYou, isInsuranceNeedsYouId,
  replaceInsuranceNeedsYou,
} from "./insurance-registry";
import { syncDerivedNeedsYouFor } from "./needs-you-derive";
import { fleetSync, truckContextFrom } from "./truck-registry";
import { fleetRowsFor } from "./fleet-operations";
import { fleetNeedsYouItems } from "./fleet-needs-you";
import {
  isMaintenanceNeedsYouId, maintenanceContextFrom, maintenanceNeedsYouItems,
  putMaintenanceNeedsYouItem, withOverlayContext,
} from "./maintenance-registry";
import { nowIso } from "./time";
import {
  applyDocumentItemAction, documentNeedsYouItems, findDocumentNeedsYouItem,
  isDocumentNeedsYouId,
} from "./document-needs-you";
import { agreementNeedsYouItems, isAgreementNeedsYouId } from "./agreement-needs-you";
import { agreementContextFrom } from "./agreement-registry";

const LATENCY_MS = 180;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/**
 * Every method declares the permission it needs and enforces it here. A UI bug
 * that renders a forbidden button still fails at this seam — which is exactly
 * the expectation the real API must meet.
 */
function requirePermissions(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/**
 * Urgency = severity first, then how close the deadline is.
 *
 * Severity has to dominate ABSOLUTELY, and making that true takes some care:
 * epoch milliseconds are around 1.8e12, so any modest multiplier on severity
 * lets a low item with a deadline this afternoon sort above a critical one with
 * no deadline at all. The severity band is therefore far wider than the whole
 * range a due time can contribute, and the due time only ever breaks ties
 * inside one band.
 */
export function urgencyScore(item: NeedsYouItem): number {
  /** Well past any real due date, so "no deadline" sorts last within its band. */
  const NO_DEADLINE = Date.UTC(2100, 0, 1);
  const due = item.dueAt ? new Date(item.dueAt).getTime() : NO_DEADLINE;
  return SEVERITY_ORDER[item.severity] * 1e13 + due / 1e3;
}

/**
 * The queue is two sources, not one.
 *
 * Seeded operational items live in the organization's partition. Document items
 * are DERIVED from live document state every time the queue is read, so a
 * missing certificate appears without a fixture and a replaced one disappears
 * without anybody resolving it.
 */
function allItems(ctx: ServiceContext): NeedsYouItem[] {
  const org = mockStore.org(ctx.organizationId);
  // Compliance FIRST, before the document items below are derived.
  //
  // Building compliance's subjects seeds evidence rows into the document store,
  // and the document items are derived from that same store. Deriving documents
  // first makes the first read of a fresh store disagree with every read after
  // it — three items, then nine, from identical state and permissions.
  const compliance = complianceNeedsYouItems(ctx);
  return [
    ...org.needsYou,
    ...documentNeedsYouItems(ctx),
    // Insurance items are derived the same way documents are: an expiring
    // policy appears the moment it slips inside the window and a renewed one
    // stops appearing without anybody tidying up after it.
    ...insuranceNeedsYou(insuranceContextFrom(ctx)),
    // Maintenance is derived the same way: a defect or an overdue service
    // shows up while it is true and stops showing when it is dealt with.
    ...maintenanceNeedsYouItems(maintenanceContextFrom(ctx)),
    // Settlement items are derived too. Their own module has already applied
    // carrier isolation and payee privacy, so they arrive ready to show.
    ...settlementNeedsYouItems(ctx),
    // Contract items are derived the same way: a version out for signature, an
    // agreement inside its own renewal window, a requirement with nothing
    // against it, a termination nobody finished. Sign the version or produce the
    // document and the item stops existing.
    ...agreementNeedsYouItems(agreementContextFrom(ctx)),
    // Derived above, so the document rows it seeds are already in place.
    ...compliance,
  ];
}

function visibleTo(ctx: ServiceContext, item: NeedsYouItem): boolean {
  // Compliance items come through the compliance bridge, which has already
  // applied the caller's permissions, shares between organizations,
  // responsibility scope and frozen records. That is stricter than anything
  // re-derived here, so they are exempt from the whole check rather than only
  // from the record-scope half.
  if (isComplianceItemId(item.id)) return true;

  // Item-level permission gate.
  if (!item.requires.every((k) => ctx.permissions.has(k))) return false;

  // Maintenance items are DERIVED from the maintenance registry, which has
  // already applied the caller's permissions, their relationship with the
  // equipment and their responsibility scope. Re-narrowing them by entity kind
  // here would second-guess a stricter check with a weaker one.
  if (isMaintenanceNeedsYouId(item.id)) return true;

  // Contract items come from the agreement registry, which has already applied
  // this membership's permissions, its organization and — for signature items —
  // its signer authority. The record-scope narrowing below has no entity kind
  // for a contract, so without this a driver would silently lose the item asking
  // them to sign their own agreement.
  if (isAgreementNeedsYouId(item.id)) return true;


  // Record scope: a driver sees only items about their own loads and record.
  if (ctx.scope.loads === "assigned" && ctx.driverProfileId) {
    const org = mockStore.org(ctx.organizationId);
    if (item.entity.kind === "load") {
      const load = org.loads.find((l) => l.id === item.entity.id);
      return load?.assignment?.driverId === ctx.driverProfileId;
    }
    if (item.entity.kind === "driver") return item.entity.id === ctx.driverProfileId;
    // A document item is already scoped by the document service, which will not
    // return another person's paperwork to a driver membership at all.
    if (item.entity.kind === "document") return isDocumentNeedsYouId(item.id);
    if (item.entity.kind === "truck") {
      // Visibility of a truck is a registry question, not an org-data one.
      const mine = fleetSync(truckContextFrom(ctx));
      return mine.some((t) => t.truckId === item.entity.id);
    }
    return false;
  }
  return true;
}

/** Writes go back to whichever producer owns the item. */
function replaceItem(ctx: ServiceContext, item: NeedsYouItem) {
  if (isComplianceItemId(item.id)) {
    replaceComplianceNeedsYou(item);
    return;
  }
  mockStore.replaceNeedsYou(ctx.organizationId, item);
}

function autoUnsnooze(item: NeedsYouItem): NeedsYouItem {
  if (item.status !== "snoozed" || !item.snoozedUntil) return item;
  if (new Date(item.snoozedUntil).getTime() > Date.now()) return item;
  return { ...item, status: "open", snoozedUntil: undefined, snoozeReason: undefined };
}

function matches(ctx: ServiceContext, item: NeedsYouItem, f: NeedsYouFilters): boolean {
  if (f.severity?.length && !f.severity.includes(item.severity)) return false;
  if (f.category?.length && !f.category.includes(item.category)) return false;
  if (f.status?.length && !f.status.includes(item.status)) return false;
  if (f.entityKind?.length && !f.entityKind.includes(item.entity.kind)) return false;
  if (f.owner === "me" && item.assigneeMembershipId !== ctx.membershipId) return false;
  if (f.owner === "unassigned" && item.assigneeMembershipId) return false;
  if (f.dueWithinHours != null) {
    if (!item.dueAt) return false;
    const limit = Date.now() + f.dueWithinHours * 3_600_000;
    if (new Date(item.dueAt).getTime() > limit) return false;
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${item.title} ${item.reason} ${item.detail ?? ""} ${item.entity.label}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function appendHistory(
  item: NeedsYouItem,
  entry: Omit<NeedsYouHistoryEntry, "id" | "at">,
): NeedsYouHistoryEntry[] {
  return [
    ...item.history,
    { id: `nyh_${Math.random().toString(36).slice(2, 9)}`, at: nowIso(), ...entry },
  ];
}

/**
 * Folds the fleet layer's derived exceptions into this organization's queue.
 *
 * They are registered rather than concatenated so they behave like every other
 * item — assignable, snoozable, resolvable, with a history that survives a
 * reload. Registration is idempotent on a stable id, so recomputing the same
 * exception does not resurrect an item somebody already resolved.
 *
 * Failures here are swallowed on purpose. A fleet rule that cannot run is not a
 * reason to withhold the rest of somebody's queue, and the operational picture
 * is still available in full on the fleet dashboard.
 */
async function registerFleetItems(ctx: ServiceContext): Promise<void> {
  if (!ctx.permissions.has("fleet:view")) return;
  try {
    const { rows, triads } = await fleetRowsFor(ctx);
    if (!rows.length) return;
    mockStore.registerNeedsYou(
      ctx.organizationId,
      fleetNeedsYouItems(rows, triads, ctx.organizationId),
    );
  } catch {
    // Deliberately silent: see above.
  }
}

function find(ctx: ServiceContext, itemId: string): NeedsYouItem {
  // A settlement item is computed from the settlement itself, so there is
  // nothing here to write to. Snoozing or resolving one would hide the row
  // without touching the thing it is about, which is the one outcome the queue
  // must never allow.
  if (isDerivedSettlementItem(itemId)) {
    throw new Error(
      "This item is worked out from the settlement itself. Open the settlement and fix what it is asking for — it clears on its own.",
    );
  }
  // The same for a contract item: it is worked out from the contract itself, so
  // there is nothing here to snooze or resolve. Hiding the row would leave the
  // signature unsigned and the requirement unmet.
  if (isAgreementNeedsYouId(itemId)) {
    throw new Error(
      "This item is worked out from the contract itself. Open the contract and do what it is asking for — it clears on its own.",
    );
  }
  ensureInvoiceNeedsYou(ctx.organizationId);
  const item = isInsuranceNeedsYouId(itemId) || isMaintenanceNeedsYouId(itemId)
    || isComplianceItemId(itemId)
    ? allItems(ctx).find((n) => n.id === itemId)
    : isDocumentNeedsYouId(itemId)
      ? findDocumentNeedsYouItem(ctx, itemId)
      : mockStore.org(ctx.organizationId).needsYou.find((n) => n.id === itemId);
  if (!item) throw new NotFoundError("Needs You item");
  mockStore.assertOwned(ctx.organizationId, item.organizationId);
  if (!visibleTo(ctx, item)) throw new PermissionDeniedError(item.requires);
  return item;
}

/**
 * Persists a change to whichever source the item came from.
 *
 * Seeded items are replaced in the store. Derived items keep only what a person
 * did to them, because everything else about them is a function of the
 * documents and must stay that way.
 */
function persist(
  ctx: ServiceContext,
  item: NeedsYouItem,
  next: NeedsYouItem,
): NeedsYouItem {
  if (isInsuranceNeedsYouId(item.id)) {
    replaceInsuranceNeedsYou(next);
    return next;
  }
  if (isComplianceItemId(item.id)) {
    replaceComplianceNeedsYou(next);
    return next;
  }
  if (isMaintenanceNeedsYouId(item.id)) {
    withOverlayContext(maintenanceContextFrom(ctx), () => putMaintenanceNeedsYouItem(next));
    return next;
  }
  if (!isDocumentNeedsYouId(item.id)) {
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
  }
  return applyDocumentItemAction(item, {
    status: next.status,
    assigneeMembershipId: next.assigneeMembershipId,
    snoozedUntil: next.snoozedUntil,
    snoozeReason: next.snoozeReason,
    resolvedAt: next.resolvedAt,
    resolutionNote: next.resolutionNote,
    historyEntry: next.history[next.history.length - 1],
  });
}

export const mockNeedsYouService: NeedsYouService = {
  async list(ctx, filters = {}) {
    await wait();
    // Regenerate first: the queue is a view of live state, so what it holds is
    // decided here rather than by whatever happened to be written down earlier.
    syncDerivedNeedsYouFor(ctx);
    // Fuel items are derived from the ledger, not seeded, so the queue is
    // brought into line with it before anything is read.
    syncFuelNeedsYou(ctx);
    // Fleet writes its rows straight into the organization's bucket rather
    // than returning them, so it runs alongside the sync above. Its ids are
    // ny_fleet_*, which the ny_d_ prune leaves alone.
    await registerFleetItems(ctx);
    // The invoice module contributes its own items — missing documents,
    // disputes and overdue receivables — into THIS queue rather than keeping
    // a second one of its own. Its ids are ny_inv*, so the ny_d_ prune above
    // leaves them alone.
    ensureInvoiceNeedsYou(ctx.organizationId);
    return allItems(ctx)
      .map(autoUnsnooze)
      .filter((i) => visibleTo(ctx, i))
      .filter((i) => matches(ctx, i, filters))
      .sort((a, b) => urgencyScore(a) - urgencyScore(b));
  },

  async get(ctx, itemId) {
    await wait();
    syncDerivedNeedsYouFor(ctx);
    // Fuel items are derived from the ledger, not seeded, so the queue is
    // brought into line with it before anything is read.
    syncFuelNeedsYou(ctx);
    return autoUnsnooze(find(ctx, itemId));
  },

  async openCount(ctx) {
    syncDerivedNeedsYouFor(ctx);
    // Fuel items are derived from the ledger, not seeded, so the queue is
    // brought into line with it before anything is read.
    syncFuelNeedsYou(ctx);
    // Fleet writes its rows straight into the organization's bucket rather
    // than returning them, so it runs alongside the sync above. Its ids are
    // ny_fleet_*, which the ny_d_ prune leaves alone.
    await registerFleetItems(ctx);
    // The invoice module contributes its own items — missing documents,
    // disputes and overdue receivables — into THIS queue rather than keeping
    // a second one of its own. Its ids are ny_inv*, so the ny_d_ prune above
    // leaves them alone.
    ensureInvoiceNeedsYou(ctx.organizationId);
    return allItems(ctx)
      .map(autoUnsnooze)
      .filter((i) => visibleTo(ctx, i))
      .filter((i) => i.status === "open" || i.status === "escalated").length;
  },

  async assign(ctx, itemId, membershipId) {
    await wait();
    const item = find(ctx, itemId);
    const next: NeedsYouItem = {
      ...item,
      assigneeMembershipId: membershipId,
      history: appendHistory(item, {
        actor: ctx.actor,
        action: "assigned",
        note: `Assigned to ${membershipId}`,
      }),
    };
    return persist(ctx, item, next);
  },

  async snooze(ctx, itemId, input: SnoozeInput) {
    await wait();
    const item = find(ctx, itemId);
    const cap = MAX_SNOOZE_HOURS[item.severity];
    if (input.hours > cap) {
      // Snooze clears the queue; it never parks a high-risk item.
      throw new Error(
        `A ${item.severity} item can be snoozed for at most ${cap} hours.`,
      );
    }
    if (!input.reason.trim()) throw new Error("A snooze needs a reason.");
    const until = new Date(Date.now() + input.hours * 3_600_000).toISOString();
    const next: NeedsYouItem = {
      ...item,
      status: "snoozed",
      snoozedUntil: until,
      snoozeReason: input.reason.trim(),
      history: appendHistory(item, {
        actor: ctx.actor, action: "snoozed", note: input.reason.trim(), until,
      }),
    };
    return persist(ctx, item, next);
  },

  async unsnooze(ctx, itemId) {
    await wait();
    const item = find(ctx, itemId);
    const next: NeedsYouItem = {
      ...item,
      status: "open",
      snoozedUntil: undefined,
      snoozeReason: undefined,
      history: appendHistory(item, { actor: ctx.actor, action: "unsnoozed" }),
    };
    return persist(ctx, item, next);
  },

  async escalate(ctx, itemId, input: EscalateInput) {
    await wait();
    const item = find(ctx, itemId);
    if (!input.note.trim()) throw new Error("An escalation needs a note.");
    const next: NeedsYouItem = {
      ...item,
      status: "escalated",
      assigneeMembershipId: input.toMembershipId ?? item.assigneeMembershipId,
      snoozedUntil: undefined,
      history: appendHistory(item, {
        actor: ctx.actor, action: "escalated", note: input.note.trim(),
      }),
    };
    return persist(ctx, item, next);
  },

  async resolve(ctx, itemId, note) {
    await wait();
    const item = find(ctx, itemId);
    // Acting on an item needs the permission its recommended action declares.
    requirePermissions(ctx, ...item.recommendedAction.requires);
    const next: NeedsYouItem = {
      ...item,
      status: "resolved",
      resolvedAt: nowIso(),
      resolutionNote: note?.trim() || undefined,
      snoozedUntil: undefined,
      history: appendHistory(item, { actor: ctx.actor, action: "resolved", note }),
    };
    return persist(ctx, item, next);
  },

  async reopen(ctx, itemId) {
    await wait();
    const item = find(ctx, itemId);
    const next: NeedsYouItem = {
      ...item,
      status: "open",
      resolvedAt: undefined,
      resolutionNote: undefined,
      history: appendHistory(item, { actor: ctx.actor, action: "reopened" }),
    };
    return persist(ctx, item, next);
  },
};
