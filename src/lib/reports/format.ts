import type { MetricUnit } from "@/types";
import { money, ratePerMile } from "@/lib/utils/format";

/**
 * How a metric is written. One implementation, used by the table, the charts,
 * the summary text and the export, so the same number never appears in two
 * different shapes on one screen.
 */

/** What is shown when a number could not be produced. Never "0", never blank. */
export const NO_VALUE = "—";

export function formatMetric(
  value: number | null | undefined,
  unit: MetricUnit,
  opts: { compact?: boolean } = {},
): string {
  if (value == null || Number.isNaN(value)) return NO_VALUE;
  switch (unit) {
    case "money":
      return money(Math.round(value), { compact: opts.compact });
    case "rate_per_mile":
      return ratePerMile(value);
    case "percent":
      return `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%`;
    case "miles":
      return `${Math.round(value).toLocaleString("en-US")} mi`;
    case "count":
      return Math.round(value).toLocaleString("en-US");
    case "hours":
      return value >= 48
        ? `${(value / 24).toFixed(1)} days`
        : `${value.toFixed(value < 10 ? 1 : 0)} hrs`;
    case "days":
      return `${value.toFixed(value < 10 ? 1 : 0)} days`;
  }
}

/** Axis ticks and compact chart labels. */
export function formatAxis(value: number, unit: MetricUnit): string {
  if (unit === "money") return money(Math.round(value), { compact: true });
  if (unit === "percent") return `${Math.round(value * 100)}%`;
  if (unit === "rate_per_mile") return `$${(value / 100).toFixed(2)}`;
  return formatMetric(value, unit);
}

/** The raw value an export writes: cents as dollars, ratios as percentages. */
export function exportValue(value: number | null, unit: MetricUnit): string {
  if (value == null) return "";
  switch (unit) {
    case "money":
      return (value / 100).toFixed(2);
    case "rate_per_mile":
      return (value / 100).toFixed(3);
    case "percent":
      return (value * 100).toFixed(2);
    case "miles":
    case "count":
      return String(Math.round(value));
    case "hours":
    case "days":
      return value.toFixed(2);
  }
}

/** The unit as a column header suffix in an export. */
export const UNIT_SUFFIX: Record<MetricUnit, string> = {
  money: "USD",
  rate_per_mile: "USD/mi",
  percent: "%",
  miles: "mi",
  count: "",
  hours: "hrs",
  days: "days",
};

export function changeLabel(changePct: number | null | undefined): string | null {
  if (changePct == null || !Number.isFinite(changePct)) return null;
  const pct = Math.abs(changePct * 100);
  const rounded = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  if (pct < 0.5) return "level with the previous period";
  return `${changePct > 0 ? "up" : "down"} ${rounded}% on the previous period`;
}
