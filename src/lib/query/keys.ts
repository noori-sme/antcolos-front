import type { NeedsYouFilters } from "@/types";

/**
 * Every query key is namespaced by organization. Org A's data can never be
 * served from cache to a screen rendered under Org B — structurally, not by
 * convention. The cache is also cleared outright on organization switch.
 */
export const orgKey = (organizationId: string) => ["org", organizationId] as const;

export const queryKeys = {
  home: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "home", membershipId] as const,
  needsYouList: (organizationId: string, membershipId: string, filters: NeedsYouFilters) =>
    [...orgKey(organizationId), "needs-you", membershipId, filters] as const,
  needsYouCount: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "needs-you", membershipId, "count"] as const,
  members: (organizationId: string) =>
    [...orgKey(organizationId), "members"] as const,
  loads: (organizationId: string, filters?: unknown) =>
    [...orgKey(organizationId), "loads", filters ?? null] as const,
  fuelDashboard: (organizationId: string, membershipId: string, window: unknown) =>
    [...orgKey(organizationId), "fuel", "dashboard", membershipId, window ?? null] as const,
  fuelTransactions: (organizationId: string, membershipId: string, filters?: unknown) =>
    [...orgKey(organizationId), "fuel", "transactions", membershipId, filters ?? null] as const,
  fuelTransaction: (organizationId: string, membershipId: string, id: string) =>
    [...orgKey(organizationId), "fuel", "transaction", membershipId, id] as const,
  fuelMileage: (organizationId: string, membershipId: string, filters?: unknown) =>
    [...orgKey(organizationId), "fuel", "mileage", membershipId, filters ?? null] as const,
  fuelAudit: (organizationId: string, membershipId: string, subjectId?: string) =>
    [...orgKey(organizationId), "fuel", "audit", membershipId, subjectId ?? null] as const,
  fuelIntegrations: (organizationId: string) =>
    [...orgKey(organizationId), "fuel", "integrations"] as const,
  fuelSharing: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "fuel", "sharing", membershipId] as const,
  iftaPeriods: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "ifta", "periods", membershipId] as const,
  iftaPeriod: (organizationId: string, membershipId: string, id: string) =>
    [...orgKey(organizationId), "ifta", "period", membershipId, id] as const,
} as const;
