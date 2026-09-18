"use client";

import { useSearchParams } from "next/navigation";

/**
 * Carries an invitation through Sign Up and Sign In.
 *
 * Somebody who follows an invitation link without an account has to go and make
 * one, and the invitation must be waiting for them when they come back —
 * dropping them on a generic welcome screen and expecting them to dig the email
 * out again is how invitations go unaccepted.
 *
 * ★ THE TOKEN RIDES ALONG. NOTHING ELSE DOES ★
 * This used to append `signedin=1`, which the acceptance screen read as "they
 * have just proved who they are". It proved nothing: a query parameter is not
 * evidence of identity, and an invitation that attached itself to whoever held
 * the link made forwarding an email a way to give away a seat. Acceptance is
 * authorized on the signed-in ACCOUNT now, so the flag has nothing to say — and
 * it is removed rather than left lying about looking meaningful.
 *
 * The return path still works, and for the better reason: by the time somebody
 * comes back from Sign Up, the address they signed up with IS the address the
 * invitation names.
 */
export function useInvitationReturnPath(): string | null {
  const token = useSearchParams().get("invitation");
  if (!token) return null;
  return `/invitation/${encodeURIComponent(token)}`;
}
