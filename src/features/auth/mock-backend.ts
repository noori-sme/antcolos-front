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

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export interface SendCodeResult {
  /** Always true in the mock. A real backend may rate-limit or reject. */
  sent: true;
}

/** Pretends to sign up and email a verification code. Sends nothing. */
export async function mockSignup(input: SignupInput): Promise<SendCodeResult> {
  void input; // the real adapter sends the code to this address
  await sleep(LATENCY_MS);
  return { sent: true };
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
/* -------------------------------------------------------------------------- */
/* Onboarding — FMCSA carrier lookup                                           */
/* -------------------------------------------------------------------------- */

/**
 * ███ NOT FMCSA ███
 *
 * Nothing below talks to FMCSA, SAFER, the QCMobile API or any other register.
 * These are three invented carriers, chosen so every outcome the carrier
 * verification screen has to handle can actually be reached in review.
 */
export interface FmcsaCarrier {
  legalName: string;
  dbaName?: string;
  mc: string;
  dot: string;
  location: string;
  entityType: string;
  operatingStatus: string;
  /** null models a register entry with no usable address on file. */
  email: string | null;
}

const FMCSA_RECORDS: FmcsaCarrier[] = [
  {
    legalName: "Northline Freight LLC",
    dbaName: "Northline",
    mc: "123456",
    dot: "1234567",
    location: "Boise, ID",
    entityType: "Carrier",
    operatingStatus: "Authorized for property",
    email: "sam_salem@gmail.com",
  },
  {
    legalName: "Cascade Haul Inc",
    mc: "654321",
    dot: "7654321",
    location: "Portland, OR",
    entityType: "Carrier",
    operatingStatus: "Authorized for property",
    email: "ops_team@cascadehaul.com",
  },
  {
    legalName: "Sierra Transport Co",
    mc: "111111",
    dot: "2222222",
    location: "Reno, NV",
    entityType: "Carrier",
    operatingStatus: "Authorized for property",
    email: null,
  },
];

/** DOT numbers already claimed by an Antcolos account. */
const CLAIMED_DOT_NUMBERS = new Set(["7654321"]);

export type CarrierLookupResult =
  | { status: "found"; carrier: FmcsaCarrier & { email: string } }
  | { status: "not-found" }
  | { status: "mismatch"; mcCarrier: string; dotCarrier: string }
  | { status: "already-claimed"; carrier: FmcsaCarrier }
  | { status: "no-email"; carrier: FmcsaCarrier };

/**
 * Pretends to search the federal register. Searches nothing.
 *
 * Either identifier on its own is enough. When both are given they must point
 * at the same carrier — two valid numbers belonging to different companies is a
 * distinct answer from "no such carrier", because it usually means a typo in
 * one of them rather than a carrier that does not exist.
 */
export async function mockLookUpCarrier(
  mcDigits: string,
  dotDigits: string,
): Promise<CarrierLookupResult> {
  await sleep(1100); // a register lookup is the slowest thing in the flow

  const byMc = mcDigits ? FMCSA_RECORDS.find((c) => c.mc === mcDigits) : undefined;
  const byDot = dotDigits ? FMCSA_RECORDS.find((c) => c.dot === dotDigits) : undefined;

  if (mcDigits && dotDigits) {
    if (!byMc || !byDot) return { status: "not-found" };
    if (byMc.dot !== byDot.dot) {
      return { status: "mismatch", mcCarrier: byMc.legalName, dotCarrier: byDot.legalName };
    }
  }

  const carrier = byMc ?? byDot;
  if (!carrier) return { status: "not-found" };
  if (CLAIMED_DOT_NUMBERS.has(carrier.dot)) return { status: "already-claimed", carrier };
  if (!carrier.email) return { status: "no-email", carrier };
  return { status: "found", carrier: { ...carrier, email: carrier.email } };
}

/* -------------------------------------------------------------------------- */
/* Onboarding — codes sent to an organization's own address                    */
/* -------------------------------------------------------------------------- */

/**
 * Pretends to email a code to an address the user did not type — a carrier's
 * FMCSA address, or a dispatch organization's official address. Sends nothing.
 */
export async function mockSendOrgCode(address: string): Promise<SendCodeResult> {
  void address; // the real adapter sends the code here, and only here
  await sleep(LATENCY_MS);
  return { sent: true };
}

/** Same rules as the signup code. Verifies nothing. */
export async function mockVerifyOrgCode(
  code: string,
  codeIsStale: boolean,
): Promise<VerifyCodeResult> {
  await sleep(LATENCY_MS);
  if (code === ALWAYS_EXPIRED_CODE || codeIsStale) return { status: "expired" };
  if (code === VALID_CODE) return { status: "verified" };
  return { status: "invalid" };
}

/* -------------------------------------------------------------------------- */
/* Onboarding — organization creation                                          */
/* -------------------------------------------------------------------------- */

export interface CarrierOrganizationInput {
  ownerLegalName: string;
  mc: string;
  dot: string;
  legalName: string;
}

/**
 * Pretends to create the carrier organization and record this user as its
 * verified owner. Creates nothing.
 */
export async function mockCreateCarrierOrganization(
  input: CarrierOrganizationInput,
): Promise<{ created: true }> {
  void input;
  await sleep(LATENCY_MS);
  return { created: true };
}

export interface DispatchOrganizationInput {
  ownerLegalName: string;
  organizationName: string;
  /** The organization's official address. May equal the owner's personal one. */
  organizationEmail: string;
}

/**
 * Pretends to create the dispatch organization. Creates nothing.
 *
 * There is no password here on purpose: the person already set one for their
 * personal Antcolos account during signup, and an organization is not an
 * account you log into.
 */
export async function mockCreateDispatchOrganization(
  input: DispatchOrganizationInput,
): Promise<{ created: true }> {
  void input;
  await sleep(LATENCY_MS);
  return { created: true };
}

/* -------------------------------------------------------------------------- */
/* Onboarding — the individual dispatcher                                      */
/* -------------------------------------------------------------------------- */

export interface IndividualDispatcherInput {
  /** The address dispatchers will be reached on for work. Verified first. */
  workEmail: string;
}

/**
 * Pretends to set up a one-person dispatch workspace. Creates nothing.
 *
 * An individual dispatcher is not a different kind of account — everything in
 * Antcolos hangs off a membership in an organization, so somebody working alone
 * gets a dispatch workspace of their own with exactly one member in it. What
 * makes it "individual" is that nobody is asked for a company name and nobody
 * else is invited; it can grow into a team later without the person having to
 * start again.
 *
 * No password is set here. The person already has one from signup, and a
 * workspace is not an account you log into.
 */
export async function mockCreateIndividualDispatcher(
  input: IndividualDispatcherInput,
): Promise<{ created: true }> {
  void input;
  await sleep(LATENCY_MS);
  return { created: true };
}

/**
 * Pretends to email a code to a work address the dispatcher typed in.
 *
 * Kept separate from `mockSendOrgCode` even though both do nothing, because the
 * two are different in the real world: that one goes to an address Antcolos
 * already held on file, and this one goes to an address somebody just typed and
 * may well have got wrong.
 */
export async function mockSendWorkEmailCode(address: string): Promise<SendCodeResult> {
  void address; // the real adapter sends the code here, and only here
  await sleep(LATENCY_MS);
  return { sent: true };
}

/** Same rules as every other code in this file. Verifies nothing. */
export async function mockVerifyWorkEmailCode(
  code: string,
  codeIsStale: boolean,
): Promise<VerifyCodeResult> {
  await sleep(LATENCY_MS);
  if (code === ALWAYS_EXPIRED_CODE || codeIsStale) return { status: "expired" };
  if (code === VALID_CODE) return { status: "verified" };
  return { status: "invalid" };
}
