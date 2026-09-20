import type { Referral, ReferralEvent } from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The referral store: introductions, the addresses that asked to stop
 * receiving them, and the abuse reports.
 *
 * A LEAF, like the access store and the workforce store. It imports no
 * registry, so any registry can read it without a cycle, and it enforces
 * nothing — permissions, organization scope and identity live one layer up
 * where the caller's context exists.
 *
 * ★ WHAT IS NOT IN HERE ★
 * No User, no Organization, no Membership, no Invitation, no engagement, no
 * document. Delete this store and Antcolos loses the introductions and the
 * opt-out list, and not one canonical fact — which is the property that keeps a
 * referral from growing into a second registry of people and companies.
 *
 * ★ THE OPT-OUT LIST IS THE ONE THING HERE THAT MUST OUTLIVE A REFERRAL ★
 * It is keyed by normalized email and holds nothing else: no name, no referral
 * id, no reason text and nothing about who referred them. It is a list of
 * addresses that have said stop, and the only correct use of it is to refuse to
 * send. It is deliberately not readable through any service method, because a
 * feature that could ask "has this address opted out?" is a feature that can
 * enumerate people by asking about them one at a time.
 */

interface StoreState {
  referrals: Referral[];
  seeded: boolean;
  /** Normalized email -> when it opted out. Never exposed through a service. */
  optOuts: Map<string, string>;
  /** Append-only. Kept apart from a referral so a withdrawal cannot erase one. */
  abuseReports: AbuseReport[];
}

export interface AbuseReport {
  id: string;
  referralId: string;
  /** The address that reported it. Nothing about their account, if they have one. */
  reportedEmail: string;
  reason?: string;
  at: string;
  /** Snapshotted so a withdrawn or closed referral still explains the report. */
  referrerUserId: string;
  targetOrganizationId: string;
}

function emptyState(): StoreState {
  return { referrals: [], seeded: false, optOuts: new Map(), abuseReports: [] };
}

/**
 * Seeded on first read rather than on import, so a reset genuinely resets.
 *
 * The same shape the access store uses, for the same reason: a module-level
 * seed runs once per process and makes `resetReferralStore()` a lie in the
 * second test that calls it.
 */
export function ensureSeeded(seed: () => Referral[]) {
  if (state.seeded) return;
  state.seeded = true;
  state.referrals = seed();
}

let state: StoreState = emptyState();
let seq = 0;

/** Test hook. Never called by the UI. */
export function resetReferralStore() {
  state = emptyState();
  seq = 0;
}

const bump = () => (seq += 1).toString(36) + Date.now().toString(36);

export const nextReferralId = () => `ref_${bump()}`;
export const nextEmailId = () => `rmail_${bump()}`;
export const nextEventId = () => `rev_${bump()}`;
export const nextReportId = () => `rrep_${bump()}`;

/**
 * The token, and the honest label on it.
 *
 * ███ THIS IS NOT A SECURE TOKEN ███
 * `Math.random` in a browser tab. It is unguessable enough that a demo does not
 * collide with itself and nothing more. A backend mints these from a CSPRNG,
 * stores only a hash, and compares in constant time.
 */
export function nextClaimToken(): string {
  const part = () => Math.random().toString(36).slice(2, 10).toUpperCase();
  return `REF-${part()}${part()}`;
}

/** Short, printable, and NOT the token. Safe on a page or in a subject line. */
export function nextReference(): string {
  return `R-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const copy = (r: Referral): Referral => ({
  ...r,
  candidate: { ...r.candidate },
  company: { ...r.company },
  claim: { ...r.claim },
  emails: r.emails.map((e) => ({ ...e })),
  events: r.events.map((e) => ({ ...e })),
});

export function referralById(id: string): Referral | undefined {
  const found = state.referrals.find((r) => r.id === id);
  return found ? copy(found) : undefined;
}

/**
 * Case-insensitive, because email clients mangle the case of a URL often
 * enough that a link which only worked in one case would be a support queue.
 * The comparison is still on the whole token, never a prefix.
 */
export function referralByToken(token: string): Referral | undefined {
  const wanted = token.trim().toUpperCase();
  if (!wanted) return undefined;
  const found = state.referrals.find((r) => r.claim.token.toUpperCase() === wanted);
  return found ? copy(found) : undefined;
}

export function referralsByReferrer(userId: string): Referral[] {
  return state.referrals
    .filter((r) => r.referrerUserId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(copy);
}

export function referralsForOrganization(organizationId: string): Referral[] {
  return state.referrals
    .filter((r) => r.targetOrganizationId === organizationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(copy);
}

export function allReferrals(): Referral[] {
  return state.referrals.map(copy);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export function putReferral(referral: Referral): Referral {
  const i = state.referrals.findIndex((r) => r.id === referral.id);
  if (i >= 0) state.referrals[i] = referral;
  else state.referrals.unshift(referral);
  return copy(referral);
}

/** Appends one history line. Nothing in this module removes or edits one. */
export function appendEvent(referral: Referral, event: Omit<ReferralEvent, "id">): Referral {
  return { ...referral, events: [...referral.events, { id: nextEventId(), ...event }] };
}

/* -------------------------------------------------------------------------- */
/* The duplicate guard                                                         */
/* -------------------------------------------------------------------------- */

/**
 * An open referral for this candidate at this company, from ANY referrer.
 *
 * The frontend stand-in for a unique partial index on
 * `(targetOrganizationId, candidateEmail) WHERE still open`. Two open referrals
 * for one person at one company is two claim links and two emails to somebody
 * who asked for neither, and the company reviewing the same introduction twice.
 *
 * "Open" means the referrer has not withdrawn it, the referral is not closed,
 * and the candidate has not answered. A company REJECTION does not reopen the
 * door: the introduction was made and refused, and letting a second one through
 * the moment the company says no turns the inbox into a retry loop.
 */
export function openReferralFor(
  targetOrganizationId: string, candidateEmail: string,
): Referral | undefined {
  const wanted = candidateEmail.trim().toLowerCase();
  if (!wanted) return undefined;
  const found = state.referrals.find((r) =>
    r.targetOrganizationId === targetOrganizationId
    && r.candidate.email === wanted
    && r.lifecycle === "submitted"
    && !r.candidateDecision);
  return found ? copy(found) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                               */
/* -------------------------------------------------------------------------- */

/**
 * ███ COUNTED IN THIS TAB. THAT IS ALL IT IS. ███
 *
 * Open a second browser and every counter below starts at zero, so this stops
 * nobody. It is here because the SHAPE has to exist somewhere a reviewer can
 * read it: these are the windows and caps a backend must enforce, on the
 * server, keyed the same way, before the email is queued.
 */
export const REFERRAL_LIMITS = {
  /** One person, one hour. Generous enough for a real day of introductions. */
  referrerPerHour: 10,
  referrerPerDay: 25,
  /** How often ONE address may be introduced to anybody, by anybody. */
  recipientPerDay: 3,
  recipientPerWeek: 5,
  /** How many introductions one company's inbox may take in a day. */
  organizationPerDay: 25,
  /** Resends of one referral, ever. */
  maxResends: 2,
  /** How long before a resend is allowed at all. */
  resendCooldownHours: 24,
} as const;

const HOUR = 3_600_000;
const since = (ms: number) => Date.now() - ms;

function countCreated(predicate: (r: Referral) => boolean, windowMs: number): number {
  const from = since(windowMs);
  return state.referrals.filter(
    (r) => predicate(r) && new Date(r.createdAt).getTime() >= from,
  ).length;
}

export function referrerCount(userId: string, windowMs: number): number {
  return countCreated((r) => r.referrerUserId === userId, windowMs);
}

export function recipientCount(email: string, windowMs: number): number {
  const wanted = email.trim().toLowerCase();
  return countCreated((r) => r.candidate.email === wanted, windowMs);
}

export function organizationCount(organizationId: string, windowMs: number): number {
  return countCreated((r) => r.targetOrganizationId === organizationId, windowMs);
}

export const WINDOW = { hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR } as const;

/* -------------------------------------------------------------------------- */
/* Opt-outs and abuse reports                                                  */
/* -------------------------------------------------------------------------- */

export function optOut(email: string, at: string) {
  const key = email.trim().toLowerCase();
  if (key) state.optOuts.set(key, at);
}

/**
 * Internal only, and it stays internal.
 *
 * Every caller of this is inside the submit path, where the answer turns into
 * the SAME refusal message as an ordinary rate limit. Nothing surfaces it, and
 * nothing should: a caller that could read this could test addresses one by one
 * and learn which of them have been referred before.
 */
export function hasOptedOut(email: string): boolean {
  return state.optOuts.has(email.trim().toLowerCase());
}

export function recordAbuseReport(report: Omit<AbuseReport, "id">): AbuseReport {
  const stored = { id: nextReportId(), ...report };
  state.abuseReports.push(stored);
  return { ...stored };
}

/** Test and audit hook. Never reachable from a screen. */
export function abuseReports(): AbuseReport[] {
  return state.abuseReports.map((r) => ({ ...r }));
}
