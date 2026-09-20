import type { AppliedTemplate, PermissionKey } from "./permission";

export type MembershipStatus = "invited" | "active" | "suspended" | "left";

/**
 * Whether this membership can pick work up right now.
 *
 * Kept apart from `MembershipStatus`, which is about the SEAT: a suspended
 * membership is not a member at all, while an on-leave one is a member who
 * cannot take work this week. Collapsing them would make "route around them for
 * now" indistinguishable from "they are gone".
 *
 * ★ WHY IT LIVES HERE AND NOT IN THE DIRECTORY ★
 * Three modules now read it — the directory that owns it, the responsibility
 * engine that routes on it, and Workforce, which records the HR fact of leave
 * and must be able to say what the seat read BEFORE leave took it over. A
 * vocabulary three modules share belongs in the shared vocabulary; a second
 * copy of these four words is how "on leave" comes to mean two things.
 *
 * ███ SINGLE-VALUED, AND THAT MATTERS ███
 * A seat has ONE availability, so two independent reasons to be unavailable
 * cannot both be represented. Leave therefore DISPLACES whatever was there and
 * must record what it displaced — see `WorkforceLeaveRecord.seatAvailabilityBefore`
 * — or ending the leave would announce somebody available who was off shift
 * before it started.
 */
export type MembershipAvailability =
  | "available"
  /** Working, but not this shift. */
  | "off_shift"
  | "on_leave"
  /** Present and refusing new work — at capacity, or on something else. */
  | "unavailable";

export const AVAILABILITY_LABEL: Record<MembershipAvailability, string> = {
  available: "Available",
  off_shift: "Off shift",
  on_leave: "On leave",
  unavailable: "Not taking work",
};

export const AVAILABILITY_TAKES_WORK: Record<MembershipAvailability, boolean> = {
  available: true,
  off_shift: false,
  on_leave: false,
  unavailable: false,
};

export interface MembershipScope {
  /** Permission says what action; scope says over which records. */
  loads: "all" | "assigned";
  financials: "all" | "own";
}

/** The per-organization link. Disposable — the User it points at is not. */
export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  status: MembershipStatus;
  /** Organization-specific job title, display only. Never a permission source. */
  title?: string;
  /**
   * The templates applied to this seat, each carrying the permission SNAPSHOT
   * taken when it was applied.
   *
   * Not a list of ids to dereference. A membership that held ids would be a
   * membership whose access changed whenever somebody edited a template — the
   * exact behaviour the product has to be able to promise it does not have.
   * See `AppliedTemplate`.
   */
  appliedTemplates: AppliedTemplate[];
  /** Person-specific additions, on top of whatever the templates brought. */
  grants: PermissionKey[];
  /** Person-specific removals. Beat grants, so one key can be taken back
   *  without building a template for one person. */
  revocations: PermissionKey[];
  scope: MembershipScope;
  driverProfileId?: string;
  isOwner: boolean;
  joinedAt: string;
  endedAt?: string;
  // No personal profile data.
}
