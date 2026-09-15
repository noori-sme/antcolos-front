import { ALL_NAV_SECTIONS } from "@/config/nav";
import type { PermissionKey } from "@/types";

/**
 * path -> required permissions. Derived from the nav config so a route and its
 * nav entry can never disagree, plus entries for routes that have no nav item.
 * The (app) guard reads this and redirects to a proper 403 screen.
 */
const EXTRA_ROUTES: Record<string, PermissionKey[]> = {
  // These sit under /dispatch but need LESS than the dispatch board does.
  // Working a truck's cycle and reading the opportunity inbox take seeing
  // loads and trucks; handing work to somebody else is what needs
  // `loads:assign`, and it is checked where that actually happens. Without
  // these two entries the longest-prefix rule would apply /dispatch's
  // requirements and lock out a dispatcher who may search but not assign.
  "/dispatch/trucks": ["loads:view", "trucks:view"],
  "/dispatch/rate-confirmations": ["loads:view"],
  "/dispatch/opportunities": ["loads:view", "trucks:view"],
  "/rate-cons/new": ["loads:create", "documents:upload"],
  // Confirming who a broker is is a stronger power than reading the directory,
  // so the review screen is gated above its parent rather than inheriting it.
  "/directory/review": ["customers:view", "customers:resolve"],
  "/customers": ["customers:view"],
  "/fleet/trucks/new": ["trucks:create"],
  "/fleet/equipment": ["fleet:view"],
  "/rate-cons": ["loads:view"],
  "/reports": ["reports:view"],
  "/settings": ["members:view"],
  "/account": [],
};

export const ROUTE_MANIFEST: Record<string, PermissionKey[]> = {
  ...Object.fromEntries(
    ALL_NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.href, i.requires])),
  ),
  ...EXTRA_ROUTES,
};

/** Longest matching prefix wins, so /loads/[id] inherits /loads. */
export function requiredPermissionsForPath(pathname: string): PermissionKey[] {
  let best: string | null = null;
  for (const route of Object.keys(ROUTE_MANIFEST)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      if (!best || route.length > best.length) best = route;
    }
  }
  return best ? ROUTE_MANIFEST[best] : [];
}
