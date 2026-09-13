/**
 * Account rules — pure, synchronous, and the single source of truth for what a
 * valid email, username and password look like.
 *
 * These are FRONTEND rules only. They shape the UI and give instant feedback
 * while typing. The backend must enforce the same rules again when it lands:
 * anything here can be bypassed by a client that does not run this code.
 */

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately permissive. Real addresses are stranger than most regexes allow,
 * so this only rejects shapes that cannot be an address at all. Whether the
 * mailbox exists is a backend question, answered by the verification code.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const EMAIL_MAX_LENGTH = 254;

export function validateEmail(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter your email address.";
  if (value.length > EMAIL_MAX_LENGTH) return "That email address is too long.";
  if (!EMAIL_SHAPE.test(value)) return "Enter a valid email address, like name@company.com.";
  return null;
}

/** Normalized form the rest of the flow carries around. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Verification code                                                           */
/* -------------------------------------------------------------------------- */

export const CODE_LENGTH = 6;
/** How long a code stays valid, in seconds. */
export const CODE_TTL_SECONDS = 120;
/** How long before "Resend code" becomes available again, in seconds. */
export const RESEND_COOLDOWN_SECONDS = 30;

export function isCodeComplete(digits: string[]): boolean {
  return digits.length === CODE_LENGTH && digits.every((d) => /^[0-9]$/.test(d));
}

/* -------------------------------------------------------------------------- */
/* Username                                                                    */
/* -------------------------------------------------------------------------- */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/** Shown under the field so the rules are never a guessing game. */
export const USERNAME_RULES_TEXT =
  `${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters. Lowercase letters, numbers and underscores only. ` +
  "Must start with a letter. Cannot end with an underscore. Chosen once — it cannot be changed later.";

const USERNAME_SHAPE = /^[a-z][a-z0-9_]*$/;

/** Returns a human-readable problem, or null when the shape is acceptable. */
export function validateUsername(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Choose a username.";
  if (value.length < USERNAME_MIN_LENGTH) {
    return `Usernames are at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return `Usernames are at most ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (/[A-Z]/.test(value)) return "Use lowercase letters only.";
  if (!/^[a-z]/.test(value)) return "Start with a letter.";
  if (value.endsWith("_")) return "Cannot end with an underscore.";
  if (!USERNAME_SHAPE.test(value)) {
    return "Use lowercase letters, numbers and underscores only.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRequirement {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

/** Rendered as a live checklist under the password field, in this order. */
export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "At least one uppercase letter",
    test: (v) => /[A-Z]/.test(v),
  },
  {
    id: "number",
    label: "At least one number",
    test: (v) => /[0-9]/.test(v),
  },
  {
    id: "special",
    label: "At least one special character",
    // Anything that is not a letter, a digit or whitespace.
    test: (v) => /[^A-Za-z0-9\s]/.test(v),
  },
] as const;

export function unmetPasswordRequirements(value: string): PasswordRequirement[] {
  return PASSWORD_REQUIREMENTS.filter((r) => !r.test(value));
}

export function isPasswordStrongEnough(value: string): boolean {
  return unmetPasswordRequirements(value).length === 0;
}

/* -------------------------------------------------------------------------- */
/* Organization name (dispatch onboarding)                                     */
/* -------------------------------------------------------------------------- */

export const ORG_NAME_MIN_LENGTH = 2;
export const ORG_NAME_MAX_LENGTH = 60;

export function validateOrgName(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter your organization's name.";
  if (value.length < ORG_NAME_MIN_LENGTH) {
    return `Use at least ${ORG_NAME_MIN_LENGTH} characters.`;
  }
  if (value.length > ORG_NAME_MAX_LENGTH) {
    return `Use at most ${ORG_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}
