import type {
  CandidateClaimVisibility, CandidateReferralState, Referral, ReferrerVisibleStatus,
} from "@/types";

/**
 * The state rules, on their own, as pure functions over one `Referral`.
 *
 * ★ THERE IS NO SINGLE STATUS, AND THERE IS NOT GOING TO BE ONE ★
 * Three axes — the referrer's `lifecycle`, the candidate's answer, the
 * company's answer — and every presentation in the product is DERIVED from
 * them. A stored roll-up would have to be recomputed on every transition, and
 * the first time somebody forgot, "Northline passed" and "Alex declined" would
 * become the same word on a screen.
 *
 * ── THE ORDERING CASES, ANSWERED ───────────────────────────────────────────
 *
 * COMPANY ACCEPTS BEFORE THE CANDIDATE CLAIMS
 *   Allowed, and it changes nothing for the candidate. The claim link keeps
 *   working on its own expiry; their email is not re-sent; the company may
 *   start the invitation, and the invitation's own flow is what waits for an
 *   account. The referrer sees "Company interested".
 *
 * CANDIDATE CLAIMS BEFORE THE COMPANY ACCEPTS
 *   Allowed. `candidateUserId` is written, the account is theirs permanently,
 *   and the company-side row moves from "Has not responded yet" to "Has an
 *   Antcolos account" — which is the ONLY thing the company learns from it.
 *   The company's review is untouched and still pending.
 *
 * COMPANY REJECTS AFTER THE CANDIDATE HAS JOINED ANTCOLOS
 *   The referral closes. The `User`, and anything else the person built on
 *   Antcolos, is untouched — there is no code path in this module that deletes,
 *   disables or downgrades an account, and `rejectReferral` writes only to the
 *   referral's own `company` block.
 *
 * REFERRER WITHDRAWS BEFORE COMPANY REVIEW
 *   `lifecycle` becomes `withdrawn`, the claim token is closed, and the
 *   referral leaves the company's pending queue. A withdrawal never deletes the
 *   record and never removes an account the candidate already claimed: if they
 *   claimed first, they keep everything they have.
 *
 * THE EMAIL BOUNCES
 *   The email record moves to `bounced` on provider evidence. The candidate
 *   state stays "not responded" rather than becoming a decision — a bounce is
 *   not a "no". The referrer is told delivery failed so they can check the
 *   address; the company is told nothing, because whether a stranger's mailbox
 *   exists is not the company's business.
 *
 * THE TOKEN EXPIRES
 *   Derived, never swept: `candidateStateOf` reads `expired` once `expiresAt`
 *   has passed with no decision. The link fails closed. The company's review
 *   is unaffected — a company may still be interested in somebody who never
 *   opened their email, and its next step is the invitation flow, which sends
 *   its own link.
 *
 * THE TARGET COMPANY BECOMES INACTIVE
 *   New referrals to it are refused at submission (`organization_inactive`).
 *   Existing ones are NOT retroactively closed or hidden: the introduction
 *   genuinely happened, and rewriting history because a workspace went quiet
 *   would lose the referrer's and the candidate's own record of it.
 *
 * THE COMPANY LATER SENDS AN INVITATION
 *   `resultingInvitationId` is written by the handoff, after the EXISTING
 *   access service issued it. The referral is then `closed`: its job — getting
 *   these two to a canonical flow — is done, and everything after belongs to
 *   the invitation and its acceptance run.
 *
 * THE CANDIDATE DECLINES THE COMPANY INVITATION AFTER ACCEPTANCE
 *   That is the INVITATION's `declined` status, recorded by the access module
 *   on the invitation. The referral stays closed and is not reopened, not
 *   marked rejected, and not re-derived from the invitation — two records, two
 *   decisions, and the referral has no business restating the second one.
 */

/**
 * The candidate's state right now.
 *
 * A decision they made beats everything. Otherwise it is the delivery evidence,
 * then the clock. Nothing about the company appears here at all, which is the
 * property that keeps a rejection from reading as the candidate's answer.
 */
export function candidateStateOf(
  referral: Referral,
  now: Date = new Date(),
): CandidateReferralState {
  if (referral.candidateDecision) return referral.candidateDecision.state;

  const expired = new Date(referral.claim.expiresAt).getTime() <= now.getTime();
  if (expired) return "expired";

  // `delivered` is only ever written from provider evidence, so reading it back
  // here cannot inflate into "we think it arrived".
  const delivered = referral.emails.some((e) => e.state === "delivered");
  return delivered ? "email_delivered" : "email_pending";
}

/** True when a delivery attempt is known to have failed. Never a "no". */
export function deliveryFailed(referral: Referral): boolean {
  return referral.emails.length > 0
    && referral.emails.every((e) => e.state === "bounced" || e.state === "failed");
}

/**
 * What the COMPANY may know about the candidate's side — three values, no more.
 *
 * `expired`, `email_pending` and `email_delivered` all collapse to `not_yet` on
 * purpose. Whether a stranger opened their email, and whether their address
 * bounced, are facts about that person; the company's legitimate interest is
 * only "is there an account to invite yet".
 *
 * `reported_unwanted` also reads `declined`. Telling the company that somebody
 * reported the introduction as abuse would hand a report back to the side best
 * placed to retaliate for it.
 */
export function candidateVisibilityFor(
  referral: Referral,
  now: Date = new Date(),
): CandidateClaimVisibility {
  const state = candidateStateOf(referral, now);
  if (state === "claimed") return "joined";
  if (state === "declined" || state === "reported_unwanted") return "declined";
  return "not_yet";
}

/**
 * What the REFERRER is shown.
 *
 * Ordered so the most decisive fact wins, and pruned so nothing internal leaks:
 * the referrer never learns that the company is still arguing about it, who
 * looked at it, or that the candidate reported the introduction as unwanted —
 * that last one is the whole point of an abuse report being confidential from
 * the person who triggered it.
 */
export function referrerStatusOf(
  referral: Referral,
  now: Date = new Date(),
): ReferrerVisibleStatus {
  if (referral.lifecycle === "withdrawn") return "withdrawn";

  const candidate = candidateStateOf(referral, now);
  // A plain decline is the candidate's own answer and the referrer, who knows
  // them, should hear it. A REPORT is not surfaced as a report: it reads as a
  // decline, because telling somebody "they reported you" is how a report
  // becomes a conversation the reporter did not ask for.
  if (candidate === "declined" || candidate === "reported_unwanted") {
    return "candidate_declined";
  }

  if (referral.company.state === "rejected") return "company_passed";
  if (referral.company.state === "accepted") return "company_interested";
  if (referral.lifecycle === "closed") return "closed";
  // Pending review, and somebody at the company could open it at any time.
  return candidate === "email_pending" ? "sent" : "company_reviewing";
}

/** Still open on both axes: the only state a company decision is taken in. */
export function isDecidable(referral: Referral): boolean {
  return referral.lifecycle === "submitted"
    && referral.company.state === "pending_review";
}

/**
 * Whether the claim link should still work.
 *
 * Withdrawal and an explicit candidate decision close it; a company decision
 * NEVER does. The candidate's account is independent of the company's answer,
 * and a link that stopped working because a company said no would make it
 * conditional on exactly the thing it is supposed to be independent of.
 */
export function claimLinkLive(referral: Referral, now: Date = new Date()): boolean {
  if (referral.claim.consumedAt || referral.claim.closedAt) return false;
  if (referral.lifecycle === "withdrawn") return false;
  if (referral.candidateDecision) return false;
  return new Date(referral.claim.expiresAt).getTime() > now.getTime();
}
