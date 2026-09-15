import type { FleetTruck, Load, ReportAudience, ReportRange } from "@/types";
import { destinationStop } from "@/types";
import {
  mockAttribution, mockCarrierLinks, mockEarnings, mockEmptySpells, mockExpenses,
  mockInvoices, mockOpportunities, mockSearchSessions, mockSettlements,
} from "./mock-fixtures";
import type {
  DocumentComplianceRef, RateConfirmationRef, ReportDataset,
} from "./types";

/**
 * Assembles everything one report run reads, and applies the three boundaries
 * that decide what a caller is allowed to analyze:
 *
 *  1. WORKSPACE — the loads and trucks handed in were already narrowed to the
 *     active organization by their own modules. Nothing here widens that.
 *  2. CARRIER SHARING — a dispatch workspace analyzes only the carriers that
 *     have shared their records. Anything else is dropped and counted, so the
 *     report can say what it did not look at instead of quietly under-reporting.
 *  3. ATTRIBUTION — an individual dispatcher analyzes only the loads credited
 *     to them. There is no path from here to an organization-wide number.
 */

export interface DatasetInput {
  organizationId: string;
  membershipId: string;
  audience: ReportAudience;
  range: ReportRange;
  previousRange: ReportRange;
  /** Loads from the Loads module, already organization-scoped. */
  loads: Load[];
  /** Trucks from the registry, already relationship-scoped. */
  trucks: FleetTruck[];
  /** The workspace's members, for load attribution. */
  members: { membershipId: string; displayName: string }[];
  driverName: (driverId: string) => string;
}

/** A load belongs to the period its delivery falls in. One rule, everywhere. */
export function loadPeriodDate(load: Load): string {
  const stop = destinationStop(load);
  return stop.departedAt ?? stop.arrivedAt ?? stop.appointmentAt;
}

function inRange(iso: string, range: ReportRange): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(range.from).getTime() && t < new Date(range.to).getTime();
}

function rateConfirmations(organizationId: string, loads: Load[]): RateConfirmationRef[] {
  const out: RateConfirmationRef[] = [];
  for (const load of loads) {
    const requirement = load.documentRequirements.find((r) => r.kind === "rate_confirmation");
    if (!requirement) continue;
    const documentId = requirement.satisfiedByDocumentId;
    if (!documentId) continue;
    out.push({
      id: `rc_${documentId}`,
      organizationId,
      loadId: load.id,
      documentId,
      receivedAt: load.createdAt,
      // A load past verification has had its rate confirmation checked — that
      // transition is what "verifying" means in the Loads module.
      state: load.status === "verifying" ? "pending" : "verified",
      verifiedAt: load.status === "verifying" ? undefined : load.updatedAt,
    });
  }
  return out;
}

function documentCompliance(loads: Load[]): DocumentComplianceRef[] {
  return loads.map((load) => {
    const required = load.documentRequirements.filter((r) => r.required);
    return {
      loadId: load.id,
      requiredCount: required.length,
      satisfiedCount: required.filter((r) => r.satisfiedByDocumentId).length,
      missingKinds: required.filter((r) => !r.satisfiedByDocumentId).map((r) => r.kind),
    };
  });
}

export function assembleDataset(input: DatasetInput): ReportDataset {
  const {
    organizationId, membershipId, audience, range, previousRange, trucks, members,
  } = input;

  // A cancelled load is not work that happened. It is excluded from every
  // report; the Loads module still shows it.
  const confirmed = input.loads.filter((l) => l.status !== "cancelled" && l.status !== "draft");

  // --- Carrier sharing ----------------------------------------------------
  const carriers = mockCarrierLinks(organizationId);
  const sharedIds = new Set(
    carriers.filter((c) => c.sharing === "shared").map((c) => c.carrierOrganizationId),
  );
  const withheldIds = new Set<string>();
  const shared = confirmed.filter((load) => {
    const carrierId = load.assignment?.carrierOrganizationId;
    // A load running under the workspace's own authority has no carrier link
    // and is always its own to analyze.
    if (!carrierId) return true;
    if (sharedIds.has(carrierId)) return true;
    withheldIds.add(carrierId);
    return false;
  });
  const withheldCount = confirmed.length - shared.length;

  // --- Attribution --------------------------------------------------------
  const attribution = mockAttribution(shared, members);
  const mine =
    audience === "dispatcher_individual"
      ? shared.filter((l) => attribution.get(l.id)?.membershipId === membershipId)
      : shared;

  const loads = mine.filter((l) => inRange(loadPeriodDate(l), range));
  const previousLoads = mine.filter((l) => inRange(loadPeriodDate(l), previousRange));

  const driverName = input.driverName;
  const spells = mockEmptySpells(organizationId, trucks, loads, range);

  return {
    loads,
    previousLoads,
    trucks,
    invoices: mockInvoices(organizationId, loads),
    previousInvoices: mockInvoices(organizationId, previousLoads),
    settlements: mockSettlements(organizationId, loads, driverName),
    expenses: mockExpenses(organizationId, range, trucks, loads),
    previousExpenses: mockExpenses(organizationId, previousRange, trucks, previousLoads),
    rateConfirmations: rateConfirmations(organizationId, loads),
    documents: documentCompliance(loads),
    emptySpells: spells,
    searchSessions: mockSearchSessions(organizationId, spells, attribution, membershipId),
    opportunities: mockOpportunities(organizationId, loads, attribution, membershipId),
    earnings: mockEarnings(organizationId, loads, attribution),
    previousEarnings: mockEarnings(organizationId, previousLoads, attribution),
    carriers,
    attribution,
    withheld: { carrierOrganizationIds: [...withheldIds], loadCount: withheldCount },
  };
}
