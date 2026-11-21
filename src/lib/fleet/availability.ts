import type { AvailabilityBucket, TruckAvailability } from "@/types/fleet-availability";

/** The board's columns, in reading order, with what a person sees (spec §18 wording). */
export const BUCKET_LABEL: Record<AvailabilityBucket, string> = {
  AVAILABLE_NOW: "Available now",
  WITHIN_5H: "Available in 2–5 hours",
  LATER_TODAY: "Available later today",
  LATER: "Available later",
  UNKNOWN: "On a trip, no estimate",
  MAINTENANCE: "Maintenance hold",
  UNAVAILABLE: "Unavailable",
};

export const BUCKET_ORDER: readonly AvailabilityBucket[] = [
  "AVAILABLE_NOW", "WITHIN_5H", "LATER_TODAY", "LATER", "UNKNOWN", "MAINTENANCE", "UNAVAILABLE",
];

/** Rows grouped by bucket, keeping the API's soonest-empty-first order inside each group. */
export function groupByBucket(rows: TruckAvailability[]): Map<AvailabilityBucket, TruckAvailability[]> {
  const groups = new Map<AvailabilityBucket, TruckAvailability[]>(BUCKET_ORDER.map((b) => [b, []]));
  for (const row of rows) groups.get(row.bucket)!.push(row);
  return groups;
}

/** "Dallas, TX", "Dallas", or null. */
export function emptyPlace(row: Pick<TruckAvailability, "emptyCity" | "emptyState">): string | null {
  const parts = [row.emptyCity, row.emptyState].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * When the truck should be empty, relative to `now`: "in 3 h 20 min", "in 45 min",
 * "overdue" (the estimate has passed), or null when there is no estimate.
 */
export function emptyIn(estimatedEmptyAt: string | null, now: Date): string | null {
  if (!estimatedEmptyAt) return null;
  const at = new Date(estimatedEmptyAt);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "overdue";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) return `in ${Math.round(h / 24)} d`;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
