import type { FleetAssetKind, FleetEquipmentFilters, NeedsYouFilters } from "@/types";

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
  fleetDashboard: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "fleet", "dashboard", membershipId] as const,
  fleetEquipment: (
    organizationId: string, membershipId: string, filters: FleetEquipmentFilters,
  ) => [...orgKey(organizationId), "fleet", "equipment", membershipId, filters] as const,
  fleetAsset: (
    organizationId: string, membershipId: string, assetKind: FleetAssetKind, assetId: string,
  ) => [...orgKey(organizationId), "fleet", "asset", membershipId, assetKind, assetId] as const,
} as const;
