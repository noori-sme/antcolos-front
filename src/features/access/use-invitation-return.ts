"use client";

import { useSearchParams } from "next/navigation";

/**
 * Carries an invitation through Sign Up and Sign In.
 *
 * Somebody who follows an invitation link without an account has to go and make
 * one, and the invitation must be waiting for them when they come back —
 * dropping them on a generic welcome screen and expecting them to dig the email
 * out again is how invitations go unaccepted. The token rides along in the URL
 * and `signedin=1` tells the invitation screen they have just proved who they
 * are.
 */
export function useInvitationReturnPath(): string | null {
  const token = useSearchParams().get("invitation");
  if (!token) return null;
  return `/invitation/${encodeURIComponent(token)}?signedin=1`;
}
