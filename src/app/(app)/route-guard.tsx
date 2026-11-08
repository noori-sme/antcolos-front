"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isRouteAvailable, requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
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
  const allowed = useCanAll(required);

  // Check if token exists in cookies
  const hasToken = typeof document !== 'undefined' && document.cookie.includes('antcolos_token=');
  const isBrowser = typeof window !== 'undefined';

  if (isBrowser && !hasToken) {
    // If no token is found, redirect to sign-in instantly
    window.location.href = '/sign-in';
    return null;
  }

  if (!isRouteAvailable(pathname)) return <NotAvailable />;
  if (!allowed) return <Forbidden required={required} />;
  return <>{children}</>;
}
