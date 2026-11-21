import {
  AVAILABILITY_BUCKETS, type AvailabilityBucket, type TruckAvailability,
} from "@/types/fleet-truck";

/** The board shows buckets in this order (the API's own order). */
export const BUCKET_ORDER: readonly AvailabilityBucket[] = AVAILABILITY_BUCKETS;

const BUCKET_LABELS: Record<AvailabilityBucket, string> = {
  AVAILABLE_NOW: "Available now",
  WITHIN_5H: "Within 5 hours",
  LATER_TODAY: "Later today",
  LATER: "Later",
  UNKNOWN: "On a trip, time unknown",
  MAINTENANCE: "In maintenance",
  UNAVAILABLE: "Unavailable",
};

export function bucketLabel(bucket: AvailabilityBucket): string {
  return BUCKET_LABELS[bucket];
}

/** Why a row is in a bucket, when the bucket alone does not say. */
export const BUCKET_HINTS: Partial<Record<AvailabilityBucket, string>> = {
  UNKNOWN: "On a trip, but we can't see a delivery time (the load may belong to another company).",
};

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "In 3 h 20 min", "Now", "Overdue by 1 h"; null when the time is unknown. */
export function emptyInText(estimatedEmptyAt: string | null, now: Date): string | null {
  if (!estimatedEmptyAt) return null;
  const minutes = Math.round((new Date(estimatedEmptyAt).getTime() - now.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return null;
  if (minutes === 0) return "Now";
  return minutes > 0 ? `In ${duration(minutes)}` : `Overdue by ${duration(-minutes)}`;
}

/** A stored prediction against the actual empty time; within 5 minutes counts as on time. */
export function predictionErrorText(errorMinutes: number | null): string {
  if (errorMinutes === null) return "Not delivered yet";
  if (Math.abs(errorMinutes) <= 5) return "On time";
  return errorMinutes > 0 ? `${duration(errorMinutes)} late` : `${duration(-errorMinutes)} early`;
}

export interface BucketGroup {
  bucket: AvailabilityBucket;
  rows: TruckAvailability[];
}

/** Rows grouped in board order; the API's soonest-first order is kept inside each group. */
export function groupByBucket(rows: readonly TruckAvailability[]): BucketGroup[] {
  return BUCKET_ORDER.map((bucket) => ({ bucket, rows: rows.filter((r) => r.bucket === bucket) }))
    .filter((group) => group.rows.length > 0);
}
