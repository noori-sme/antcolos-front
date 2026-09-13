import { ALL_NAV_SECTIONS } from "@/config/nav";
import type { PermissionKey } from "@/types";

/**
 * path -> required permissions. Derived from the nav config so a route and its
 * nav entry can never disagree, plus entries for routes that have no nav item.
 * The (app) guard reads this and redirects to a proper 403 screen.
 */
const EXTRA_ROUTES: Record<string, PermissionKey[]> = {
  "/rate-cons/new": ["loads:create", "documents:upload"],
  "/rate-cons": ["loads:view"],
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
