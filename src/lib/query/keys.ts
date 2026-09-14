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
  reportWorkspace: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "reports", membershipId, "workspace"] as const,
  report: (
    organizationId: string,
    membershipId: string,
    reportId: string,
    filters: unknown,
  ) => [...orgKey(organizationId), "reports", membershipId, reportId, filters] as const,
  reportDrilldown: (
    organizationId: string,
    membershipId: string,
    reportId: string,
    filters: unknown,
    ref: unknown,
  ) =>
    [...orgKey(organizationId), "reports", membershipId, reportId, filters, "drilldown", ref] as const,
} as const;
