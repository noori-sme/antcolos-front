"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import { useCanAll } from "@/lib/session/hooks";
import { Forbidden } from "./forbidden";

/**
 * Route-level gate. The route manifest is derived from the nav config, so a
 * route and its nav entry can never disagree. This is UX, not security — the
 * service layer enforces the same keys independently.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const required = requiredPermissionsForPath(pathname);
  const allowed = useCanAll(required);

  if (!allowed) return <Forbidden required={required} />;
  return <>{children}</>;
}
