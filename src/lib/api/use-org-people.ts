"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { OrgPeopleFamily, OrgPeopleQuery } from "@/types/org-people";
import { services } from "./index";
import { useServiceContext } from "./use-service-context";

/**
 * Shared reads for the real people lists. Features wrap these in their own
 * `hooks.ts` (`useDrivers`, `useAdmin`, …) so screens keep reading through
 * their feature's hooks.
 */
export function usePeopleList(family: OrgPeopleFamily, query: OrgPeopleQuery, enabled = true) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? queryKeys.peopleList(ctx.organizationId, family, query) : ["people", "no-context"],
    queryFn: () => services.orgPeople.list(ctx!, family, query),
    enabled: Boolean(ctx) && enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePerson(family: OrgPeopleFamily, userId: string) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? queryKeys.person(ctx.organizationId, family, userId) : ["people", "no-context"],
    queryFn: () => services.orgPeople.get(ctx!, family, userId),
    enabled: Boolean(ctx) && Boolean(userId),
  });
}
