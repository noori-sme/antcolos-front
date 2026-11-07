"use client";

import { usePeopleList, usePerson } from "@/lib/api/use-org-people";
import type { OrgPeopleQuery } from "@/types/org-people";

/** This organization's dispatchers (users contract). */
export function useDispatchers(query: OrgPeopleQuery) {
  return usePeopleList("dispatchers", query);
}

export function useDispatcher(userId: string) {
  return usePerson("dispatchers", userId);
}
