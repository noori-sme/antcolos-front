"use client";

import { useEffect } from "react";
import { grantMembership, type GrantMembershipInput } from "./membership-store";

/**
 * A development-only handle on the membership store, for the browser suite.
 *
 * ███ WHY THIS EXISTS, AND WHY IT IS NOT A BACKDOOR ███
 *
 * PR-1 makes a granted seat OBSERVABLE. It deliberately does not add the thing
 * that grants one — deciding who may have a seat, on what basis, is the Access
 * service's, and the Access service does not exist yet. That leaves a claim
 * that can only honestly be checked by rendering a page ("a seat granted while
 * the tab is open reaches Home, the nav and the portal without a reload") and
 * no product action that would grant one.
 *
 * So the browser suite drives the store directly, through this. It is the same
 * kind of affordance as `?fixture=newcomer` in ./scenarios.ts, and it is
 * hedged the same way:
 *
 *   • It mounts ONLY when `process.env.NODE_ENV === "development"`. Next
 *     inlines that constant, so the whole component and its import are removed
 *     from a production build — there is nothing to reach at runtime, rather
 *     than something guarded by a check.
 *   • It grants no permission of its own. It hands the store a `Membership`
 *     exactly as a caller would, and `effectivePermissions` decides what that
 *     seat can do — the same function, with the same rules, as for a seeded one.
 *   • It writes to an in-memory store that a reload clears. Nothing persists,
 *     nothing is authorized, and nothing crosses a network.
 *
 * It goes away when the Access service arrives and the browser suite can press
 * a real button instead.
 */

declare global {
  interface Window {
    /** Present in development only. See the note above. */
    __antcolosFixtures?: {
      grantMembership: (input: GrantMembershipInput) => void;
    };
  }
}

function FixtureBridgeImpl() {
  useEffect(() => {
    window.__antcolosFixtures = {
      grantMembership: (input) => { grantMembership(input); },
    };
    return () => { delete window.__antcolosFixtures; };
  }, []);
  return null;
}

export function SessionFixtureBridge() {
  if (process.env.NODE_ENV !== "development") return null;
  return <FixtureBridgeImpl />;
}
