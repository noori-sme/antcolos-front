import {
  METERED_CAPACITIES,
  type Achievement, type ProfileCapacity, type ProfileContribution, type ProfileView,
  type UserProfile, type WorkplaceAssociation,
} from "@/types";
import { evaluateAchievements } from "./achievements";
import { buildMetrics } from "./metrics";
import { buildTenure } from "./tenure";
import { canReadProfile, isOwner, visibleSections, withheldSections, type ProfileViewer } from "./visibility";

/**
 * The whole profile, assembled from the records that make it up.
 *
 * ★ WHY THIS IS PURE ★
 * Three callers need the SAME answer and run in three different places: the
 * mock service in a browser tab, the public page on a server, and the Open
 * Graph image route in a route handler. If each assembled its own view, a
 * share card would eventually claim a figure the page underneath it did not
 * show. One function, three callers, no drift.
 *
 * It takes `asOf` rather than reading the clock, so a card and the page it was
 * generated from describe the same instant.
 */

export interface ProfileRecords {
  profile: UserProfile;
  associations: readonly WorkplaceAssociation[];
  contributions: readonly ProfileContribution[];
  /** Comparative awards the platform decided. Never derived — see ./achievements.ts. */
  conferred: readonly Achievement[];
}

/**
 * The capacities this person has actually worked in, in a stable order.
 *
 * Taken from the associations first, because that is the record of employment,
 * and topped up from the contributions so that work posted before an
 * association was opened still counts. Only metered capacities produce a grid.
 */
export function meteredCapacitiesOf(records: ProfileRecords): ProfileCapacity[] {
  const worked = new Set<ProfileCapacity>([
    ...records.associations.map((a) => a.capacity),
    ...records.contributions.map((c) => c.capacity),
  ]);
  return METERED_CAPACITIES.filter((capacity) => worked.has(capacity));
}

/**
 * Returns null when this reader may not see the profile at all.
 *
 * Null rather than a stripped-down view, because the caller's job in that case
 * is to answer "no such profile" — see `canReadProfile` for why saying more is
 * itself a disclosure.
 */
export function buildProfileView(
  records: ProfileRecords,
  viewer: ProfileViewer | null,
  asOf: string,
): ProfileView | null {
  const { profile, associations, contributions, conferred } = records;
  if (!canReadProfile(profile, viewer)) return null;

  const sections = visibleSections(profile, viewer);
  // Newest first: a career page is read from what somebody is doing now
  // backwards, and an open-ended association is always the newest thing.
  const ordered = [...associations].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return {
    profile,
    tenure: buildTenure(profile.joinedAt, associations, asOf),
    // Absent, not empty. An empty array would be a claim about the person.
    workplaces: sections.workplaces ? ordered : undefined,
    metrics: sections.metrics
      ? buildMetrics(contributions, meteredCapacitiesOf(records))
      : undefined,
    achievements: sections.achievements
      ? evaluateAchievements({ joinedAt: profile.joinedAt, contributions, asOf, conferred })
      : undefined,
    isOwner: isOwner(profile, viewer),
    withheld: withheldSections(profile, viewer),
  };
}
