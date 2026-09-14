import type {
  MaintenanceDueSummary,
  MaintenanceState,
  MaintenanceTrigger,
  MeterReading,
} from "@/types";

/**
 * Turning a trigger into a state.
 *
 * Pure functions, no registry, no clock of their own: everything comes in as an
 * argument so the same code answers "what is this today" on a screen and "what
 * would this be on that date" in a test. Nothing here reads permissions —
 * deciding what somebody may SEE is the service layer's job, and mixing the two
 * is how a rule ends up enforced in one place and not the other.
 *
 * The one judgement call worth stating: **an unanswerable question is never
 * answered.** A mileage requirement on equipment with no odometer reading is
 * `upcoming` with `unknown: true`, not overdue and not fine. Guessing either way
 * would put a fleet manager's name against a decision nobody made.
 */

const DAY_MS = 86_400_000;

/** Everything the state of one requirement depends on. */
export interface TriggerEvaluation {
  trigger: MaintenanceTrigger;
  /** Latest reading for the equipment, when there is one. */
  meter?: MeterReading;
  /** Readings older than this are reported as stale rather than current. */
  meterStaleAfterDays?: number;
  /** Set once the requirement is finished. */
  completedAt?: string;
  /** Set while a repair order is open against it. */
  inService?: boolean;
  /** A recorded decision to run past due, with its expiry. */
  deferredUntil?: string;
  /** True when a deferral exists at all — a deferral with no end date. */
  deferred?: boolean;
  /** "Now", supplied rather than read, so tests are not time-dependent. */
  now: Date;
}

/**
 * What state this requirement is in.
 *
 * Order matters and is deliberate: completed beats everything (it is done), then
 * in-service (the work is happening, so "overdue" would be noise), then an
 * unexpired deferral, and only then the trigger itself.
 */
export function requirementState(input: TriggerEvaluation): MaintenanceState {
  if (input.completedAt) return "completed";
  if (input.inService) return "in_service";
  if (isDeferralActive(input)) return "deferred";
  return triggerState(input);
}

/**
 * A deferral runs out. One without an end date does not.
 *
 * An expired deferral is not silently renewed: the requirement drops back to
 * whatever the trigger says, which is usually overdue, and reappears in Needs
 * You. That is the point — deferring buys time, it does not close anything.
 */
function isDeferralActive(input: TriggerEvaluation): boolean {
  if (!input.deferred && !input.deferredUntil) return false;
  if (!input.deferredUntil) return true;
  return new Date(input.deferredUntil).getTime() > input.now.getTime();
}

/** The trigger's own verdict, ignoring completion, service and deferral. */
function triggerState(input: TriggerEvaluation): MaintenanceState {
  const due = dueSummary(input);
  if (due.unknown) return "upcoming";

  switch (input.trigger.kind) {
    case "date": {
      const days = due.remainingDays!;
      if (days < 0) return "overdue";
      return days <= input.trigger.warnDays ? "due_soon" : "upcoming";
    }
    case "mileage": {
      const miles = due.remainingMiles!;
      if (miles < 0) return "overdue";
      return miles <= input.trigger.warnMiles ? "due_soon" : "upcoming";
    }
    case "engine_hours": {
      const hours = due.remainingHours!;
      if (hours < 0) return "overdue";
      return hours <= input.trigger.warnHours ? "due_soon" : "upcoming";
    }
    case "defect": {
      // A fault that stops the equipment is overdue the moment it is reported —
      // there is no window in which "should not be driven" is upcoming.
      if (input.trigger.reportedSeverity === "out_of_service") return "overdue";
      if (!input.trigger.dueAt) {
        // Triage set no deadline. Critical faults still lead the queue;
        // anything else waits for a person to decide, rather than for this
        // function to invent a date on their behalf.
        return input.trigger.reportedSeverity === "critical" ? "overdue" : "due_soon";
      }
      const days = due.remainingDays!;
      if (days < 0) return "overdue";
      return days <= 2 ? "due_soon" : "upcoming";
    }
  }
}

/**
 * How far off it is, phrased for a table cell.
 *
 * Days are counted in whole days from the same instant, not calendar days, so
 * "due tomorrow" does not flip to "overdue" at midnight for a job booked at
 * 4pm.
 */
export function dueSummary(input: TriggerEvaluation): MaintenanceDueSummary {
  const { trigger, meter, now } = input;

  switch (trigger.kind) {
    case "date": {
      const remainingDays = daysBetween(now, new Date(trigger.dueAt));
      return {
        kind: "date",
        label: dayLabel(remainingDays),
        unknown: false,
        remainingDays,
        dueAt: trigger.dueAt,
      };
    }

    case "mileage": {
      if (meter?.odometerMiles === undefined) {
        return { kind: "mileage", label: "No odometer reading", unknown: true };
      }
      const remainingMiles = trigger.dueAtMiles - meter.odometerMiles;
      return {
        kind: "mileage",
        label: distanceLabel(remainingMiles),
        unknown: false,
        meterStale: isMeterStale(input),
        remainingMiles,
      };
    }

    case "engine_hours": {
      if (meter?.engineHours === undefined) {
        return { kind: "engine_hours", label: "No hour-meter reading", unknown: true };
      }
      const remainingHours = round1(trigger.dueAtHours - meter.engineHours);
      return {
        kind: "engine_hours",
        label: hoursLabel(remainingHours),
        unknown: false,
        meterStale: isMeterStale(input),
        remainingHours,
      };
    }

    case "defect": {
      if (!trigger.dueAt) {
        return {
          kind: "defect",
          label:
            trigger.reportedSeverity === "out_of_service"
              ? "Equipment stopped"
              : "No deadline set",
          // Not unknown: a defect with no deadline is a definite, answerable
          // state. It just has no date, which is a different thing from a
          // mileage rule nobody can evaluate.
          unknown: false,
        };
      }
      const remainingDays = daysBetween(now, new Date(trigger.dueAt));
      return {
        kind: "defect",
        label: dayLabel(remainingDays),
        unknown: false,
        remainingDays,
        dueAt: trigger.dueAt,
      };
    }
  }
}

/**
 * Whether the reading behind a distance or hours answer is too old to trust.
 *
 * The answer is still shown — a stale number beats no number for a human — but
 * it is labelled, so nobody reads a four-month-old odometer as today's.
 */
function isMeterStale(input: TriggerEvaluation): boolean {
  if (!input.meter || input.meterStaleAfterDays === undefined) return false;
  const ageDays =
    (input.now.getTime() - new Date(input.meter.readAt).getTime()) / DAY_MS;
  return ageDays > input.meterStaleAfterDays;
}

/**
 * The next due point after a job is finished.
 *
 * Returns the trigger unchanged when it does not recur: a one-off inspection
 * that has been done is finished, and rolling it forward would invent a
 * schedule the carrier never asked for.
 *
 * Intervals advance from the point the work was ACTUALLY done, not from the old
 * due date. Rolling from the due date is how a fleet that runs a week late ends
 * up with a service every 6,000 miles instead of every 7,000.
 */
export function nextTriggerAfterCompletion(
  trigger: MaintenanceTrigger,
  completion: { at: Date; meter?: MeterReading },
): MaintenanceTrigger | null {
  switch (trigger.kind) {
    case "date": {
      if (!trigger.intervalDays) return null;
      const next = new Date(completion.at.getTime() + trigger.intervalDays * DAY_MS);
      return { ...trigger, dueAt: next.toISOString() };
    }
    case "mileage": {
      if (!trigger.intervalMiles) return null;
      // Without a reading at completion there is no base to add the interval
      // to. Returning null leaves a person to set the next one rather than
      // anchoring the whole future schedule to a guess.
      if (completion.meter?.odometerMiles === undefined) return null;
      return {
        ...trigger,
        dueAtMiles: completion.meter.odometerMiles + trigger.intervalMiles,
      };
    }
    case "engine_hours": {
      if (!trigger.intervalHours) return null;
      if (completion.meter?.engineHours === undefined) return null;
      return {
        ...trigger,
        dueAtHours: round1(completion.meter.engineHours + trigger.intervalHours),
      };
    }
    case "defect":
      // A defect requirement answers one fault. It never recurs.
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function dayLabel(days: number): string {
  if (days < 0) {
    const over = Math.abs(days);
    return over === 1 ? "1 day overdue" : `${over} days overdue`;
  }
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `In ${days} days`;
}

function distanceLabel(miles: number): string {
  if (miles < 0) return `${Math.abs(miles).toLocaleString()} mi over`;
  return `In ${miles.toLocaleString()} mi`;
}

function hoursLabel(hours: number): string {
  if (hours < 0) return `${Math.abs(hours).toLocaleString()} h over`;
  return `In ${hours.toLocaleString()} h`;
}

/**
 * Sort order for a work queue: the most pressing first.
 *
 * Overdue leads, then due soon, then in service (somebody is on it), then
 * upcoming, then deferred, then completed. Within a band, whatever is closest
 * to its due point comes first.
 */
export const MAINTENANCE_STATE_ORDER: Record<MaintenanceState, number> = {
  overdue: 0,
  due_soon: 1,
  in_service: 2,
  upcoming: 3,
  deferred: 4,
  completed: 5,
};

/** A single comparable number for ordering a mixed list of requirements. */
export function urgencyScore(state: MaintenanceState, due: MaintenanceDueSummary): number {
  const band = MAINTENANCE_STATE_ORDER[state] * 1_000_000;
  if (due.unknown) return band + 900_000;
  // Normalise the three units onto one axis. Exact cross-unit comparison is
  // meaningless, so this only has to be stable and monotonic within a band.
  const remaining =
    due.remainingDays ??
    (due.remainingMiles !== undefined ? due.remainingMiles / 100 : undefined) ??
    due.remainingHours ??
    0;
  return band + Math.max(-500_000, Math.min(500_000, remaining));
}
