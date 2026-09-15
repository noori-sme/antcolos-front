import type { ReportRange, ReportTrend } from "@/types";

/**
 * Date ranges, buckets and the previous period.
 *
 * One rule decides everything here: a range is a half-open interval
 * [from, to) of instants. Nothing in reporting compares dates as strings, and
 * nothing rounds a day boundary in a way the reader cannot reproduce.
 */

export interface RangePreset {
  id: string;
  label: string;
  /** Days back from now. A preset always ends at "now". */
  days: number;
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "180d", label: "Last 6 months", days: 180 },
  { id: "365d", label: "Last 12 months", days: 365 },
];

export const DEFAULT_PRESET_ID = "30d";

export function rangeFromPreset(presetId: string, now = Date.now()): ReportRange {
  const preset = RANGE_PRESETS.find((p) => p.id === presetId) ?? RANGE_PRESETS[1];
  return {
    from: new Date(now - preset.days * 86_400_000).toISOString(),
    to: new Date(now).toISOString(),
    presetId: preset.id,
  };
}

export function defaultRange(now = Date.now()): ReportRange {
  return rangeFromPreset(DEFAULT_PRESET_ID, now);
}

/** A custom range from two calendar dates, taken as whole days in UTC. */
export function customRange(fromDate: string, toDate: string): ReportRange {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  // Inclusive end date, exclusive instant: "to" covers the whole of that day.
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function rangeLengthDays(range: ReportRange): number {
  const ms = new Date(range.to).getTime() - new Date(range.from).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * The period immediately before this one, the same length. Trends compare like
 * with like: 30 days against the 30 days before them, never against a month.
 */
export function previousRange(range: ReportRange): ReportRange {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const span = to - from;
  return {
    from: new Date(from - span).toISOString(),
    to: new Date(from).toISOString(),
  };
}

export function withinRange(iso: string | undefined, range: ReportRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= new Date(range.from).getTime() && t < new Date(range.to).getTime();
}

export type Granularity = ReportTrend["granularity"];

/** Enough points to show a shape, few enough to read. */
export function granularityFor(range: ReportRange): Granularity {
  const days = rangeLengthDays(range);
  if (days <= 31) return "day";
  if (days <= 210) return "week";
  return "month";
}

/** The bucket an instant falls in. Buckets are keyed by their UTC start. */
export function bucketKey(iso: string, granularity: Granularity): string {
  const d = new Date(iso);
  if (granularity === "day") return d.toISOString().slice(0, 10);
  if (granularity === "month") return `${d.toISOString().slice(0, 7)}-01`;
  // Week buckets start on Monday, the way a dispatch week is read.
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Every bucket in the range, in order, including the ones with no records. */
export function bucketsIn(range: ReportRange, granularity: Granularity): string[] {
  const keys: string[] = [];
  const end = new Date(range.to).getTime();
  const cursor = new Date(bucketKey(range.from, granularity));
  while (cursor.getTime() < end) {
    keys.push(cursor.toISOString().slice(0, 10));
    if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

export function bucketLabel(key: string, granularity: Granularity): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  if (granularity === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", year: "numeric", timeZone: "UTC",
    }).format(d);
  }
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  }).format(d);
  return granularity === "week" ? `Week of ${label}` : label;
}

export function rangeLabel(range: ReportRange): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  const from = new Date(range.from);
  // The range is half-open; the reader thinks in inclusive days.
  const to = new Date(new Date(range.to).getTime() - 1);
  return `${fmt.format(from)} – ${fmt.format(to)}`;
}
