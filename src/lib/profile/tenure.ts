import type { ProfileTenure, WorkplaceAssociation } from "@/types";

/**
 * Account lifetime and time actually worked.
 *
 * Two different questions, and conflating them is the usual way a career page
 * starts lying. "Joined November 2025" is about the ACCOUNT. "Three years
 * dispatching" is about the WORK, and somebody can have the first without any
 * of the second.
 */

const DAY_MS = 86_400_000;

/** Whole days between two instants, never negative. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

interface Interval {
  start: number;
  end: number;
}

/**
 * The days covered by at least one association, counted once.
 *
 * ★ WHY A UNION AND NOT A SUM ★
 * Somebody dispatching for two carriers through the same spring worked one
 * spring. Summing the two associations would report twice the career, which is
 * exactly the number a person would be accused of inflating — so overlapping
 * periods are merged before anything is counted.
 *
 * An association with no end date runs to `asOf`. One that starts in the
 * future contributes nothing rather than a negative.
 */
export function activeDaysFrom(
  associations: readonly WorkplaceAssociation[],
  asOfIso: string,
): number {
  const asOf = Date.parse(asOfIso);
  if (!Number.isFinite(asOf)) return 0;

  const intervals: Interval[] = [];
  for (const association of associations) {
    const start = Date.parse(association.startedAt);
    if (!Number.isFinite(start) || start > asOf) continue;
    const rawEnd = association.endedAt ? Date.parse(association.endedAt) : asOf;
    const end = Math.min(Number.isFinite(rawEnd) ? rawEnd : asOf, asOf);
    if (end <= start) continue;
    intervals.push({ start, end });
  }
  if (intervals.length === 0) return 0;

  intervals.sort((a, b) => a.start - b.start);
  let covered = 0;
  let { start, end } = intervals[0];
  for (const next of intervals.slice(1)) {
    if (next.start <= end) {
      end = Math.max(end, next.end);
      continue;
    }
    covered += end - start;
    ({ start, end } = next);
  }
  covered += end - start;
  return Math.floor(covered / DAY_MS);
}

export function buildTenure(
  joinedAt: string,
  associations: readonly WorkplaceAssociation[],
  asOfIso: string,
): ProfileTenure {
  return {
    joinedAt,
    daysOnPlatform: daysBetween(joinedAt, asOfIso),
    activeDays: activeDaysFrom(associations, asOfIso),
    currentWorkplaces: associations.filter((a) => !a.endedAt).length,
    organizationsWorkedWith: new Set(associations.map((a) => a.organizationId)).size,
  };
}

/**
 * "2 yr 4 mo", "7 mo", "12 days".
 *
 * Deliberately coarse and deliberately not a library call: this is read at a
 * glance next to a number, and "about 2 years" is both more honest and more
 * readable than "2 years, 4 months and 11 days".
 */
export function formatDuration(days: number): string {
  if (days < 1) return "Today";
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
  // Years are taken from the days rather than from a month count, so that a
  // person whose account is exactly a year old reads "1 yr" and not "11 mo".
  const years = Math.floor(days / 365);
  if (years < 1) return `${Math.floor(days / 30.44)} mo`;
  const months = Math.floor((days - years * 365) / 30.44);
  return months === 0 ? `${years} yr` : `${years} yr ${months} mo`;
}

/** "May 2026" — the granularity a career record is read at. */
export function formatMonth(iso: string, locale = "en-US"): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "May 2026 – Present". The one place an open-ended period is worded. */
export function formatPeriod(startedAt: string, endedAt?: string, locale = "en-US"): string {
  return `${formatMonth(startedAt, locale)} – ${endedAt ? formatMonth(endedAt, locale) : "Present"}`;
}
