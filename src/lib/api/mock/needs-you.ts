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
import { mockStore } from "./store";
import {
  insuranceContextFrom, insuranceNeedsYou, isInsuranceNeedsYouId,
  replaceInsuranceNeedsYou,
} from "./insurance-registry";
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

/**
 * Everything in the queue for this membership, from both sources.
 *
 * Most items are records in the organization's own store. Insurance items are
 * DERIVED on every read from live policy and claim state, so an expiring
 * policy appears the moment it slips inside the window and a renewed one stops
 * appearing without anybody tidying up after it. They merge here rather than
 * in a screen, so the count in the nav, the Home preview and the workspace are
 * always the same number.
 */
function allItems(ctx: ServiceContext): NeedsYouItem[] {
  return [...mockStore.org(ctx.organizationId).needsYou, ...insuranceNeedsYou(insuranceContextFrom(ctx))];
}

/** Sends a changed item back to whichever source it came from. */
function persist(ctx: ServiceContext, next: NeedsYouItem) {
  if (isInsuranceNeedsYouId(next.id)) replaceInsuranceNeedsYou(next);
  else persist(ctx, next);
}

/**
 * Urgency = severity first, then how close the deadline is.
 *
 * Severity genuinely dominates: the deadline only ever separates two items of
 * the same severity, and an item with no deadline sorts after one that has a
 * deadline rather than jumping the queue. An epoch timestamp is a very large
 * number, so it is folded in as a fraction rather than added to a rank.
 */
export function urgencyScore(item: NeedsYouItem): number {
  const severity = SEVERITY_ORDER[item.severity];
  if (!item.dueAt) return severity + 0.999;
  const hoursOut = (new Date(item.dueAt).getTime() - Date.now()) / 3_600_000;
  // Maps any deadline into (0, 1): overdue nearest to 0, far future nearest 1.
  const closeness = 1 / (1 + Math.exp(-hoursOut / 48));
  return severity + closeness * 0.998;
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
  const item = allItems(ctx).find((n) => n.id === itemId);
  if (!item) throw new NotFoundError("Needs You item");
  mockStore.assertOwned(ctx.organizationId, item.organizationId);
  if (!visibleTo(ctx, item)) throw new PermissionDeniedError(item.requires);
  return item;
}

export const mockNeedsYouService: NeedsYouService = {
  async list(ctx, filters = {}) {
    await wait();
    return allItems(ctx)
      .map(autoUnsnooze)
      .filter((i) => visibleTo(ctx, i))
      .filter((i) => matches(ctx, i, filters))
      .sort((a, b) => urgencyScore(a) - urgencyScore(b));
  },

  async get(ctx, itemId) {
    await wait();
    return autoUnsnooze(find(ctx, itemId));
  },

  async openCount(ctx) {
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
    persist(ctx, next);
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
    persist(ctx, next);
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
    persist(ctx, next);
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
    persist(ctx, next);
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
    persist(ctx, next);
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
    persist(ctx, next);
    return next;
  },
};
