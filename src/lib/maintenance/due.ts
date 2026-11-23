import {
  MAINTENANCE_CATEGORIES, type MaintenanceCategory, type MaintenanceSchedule, type MaintenanceTask,
  type ScheduleDue, type ScheduleInput,
} from "@/types/maintenance-live";

/** What a maintenance interval is for, in plain words (plan 24). */
export const CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  OIL_CHANGE: "Oil change",
  PREVENTIVE_SERVICE: "Preventive service",
  INSPECTION: "Inspection",
  TIRES: "Tires",
  BRAKES: "Brakes",
  OTHER: "Other",
};

export function categoryLabel(category: string): string {
  if ((MAINTENANCE_CATEGORIES as readonly string[]).includes(category)) {
    return CATEGORY_LABELS[category as MaintenanceCategory];
  }
  const words = category.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const n = (value: number) => value.toLocaleString("en-US");
const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const plural = (value: number, one: string, many: string) => `${n(value)} ${value === 1 ? one : many}`;

function leftText(left: number, unit: string, one = unit): string {
  return left < 0 ? `${plural(-left, one, unit)} overdue` : `${plural(left, one, unit)} left`;
}

/** "660 mi left", "3 days overdue · Nov 18", "Due at 183,000 mi · no reading yet". */
export function dueSummary(due: ScheduleDue): string {
  const parts: string[] = [];
  if (due.milesLeft !== null) parts.push(leftText(due.milesLeft, "mi"));
  if (due.engineHoursLeft !== null) parts.push(leftText(due.engineHoursLeft, "engine h"));
  if (due.daysLeft !== null) {
    parts.push(`${leftText(due.daysLeft, "days", "day")}${due.nextDueAt ? ` · ${date(due.nextDueAt)}` : ""}`);
  }
  if (parts.length) return parts.join(" · ");
  const at = due.nextDueOdometerMiles !== null
    ? `${n(due.nextDueOdometerMiles)} mi`
    : due.nextDueEngineHours !== null ? `${n(due.nextDueEngineHours)} engine h` : null;
  return at ? `Due at ${at} · no reading yet` : "No reading yet";
}

/** What a task was due at when it opened. */
export function taskDueSummary(task: Pick<MaintenanceTask, "dueOdometerMiles" | "dueEngineHours" | "dueAt">): string {
  const parts: string[] = [];
  if (task.dueOdometerMiles !== null) parts.push(`At ${n(task.dueOdometerMiles)} mi`);
  if (task.dueEngineHours !== null) parts.push(`At ${n(task.dueEngineHours)} engine h`);
  if (task.dueAt) parts.push(`${parts.length ? "by" : "By"} ${date(task.dueAt)}`);
  return parts.length ? parts.join(" · ") : "Due now";
}

/** "Every 15,000 mi or 180 days". */
export function intervalSummary(
  s: Pick<MaintenanceSchedule, "everyDays" | "everyMiles" | "everyEngineHours">,
): string {
  const parts: string[] = [];
  if (s.everyMiles !== null) parts.push(`${n(s.everyMiles)} mi`);
  if (s.everyEngineHours !== null) parts.push(`${n(s.everyEngineHours)} engine h`);
  if (s.everyDays !== null) parts.push(plural(s.everyDays, "day", "days"));
  return `Every ${parts.join(" or ")}`;
}

export const MAX_DEFER_DAYS = 90;

/** The latest a task may be deferred to (the API refuses later). */
export function maxDeferDate(now: Date): Date {
  return new Date(now.getTime() + MAX_DEFER_DAYS * 24 * 60 * 60 * 1000);
}

const EDITABLE = [
  "title", "category", "everyDays", "everyMiles", "everyEngineHours", "warnDays", "warnMiles",
  "warnEngineHours", "lastServiceOdometerMiles", "lastServiceEngineHours",
] as const;

/** The PATCH body: only fields that changed; `null` clears an interval or window. */
export function scheduleChanges(before: MaintenanceSchedule, after: ScheduleInput): ScheduleInput {
  const changes: Record<string, unknown> = {};
  for (const field of EDITABLE) {
    const next = after[field];
    if (next !== undefined && next !== (before as unknown as Record<string, unknown>)[field]) {
      changes[field] = next;
    }
  }
  return changes as ScheduleInput;
}
