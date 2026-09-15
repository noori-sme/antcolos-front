import type { Load } from "@/types";
import { destinationStop, originStop } from "@/types";
import type { Slice } from "./slice";

/**
 * Every metric, computed from a slice. One function, so the table, the charts
 * and the summary text cannot disagree, and one place to read if a number ever
 * looks wrong.
 *
 * null means "not computable from what this slice holds" — no rate visible, no
 * source connected, no denominator. It is never rendered as zero: an empty
 * period and a period whose rates are hidden are different facts.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function sumDefined(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

/** A sum over records: no records is a real zero, records with no figure is null. */
function sumOver<T>(rows: T[], get: (row: T) => number | null | undefined): number | null {
  if (rows.length === 0) return 0;
  return sumDefined(rows.map(get));
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const BILLABLE = ["delivered", "ready_to_invoice", "invoiced", "paid"];

/**
 * Freight that has actually moved.
 *
 * Money metrics count these and nothing else: a load that is booked for next
 * Tuesday is real work in the dispatch sense, but counting its rate as revenue
 * would be booking income that has not been earned.
 */
function hasDelivered(load: Load): boolean {
  if (BILLABLE.includes(load.status)) return true;
  const stop = destinationStop(load);
  return Boolean(stop.arrivedAt ?? stop.departedAt);
}

function deliveredOnTime(load: Load): boolean | null {
  const stop = destinationStop(load);
  if (!stop.arrivedAt) return null;
  const deadline = new Date(stop.appointmentEndAt ?? stop.appointmentAt).getTime();
  return new Date(stop.arrivedAt).getTime() <= deadline;
}

/** Days a load occupied a truck. At least one: a same-day run still uses the day. */
function truckDays(load: Load): number {
  const start = new Date(originStop(load).departedAt ?? originStop(load).appointmentAt).getTime();
  const end = new Date(destinationStop(load).arrivedAt ?? destinationStop(load).appointmentAt).getTime();
  return Math.max(1, Math.round((end - start) / DAY_MS));
}

export interface MetricContext {
  now: number;
}

export function computeMetric(
  key: string,
  slice: Slice,
  ctx: MetricContext,
): number | null {
  const loads = slice.loads;
  const moved = loads.filter(hasDelivered);
  const revenue = () => sumOver(moved, (l) => l.financials?.totalRateCents);
  const loadedMiles = () => sumOver(moved, (l) => l.financials?.loadedMiles);
  const deadheadMiles = () => sumOver(moved, (l) => l.financials?.deadheadMiles);
  const totalMiles = () => {
    const a = loadedMiles();
    const b = deadheadMiles();
    return a == null || b == null ? null : a + b;
  };
  const cost = () => {
    const driverPay = slice.settlements.length
      ? sumOver(slice.settlements, (s) => s.driverPayCents)
      : null;
    const spend = slice.expenses.length ? sumOver(slice.expenses, (e) => e.amountCents) : null;
    if (driverPay == null && spend == null) return null;
    return (driverPay ?? 0) + (spend ?? 0);
  };
  const costPerMile = () => ratio(cost(), totalMiles());

  switch (key) {
    // ---- Money ------------------------------------------------------------
    case "revenue":
      return revenue();
    case "loadCount":
      return moved.length;
    case "revenuePerLoad":
      return ratio(revenue(), moved.length);
    case "cost":
      return cost();
    case "grossProfit": {
      const r = revenue();
      const c = cost();
      return r == null || c == null ? null : r - c;
    }
    case "margin": {
      const r = revenue();
      const c = cost();
      if (r == null || c == null || r === 0) return null;
      return (r - c) / r;
    }
    case "expenses":
      return slice.expenses.length ? sumOver(slice.expenses, (e) => e.amountCents) : null;
    case "costPerMile":
      return costPerMile();

    // ---- Rate and miles ---------------------------------------------------
    case "rpm":
      return ratio(revenue(), loadedMiles());
    case "allInRpm":
      return ratio(revenue(), totalMiles());
    case "loadedMiles":
      return loadedMiles();
    case "deadheadMiles":
      return deadheadMiles();
    case "deadheadPct":
      return ratio(deadheadMiles(), totalMiles());
    case "deadheadCost": {
      const dh = deadheadMiles();
      const cpm = costPerMile();
      return dh == null || cpm == null ? null : dh * cpm;
    }

    // ---- Invoicing --------------------------------------------------------
    case "invoicedAmount":
      return sumOver(
        slice.invoices.filter((i) => i.status !== "draft"),
        (i) => i.amountCents,
      );
    case "unbilledAmount": {
      const invoiced = new Set(
        slice.invoices.filter((i) => i.status !== "draft").map((i) => i.loadId),
      );
      const unbilled = loads.filter(
        (l) => BILLABLE.includes(l.status) && !invoiced.has(l.id),
      );
      return sumOver(unbilled, (l) => l.financials?.totalRateCents);
    }
    case "openReceivables":
      return sumOver(
        slice.invoices.filter((i) => i.status === "sent" || i.status === "overdue"),
        (i) => i.amountCents,
      );
    case "overdueAmount":
      return sumOver(
        slice.invoices.filter((i) => i.status === "overdue"),
        (i) => i.amountCents,
      );
    case "invoiceCount":
      return slice.invoices.length;
    case "daysToPay":
      return mean(
        slice.invoices
          .filter((i) => i.paidAt && i.sentAt)
          .map((i) => (new Date(i.paidAt!).getTime() - new Date(i.sentAt!).getTime()) / DAY_MS),
      );
    case "agingDays":
      return mean(
        slice.invoices
          .filter((i) => (i.status === "sent" || i.status === "overdue") && i.sentAt)
          .map((i) => (ctx.now - new Date(i.sentAt!).getTime()) / DAY_MS),
      );

    // ---- Settlements ------------------------------------------------------
    case "settlementAmount":
      return sumOver(slice.settlements, (s) => s.driverPayCents);
    case "settlementCount":
      return slice.settlements.length;
    case "settlementPendingAmount":
      return sumOver(
        slice.settlements.filter((s) => s.status === "draft" || s.status === "in_review"),
        (s) => s.driverPayCents,
      );

    // ---- Operations -------------------------------------------------------
    case "onTimePct": {
      const judged = loads.map(deliveredOnTime).filter((v): v is boolean => v !== null);
      if (judged.length === 0) return null;
      return judged.filter(Boolean).length / judged.length;
    }
    case "documentCompliancePct": {
      if (slice.documents.length === 0) return null;
      const complete = slice.documents.filter((d) => d.missingKinds.length === 0).length;
      return complete / slice.documents.length;
    }
    case "rateConVerifiedPct": {
      if (slice.loads.length === 0) return null;
      const verified = slice.rateConfirmations.filter((r) => r.state === "verified").length;
      return verified / slice.loads.length;
    }
    case "truckCount":
      return slice.trucks.length;
    case "utilizationPct": {
      if (slice.trucks.length === 0 || slice.days === 0) return null;
      const used = loads.reduce((total, load) => total + truckDays(load), 0);
      return Math.min(1, used / (slice.trucks.length * slice.days));
    }
    case "emptyTruckCount":
      return slice.trucks.filter((t) => !t.currentLoadId).length;
    case "emptyHours":
      return mean(
        slice.spells.map(
          (s) =>
            ((s.bookedAt ? new Date(s.bookedAt).getTime() : ctx.now) -
              new Date(s.startedAt).getTime()) /
            HOUR_MS,
        ),
      );
    case "timeToCoverHours":
      return mean(
        slice.spells
          .filter((s) => s.bookedAt)
          .map(
            (s) =>
              (new Date(s.bookedAt!).getTime() - new Date(s.startedAt).getTime()) / HOUR_MS,
          ),
      );

    // ---- Dispatch ---------------------------------------------------------
    case "commission":
      return sumOver(moved, (l) => l.financials?.dispatcherCommissionCents);
    case "commissionPerLoad":
      return ratio(
        sumOver(moved, (l) => l.financials?.dispatcherCommissionCents),
        moved.length,
      );
    case "bookedLoads":
      return loads.length;
    case "bookingSuccessPct": {
      if (slice.opportunities.length === 0) return null;
      const booked = slice.opportunities.filter((o) => o.outcome === "booked").length;
      return booked / slice.opportunities.length;
    }
    case "offersSent":
      return slice.opportunities.length;
    case "brokerResponsePct": {
      if (slice.opportunities.length === 0) return null;
      const answered = slice.opportunities.filter((o) => o.respondedAt).length;
      return answered / slice.opportunities.length;
    }
    case "brokerResponseHours":
      return mean(
        slice.opportunities
          .filter((o) => o.respondedAt)
          .map(
            (o) =>
              (new Date(o.respondedAt!).getTime() - new Date(o.offeredAt).getTime()) / HOUR_MS,
          ),
      );
    case "carrierCount": {
      const inLoads = new Set(
        loads.map((l) => l.assignment?.carrierOrganizationId).filter(Boolean) as string[],
      );
      if (inLoads.size > 0) return inLoads.size;
      return slice.carriers.filter((c) => c.sharing === "shared").length;
    }
    case "searchSessions":
      return slice.sessions.length;

    // ---- One dispatcher's own numbers ------------------------------------
    case "myEarnings":
      return sumOver(slice.earnings, (e) => e.amountCents);
    case "myEarningsPerLoad":
      return ratio(
        sumOver(slice.earnings, (e) => e.amountCents),
        new Set(slice.earnings.map((e) => e.loadId)).size,
      );
    case "myLoads":
      return loads.length;
    case "activityCount":
      return loads.length + slice.sessions.length + slice.opportunities.length;

    default:
      return null;
  }
}
