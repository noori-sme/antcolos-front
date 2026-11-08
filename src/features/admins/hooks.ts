"use client";

import { usePeopleList, usePerson } from "@/lib/api/use-org-people";
import type { OrgPeopleQuery } from "@/types/org-people";

/** This organization's admins (users contract). */
export function useAdmins(query: OrgPeopleQuery) {
  return usePeopleList("admins", query);
}

export function useAdmin(userId: string) {
  return usePerson("admins", userId);
}
