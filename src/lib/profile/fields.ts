/**
 * The four things a person writes about themselves, and the limits on them.
 *
 * ███ FRONTEND RULES ███
 * They shape the form and are applied again in the service, so a screen cannot
 * store something the seam refuses. The backend must apply them a third time;
 * anything here is bypassed by a client that does not run this code.
 *
 * Deliberately generous. A profile is somebody's own account of their career,
 * and a form that argues with a person about how they describe themselves is a
 * form they abandon. Only genuinely unusable input is refused.
 */

export const HEADLINE_MAX_LENGTH = 120;
export const BIO_MAX_LENGTH = 600;
export const LOCATION_MAX_LENGTH = 80;
export const LINK_LABEL_MAX_LENGTH = 40;

export function validateHeadline(raw: string): string | null {
  if (raw.trim().length > HEADLINE_MAX_LENGTH) {
    return `Keep the headline to ${HEADLINE_MAX_LENGTH} characters.`;
  }
  return null;
}

export function validateBio(raw: string): string | null {
  if (raw.trim().length > BIO_MAX_LENGTH) {
    return `Keep the bio to ${BIO_MAX_LENGTH} characters.`;
  }
  return null;
}

export function validateLocation(raw: string): string | null {
  if (raw.trim().length > LOCATION_MAX_LENGTH) {
    return `Keep the location to ${LOCATION_MAX_LENGTH} characters.`;
  }
  return null;
}

/**
 * A link somebody put on their profile.
 *
 * Only `http` and `https` are allowed, and the reason is narrow and specific:
 * a profile link is rendered as an anchor on a page anybody can open, and a
 * `javascript:` or `data:` URL in that position is a script running on
 * Antcolos's own origin under somebody else's name.
 */
export function validateLink(url: string): string | null {
  const value = url.trim();
  if (!value) return "Enter a link, or remove the row.";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Enter a full link, starting with https://";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Links have to start with https://";
  }
  return null;
}

/** Characters left, for the counter under a field. Never negative in display. */
export function remaining(value: string, max: number): number {
  return max - value.trim().length;
}
