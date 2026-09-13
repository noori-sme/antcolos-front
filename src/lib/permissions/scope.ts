import type { Membership, MembershipScope } from "@/types";

/**
 * Permission answers *what action*. Scope answers *over which records*.
 * Without this, "Driver" has to be a role. With it, a driver is a membership
 * with a small permission set and `loads: "assigned"`.
 */
export const DEFAULT_SCOPE: MembershipScope = { loads: "all", financials: "all" };
export const OWN_RECORDS_SCOPE: MembershipScope = { loads: "assigned", financials: "own" };

export function seesOnlyAssignedLoads(membership: Membership | null): boolean {
  return membership?.scope.loads === "assigned";
}

export function seesOnlyOwnFinancials(membership: Membership | null): boolean {
  return membership?.scope.financials === "own";
}
