import type { ComplianceFilters, NeedsYouFilters } from "@/types";

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
} as const;

/**
 * Compliance keys are namespaced by organization AND membership: two people in
 * the same organization legitimately see different requirements, because a
 * driver sees their own record and a safety manager sees the fleet.
 */
export const complianceKeys = {
  summary: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "compliance", membershipId, "summary"] as const,
  list: (organizationId: string, membershipId: string, filters: ComplianceFilters) =>
    [...orgKey(organizationId), "compliance", membershipId, "list", filters] as const,
  groups: (organizationId: string, membershipId: string, filters: ComplianceFilters) =>
    [...orgKey(organizationId), "compliance", membershipId, "groups", filters] as const,
  requirement: (organizationId: string, membershipId: string, requirementId: string) =>
    [...orgKey(organizationId), "compliance", membershipId, "requirement", requirementId] as const,
  shares: (organizationId: string) =>
    [...orgKey(organizationId), "compliance", "shares"] as const,
  snapshots: (organizationId: string, subjectId?: string) =>
    [...orgKey(organizationId), "compliance", "snapshots", subjectId ?? null] as const,
  extensions: (organizationId: string) =>
    [...orgKey(organizationId), "compliance", "extensions"] as const,
} as const;
