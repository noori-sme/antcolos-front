import { site } from "@/config/brand";
import { usernameFromSegment } from "@/lib/profile/identity";
import { publishedRecords } from "@/lib/profile/published";
import { achievementShareCard, profileShareCard } from "@/lib/profile/share";
import { buildProfileView } from "@/lib/profile/view";
import type { ProfileView, ShareCard } from "@/types";

/**
 * Resolving a profile ON THE SERVER, for metadata and share-card images.
 *
 * ★ WHY THIS DOES NOT GO THROUGH THE SERVICE ★
 * Everything else in this app reads through `services.*`, whose mock adapter
 * lives in a browser tab. A crawler fetching an Open Graph image has no tab and
 * no store, so this reads the published snapshot directly — the same module the
 * mock store seeds itself from, assembled by the same pure `buildProfileView`
 * the page uses. One set of records, one assembler, two runtimes.
 *
 * ███ THE LIMITATION, STATED ███
 * A profile edited in a tab is edited in that tab's store, and the seeded
 * snapshot is what a server-rendered card still draws. A real backend serves
 * both from the same row; this function is exactly the seam where that read
 * goes. See `docs/permanent-user-profile.md`.
 *
 * Always read as a STRANGER (`null` viewer): a link preview in a group chat is
 * not a signed-in reader, so a card can never carry a figure the public page
 * withholds.
 */

export interface ResolvedProfile {
  username: string;
  view: ProfileView;
  /** True when the URL segment was not already the canonical handle. */
  needsCanonicalRedirect: boolean;
}

export function resolveProfileSegment(segment: string): ResolvedProfile | null {
  const username = usernameFromSegment(segment);
  if (!username) return null;

  const records = publishedRecords(username);
  if (!records) return null;

  const view = buildProfileView(records, null, new Date().toISOString());
  if (!view) return null;

  return { username, view, needsCanonicalRedirect: segment !== username };
}

/** The card for a profile, or for one achievement on it. Null when not public. */
export function resolveShareCard(
  segment: string,
  achievementKey?: string,
): ShareCard | null {
  const resolved = resolveProfileSegment(segment);
  if (!resolved || resolved.view.profile.visibility !== "public") return null;

  if (!achievementKey) return profileShareCard(resolved.view, site.origin);

  const achievement = resolved.view.achievements?.find((a) => a.key === achievementKey);
  return achievement ? achievementShareCard(resolved.view, achievement, site.origin) : null;
}
