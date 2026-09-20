import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, validateUsername } from "@/features/auth/rules";
import type { Username } from "@/types";

/**
 * The handle, and the one place a URL segment becomes a username.
 *
 * Pure and synchronous, because it runs in three places that cannot share a
 * runtime: the signup form, a public page rendered on the server, and an Open
 * Graph image route. A rule that lived in only one of them would let
 * `/profile/@Sam` and `/profile/sam` disagree about whose profile they are.
 */

/** The canonical path for a profile. The only place this string is built. */
export function profilePath(username: Username): string {
  return `/profile/${username}`;
}

/** The canonical path for a single achievement's share page. */
export function achievementPath(username: Username, achievementKey: string): string {
  return `/profile/${username}/a/${encodeURIComponent(achievementKey)}`;
}

/** `@sam` is how people write it; `sam` is what it is. */
export function displayHandle(username: Username): string {
  return `@${username}`;
}

/**
 * A URL segment, turned into the username it refers to — or null.
 *
 * Accepts the three forms people actually paste: `sam`, `@sam`, and `%40sam`
 * from a link that went through an encoder. Case is folded, because a handle
 * typed in a phone keyboard that capitalizes the first letter is still the
 * same person's handle.
 *
 * Returns null rather than a best guess when the result could not be a
 * username at all. A profile route that guessed would answer for the wrong
 * person, and answering "no such profile" is the only safe wrong answer.
 */
export function usernameFromSegment(raw: string): Username | null {
  let value = raw.trim();
  if (!value) return null;

  // A segment can arrive encoded once or (from a hand-built link) twice.
  for (let i = 0; i < 2 && value.includes("%"); i += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      return null;
    }
  }

  value = value.replace(/^@+/, "").trim().toLowerCase();
  if (value.length < USERNAME_MIN_LENGTH || value.length > USERNAME_MAX_LENGTH) return null;
  return validateUsername(value) === null ? value : null;
}

/**
 * The absolute URL a share card points back at.
 *
 * `origin` is passed in rather than read from `window`, because the two callers
 * that need an absolute URL — the share dialog and the Open Graph route — run
 * on opposite sides of the network. A trailing slash on the origin is dropped
 * so the result never contains `//profile`.
 */
export function absoluteProfileUrl(origin: string, username: Username): string {
  return `${origin.replace(/\/+$/, "")}${profilePath(username)}`;
}

export function absoluteAchievementUrl(
  origin: string,
  username: Username,
  achievementKey: string,
): string {
  return `${origin.replace(/\/+$/, "")}${achievementPath(username, achievementKey)}`;
}
