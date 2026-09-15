/** An audit entry is a moment, and the minute is the point of recording it. */
export function formatDateTime(iso: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone,
  }).format(new Date(iso));
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

/** "3 hours ago", for a list where the exact minute is one click away. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** "in 6 hours" / "4 hours overdue", said plainly. */
export function dueLabel(iso?: string, now = Date.now()): string {
  if (!iso) return "No due date";
  const diff = new Date(iso).getTime() - now;
  const hours = Math.round(Math.abs(diff) / 3_600_000);
  const unit = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`;
  return diff >= 0 ? `Due in ${unit}` : `${unit} overdue`;
}

export function isOverdue(iso?: string, now = Date.now()): boolean {
  return Boolean(iso && new Date(iso).getTime() < now);
}

/** A change value on screen. An absent value is a withheld one, not an empty one. */
export function changeValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
