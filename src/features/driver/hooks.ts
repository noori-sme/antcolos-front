"use client";

import { usePeopleList, usePerson } from "@/lib/api/use-org-people";
import type { OrgPeopleQuery } from "@/types/org-people";

/** This organization's drivers (users contract). */
export function useDrivers(query: OrgPeopleQuery) {
  return usePeopleList("drivers", query);
}

export function useDriver(userId: string) {
  return usePerson("drivers", userId);
}
