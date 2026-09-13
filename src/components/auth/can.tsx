"use client";

import type { ReactNode } from "react";
import { useCanAll } from "@/lib/session/hooks";
import type { PermissionKey } from "@/types";

/**
 * Hides UI the membership may not use. This is user experience, not security —
 * the real boundary is the service layer and, later, the API.
 */
export function Can({
  permission,
  permissions,
  fallback = null,
  children,
}: {
  permission?: PermissionKey;
  permissions?: readonly PermissionKey[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const required = permissions ?? (permission ? [permission] : []);
  const allowed = useCanAll(required);
  return <>{allowed ? children : fallback}</>;
}
