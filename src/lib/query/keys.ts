import type {
  AuditEventFilters, ComplianceFilters, FleetAssetKind, FleetEquipmentFilters,
  NeedsYouFilters, RiskCaseFilters, RiskSignalFilters, SettlementFilters,
  SettlementSort,
} from "@/types";

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
  eldDashboard: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "eld", "dashboard", membershipId] as const,
  eldDevices: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "eld", "devices", membershipId] as const,
  eldDevice: (organizationId: string, membershipId: string, deviceId: string) =>
    [...orgKey(organizationId), "eld", "device", membershipId, deviceId] as const,
  eldEvents: (organizationId: string, membershipId: string, query?: unknown) =>
    [...orgKey(organizationId), "eld", "events", membershipId, query ?? null] as const,
  eldSignals: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "eld", "signals", membershipId] as const,
  eldRawPayloads: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "eld", "raw", membershipId] as const,
  eldShares: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "eld", "shares", membershipId] as const,
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
  contractsDashboard: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "contracts", "dashboard", membershipId] as const,
  contracts: (organizationId: string, membershipId: string, filters?: unknown) =>
    [...orgKey(organizationId), "contracts", "list", membershipId, filters ?? null] as const,
  contract: (organizationId: string, membershipId: string, contractId: string) =>
    [...orgKey(organizationId), "contracts", "one", membershipId, contractId] as const,
  contractVersion: (
    organizationId: string,
    membershipId: string,
    contractId: string,
    contractVersionId: string,
  ) =>
    [...orgKey(organizationId), "contracts", "version", membershipId, contractId, contractVersionId] as const,
  contractTransitionRequests: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "contracts", "transitions", membershipId] as const,
  fleetDashboard: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "fleet", "dashboard", membershipId] as const,
  fleetEquipment: (
    organizationId: string, membershipId: string, filters: FleetEquipmentFilters,
  ) => [...orgKey(organizationId), "fleet", "equipment", membershipId, filters] as const,
  fleetAsset: (
    organizationId: string, membershipId: string, assetKind: FleetAssetKind, assetId: string,
  ) => [...orgKey(organizationId), "fleet", "asset", membershipId, assetKind, assetId] as const,
  insuranceDashboard: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "insurance", membershipId, "dashboard"] as const,
  policies: (organizationId: string, membershipId: string, filters?: unknown) =>
    [...orgKey(organizationId), "insurance", membershipId, "policies", filters ?? null] as const,
  policy: (organizationId: string, membershipId: string, policyId: string) =>
    [...orgKey(organizationId), "insurance", membershipId, "policy", policyId] as const,
  certificates: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "insurance", membershipId, "certificates"] as const,
  claims: (organizationId: string, membershipId: string, filters?: unknown) =>
    [...orgKey(organizationId), "insurance", membershipId, "claims", filters ?? null] as const,
  claim: (organizationId: string, membershipId: string, claimId: string) =>
    [...orgKey(organizationId), "insurance", membershipId, "claim", claimId] as const,
  invoices: (organizationId: string, membershipId: string, scope: unknown) =>
    [...orgKey(organizationId), "invoices", membershipId, scope ?? null] as const,
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

/**
 * Audit and risk keys carry the MEMBERSHIP as well as the organization.
 *
 * Two people in one organization legitimately see different ledgers: the feeds
 * that contribute to it are gated on the reader's own permissions, so a
 * compliance reviewer and an accountant see overlapping but different sets. One
 * served from the other's cache would be a disclosure.
 */
export const auditKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "audit"] as const,
  list: (organizationId: string, membershipId: string, filters: AuditEventFilters) =>
    [...orgKey(organizationId), "audit", membershipId, "list", filters] as const,
  event: (organizationId: string, membershipId: string, eventId: string) =>
    [...orgKey(organizationId), "audit", membershipId, "event", eventId] as const,
  forEntity: (organizationId: string, membershipId: string, entityId: string) =>
    [...orgKey(organizationId), "audit", membershipId, "entity", entityId] as const,
  forActor: (organizationId: string, membershipId: string, actorMembershipId: string) =>
    [...orgKey(organizationId), "audit", membershipId, "actor", actorMembershipId] as const,
  sources: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "audit", membershipId, "sources"] as const,
  exportView: (organizationId: string, membershipId: string, filters: AuditEventFilters) =>
    [...orgKey(organizationId), "audit", membershipId, "export", filters] as const,
} as const;

export const riskKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "risk"] as const,
  dashboard: (organizationId: string, membershipId: string) =>
    [...orgKey(organizationId), "risk", membershipId, "dashboard"] as const,
  rules: (organizationId: string) => [...orgKey(organizationId), "risk", "rules"] as const,
  signals: (organizationId: string, membershipId: string, filters: RiskSignalFilters) =>
    [...orgKey(organizationId), "risk", membershipId, "signals", filters] as const,
  signal: (organizationId: string, membershipId: string, signalId: string) =>
    [...orgKey(organizationId), "risk", membershipId, "signal", signalId] as const,
  cases: (organizationId: string, membershipId: string, filters: RiskCaseFilters) =>
    [...orgKey(organizationId), "risk", membershipId, "cases", filters] as const,
  case: (organizationId: string, membershipId: string, caseId: string) =>
    [...orgKey(organizationId), "risk", membershipId, "case", caseId] as const,
  assignees: (organizationId: string, membershipId: string, caseId: string) =>
    [...orgKey(organizationId), "risk", membershipId, "assignees", caseId] as const,
  extensions: (organizationId: string) =>
    [...orgKey(organizationId), "risk", "extensions"] as const,
} as const;
