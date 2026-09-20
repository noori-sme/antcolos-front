import type {
  CapacityMetrics, ContributionKind, DispatcherMetrics, DriverMetrics, LaneMetric,
  ProfileCapacity, ProfileContribution,
} from "@/types";

/**
 * Every number on a profile, folded from the contribution ledger.
 *
 * ★ NOTHING HERE IS STORED ★
 * There is no counter to increment and no total to migrate. Each figure is a
 * fold over rows that each name an organization, a moment and a source record,
 * so any number on a profile can be traced back to the loads that produced it.
 * A correction is a reversing row; this function does not care, because it only
 * ever sums what it is given.
 *
 * Pure, synchronous and free of `Date.now()`: the caller supplies the window it
 * wants, which is what makes "this quarter" and "all time" the same code.
 */

/** How many lanes a profile shows. More than three is a table, not a highlight. */
export const TOP_LANE_COUNT = 3;

/**
 * The safety score, written down rather than tuned in a service.
 *
 * It is a DERIVED SUMMARY, not a regulatory score: Antcolos is not FMCSA, this
 * is not a CSA/SMS BASIC percentile, and nothing here should be read as one.
 * The formula is deliberately trivial and deliberately visible — a safety
 * number a driver cannot reconstruct from their own record is a number they
 * cannot dispute.
 */
export const SAFETY_BASELINE = 100;
export const SAFETY_EVENT_PENALTY = 8;
export const SAFETY_CLEAN_INSPECTION_CREDIT = 2;

const sumOf = (rows: readonly ProfileContribution[], kind: ContributionKind): number =>
  rows.reduce((total, row) => (row.kind === kind ? total + row.value : total), 0);

const laneKey = (row: ProfileContribution): string | null =>
  row.lane ? `${row.lane.origin}\u0000${row.lane.destination}` : null;

/**
 * Lanes, ranked by how much work happened on them.
 *
 * Counted from `loadKind` rows and priced from `revenue_booked` rows on the
 * same lane, so a lane whose revenue was never posted shows its load count and
 * a rate of zero rather than disappearing.
 */
function topLanes(
  rows: readonly ProfileContribution[],
  loadKind: ContributionKind,
): LaneMetric[] {
  const lanes = new Map<string, { origin: string; destination: string; loads: number; cents: number }>();

  for (const row of rows) {
    const key = laneKey(row);
    if (!key || !row.lane) continue;
    if (row.kind !== loadKind && row.kind !== "revenue_booked") continue;
    const lane = lanes.get(key)
      ?? { origin: row.lane.origin, destination: row.lane.destination, loads: 0, cents: 0 };
    if (row.kind === loadKind) lane.loads += row.value;
    else lane.cents += row.value;
    lanes.set(key, lane);
  }

  return [...lanes.values()]
    .filter((lane) => lane.loads > 0)
    .map((lane) => ({
      origin: lane.origin,
      destination: lane.destination,
      loads: lane.loads,
      averageRateCents: Math.round(lane.cents / lane.loads),
    }))
    // Ties broken by revenue, then alphabetically, so the same ledger always
    // produces the same three lanes in the same order.
    .sort((a, b) =>
      b.loads - a.loads
      || b.averageRateCents - a.averageRateCents
      || `${a.origin}${a.destination}`.localeCompare(`${b.origin}${b.destination}`))
    .slice(0, TOP_LANE_COUNT);
}

export function dispatcherMetrics(rows: readonly ProfileContribution[]): DispatcherMetrics {
  const loadsDispatched = sumOf(rows, "load_dispatched");
  const grossRevenueBookedCents = sumOf(rows, "revenue_booked");
  return {
    capacity: "dispatcher",
    loadsDispatched,
    grossRevenueBookedCents,
    // Zero loads is zero, never a division by nothing.
    averageLoadRateCents: loadsDispatched > 0
      ? Math.round(grossRevenueBookedCents / loadsDispatched)
      : 0,
    topLanes: topLanes(rows, "load_dispatched"),
  };
}

export function driverMetrics(rows: readonly ProfileContribution[]): DriverMetrics {
  const loadsDelivered = sumOf(rows, "load_delivered");
  const milesDriven = sumOf(rows, "miles_driven");
  const onTime = sumOf(rows, "delivery_on_time");
  const late = sumOf(rows, "delivery_late");
  const cleanInspections = sumOf(rows, "clean_inspection");
  const safetyEvents = sumOf(rows, "safety_event");
  const rated = onTime + late;

  const hasDrivingHistory =
    loadsDelivered > 0 || milesDriven > 0 || cleanInspections > 0 || safetyEvents > 0;

  return {
    capacity: "driver",
    loadsDelivered,
    milesDriven,
    cleanInspections,
    safetyScore: hasDrivingHistory
      ? Math.max(0, Math.min(100, Math.round(
        SAFETY_BASELINE
        - safetyEvents * SAFETY_EVENT_PENALTY
        + cleanInspections * SAFETY_CLEAN_INSPECTION_CREDIT,
      )))
      : null,
    // Null, not zero: nothing delivered is not the same as nothing on time.
    onTimePercentage: rated > 0 ? Math.round((onTime / rated) * 100) : null,
    topLanes: topLanes(rows, "load_delivered"),
  };
}

/**
 * The metric grids a profile shows.
 *
 * One per capacity the person has actually worked in, in the order
 * `capacities` gives — so somebody who dispatches and drives gets both grids,
 * and somebody who has only ever driven is never shown an empty dispatch
 * scoreboard.
 */
export function buildMetrics(
  contributions: readonly ProfileContribution[],
  capacities: readonly ProfileCapacity[],
): CapacityMetrics[] {
  const metrics: CapacityMetrics[] = [];
  for (const capacity of capacities) {
    const rows = contributions.filter((row) => row.capacity === capacity);
    if (capacity === "dispatcher") metrics.push(dispatcherMetrics(rows));
    if (capacity === "driver") metrics.push(driverMetrics(rows));
  }
  return metrics;
}

/** Contributions inside a window, inclusive of `fromIso`, exclusive of `toIso`. */
export function contributionsBetween(
  contributions: readonly ProfileContribution[],
  fromIso: string,
  toIso: string,
): ProfileContribution[] {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return contributions.filter((row) => {
    const at = Date.parse(row.occurredAt);
    return Number.isFinite(at) && at >= from && at < to;
  });
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** `$1.4M`, `$18.2K`, `$940`. Share cards and stat tiles are read at a glance. */
export function formatCompactUsd(cents: number): string {
  const dollars = Math.round(cents / 100);
  const sign = dollars < 0 ? "-" : "";
  const value = Math.abs(dollars);
  // One decimal while it still says something, none once the unit is coarse
  // enough that it does not. `$1.0M` is written `$1M`.
  const scaled = (divisor: number, suffix: string) => {
    const n = value / divisor;
    const text = n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, "");
    return `${sign}$${text}${suffix}`;
  };
  if (value >= 1_000_000) return scaled(1_000_000, "M");
  if (value >= 1_000) return scaled(1_000, "K");
  return `${sign}$${value.toLocaleString("en-US")}`;
}

/** `$2,450` — the exact figure, for a rate somebody may compare. */
export function formatUsd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function laneLabelOf(lane: LaneMetric): string {
  return `${lane.origin} → ${lane.destination}`;
}
