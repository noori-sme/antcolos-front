import type { IftaPeriod, Quarter } from "@/types";

/**
 * Quarter arithmetic.
 *
 * IFTA quarters are calendar quarters in UTC here. A real filing uses the
 * carrier's base-jurisdiction calendar, which is the same calendar for every
 * jurisdiction that matters — but the boundary handling is kept in one place
 * so a future timezone rule changes one function, not forty call sites.
 */

export const QUARTERS: readonly Quarter[] = [1, 2, 3, 4] as const;

export function quarterOf(iso: string): Quarter {
  const month = new Date(iso).getUTCMonth();
  return ((Math.floor(month / 3) + 1) as Quarter);
}

export function yearOf(iso: string): number {
  return new Date(iso).getUTCFullYear();
}

/** Inclusive ISO dates, "2026-04-01" to "2026-06-30". */
export function quarterBounds(year: number, quarter: Quarter): { startsOn: string; endsOn: string } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return { startsOn: isoDate(start), endsOn: isoDate(end) };
}

/**
 * The statutory due date: the last day of the month after the quarter ends.
 * Informational only — Antcolos files nothing and reminds nobody's regulator.
 */
export function quarterDueDate(year: number, quarter: Quarter): string {
  const endMonth = quarter * 3;
  return isoDate(new Date(Date.UTC(year, endMonth + 1, 0)));
}

/** A stable, readable period id. Ids are opaque, but these are also sortable. */
export function periodId(organizationId: string, carrierOrganizationId: string, year: number, quarter: Quarter): string {
  return `ifta_${organizationId}_${carrierOrganizationId}_${year}Q${quarter}`;
}

export function periodLabel(year: number, quarter: Quarter): string {
  return `Q${quarter} ${year}`;
}

/** Whether an instant falls inside the quarter. Boundaries are inclusive. */
export function isWithinQuarter(iso: string, year: number, quarter: Quarter): boolean {
  const { startsOn, endsOn } = quarterBounds(year, quarter);
  const at = new Date(iso).getTime();
  return at >= Date.parse(`${startsOn}T00:00:00.000Z`) && at <= Date.parse(`${endsOn}T23:59:59.999Z`);
}

/** True once the quarter is over. A running quarter can never be `ready`. */
export function isQuarterFinished(year: number, quarter: Quarter, now = Date.now()): boolean {
  const { endsOn } = quarterBounds(year, quarter);
  return now > Date.parse(`${endsOn}T23:59:59.999Z`);
}

export function isPeriodFinished(period: IftaPeriod, now = Date.now()): boolean {
  return isQuarterFinished(period.year, period.quarter, now);
}

/** The quarter containing `iso`, and the `count - 1` quarters before it. */
export function recentQuarters(iso: string, count: number): { year: number; quarter: Quarter }[] {
  let year = yearOf(iso);
  let quarter = quarterOf(iso);
  const out: { year: number; quarter: Quarter }[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ year, quarter });
    quarter = (quarter === 1 ? 4 : quarter - 1) as Quarter;
    if (quarter === 4) year -= 1;
  }
  return out;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
