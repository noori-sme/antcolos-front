/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Every function here is a fake. Nothing is sent, stored, verified or looked up.
 * There is no account, no email, no database and no session. This file exists so
 * the Sign In / Sign Up screens can be designed and reviewed with realistic
 * timing and realistic failure states before any backend exists.
 *
 * It is deliberately the ONLY file in the auth feature that fakes anything, so
 * replacing it is the whole integration job:
 *
 *   - keep the exported function signatures and result types,
 *   - delete the bodies,
 *   - call the real service through `src/lib/api/contracts/` instead.
 *
 * No screen imports the demo constants below for display purposes; they only
 * drive the fake outcomes.
 */

/** Fake network latency, so loading states are actually visible in review. */
const LATENCY_MS = 800;
const FAST_LATENCY_MS = 450;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Demo fixtures — the values that decide which outcome you get                */
/* -------------------------------------------------------------------------- */

/** The only verification code the mock accepts. */
const VALID_CODE = "123456";
/** Typing this code always produces the "expired" outcome, on demand. */
const ALWAYS_EXPIRED_CODE = "000000";

/** Usernames the mock reports as already taken. */
const TAKEN_USERNAMES = new Set([
  "admin", "antcolos", "dispatch", "driver", "sam", "support", "root", "test",
]);

/** The only password the mock accepts on Sign In. */
const VALID_SIGN_IN_PASSWORD = "Antcolos1!";

/** Invitation codes the mock recognizes. Everything else is invalid. */
const INVITATIONS: Record<string, { organization: string; role: string; expired: boolean }> = {
  "DISPATCH-2026": { organization: "Meridian Dispatch", role: "Senior dispatcher", expired: false },
  "EXPIRED-2025": { organization: "Meridian Dispatch", role: "Dispatcher", expired: true },
};

/* -------------------------------------------------------------------------- */
/* Sign up — request a verification code                                       */
/* -------------------------------------------------------------------------- */

export interface SendCodeResult {
  /** Always true in the mock. A real backend may rate-limit or reject. */
  sent: true;
}

/** Pretends to email a verification code. Sends nothing. */
export async function mockSendVerificationCode(email: string): Promise<SendCodeResult> {
  void email; // the real adapter sends the code to this address
  await sleep(LATENCY_MS);
  return { sent: true };
}

/* -------------------------------------------------------------------------- */
/* Sign up — check the verification code                                       */
/* -------------------------------------------------------------------------- */

export type VerifyCodeResult =
  | { status: "verified" }
  | { status: "invalid" }
  | { status: "expired" };

/**
 * `codeIsStale` is passed in by the screen, which owns the countdown. A real
 * backend decides expiry itself and this argument goes away.
 */
export async function mockVerifyCode(
  code: string,
  codeIsStale: boolean,
): Promise<VerifyCodeResult> {
  await sleep(LATENCY_MS);
  if (code === ALWAYS_EXPIRED_CODE || codeIsStale) return { status: "expired" };
  if (code === VALID_CODE) return { status: "verified" };
  return { status: "invalid" };
}

/* -------------------------------------------------------------------------- */
/* Sign up — username availability                                             */
/* -------------------------------------------------------------------------- */

export type UsernameCheckResult =
  | { status: "available" }
  | { status: "taken"; suggestions: string[] };

/** Pretends to look up a username. Queries nothing. */
export async function mockCheckUsername(username: string): Promise<UsernameCheckResult> {
  await sleep(FAST_LATENCY_MS);
  if (!TAKEN_USERNAMES.has(username)) return { status: "available" };
  return {
    status: "taken",
    suggestions: [`${username}_co`, `${username}01`, `real_${username}`]
      .filter((s) => s.length <= 20)
      .slice(0, 3),
  };
}

/* -------------------------------------------------------------------------- */
/* Sign up — create the account                                                */
/* -------------------------------------------------------------------------- */

export interface CreateAccountInput {
  email: string;
  username: string;
  password: string;
}

/** Pretends to create an account. Creates nothing and stores nothing. */
export async function mockCreateAccount(input: CreateAccountInput): Promise<{ created: true }> {
  void input; // the real adapter persists this
  await sleep(LATENCY_MS);
  return { created: true };
}

/* -------------------------------------------------------------------------- */
/* Sign in                                                                     */
/* -------------------------------------------------------------------------- */

export type SignInResult =
  | { status: "ok" }
  | { status: "invalid-credentials" };

/**
 * Pretends to sign in. Authenticates nothing and issues no session — the app
 * already runs on the mocked session fixtures either way.
 */
export async function mockSignIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  void email; // the real adapter authenticates this address
  await sleep(LATENCY_MS);
  return password === VALID_SIGN_IN_PASSWORD
    ? { status: "ok" }
    : { status: "invalid-credentials" };
}

/* -------------------------------------------------------------------------- */
/* Forgot password                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Pretends to send a reset link. Sends nothing. Always reports success so the
 * screen cannot be used to discover which addresses have accounts — the real
 * backend must behave the same way.
 */
export async function mockSendResetLink(email: string): Promise<{ sent: true }> {
  void email; // the real adapter sends the reset link here
  await sleep(LATENCY_MS);
  return { sent: true };
}

/* -------------------------------------------------------------------------- */
/* Onboarding — create a dispatch organization                                 */
/* -------------------------------------------------------------------------- */

/** Pretends to create an organization. Creates nothing. */
export async function mockCreateOrganization(name: string): Promise<{ created: true }> {
  void name; // the real adapter creates the organization under this name
  await sleep(LATENCY_MS);
  return { created: true };
}

/* -------------------------------------------------------------------------- */
/* Onboarding — invitations                                                    */
/* -------------------------------------------------------------------------- */

export type InvitationResult =
  | { status: "valid"; code: string; organization: string; role: string }
  | { status: "expired"; organization: string }
  | { status: "invalid" };

/**
 * Accepts either a bare code or a full invitation URL and pulls the code out of
 * it. Joining a dispatch organization is possible ONLY through an invitation —
 * there is intentionally no directory to browse and no join-by-name.
 */
export function extractInvitationCode(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  // Tolerate a pasted link: take the last non-empty path segment, minus query.
  const withoutQuery = value.split(/[?#]/)[0];
  const segments = withoutQuery.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last.toUpperCase();
}

/** Pretends to look up an invitation. Looks nothing up. */
export async function mockLookUpInvitation(rawCodeOrLink: string): Promise<InvitationResult> {
  await sleep(LATENCY_MS);
  const code = extractInvitationCode(rawCodeOrLink);
  const found = INVITATIONS[code];
  if (!found) return { status: "invalid" };
  if (found.expired) return { status: "expired", organization: found.organization };
  return { status: "valid", code, organization: found.organization, role: found.role };
}

/** Pretends to accept an invitation. Joins nothing. */
export async function mockAcceptInvitation(code: string): Promise<{ joined: true }> {
  void code; // the real adapter redeems this invitation
  await sleep(LATENCY_MS);
  return { joined: true };
}
