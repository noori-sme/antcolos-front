/** Dates in compliance are calendar facts, not dispatch times: no clock. */
export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

/** History entries are moments, and the minute matters for an audit trail. */
export function formatDateTime(iso: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone,
  }).format(new Date(iso));
}
