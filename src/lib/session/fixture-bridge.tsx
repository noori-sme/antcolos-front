"use client";

import { useEffect } from "react";
import {
  grantMembership, setMembershipStatus, type GrantMembershipInput,
} from "./membership-store";
import type { Membership } from "@/types";
import type { SessionScenario } from "./scenarios";

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
 *   • TWO independent gates, both of which must hold. `NODE_ENV` must be
 *     `development`, which Next inlines, so a production build removes the
 *     component outright — verified against the built output and against a
 *     running production server, not assumed. AND `NEXT_PUBLIC_ANTCOLOS_E2E`
 *     must be `"1"`, which only the browser suite's own server sets. The second
 *     gate exists because the first one is a statement about how a build was
 *     made: somebody who ran `next dev` on a reachable host would satisfy it by
 *     accident, and nothing should hinge on nobody ever doing that. An ordinary
 *     `npm run dev` does not attach this either.
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
      setMembershipStatus: (
        scenario: SessionScenario, membershipId: string, status: Membership["status"],
      ) => void;
    };
  }
}

function FixtureBridgeImpl() {
  useEffect(() => {
    window.__antcolosFixtures = {
      grantMembership: (input) => { grantMembership(input); },
      setMembershipStatus,
    };
    return () => { delete window.__antcolosFixtures; };
  }, []);
  return null;
}

/** Both gates. Neither alone is enough, and neither is a security boundary on
 *  its own — see the note above on what actually makes this safe. */
function enabled(): boolean {
  return process.env.NODE_ENV === "development"
    && process.env.NEXT_PUBLIC_ANTCOLOS_E2E === "1";
}

export function SessionFixtureBridge() {
  if (!enabled()) return null;
  return <FixtureBridgeImpl />;
}

/** Exported for the test that pins the gate. Never called by the app. */
export const fixtureBridgeEnabled = enabled;
