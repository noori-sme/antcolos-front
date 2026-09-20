import {
  WORKFORCE_AVAILABILITY_LIMITATION, WORKFORCE_LEAVE_REASON_LABEL,
  type WorkforceAvailability, type WorkforceEngagement,
  type WorkforceLeaveRecord,
} from "@/types";

/**
 * ★ THE ONE TYPED AVAILABILITY SIGNAL, AND ITS EXACT LIMITS ★
 *
 * Derived, never stored. A leave record whose expected return has passed does
 * not silently become "back": somebody has to say they returned, because
 * guessing is how a person who extended their leave gets handed a load.
 *
 * ███ WHAT THIS DELIBERATELY DOES NOT DO ███
 * It does not read a truck, an inspection, an out-of-service order, a licence,
 * a medical card, an hours-of-service clock or a load. `availableForWork: true`
 * means exactly "HR knows of no reason not to route work to this person" and is
 * worth nothing beyond that. Dispatch readiness is Dispatch's, roadworthiness
 * is Maintenance's, qualification is Safety's and hours are the ELD's — and
 * this module has no import that could reach any of them, which is the point.
 *
 * ── HOW IT REACHES THE ROUTING ENGINE ────────────────────────────────────
 * Not through this file. Workforce does not hold a routing flag: when leave is
 * recorded, the service calls the membership directory's own
 * `setMembershipAvailability`, the same way offboarding calls its
 * `setMembershipStatus`. `takesWork` and the responsibility engine's candidate
 * gate keep working exactly as they did, reading the field they always read.
 * This projection is what a HUMAN sees; that command is what the system acts on.
 */

/** Leave that covers today. Inclusive of the start day, exclusive of return. */
export function isLeaveCurrent(leave: WorkforceLeaveRecord, now: string): boolean {
  if (leave.status === "ended" || leave.status === "cancelled") return false;
  if (leave.startDate > now) return false;
  // An expected return in the past does NOT end it. See the note above.
  return leave.actualReturnDate === undefined;
}

/** Leave recorded for a date that has not arrived. */
export function isLeavePlanned(leave: WorkforceLeaveRecord, now: string): boolean {
  if (leave.status === "ended" || leave.status === "cancelled") return false;
  return leave.startDate > now;
}

export function currentLeave(
  engagement: Pick<WorkforceEngagement, "leave">, now: string,
): WorkforceLeaveRecord | undefined {
  return engagement.leave.find((l) => isLeaveCurrent(l, now));
}

/** The soonest planned leave, so a row can say "away from the 3rd". */
export function nextPlannedLeave(
  engagement: Pick<WorkforceEngagement, "leave">, now: string,
): WorkforceLeaveRecord | undefined {
  return engagement.leave
    .filter((l) => isLeavePlanned(l, now))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * The availability projection for one engagement.
 *
 * Order matters and is not arbitrary: the engagement's own state is asked
 * FIRST, because somebody who has left or has been stood down is not "on
 * holiday" whatever their leave records say, and a projection that read the
 * leave first would announce a returning date for somebody who is gone.
 */
export function availabilityFor(
  engagement: Pick<WorkforceEngagement, "state" | "leave" | "suspensionReason">,
  now: string,
): WorkforceAvailability {
  const limitation = WORKFORCE_AVAILABILITY_LIMITATION;

  if (engagement.state === "suspended") {
    return {
      state: "suspended",
      summary: engagement.suspensionReason
        ? `Stood down by this organization: ${engagement.suspensionReason}`
        : "Stood down by this organization. This is not leave.",
      availableForWork: false,
      limitation,
    };
  }

  if (engagement.state !== "active") {
    return {
      state: "not_engaged",
      summary: "Not currently working with this organization.",
      availableForWork: false,
      limitation,
    };
  }

  const live = currentLeave(engagement, now);
  if (live) {
    const reason = WORKFORCE_LEAVE_REASON_LABEL[live.reason].toLowerCase();
    const overdue = live.expectedReturnDate !== undefined && live.expectedReturnDate < now;
    return {
      state: "on_leave",
      leave: live,
      summary: live.expectedReturnDate
        ? overdue
          ? `Away (${reason}); was expected back on ${day(live.expectedReturnDate)} and nobody has recorded a return.`
          : `Away (${reason}) until ${day(live.expectedReturnDate)}.`
        : `Away (${reason}); no return date has been recorded.`,
      availableForWork: false,
      limitation,
    };
  }

  const planned = nextPlannedLeave(engagement, now);
  if (planned) {
    return {
      state: "leave_planned",
      leave: planned,
      // Working TODAY. The distinction exists so a dispatcher planning next
      // week sees it and today's routing is unaffected.
      summary: `Working. Away from ${day(planned.startDate)}`
        + `${planned.expectedReturnDate ? ` until ${day(planned.expectedReturnDate)}` : ""}.`,
      availableForWork: true,
      limitation,
    };
  }

  return {
    state: "working",
    summary: "Working. HR knows of no reason not to route work to this person.",
    availableForWork: true,
    limitation,
  };
}
