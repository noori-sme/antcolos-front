import type { FleetTruck, Load, ReportRange } from "@/types";
import { destinationStop, originStop } from "@/types";
import type {
  CarrierLinkRef, DispatcherAttributionRef, DispatcherEarningRef, EmptySpellRef,
  ExpenseCategory, ExpenseRef, InvoiceRef, OpportunityRef, SearchSessionRef,
  SettlementRef,
} from "./types";

/**
 * ███ MOCK FIXTURES — NOT A BACKEND, NOT ACCOUNTING ███
 *
 * Stand-ins for modules that are being built separately. Three rules hold here
 * and are what make them honest:
 *
 *  1. Every fixture is DERIVED FROM REAL RECORDS and references them by id. An
 *     invoice fixture bills an actual load; an empty spell belongs to an actual
 *     truck. Nothing here creates a load, a truck, a driver or a customer.
 *  2. No money is invented where a confirmed figure exists. An invoice amount
 *     is the load's own total rate. Driver pay is the load's own driver share.
 *     Only figures that have no source at all — operating expenses, dispatcher
 *     payouts — are fixtures, and they say so everywhere they appear.
 *  3. Everything is deterministic: the same records produce the same fixtures,
 *     so a number never moves between two readings of the same report.
 */

/** Stable 32-bit hash. Deterministic across reloads — never Math.random(). */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic integer in [min, max]. */
function seeded(seed: string, min: number, max: number): number {
  return min + (hash(seed) % Math.max(1, max - min + 1));
}

const DAY = 86_400_000;

function deliveredAt(load: Load): string {
  const stop = destinationStop(load);
  return stop.departedAt ?? stop.arrivedAt ?? stop.appointmentAt;
}

// ---------------------------------------------------------------------------
// Carrier relationships — the isolation boundary for a dispatch workspace
// ---------------------------------------------------------------------------

/**
 * Which carriers have shared their records with which dispatch workspace.
 *
 * `not_shared` is the case worth looking at: Crosswind works with Meridian but
 * has not shared its records, so Meridian's reports exclude every Crosswind
 * load, say how many were excluded, and cannot drill into one.
 */
const CARRIER_LINKS: Record<string, CarrierLinkRef[]> = {
  org_meridian: [
    { carrierOrganizationId: "carrier_baxter", name: "Baxter Transit LLC", sharing: "shared", sharedSince: "2026-03-14T00:00:00.000Z" },
    { carrierOrganizationId: "carrier_ridgeway", name: "Ridgeway Carriers", sharing: "shared", sharedSince: "2026-04-02T00:00:00.000Z" },
    { carrierOrganizationId: "carrier_crosswind", name: "Crosswind Freight", sharing: "not_shared" },
  ],
  org_summit: [],
};

export function mockCarrierLinks(organizationId: string): CarrierLinkRef[] {
  return CARRIER_LINKS[organizationId] ?? [];
}

// ---------------------------------------------------------------------------
// Load attribution — which dispatcher a load is credited to
// ---------------------------------------------------------------------------

/**
 * The Loads module does not record a booking dispatcher yet. Credit is dealt
 * round-robin over the workspace's members, in load-id order, so the same load
 * always belongs to the same person whoever is asking — a dispatcher cannot
 * become the owner of a load by being the one who ran the report — and the desk
 * is spread evenly rather than clumped by a hash.
 */
export function mockAttribution(
  loads: Load[],
  members: { membershipId: string; displayName: string }[],
): Map<string, DispatcherAttributionRef> {
  const map = new Map<string, DispatcherAttributionRef>();
  if (members.length === 0) return map;
  const ordered = [...loads].sort((a, b) => a.id.localeCompare(b.id));
  for (const [index, load] of ordered.entries()) {
    const member = members[index % members.length];
    map.set(load.id, {
      loadId: load.id,
      membershipId: member.membershipId,
      displayName: member.displayName,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Invoices — status and ageing only; the amount is the load's own rate
// ---------------------------------------------------------------------------

export function mockInvoices(organizationId: string, loads: Load[]): InvoiceRef[] {
  const invoices: InvoiceRef[] = [];
  for (const load of loads) {
    // A load is billable once it is delivered. Anything earlier has no invoice,
    // which is exactly what the "unbilled" number is counting.
    if (!["invoiced", "paid", "ready_to_invoice"].includes(load.status)) continue;
    const amountCents = load.financials?.totalRateCents;
    if (amountCents == null) continue; // No rate visible to this caller: no invoice line.

    const delivered = new Date(deliveredAt(load)).getTime();
    const issuedAt = new Date(delivered + DAY).toISOString();
    const termsDays = 30;
    const dueAt = new Date(delivered + DAY + termsDays * DAY).toISOString();

    let status: InvoiceRef["status"];
    let paidAt: string | undefined;
    if (load.status === "paid") {
      status = "paid";
      paidAt = new Date(delivered + DAY + seeded(`pay-${load.id}`, 12, 41) * DAY).toISOString();
    } else if (load.status === "ready_to_invoice") {
      status = "draft";
    } else {
      status = Date.now() > new Date(dueAt).getTime() ? "overdue" : "sent";
    }

    invoices.push({
      id: `inv_mock_${load.id}`,
      organizationId,
      loadId: load.id,
      customerId: load.customer.id,
      customerName: load.customer.name,
      amountCents,
      status,
      issuedAt: status === "draft" ? undefined : issuedAt,
      sentAt: status === "draft" ? undefined : issuedAt,
      dueAt: status === "draft" ? undefined : dueAt,
      paidAt,
    });
  }
  return invoices;
}

// ---------------------------------------------------------------------------
// Settlements — weekly periods over the load's own driver share
// ---------------------------------------------------------------------------

export function mockSettlements(
  organizationId: string,
  loads: Load[],
  driverName: (driverId: string) => string,
): SettlementRef[] {
  const byPeriod = new Map<string, { driverId: string; loadIds: string[]; payCents: number; start: number }>();

  for (const load of loads) {
    const driverId = load.assignment?.driverId;
    const share = load.financials?.driverShareCents;
    if (!driverId || share == null) continue;
    if (!["delivered", "ready_to_invoice", "invoiced", "paid"].includes(load.status)) continue;

    const delivered = new Date(deliveredAt(load));
    const weekday = (delivered.getUTCDay() + 6) % 7;
    const start = Date.UTC(
      delivered.getUTCFullYear(), delivered.getUTCMonth(), delivered.getUTCDate() - weekday,
    );
    const key = `${driverId}:${start}`;
    const entry = byPeriod.get(key) ?? { driverId, loadIds: [], payCents: 0, start };
    entry.loadIds.push(load.id);
    entry.payCents += share;
    byPeriod.set(key, entry);
  }

  return [...byPeriod.entries()].map(([key, entry]) => {
    const closed = entry.start + 7 * DAY;
    // A period that closed over a week ago has been paid; last week's is still
    // being approved; the current one is a draft.
    const age = Date.now() - closed;
    const status: SettlementRef["status"] =
      age > 7 * DAY ? "paid" : age > 0 ? "in_review" : "draft";
    return {
      id: `stl_mock_${hash(key).toString(36)}`,
      organizationId,
      driverId: entry.driverId,
      driverName: driverName(entry.driverId),
      loadIds: entry.loadIds,
      driverPayCents: entry.payCents,
      status,
      periodStart: new Date(entry.start).toISOString(),
      periodEnd: new Date(closed).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Expenses — no module, no confirmed source. Fixture, and labelled as one.
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "fuel", "maintenance", "insurance", "tolls", "permits", "other",
];

/** Days a load occupied a truck. At least one: a same-day run still uses the day. */
function truckDaysOf(load: Load): number {
  const start = new Date(
    originStop(load).departedAt ?? originStop(load).appointmentAt,
  ).getTime();
  const end = new Date(
    destinationStop(load).arrivedAt ?? destinationStop(load).appointmentAt,
  ).getTime();
  return Math.max(1, Math.round((end - start) / DAY));
}

/**
 * Operating spend, week by week.
 *
 * Charged against the work that is actually recorded: miles run for the
 * variable costs, truck-days worked for the standing ones. A week with no load
 * records produces no expense records rather than a guess, because the fixture
 * has no idea what the fleet did on a day it holds nothing for. It is still a
 * fixture, and every screen it reaches says so.
 */
export function mockExpenses(
  organizationId: string,
  range: ReportRange,
  trucks: FleetTruck[],
  loads: Load[],
): ExpenseRef[] {
  if (trucks.length === 0) return [];
  const out: ExpenseRef[] = [];
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();

  for (let weekStart = from; weekStart < to; weekStart += 7 * DAY) {
    const weekEnd = weekStart + 7 * DAY;
    const week = new Date(weekStart).toISOString().slice(0, 10);
    const inWeek = loads.filter((load) => {
      const t = new Date(deliveredAt(load)).getTime();
      return t >= weekStart && t < weekEnd;
    });
    if (inWeek.length === 0) continue;

    const miles = inWeek.reduce(
      (total, load) =>
        total + (load.financials?.loadedMiles ?? 0) + (load.financials?.deadheadMiles ?? 0),
      0,
    );
    const truckDays = inWeek.reduce((total, load) => total + truckDaysOf(load), 0);

    // Cents per mile and cents per truck-day. Jittered per week so a cost per
    // mile is not a constant the reader could mistake for a real measurement.
    const perMile = {
      fuel: seeded(`${organizationId}${week}fuel`, 6, 9),
      tolls: seeded(`${organizationId}${week}toll`, 1, 3),
    };
    const perTruckDay = {
      maintenance: seeded(`${organizationId}${week}maint`, 2_200, 3_400),
      insurance: 1_500,
      permits: seeded(`${organizationId}${week}perm`, 300, 600),
      other: seeded(`${organizationId}${week}other`, 500, 1_100),
    };

    for (const category of EXPENSE_CATEGORIES) {
      const amountCents =
        category === "fuel" || category === "tolls"
          ? miles * perMile[category]
          : truckDays * perTruckDay[category];
      if (amountCents <= 0) continue;
      out.push({
        id: `exp_mock_${hash(`${organizationId}${week}${category}`).toString(36)}`,
        organizationId,
        category,
        amountCents,
        incurredAt: new Date(weekStart).toISOString(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// MT Loop — spells of a truck sitting empty
// ---------------------------------------------------------------------------

export function mockEmptySpells(
  organizationId: string,
  trucks: FleetTruck[],
  loads: Load[],
  range: ReportRange,
): EmptySpellRef[] {
  const out: EmptySpellRef[] = [];
  const rangeFrom = new Date(range.from).getTime();
  const rangeTo = new Date(range.to).getTime();

  for (const truck of trucks) {
    // Every load this truck ran, oldest first: a spell sits between two loads.
    const truckLoads = loads
      .filter((l) => l.assignment?.truckId === truck.truckId)
      .sort((a, b) => new Date(deliveredAt(a)).getTime() - new Date(deliveredAt(b)).getTime());

    truckLoads.forEach((load, i) => {
      const startedAt = new Date(deliveredAt(load)).getTime();
      if (startedAt < rangeFrom || startedAt > rangeTo) return;
      const next = truckLoads[i + 1];
      const waited = seeded(`mt-${truck.truckId}-${load.id}`, 2, 34);
      const bookedAt = next ? startedAt + waited * 3_600_000 : undefined;
      out.push({
        id: `mt_mock_${hash(`${truck.truckId}${load.id}`).toString(36)}`,
        organizationId,
        truckId: truck.truckId,
        truckUnit: truck.unit,
        carrierOrganizationId: load.assignment?.carrierOrganizationId,
        startedAt: new Date(startedAt).toISOString(),
        bookedAt: bookedAt ? new Date(bookedAt).toISOString() : undefined,
        loadId: next?.id,
      });
    });

    // A truck with nothing on it right now is in an open spell.
    if (!truck.currentLoadId && truck.estimatedEmptyAt) {
      const startedAt = new Date(truck.estimatedEmptyAt).getTime();
      if (startedAt >= rangeFrom && startedAt <= rangeTo) {
        out.push({
          id: `mt_mock_open_${hash(truck.truckId).toString(36)}`,
          organizationId,
          truckId: truck.truckId,
          truckUnit: truck.unit,
          startedAt: truck.estimatedEmptyAt,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search sessions and opportunities
// ---------------------------------------------------------------------------

export function mockSearchSessions(
  organizationId: string,
  spells: EmptySpellRef[],
  attribution: Map<string, DispatcherAttributionRef>,
  fallbackMembershipId: string,
): SearchSessionRef[] {
  return spells.map((spell) => {
    const credited = spell.loadId ? attribution.get(spell.loadId) : undefined;
    return {
      id: `ss_mock_${hash(spell.id).toString(36)}`,
      organizationId,
      truckId: spell.truckId,
      membershipId: credited?.membershipId ?? fallbackMembershipId,
      openedAt: spell.startedAt,
      closedAt: spell.bookedAt,
      outcome: spell.bookedAt ? "booked" : "open",
      loadId: spell.loadId,
    };
  });
}

/**
 * Offers sent to brokers. Booked loads produce a booked offer against the
 * load's real customer; the declines and silences alongside them are fixtures —
 * which is exactly why a response rate is marked as mock data.
 */
export function mockOpportunities(
  organizationId: string,
  loads: Load[],
  attribution: Map<string, DispatcherAttributionRef>,
  fallbackMembershipId: string,
): OpportunityRef[] {
  const out: OpportunityRef[] = [];
  for (const load of loads) {
    const credited = attribution.get(load.id);
    const membershipId = credited?.membershipId ?? fallbackMembershipId;
    const offeredAt = new Date(
      new Date(load.createdAt).getTime() + seeded(`off-${load.id}`, 1, 9) * 3_600_000,
    );
    out.push({
      id: `opp_mock_${load.id}`,
      organizationId,
      brokerId: load.customer.id,
      brokerName: load.customer.name,
      membershipId,
      truckId: load.assignment?.truckId,
      offeredAt: offeredAt.toISOString(),
      respondedAt: new Date(
        offeredAt.getTime() + seeded(`resp-${load.id}`, 15, 260) * 60_000,
      ).toISOString(),
      outcome: load.status === "cancelled" ? "declined" : "booked",
      loadId: load.id,
    });

    // The offers that went nowhere. They belong to the same broker and the same
    // dispatcher, so a response rate has both halves of the fraction.
    const misses = seeded(`miss-${load.id}`, 0, 2);
    for (let i = 0; i < misses; i++) {
      const missedAt = new Date(offeredAt.getTime() - (i + 1) * 4 * 3_600_000);
      const answered = seeded(`ans-${load.id}-${i}`, 0, 10) > 3;
      out.push({
        id: `opp_mock_${load.id}_m${i}`,
        organizationId,
        brokerId: load.customer.id,
        brokerName: load.customer.name,
        membershipId,
        truckId: load.assignment?.truckId,
        offeredAt: missedAt.toISOString(),
        respondedAt: answered
          ? new Date(missedAt.getTime() + seeded(`ansat-${load.id}-${i}`, 20, 600) * 60_000).toISOString()
          : undefined,
        outcome: answered ? "declined" : "no_response",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatcher earnings — a payout module does not exist. Pure fixture.
// ---------------------------------------------------------------------------

/**
 * What a dispatcher was paid for a load. Deliberately NOT derived from the
 * load's rate: an individual dispatcher may see their own income without being
 * able to see what the freight paid, and this keeps that true.
 */
export function mockEarnings(
  organizationId: string,
  loads: Load[],
  attribution: Map<string, DispatcherAttributionRef>,
): DispatcherEarningRef[] {
  const out: DispatcherEarningRef[] = [];
  for (const load of loads) {
    const credited = attribution.get(load.id);
    if (!credited) continue;
    if (load.status === "cancelled" || load.status === "draft") continue;
    out.push({
      id: `earn_mock_${load.id}`,
      organizationId,
      membershipId: credited.membershipId,
      loadId: load.id,
      amountCents: seeded(`earn-${load.id}`, 4_200, 18_500),
      earnedAt: deliveredAt(load),
    });
  }
  return out;
}
