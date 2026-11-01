"use client";

import { useActiveMembership } from "@/lib/session/hooks";
import { orgKey } from "./keys";

/**
 * The org prefix for a query key, for screens that build keys inline. Every
 * key must start with it so `invalidateQueries({ queryKey: orgKey(org) })`
 * reaches it and another organization's data is never served from cache.
 *
 * Unlike `useServiceContext()`, this never returns null: with no active
 * organization the prefix is `["org", "none"]`, so the query still runs
 * exactly as it did before keys were scoped.
 */
export function useOrgKeyPrefix(): readonly ["org", string] {
  const { organization } = useActiveMembership();
  return orgKey(organization?.id ?? "none");
}
