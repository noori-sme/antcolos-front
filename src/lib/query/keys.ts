import type { NeedsYouFilters, SettlementFilters, SettlementSort } from "@/types";

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
 * Settlement keys carry the MEMBERSHIP as well as the organization, because two
 * memberships in one carrier legitimately see different settlements: an
 * accountant sees everyone's, a driver sees only their own. Keying on the
 * organization alone would let one be served from the other's cache.
 */
export const settlementKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "settlements"] as const,
  list: (
    organizationId: string,
    membershipId: string,
    filters: SettlementFilters,
    sort?: SettlementSort,
  ) =>
    [...orgKey(organizationId), "settlements", membershipId, "list", filters, sort ?? null] as const,
  totals: (organizationId: string, membershipId: string, filters: SettlementFilters) =>
    [...orgKey(organizationId), "settlements", membershipId, "totals", filters] as const,
  detail: (organizationId: string, membershipId: string, settlementId: string) =>
    [...orgKey(organizationId), "settlements", membershipId, "detail", settlementId] as const,
  audit: (organizationId: string, membershipId: string, settlementId: string) =>
    [...orgKey(organizationId), "settlements", membershipId, "audit", settlementId] as const,
  statements: (organizationId: string, membershipId: string, settlementId: string) =>
    [...orgKey(organizationId), "settlements", membershipId, "statements", settlementId] as const,
  payees: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "settlements", membershipId, "payees"] as const,
  periods: (organizationId: string) =>
    [...orgKey(organizationId), "settlements", "periods"] as const,
} as const;
