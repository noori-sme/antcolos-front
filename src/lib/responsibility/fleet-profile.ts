import {
  FLEET_BANDS, MIN_MEMBERS_FOR_SUPERVISORS, MIN_MEMBERS_FOR_TEAM_QUEUE,
  type FleetBand,
} from "@/config/responsibility";
import type { FleetProfile } from "@/types";
import type { ResponsibilityCandidate } from "./candidate";

/**
 * How much structure this workspace gets, from the one thing onboarding asks.
 *
 * The zero-friction rule in one function. A Carrier signing up answers "how
 * many trucks?" — a number they already know, typed once — and everything else
 * follows: whether there is a team queue, whether supervisors exist, how many
 * rungs the escalation ladder has. Nobody is shown an organizational design
 * wizard, and nobody has to understand the words "accountable" or "escalation
 * policy" to start working.
 *
 * The second half is what keeps that honest. A tier ALLOWS a capability; the
 * people in the workspace DECIDE it. A forty-truck carrier that has not invited
 * anybody yet gets no team queue, because a queue you cannot hand work to is a
 * worse answer than no queue at all — and, more to the point, because the
 * milestone forbids assigning work to nonexistent people.
 */

/** The band a truck count falls in. Bands are ordered largest-first. */
export function bandFor(truckCount: number): FleetBand {
  const safe = Number.isFinite(truckCount) && truckCount > 0 ? Math.floor(truckCount) : 0;
  return FLEET_BANDS.find((b) => safe >= b.minTrucks) ?? FLEET_BANDS[FLEET_BANDS.length - 1];
}

export interface FleetProfileInput {
  organizationId: string;
  truckCount: number;
  members: readonly ResponsibilityCandidate[];
  /** True when a person has answered the fleet-size question themselves. */
  sizeAnswered?: boolean;
}

export function fleetProfileFor(input: FleetProfileInput): FleetProfile {
  const band = bandFor(input.truckCount);

  // Drivers are members, but they are not who work is queued to: a driver
  // holds their own actions and nothing else. Counting them would switch on a
  // team queue for an owner-operator with three drivers and no office.
  const workforce = input.members.filter(
    (m) => m.organizationId === input.organizationId
      && m.status === "active"
      && !m.driverProfileId,
  );
  const eligibleMemberCount = workforce.length;

  const teamQueuesEnabled =
    band.teamQueuesEnabled && eligibleMemberCount >= MIN_MEMBERS_FOR_TEAM_QUEUE;

  // Supervisors need both the size and somebody actually declared as one.
  // A directory where nobody reports to anybody is a flat workspace whatever
  // its truck count says.
  const hasDeclaredSupervisor = workforce.some((m) => m.supervisorMembershipId);
  const supervisorsEnabled =
    band.supervisorsEnabled
    && eligibleMemberCount >= MIN_MEMBERS_FOR_SUPERVISORS
    && hasDeclaredSupervisor;

  // A ladder needs somebody above the person on it. With one member, every rung
  // points back at the same person, so there is exactly one.
  const escalationLevels = teamQueuesEnabled ? band.escalationLevels : 1;

  const truckCount = Math.max(0, Math.floor(input.truckCount) || 0);

  return {
    organizationId: input.organizationId,
    truckCount,
    // Registered trucks are an answer. Asking a carrier how many trucks they
    // have when Antcolos is already looking at seven of them is exactly the
    // friction the one-question rule exists to avoid.
    sizeConfirmed: truckCount > 0 || input.sizeAnswered === true,
    tier: band.tier,
    eligibleMemberCount,
    teamQueuesEnabled,
    supervisorsEnabled,
    escalationLevels,
    summary: summaryFor(band, {
      eligibleMemberCount, teamQueuesEnabled, supervisorsEnabled,
    }),
  };
}

/**
 * The tier in a sentence, and honest about the gap between what the size allows
 * and what the people make possible.
 */
function summaryFor(
  band: FleetBand,
  actual: {
    eligibleMemberCount: number;
    teamQueuesEnabled: boolean;
    supervisorsEnabled: boolean;
  },
): string {
  if (actual.eligibleMemberCount <= 1) {
    return band.tier === "solo"
      ? band.summary
      : "Everything is yours for now. Team queues and escalation levels switch themselves on when somebody else joins.";
  }
  if (band.teamQueuesEnabled && !actual.teamQueuesEnabled) {
    return "Team queues switch on as soon as a second person can take work.";
  }
  if (band.supervisorsEnabled && !actual.supervisorsEnabled) {
    return "Team queues are on. A supervisor level appears once somebody is set to oversee the desk.";
  }
  return band.summary;
}
