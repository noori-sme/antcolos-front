/**
 * What may be uploaded as an avatar, decided in one pure place.
 *
 * ███ THESE ARE FRONTEND RULES ███
 * They exist to fail fast and to explain themselves while somebody is looking
 * at the file picker. Every one of them must be enforced AGAIN by the backend,
 * because a client that does not run this code can post anything at all: a
 * `type` is what the browser guessed from the file name, a `size` is what the
 * browser reported, and neither is evidence. See `docs/permanent-user-profile.md`.
 */

export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

/**
 * SVG is deliberately absent. An SVG avatar is an executable document that
 * would be served from Antcolos's own origin, and no amount of sanitizing on
 * upload is worth the class of bug that opens.
 */
export const AVATAR_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** The `accept` attribute for the file input, built from the same list. */
export const AVATAR_ACCEPT_ATTRIBUTE = AVATAR_ACCEPTED_TYPES.join(",");

/** What a stored avatar is rendered at, and therefore what it is resized to. */
export const AVATAR_RENDER_SIZE = 512;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Just enough of a File to judge it, so this module stays testable in Node. */
export interface AvatarCandidate {
  type: string;
  size: number;
  name?: string;
}

/** A human-readable problem, or null. Never throws — a picker is not an error path. */
export function validateAvatar(file: AvatarCandidate): string | null {
  if (file.size <= 0) return "That file is empty.";
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type as (typeof AVATAR_ACCEPTED_TYPES)[number])) {
    return "Use a PNG, JPEG or WebP image.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(AVATAR_MAX_BYTES)}.`;
  }
  return null;
}

/**
 * The letters shown while there is no avatar.
 *
 * Grapheme-aware enough for names outside the Latin alphabet, which
 * `name[0]` is not: a first character taken by code unit splits an emoji or a
 * surrogate pair into half a character and renders as a replacement box.
 */
export function avatarInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return "?";
  return words.map((word) => [...word][0] ?? "").join("").toUpperCase();
}
