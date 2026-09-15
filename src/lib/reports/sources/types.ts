import type {
  Load, ReportSourceKey, ReportSourceStatus, SourceAvailability,
} from "@/types";
import type { FleetTruck } from "@/types";

/**
 * The seam between reporting and every other module.
 *
 * Reporting never stores a load, an invoice, a settlement or a document. It
 * reads them through these typed references, and every reference carries the id
 * of the record in the module that owns it so a number can be traced back.
 *
 * A module that is not built yet is served by a MOCK adapter. A mock adapter is
 * never disguised: its availability is "mock", it says so in its note, and the
 * UI renders that on every screen the numbers reach.
 */

/** An invoice, as reporting reads it. The Invoices module owns the record. */
export interface InvoiceRef {
  id: string;
  organizationId: string;
  /** The load this bills. Reporting never bills anything itself. */
  loadId: string;
  customerId: string;
  customerName: string;
  /**
   * The amount as invoiced. Where the Invoices module is not connected, this is
   * the LOAD's own total rate — reporting does not re-price freight.
   */
  amountCents: number;
  status: "draft" | "sent" | "paid" | "overdue";
  issuedAt?: string;
  sentAt?: string;
  dueAt?: string;
  paidAt?: string;
}

/** A settlement, as reporting reads it. The Settlements module owns the record. */
export interface SettlementRef {
  id: string;
  organizationId: string;
  driverId: string;
  driverName: string;
  /** Loads covered by the settlement. */
  loadIds: string[];
  /** Driver pay, from the load's own driver share where the module is not connected. */
  driverPayCents: number;
  status: "draft" | "in_review" | "approved" | "paid";
  periodStart: string;
  periodEnd: string;
}

export type ExpenseCategory =
  | "fuel" | "maintenance" | "insurance" | "tolls" | "permits" | "other";

/** An operating expense. No module owns these yet — see the mock adapter. */
export interface ExpenseRef {
  id: string;
  organizationId: string;
  category: ExpenseCategory;
  amountCents: number;
  incurredAt: string;
  truckId?: string;
}

/** A rate confirmation and where its verification stands. */
export interface RateConfirmationRef {
  id: string;
  organizationId: string;
  loadId: string;
  documentId: string;
  receivedAt: string;
  verifiedAt?: string;
  state: "pending" | "verified" | "rejected";
}

/** A document requirement, counted but never copied. */
export interface DocumentComplianceRef {
  loadId: string;
  requiredCount: number;
  satisfiedCount: number;
  missingKinds: string[];
}

/** One spell of a truck sitting empty. The MT Loop module owns these. */
export interface EmptySpellRef {
  id: string;
  organizationId: string;
  truckId: string;
  truckUnit: string;
  carrierOrganizationId?: string;
  startedAt: string;
  /** When a load was booked on the truck. Absent while it is still empty. */
  bookedAt?: string;
  loadId?: string;
}

/** An assisted load search. The Search Sessions module owns these. */
export interface SearchSessionRef {
  id: string;
  organizationId: string;
  truckId: string;
  /** The dispatcher who ran it. */
  membershipId: string;
  openedAt: string;
  closedAt?: string;
  outcome: "booked" | "abandoned" | "open";
  loadId?: string;
}

/** A load pursued with a broker. The Opportunities module owns these. */
export interface OpportunityRef {
  id: string;
  organizationId: string;
  brokerId: string;
  brokerName: string;
  membershipId: string;
  truckId?: string;
  offeredAt: string;
  respondedAt?: string;
  outcome: "booked" | "declined" | "no_response" | "pending";
  loadId?: string;
}

/** What one dispatcher earned on one load. Never the load's rate. */
export interface DispatcherEarningRef {
  id: string;
  organizationId: string;
  membershipId: string;
  loadId: string;
  amountCents: number;
  earnedAt: string;
}

/**
 * A carrier a dispatch workspace has a relationship with.
 *
 * `sharing` is the isolation boundary: records belonging to a carrier that has
 * not shared them are not read, not counted and not drillable — the service
 * drops them and says how many it dropped.
 */
export interface CarrierLinkRef {
  carrierOrganizationId: string;
  name: string;
  sharing: "shared" | "not_shared";
  sharedSince?: string;
}

/** Which dispatcher a load is credited to. */
export interface DispatcherAttributionRef {
  loadId: string;
  membershipId: string;
  displayName: string;
}

/** Everything one report run reads, assembled once and passed around. */
export interface ReportDataset {
  loads: Load[];
  /** The same loads over the period before, for trends. */
  previousLoads: Load[];
  trucks: FleetTruck[];
  invoices: InvoiceRef[];
  previousInvoices: InvoiceRef[];
  settlements: SettlementRef[];
  expenses: ExpenseRef[];
  previousExpenses: ExpenseRef[];
  rateConfirmations: RateConfirmationRef[];
  documents: DocumentComplianceRef[];
  emptySpells: EmptySpellRef[];
  searchSessions: SearchSessionRef[];
  opportunities: OpportunityRef[];
  earnings: DispatcherEarningRef[];
  previousEarnings: DispatcherEarningRef[];
  carriers: CarrierLinkRef[];
  attribution: Map<string, DispatcherAttributionRef>;
  /** Records dropped because their carrier has not shared them. */
  withheld: { carrierOrganizationIds: string[]; loadCount: number };
}

export const SOURCE_LABEL: Record<ReportSourceKey, string> = {
  loads: "Loads",
  rate_confirmations: "Rate Confirmation",
  invoices: "Invoices",
  settlements: "Settlements",
  documents: "Documents",
  trucks: "Trucks",
  carriers: "Carrier relationships",
  expenses: "Expenses",
  mt_loop: "MT Loop",
  search_sessions: "Search Sessions",
  opportunities: "Opportunities",
  dispatcher_attribution: "Load attribution",
  dispatcher_earnings: "Dispatcher earnings",
};

/**
 * What each source actually is today. This table is the honesty contract: it is
 * the only place that decides whether a number is backed by a real module, and
 * every screen renders what it says.
 */
export const SOURCE_AVAILABILITY: Record<
  ReportSourceKey,
  { availability: SourceAvailability; note: string }
> = {
  loads: {
    availability: "live",
    note: "Read from the Loads module through its service contract. Reporting adds no load records of its own.",
  },
  rate_confirmations: {
    availability: "live",
    note: "Read from the rate confirmation documents attached to each load.",
  },
  documents: {
    availability: "live",
    note: "Read from the document requirements on each load.",
  },
  trucks: {
    availability: "live",
    note: "Read from the permanent truck registry, through the same relationship rules the fleet roster uses.",
  },
  invoices: {
    availability: "mock",
    note: "The Invoices module is being built separately. Invoice status, dates and ageing come from a mock adapter; every amount is the load's own rate, never a number reporting invented.",
  },
  settlements: {
    availability: "mock",
    note: "The Settlements module is being built separately. Periods and approval status come from a mock adapter; driver pay is the load's own driver share.",
  },
  expenses: {
    availability: "mock",
    note: "There is no Expenses module yet. Every figure here is a mock fixture and must not be used to run the business.",
  },
  mt_loop: {
    availability: "mock",
    note: "The MT Loop module is being built separately. Empty spells come from a mock adapter, anchored to real trucks and real loads.",
  },
  search_sessions: {
    availability: "mock",
    note: "The Search Sessions module is being built separately. Sessions come from a mock adapter, anchored to real trucks.",
  },
  opportunities: {
    availability: "mock",
    note: "The Opportunities module is being built separately. Offers and broker responses come from a mock adapter, anchored to real customers.",
  },
  carriers: {
    availability: "mock",
    note: "Carrier sharing agreements come from a mock adapter until the Carrier relationship module exposes them. The isolation rules it describes are enforced for real.",
  },
  dispatcher_attribution: {
    availability: "mock",
    note: "Loads do not record which dispatcher booked them yet. Credit comes from a mock adapter and will be replaced by the load's own attribution field.",
  },
  dispatcher_earnings: {
    availability: "mock",
    note: "There is no dispatcher payout module yet. Your earnings come from a mock fixture; they are not the load's rate and do not reveal it.",
  },
};

/**
 * A source can be *more* degraded for one run than the table says — a workspace
 * the Loads module cannot serve at all, for instance. Overrides carry that, and
 * they may only make a source worse, never better.
 */
export type SourceOverrides = Partial<
  Record<ReportSourceKey, { availability: SourceAvailability; note: string }>
>;

export function sourceStatus(
  key: ReportSourceKey,
  overrides: SourceOverrides = {},
): ReportSourceStatus {
  const entry = overrides[key] ?? SOURCE_AVAILABILITY[key];
  return {
    key,
    label: SOURCE_LABEL[key],
    availability: entry.availability,
    note: entry.note,
  };
}

export function sourceStatuses(
  keys: readonly ReportSourceKey[],
  overrides: SourceOverrides = {},
): ReportSourceStatus[] {
  return [...new Set(keys)].map((key) => sourceStatus(key, overrides));
}
