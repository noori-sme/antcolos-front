"use client";

import { useMemo } from "react";
import { useSession } from "@/lib/session/hooks";
import type { ReferringIdentity } from "@/lib/api/contracts/referrals";

/**
 * Who is referring — the permanent account, with no organization attached.
 *
 * ★ THIS IS THE WHOLE POINT OF THE SURFACE ★
 * Every other write in this app goes through `useServiceContext()`, which is a
 * membership inside a workspace. A referral cannot: the referrer usually does
 * not belong to the company they are introducing somebody to, and quite often
 * belongs to no company at all. So this hook reads the SESSION and deliberately
 * carries no `membershipId`, no `organizationId`, no permissions and no scope —
 * there is nothing here that a service could mistake for authority.
 *
 * ███ AND IT IS NOT PROOF OF ANYTHING ███
 * `useSession()` resolves to a fixture chosen by `?fixture=` on the address
 * bar. On a server the identity is derived from the session it issued; see the
 * note on `ReferringIdentity` in the contract.
 */
export function useReferringIdentity(): ReferringIdentity {
  const { user } = useSession();
  return useMemo(
    () => ({ userId: user.id, email: user.email, displayName: user.displayName }),
    [user],
  );
}
