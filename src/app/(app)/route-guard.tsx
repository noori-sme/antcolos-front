"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DemoBanner } from "@/components/data/demo-banner";
import { SIGNED_IN_AS_DEMO } from "@/lib/api/mode";
import { canAll } from "@/lib/permissions/can";
import {
  isDemoRoute, isRouteAvailable, requiredPermissionsForPath,
} from "@/lib/permissions/route-manifest";
import { demoPermissions } from "@/lib/session/demo-session";
import { DemoSessionProvider } from "@/lib/session/demo-session-provider";
import { useCanAll } from "@/lib/session/hooks";
import { Forbidden } from "./forbidden";
import { NotAvailable } from "./not-available";

/**
 * Route-level gate. The route manifest is derived from the nav config, so a
 * route and its nav entry can never disagree. This is UX, not security — the
 * service layer enforces the same keys independently.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const required = requiredPermissionsForPath(pathname);
  const demo = isDemoRoute(pathname);
  const realAllowed = useCanAll(required);
  // A demo page (plan 10) is gated on what the demo company's owner may do.
  const allowed = demo ? canAll(demoPermissions(), required) : realAllowed;

  // Check if token exists in cookies
  const hasToken = typeof document !== 'undefined' && document.cookie.includes('antcolos_token=');
  const isBrowser = typeof window !== 'undefined';

  // Explicit mock mode is signed in as the fixtures' demo user, with no token
  // (src/lib/api/mode.ts), as middleware.ts already allows.
  if (isBrowser && !hasToken && !SIGNED_IN_AS_DEMO) {
    // If no token is found, redirect to sign-in instantly
    window.location.href = '/sign-in';
    return null;
  }

  if (!isRouteAvailable(pathname)) return <NotAvailable />;
  if (!allowed) return <Forbidden required={required} />;
  if (demo) {
    return (
      <DemoSessionProvider>
        <DemoBanner />
        {children}
      </DemoSessionProvider>
    );
  }
  return <>{children}</>;
}
