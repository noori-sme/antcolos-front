import type { Referral } from "@/types";

/**
 * The referral email, as CONTENT — the one part of the email contract a
 * frontend can honestly own.
 *
 * ███ WHAT A FRONTEND MUST NEVER OWN ███
 * The provider credentials. The signing key the token is derived from. The
 * send itself. The delivery webhook. The rate limiter. Every one of those is
 * named here so the seam is explicit rather than implied: this module returns
 * a subject and a body, and something on a server does the rest.
 *
 * The link below is a PATH, not an absolute URL, and it carries the token the
 * browser generated. On a backend the token is minted server-side, stored as a
 * hash, and the absolute URL is built from a configured origin — never from
 * `window.location`, which an attacker controls on a page they got somebody to
 * open.
 */

export interface ReferralEmailContent {
  subject: string;
  /** Plain text. An HTML part is the backend's, from the same values. */
  body: string;
  /** Relative. The backend prefixes its configured origin. */
  claimPath: string;
  /** Rendered into the body, and stated separately so a screen can show it. */
  expiresAt: string;
  /** Where "I never asked for this" goes. Must survive every redesign. */
  reportPath: string;
}

export function claimPathFor(token: string): string {
  return `/referral/${encodeURIComponent(token)}`;
}

/**
 * The six things this email has to say, and it says all of them.
 *
 * Who referred them, which company, what for, the link, when it dies, and —
 * the one people leave out — that the company has NOT necessarily accepted
 * them. An email that implied otherwise would be Antcolos telling somebody
 * they had a job offer on the strength of a stranger's form submission.
 */
export function referralEmailContent(referral: Referral): ReferralEmailContent {
  const claimPath = claimPathFor(referral.claim.token);
  const reportPath = `${claimPath}?report=1`;
  const expires = new Date(referral.claim.expiresAt).toUTCString();

  const body = [
    `${referral.candidate.fullName},`,
    "",
    `${referral.referrerNameSnapshot} referred you to `
    + `${referral.targetOrganizationNameSnapshot} on Antcolos, for `
    + `${referral.proposedTitle}.`,
    referral.note ? `\nThey added: "${referral.note}"` : "",
    "",
    "You can create your Antcolos account, or sign in to the one you already "
    + "have, here:",
    claimPath,
    "",
    `This link works until ${expires} and can only be used once.`,
    "",
    `${referral.targetOrganizationNameSnapshot} has not necessarily accepted `
    + "you. They decide separately, and your Antcolos account is yours either "
    + "way — it stays yours whatever they decide.",
    "",
    "If you did not expect this, you can decline it or report it as unwanted, "
    + "and we will stop sending you referral email:",
    reportPath,
  ].filter(Boolean).join("\n");

  return {
    subject: `${referral.referrerNameSnapshot} referred you to `
      + `${referral.targetOrganizationNameSnapshot}`,
    body,
    claimPath,
    expiresAt: referral.claim.expiresAt,
    reportPath,
  };
}

/**
 * The company-side notification.
 *
 * One sentence, and deliberately no contact details: the company reads those in
 * its own referral inbox, behind its own permission check, rather than in a
 * mailbox that forwards.
 */
export function companyNotificationLine(referral: Referral): string {
  return `${referral.referrerNameSnapshot} referred `
    + `${referral.candidate.fullName} to your company.`;
}
