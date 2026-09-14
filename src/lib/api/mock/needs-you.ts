import {
  MAX_SNOOZE_HOURS, SEVERITY_ORDER,
  type NeedsYouFilters, type NeedsYouHistoryEntry, type NeedsYouItem,
} from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  EscalateInput, NeedsYouService, SnoozeInput,
} from "../contracts/needs-you";
import { isDerivedSettlementItem, settlementNeedsYouItems } from "./settlement-needs-you";
import { mockStore } from "./store";
import { fleetSync, truckContextFrom } from "./truck-registry";
import { nowIso } from "./time";

const LATENCY_MS = 180;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/**
 * Every method declares the permission it needs and enforces it here. A UI bug
 * that renders a forbidden button still fails at this seam — which is exactly
 * the expectation the real API must meet.
 */
function require(ctx: ServiceContext, ...keys: Parameters<ServiceContext["permissions"]["has"]>[0][]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/** Urgency = severity first, then how close the deadline is. */
export function urgencyScore(item: NeedsYouItem): number {
  const severity = SEVERITY_ORDER[item.severity] * 1_000_000;
  const due = item.dueAt ? new Date(item.dueAt).getTime() : Number.MAX_SAFE_INTEGER / 2;
  return severity + due / 1_000_000;
}

function visibleTo(ctx: ServiceContext, item: NeedsYouItem): boolean {
  // Item-level permission gate.
  if (!item.requires.every((k) => ctx.permissions.has(k))) return false;

  // Record scope: a driver sees only items about their own loads and record.
  if (ctx.scope.loads === "assigned" && ctx.driverProfileId) {
    const org = mockStore.org(ctx.organizationId);
    if (item.entity.kind === "load") {
      const load = org.loads.find((l) => l.id === item.entity.id);
      return load?.assignment?.driverId === ctx.driverProfileId;
    }
    if (item.entity.kind === "driver") return item.entity.id === ctx.driverProfileId;
    if (item.entity.kind === "truck") {
      // Visibility of a truck is a registry question, not an org-data one.
      const mine = fleetSync(truckContextFrom(ctx));
      return mine.some((t) => t.truckId === item.entity.id);
    }
    return false;
  }
  return true;
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

function find(ctx: ServiceContext, itemId: string): NeedsYouItem {
  // A derived item is computed from another module's state, so there is nothing
  // here to write to. Snoozing or resolving one would hide the row without
  // touching the thing it is about, which is the one outcome the queue must
  // never allow.
  if (isDerivedSettlementItem(itemId)) {
    throw new Error(
      "This item is worked out from the settlement itself. Open the settlement and fix what it is asking for — it clears on its own.",
    );
  }
  const org = mockStore.org(ctx.organizationId);
  const item = org.needsYou.find((n) => n.id === itemId);
  if (!item) throw new NotFoundError("Needs You item");
  mockStore.assertOwned(ctx.organizationId, item.organizationId);
  if (!visibleTo(ctx, item)) throw new PermissionDeniedError(item.requires);
  return item;
}

export const mockNeedsYouService: NeedsYouService = {
  async list(ctx, filters = {}) {
    await wait();
    const org = mockStore.org(ctx.organizationId);
    // Settlement items are derived rather than stored, so they join the queue
    // here on every read. Their own module has already applied carrier
    // isolation and payee privacy to them.
    const stored = org.needsYou.map(autoUnsnooze).filter((i) => visibleTo(ctx, i));
    return [...stored, ...settlementNeedsYouItems(ctx)]
      .filter((i) => matches(ctx, i, filters))
      .sort((a, b) => urgencyScore(a) - urgencyScore(b));
  },

  async get(ctx, itemId) {
    await wait();
    return autoUnsnooze(find(ctx, itemId));
  },

  async openCount(ctx) {
    const org = mockStore.org(ctx.organizationId);
    const stored = org.needsYou
      .map(autoUnsnooze)
      .filter((i) => visibleTo(ctx, i))
      .filter((i) => i.status === "open" || i.status === "escalated").length;
    // Derived items are always open, so they all count.
    return stored + settlementNeedsYouItems(ctx).length;
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
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
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
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
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
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
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
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
  },

  async resolve(ctx, itemId, note) {
    await wait();
    const item = find(ctx, itemId);
    // Acting on an item needs the permission its recommended action declares.
    require(ctx, ...item.recommendedAction.requires);
    const next: NeedsYouItem = {
      ...item,
      status: "resolved",
      resolvedAt: nowIso(),
      resolutionNote: note?.trim() || undefined,
      snoozedUntil: undefined,
      history: appendHistory(item, { actor: ctx.actor, action: "resolved", note }),
    };
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
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
    mockStore.replaceNeedsYou(ctx.organizationId, next);
    return next;
  },
};
