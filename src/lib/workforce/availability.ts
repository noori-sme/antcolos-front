import {
  WORKFORCE_AVAILABILITY_LIMITATION, WORKFORCE_LEAVE_REASON_LABEL,
  type MembershipAvailability, type WorkforceAvailability,
  type WorkforceAvailabilityProjection, type WorkforceEngagement,
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
): Omit<WorkforceAvailability, "projection"> {
  // `projection` is deliberately NOT produced here. It needs the seat's current
  // availability, which this function does not take and must not go looking
  // for — it is pure, and a pure derivation that reached into the membership
  // directory would be the drift it exists to detect. The caller that holds the
  // seat supplies it; see `availabilityProjection` below.
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

/* -------------------------------------------------------------------------- */
/* The routing projection, and how it is kept honest                           */
/* -------------------------------------------------------------------------- */

/**
 * ★ WHAT LEAVE SAYS THE SEAT'S AVAILABILITY SHOULD BE ★
 *
 * `"on_leave"` when a leave covers today AND the engagement is one somebody
 * actually works under. `undefined` means **leave has no opinion** — not
 * "available". The difference is the whole fix:
 *
 *   • A SUSPENDED or ENDED engagement is not leave's to speak for. Ending an
 *     old leave record on somebody who has been stood down or has left must not
 *     hand them back to the routing engine, and returning `undefined` here is
 *     what stops it.
 *   • A seat somebody set to `off_shift` for an unrelated reason is not
 *     leave's to overwrite either. Leave says only what leave knows.
 *
 * PURE. It reads no store and writes nothing, so the same answer is available
 * to the command that applies it, the projection a screen renders, and the
 * Needs You derivation that notices when nobody applied it.
 */
export function desiredSeatAvailability(
  engagement: Pick<WorkforceEngagement, "state" | "leave">,
  now: string,
): MembershipAvailability | undefined {
  if (!leaveManagesSeat(engagement)) return undefined;
  return currentLeave(engagement, now) ? "on_leave" : undefined;
}

/**
 * Whether leave has ANY business touching this person's seat.
 *
 * ███ THE DISTINCTION THAT TWO DEFECTS TURNED ON ███
 * "Leave says the seat should not read `on_leave`" and "leave has no standing
 * to say anything about this seat" are different, and collapsing them is what
 * let closing an old leave record hand a SUSPENDED or OFFBOARDED person back to
 * the routing engine.
 *
 * Only an `active` engagement is leave's to speak for. Every other state is
 * somebody else's answer — the access system stood them down, or the
 * offboarding ended them — and leave must neither overwrite it nor complain
 * about it. That is why a non-active engagement reports `inSync` rather than a
 * drift: a seat reading `on_leave` under a suspension is not a mistake leave
 * gets to correct.
 */
export function leaveManagesSeat(
  engagement: Pick<WorkforceEngagement, "state">,
): boolean {
  return engagement.state === "active";
}

/**
 * Whether the routing signal actually matches what leave says it should.
 *
 * ███ WHY THIS EXISTS AT ALL ███
 * Because the projection is written by a COMMAND, and a command is a moment in
 * time. Three things happen after that moment which nothing would otherwise
 * notice:
 *
 *   1. **A future leave becomes effective.** There is no scheduler in this
 *      build and there is none in most backends either without one being built.
 *      Leave recorded for next Monday changes the seat on no day by itself.
 *   2. **Somebody changes availability independently.** The directory's command
 *      is public and has a legitimate caller — a dispatcher marking somebody
 *      back. It can set `available` on a person who is still away.
 *   3. **The projection write failed** while the HR record succeeded. There is
 *      no cross-module transaction here, so this is not hypothetical.
 *
 * In all three the HR fact and the routing signal disagree, and before this
 * function nothing anywhere could tell. This makes the disagreement an explicit,
 * derived, RESUMABLE state: it is surfaced on the engagement, raised in Needs
 * You, and applied by `reconcileAvailability` — which is idempotent, so running
 * it twice is running it once.
 *
 * ★ IT IS A COMPARISON, NOT A SECOND SOURCE OF TRUTH ★
 * It stores nothing. Leave is the canonical HR fact; the membership's
 * availability is the operational projection; this reports the delta between
 * them and has no opinion of its own.
 */
export function availabilityProjection(
  engagement: Pick<WorkforceEngagement, "state" | "leave" | "membershipId">,
  seatAvailability: MembershipAvailability | undefined,
  now: string,
): WorkforceAvailabilityProjection {
  const desired = desiredSeatAvailability(engagement, now);

  // Nobody to project onto. Not a drift: a person with no seat holds no
  // routing signal, and demanding one would raise an item about somebody who
  // has no account.
  if (!engagement.membershipId || seatAvailability === undefined) {
    return {
      managedByLeave: desired !== undefined,
      desired,
      actual: undefined,
      inSync: true,
      summary: "This person holds no seat in this workspace, so there is no work-routing "
        + "signal for leave to keep in step with.",
    };
  }

  // Not leave's to speak for at all. A suspended or ended engagement's seat is
  // whatever the access system left it as, and leave neither corrects it nor
  // complains about it — reporting a drift here is what would tempt somebody
  // into "fixing" a suspension.
  if (!leaveManagesSeat(engagement)) {
    return {
      managedByLeave: false,
      desired: undefined,
      actual: seatAvailability,
      inSync: true,
      summary: "This engagement is not active, so its work-routing signal is not leave's to "
        + "manage. Access and the engagement's own state decide it.",
    };
  }

  if (desired === undefined) {
    // Active, and no leave covers today. Anything the seat says is somebody
    // else's decision and is correct by definition — EXCEPT a seat still
    // reading `on_leave`, which is a projection nobody took back.
    const stale = seatAvailability === "on_leave";
    return {
      managedByLeave: false,
      desired: undefined,
      actual: seatAvailability,
      inSync: !stale,
      summary: stale
        ? "This seat is still marked on leave and no leave record covers today. Work is not "
          + "being routed to them for a reason that no longer exists."
        : "Leave has no opinion about this seat's availability right now; it is whatever "
          + "the workspace last decided.",
    };
  }

  const inSync = seatAvailability === desired;
  return {
    managedByLeave: true,
    desired,
    actual: seatAvailability,
    inSync,
    summary: inSync
      ? "The work-routing signal matches the recorded leave."
      : "A recorded leave covers today and this seat is still taking work. Until this is "
        + "applied, the responsibility engine may route work to somebody who is away.",
  };
}
