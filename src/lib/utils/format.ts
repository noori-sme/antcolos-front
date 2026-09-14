/** Money is stored in cents and never rendered without the matching permission. */
export function money(cents: number, opts: { compact?: boolean } = {}): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact && Math.abs(dollars) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: opts.compact && Math.abs(dollars) >= 10_000 ? 1 : 2,
    minimumFractionDigits: opts.compact && Math.abs(dollars) >= 10_000 ? 0 : 2,
  }).format(dollars);
}

export function ratePerMile(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/mi`;
}

/** Dispatch is timezone-critical; times render in the organization's zone. */
export function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone,
  }).format(new Date(iso));
}

/** Issue dates, due dates and delivery dates are days, not moments. */
export function dateIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone,
  }).format(new Date(iso));
}

export function dateTimeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone,
  }).format(new Date(iso));
}

/** "in 2h 10m" / "3h 5m ago" / "now" — the operational reading of a deadline. */
export function relativeTime(iso: string, from = Date.now()): string {
  const diffMs = new Date(iso).getTime() - from;
  const past = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  if (mins < 1) return "now";

  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;

  let body: string;
  if (days > 0) body = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  else if (hours > 0) body = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  else body = `${minutes}m`;

  return past ? `${body} ago` : `in ${body}`;
}

export function isOverdue(iso?: string, from = Date.now()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < from;
}
