import type { ProfileSectionVisibility, UserProfile } from "@/types";

/**
 * Who may read what, decided once.
 *
 * ★ THE VIEWER IS NOT A MEMBERSHIP ★
 * Every other service in Antcolos is read through a `ServiceContext`, because
 * every other record belongs to an organization. A profile does not. It is
 * read by a signed-out stranger following a link, by a broker checking who
 * they are talking to, and by the person themselves — none of whom is "a
 * membership inside an organization".
 *
 * So the viewer here is deliberately the weakest thing that could work: an
 * optional user id, and nothing else. There is no permission to pass, which
 * means there is no permission an employer could hold over somebody's
 * profile — a carrier cannot unlock a former driver's hidden sections, because
 * no code path exists that would let it try.
 */

export interface ProfileViewer {
  /** Absent for a signed-out reader. */
  userId?: string;
}

export const DEFAULT_SECTIONS: ProfileSectionVisibility = {
  metrics: true,
  workplaces: true,
  achievements: true,
};

export function isOwner(profile: UserProfile, viewer: ProfileViewer | null): boolean {
  return Boolean(viewer?.userId && viewer.userId === profile.userId);
}

/**
 * Whether this reader may see the profile AT ALL.
 *
 * A `private` profile is invisible to everybody but its owner, and a caller
 * that is refused here is told the profile does not exist rather than that it
 * exists and is hidden — the second sentence is itself a disclosure, and it is
 * what turns a username list into a directory of who works in freight.
 */
export function canReadProfile(profile: UserProfile, viewer: ProfileViewer | null): boolean {
  if (isOwner(profile, viewer)) return true;
  if (profile.visibility === "private") return false;
  if (profile.visibility === "signed-in") return Boolean(viewer?.userId);
  return true;
}

/** The sections this reader gets. The owner always gets all of them. */
export function visibleSections(
  profile: UserProfile,
  viewer: ProfileViewer | null,
): ProfileSectionVisibility {
  if (isOwner(profile, viewer)) return { ...DEFAULT_SECTIONS };
  return { ...profile.sections };
}

/**
 * The sections withheld from this reader, so the page can SAY it is withholding
 * rather than render an empty grid.
 *
 * "This dispatcher has booked nothing" and "this dispatcher does not publish
 * their figures" are different statements, and a profile that cannot tell them
 * apart quietly slanders the people who value their privacy.
 */
export function withheldSections(
  profile: UserProfile,
  viewer: ProfileViewer | null,
): Array<keyof ProfileSectionVisibility> {
  const sections = visibleSections(profile, viewer);
  return (Object.keys(DEFAULT_SECTIONS) as Array<keyof ProfileSectionVisibility>)
    .filter((section) => !sections[section]);
}

/**
 * Whether a share card may be rendered for this profile.
 *
 * A share card is served to whoever holds the link — a crawler, a chat app's
 * link preview, anybody in a group thread — so it exists only for a profile
 * its owner made public. `signed-in` deliberately does NOT qualify: a preview
 * card rendered into a message is not a signed-in reader.
 */
export function isShareable(profile: UserProfile): boolean {
  return profile.visibility === "public";
}
