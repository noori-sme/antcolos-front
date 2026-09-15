import type {
  OrganizationType, PermissionKey, ReportAudience, ReportDefinition, ReportGroup,
  ReportId,
} from "@/types";

/**
 * The report catalog.
 *
 * One entry per report, naming its audience, the permissions it needs, the
 * metrics it shows and the views its data can honestly carry. The service reads
 * this to decide what a membership may run; the UI reads it to decide what to
 * offer. Neither invents an entry.
 *
 * `views` is a judgement about the DATA, not a menu to be filled in:
 *  - "line" appears only where the rows are ordered in time.
 *  - "bar" appears only where rows are comparable magnitudes.
 *  - a report whose answer is one ratio has neither, and says so.
 */

export const REPORT_GROUP_LABEL: Record<ReportGroup, string> = {
  money: "Money",
  operations: "Operations",
  customers: "Customers and brokers",
  fleet: "Fleet",
  me: "My work",
};

export const AUDIENCE_LABEL: Record<ReportAudience, string> = {
  carrier_org: "Carrier organization",
  dispatch_org: "Dispatch organization",
  dispatcher_individual: "Your own work",
};

const CARRIER: ReportAudience[] = ["carrier_org"];
const DISPATCH: ReportAudience[] = ["dispatch_org"];
const MINE: ReportAudience[] = ["dispatcher_individual"];

export const REPORTS: ReportDefinition[] = [
  // ---- Carrier organization ----------------------------------------------
  {
    id: "carrier_revenue",
    title: "Revenue",
    description: "What the freight that moved is worth, period by period.",
    group: "money",
    audiences: CARRIER,
    requires: ["revenue:view", "rates:view"],
    summaryMetrics: ["revenue", "loadCount", "revenuePerLoad", "rpm"],
    rowMetrics: ["revenue", "loadCount", "revenuePerLoad"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "line",
    sources: ["loads"],
  },
  {
    id: "carrier_profit",
    title: "Profit and margin",
    description: "Revenue against driver pay and operating spend.",
    group: "money",
    audiences: CARRIER,
    requires: ["profitability:view", "rates:view"],
    summaryMetrics: ["revenue", "cost", "grossProfit", "margin"],
    rowMetrics: ["revenue", "cost", "grossProfit", "margin"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "line",
    sources: ["loads", "settlements", "expenses"],
  },
  {
    id: "carrier_rpm",
    title: "Rate per mile",
    description: "Loaded RPM and all-in RPM, and how they moved.",
    group: "money",
    audiences: CARRIER,
    requires: ["rates:view"],
    summaryMetrics: ["rpm", "allInRpm", "loadedMiles", "revenue"],
    rowMetrics: ["rpm", "allInRpm", "loadedMiles"],
    rowLabel: "Period",
    views: ["table", "line", "summary"],
    defaultView: "line",
    sources: ["loads"],
  },
  {
    id: "carrier_deadhead",
    title: "Deadhead",
    description: "Empty miles by truck, and what they cost.",
    group: "operations",
    audiences: CARRIER,
    requires: ["rates:view"],
    summaryMetrics: ["deadheadPct", "deadheadMiles", "loadedMiles", "deadheadCost"],
    rowMetrics: ["deadheadMiles", "loadedMiles", "deadheadPct"],
    rowLabel: "Truck",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["loads", "trucks", "expenses"],
  },
  {
    id: "carrier_truck_performance",
    title: "Truck performance",
    description: "Loads, miles, revenue and RPM for every power unit.",
    group: "fleet",
    audiences: CARRIER,
    requires: ["trucks:view", "rates:view"],
    summaryMetrics: ["truckCount", "revenue", "rpm", "loadCount"],
    rowMetrics: ["revenue", "loadCount", "loadedMiles", "rpm", "deadheadPct"],
    rowLabel: "Truck",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["trucks", "loads"],
  },
  {
    id: "carrier_expenses",
    title: "Expenses",
    description: "Operating spend by category, and spend per mile.",
    group: "money",
    audiences: CARRIER,
    requires: ["expenses:view"],
    summaryMetrics: ["expenses", "costPerMile"],
    rowMetrics: ["expenses"],
    rowLabel: "Category",
    views: ["table", "bar", "summary"],
    defaultView: "bar",
    // Cost per mile weighs driver pay too, so the settlement records are read.
    sources: ["expenses", "loads", "settlements"],
  },
  {
    id: "carrier_invoice_status",
    title: "Invoice status",
    description: "Where every invoice stands — draft, sent, paid or overdue.",
    group: "money",
    audiences: CARRIER,
    requires: ["invoices:view"],
    summaryMetrics: ["invoicedAmount", "unbilledAmount", "openReceivables", "invoiceCount"],
    rowMetrics: ["invoicedAmount", "invoiceCount"],
    rowLabel: "Status",
    views: ["table", "bar", "summary"],
    defaultView: "bar",
    sources: ["invoices", "loads"],
  },
  {
    id: "carrier_receivables",
    title: "Accounts receivable",
    description: "What is owed, by how long it has been owed.",
    group: "money",
    audiences: CARRIER,
    requires: ["invoices:view", "revenue:view"],
    summaryMetrics: ["openReceivables", "overdueAmount", "daysToPay", "invoiceCount"],
    rowMetrics: ["openReceivables", "invoiceCount"],
    rowLabel: "Age bucket",
    views: ["table", "bar", "summary"],
    defaultView: "bar",
    sources: ["invoices"],
  },
  {
    id: "carrier_settlements",
    title: "Settlements",
    description: "Driver pay by settlement period and where each one stands.",
    group: "money",
    audiences: CARRIER,
    requires: ["settlements:view"],
    summaryMetrics: ["settlementAmount", "settlementPendingAmount", "settlementCount"],
    rowMetrics: ["settlementAmount", "settlementCount"],
    rowLabel: "Driver",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["settlements"],
  },
  {
    id: "carrier_broker_performance",
    title: "Broker performance",
    description: "Which customers pay best, pay fastest and keep you loaded.",
    group: "customers",
    audiences: CARRIER,
    requires: ["customers:view", "rates:view"],
    summaryMetrics: ["revenue", "loadCount", "rpm", "daysToPay"],
    rowMetrics: ["revenue", "loadCount", "rpm", "onTimePct", "daysToPay"],
    rowLabel: "Broker or shipper",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["loads", "invoices"],
  },
  {
    id: "carrier_lane_performance",
    title: "Lane performance",
    description: "Revenue, RPM and deadhead by origin and destination.",
    group: "operations",
    audiences: CARRIER,
    requires: ["rates:view"],
    summaryMetrics: ["revenue", "loadCount", "rpm", "deadheadPct"],
    rowMetrics: ["revenue", "loadCount", "rpm", "deadheadPct"],
    rowLabel: "Lane",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["loads"],
  },
  {
    id: "carrier_equipment_utilization",
    title: "Equipment utilization",
    description: "How much of the fleet's time was spent under a load.",
    group: "fleet",
    audiences: CARRIER,
    requires: ["trucks:view"],
    summaryMetrics: ["utilizationPct", "truckCount", "emptyTruckCount", "loadCount"],
    rowMetrics: ["utilizationPct", "loadCount"],
    rowLabel: "Truck",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["trucks", "loads"],
  },

  // ---- Dispatch organization ---------------------------------------------
  {
    id: "dispatch_commission_revenue",
    title: "Commission revenue",
    description: "What the desk earned, period by period.",
    group: "money",
    audiences: DISPATCH,
    requires: ["revenue:view", "rates:view"],
    summaryMetrics: ["commission", "bookedLoads", "commissionPerLoad"],
    rowMetrics: ["commission", "bookedLoads", "commissionPerLoad"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "line",
    sources: ["loads"],
  },
  {
    id: "dispatch_carrier_performance",
    title: "Performance by carrier",
    description: "Loads, commission and RPM for each carrier you dispatch for.",
    group: "customers",
    audiences: DISPATCH,
    requires: ["revenue:view", "rates:view"],
    summaryMetrics: ["carrierCount", "commission", "bookedLoads", "rpm"],
    rowMetrics: ["commission", "bookedLoads", "rpm", "onTimePct"],
    rowLabel: "Carrier",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["loads", "carriers"],
  },
  {
    id: "dispatch_dispatcher_performance",
    title: "Performance by dispatcher",
    description: "Loads booked and commission earned by each dispatcher on the desk.",
    group: "operations",
    audiences: DISPATCH,
    requires: ["members:view", "revenue:view", "rates:view"],
    summaryMetrics: ["commission", "bookedLoads", "commissionPerLoad"],
    rowMetrics: ["commission", "bookedLoads", "rpm", "commissionPerLoad"],
    rowLabel: "Dispatcher",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["loads", "dispatcher_attribution"],
  },
  {
    id: "dispatch_booked_loads",
    title: "Booked loads",
    description: "Volume booked over time, and how much of it is still running.",
    group: "operations",
    audiences: DISPATCH,
    requires: [],
    summaryMetrics: ["bookedLoads", "carrierCount", "documentCompliancePct", "rateConVerifiedPct"],
    rowMetrics: ["bookedLoads"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "line",
    sources: ["loads", "rate_confirmations", "documents", "carriers"],
  },
  {
    id: "dispatch_average_rpm",
    title: "Average RPM",
    description: "The rate the desk is booking, loaded and all-in.",
    group: "money",
    audiences: DISPATCH,
    requires: ["rates:view"],
    summaryMetrics: ["rpm", "allInRpm", "loadedMiles"],
    rowMetrics: ["rpm", "allInRpm"],
    rowLabel: "Period",
    views: ["table", "line", "summary"],
    defaultView: "line",
    sources: ["loads"],
  },
  {
    id: "dispatch_booking_success",
    title: "Booking success",
    description: "How many of the loads pursued turned into booked freight.",
    group: "operations",
    audiences: DISPATCH,
    requires: [],
    summaryMetrics: ["bookingSuccessPct", "offersSent", "bookedLoads", "searchSessions"],
    rowMetrics: ["bookingSuccessPct", "offersSent", "bookedLoads"],
    rowLabel: "Dispatcher",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["opportunities", "search_sessions", "loads"],
  },
  {
    id: "dispatch_empty_trucks",
    title: "Empty trucks",
    description: "Which trucks are sitting, and how long they have been sitting.",
    group: "fleet",
    audiences: DISPATCH,
    requires: ["trucks:view"],
    summaryMetrics: ["emptyTruckCount", "truckCount", "emptyHours"],
    rowMetrics: ["emptyHours"],
    rowLabel: "Truck",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["trucks", "mt_loop"],
  },
  {
    id: "dispatch_time_to_cover",
    title: "Time to find a load",
    description: "How long a truck waits between going empty and being covered.",
    group: "operations",
    audiences: DISPATCH,
    requires: ["trucks:view"],
    summaryMetrics: ["timeToCoverHours", "searchSessions", "bookedLoads"],
    rowMetrics: ["timeToCoverHours", "searchSessions"],
    rowLabel: "Carrier",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["mt_loop", "search_sessions", "loads", "carriers"],
  },
  {
    id: "dispatch_broker_response",
    title: "Broker response rates",
    description: "Which brokers answer offers, and how quickly.",
    group: "customers",
    audiences: DISPATCH,
    requires: ["customers:view"],
    summaryMetrics: ["brokerResponsePct", "offersSent", "brokerResponseHours"],
    rowMetrics: ["brokerResponsePct", "offersSent", "brokerResponseHours"],
    rowLabel: "Broker",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["opportunities"],
  },

  // ---- One dispatcher, their own records only ----------------------------
  {
    id: "my_income",
    title: "My income",
    description: "What you earned on the loads credited to you.",
    group: "me",
    audiences: MINE,
    requires: [],
    summaryMetrics: ["myEarnings", "myLoads", "myEarningsPerLoad"],
    rowMetrics: ["myEarnings", "myLoads"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "line",
    sources: ["dispatcher_earnings", "dispatcher_attribution", "loads"],
  },
  {
    id: "my_loads",
    title: "My loads",
    description: "Every load credited to you in the period.",
    group: "me",
    audiences: MINE,
    requires: ["loads:view"],
    summaryMetrics: ["myLoads", "onTimePct", "documentCompliancePct", "rateConVerifiedPct"],
    rowMetrics: ["myLoads"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "table",
    sources: ["loads", "dispatcher_attribution", "documents", "rate_confirmations"],
  },
  {
    id: "my_carriers",
    title: "My carriers",
    description: "The carriers you dispatch for and what you moved for each.",
    group: "me",
    audiences: MINE,
    // Only a dispatch workspace has carriers other than itself.
    organizationTypes: ["DISPATCH_AGENCY"],
    requires: ["loads:view"],
    summaryMetrics: ["carrierCount", "myLoads", "myEarnings"],
    rowMetrics: ["myLoads", "myEarnings", "onTimePct"],
    rowLabel: "Carrier",
    views: ["table", "bar", "summary"],
    defaultView: "table",
    sources: ["loads", "carriers", "dispatcher_attribution", "dispatcher_earnings"],
  },
  {
    id: "my_performance",
    title: "My performance",
    description: "Booking success, time to cover and on-time delivery — yours only.",
    group: "me",
    audiences: MINE,
    requires: [],
    summaryMetrics: ["bookingSuccessPct", "timeToCoverHours", "onTimePct", "myLoads"],
    rowMetrics: ["bookingSuccessPct", "myLoads", "onTimePct"],
    rowLabel: "Period",
    views: ["table", "bar", "line", "summary"],
    defaultView: "line",
    sources: ["loads", "search_sessions", "opportunities", "mt_loop", "dispatcher_attribution"],
  },
  {
    id: "my_activity",
    title: "My activity",
    description: "Searches run, offers sent and loads booked, day by day.",
    group: "me",
    audiences: MINE,
    requires: [],
    summaryMetrics: ["activityCount", "searchSessions", "offersSent", "myLoads"],
    rowMetrics: ["searchSessions", "offersSent", "myLoads"],
    rowLabel: "Day",
    views: ["table", "bar", "line", "summary"],
    defaultView: "bar",
    sources: ["search_sessions", "opportunities", "loads", "dispatcher_attribution"],
  },
];

const BY_ID = new Map<ReportId, ReportDefinition>(REPORTS.map((r) => [r.id, r]));

export function reportDefinition(id: ReportId): ReportDefinition | undefined {
  return BY_ID.get(id);
}

export function isReportId(value: string): value is ReportId {
  return BY_ID.has(value as ReportId);
}

export function reportsForAudience(
  audience: ReportAudience,
  organizationType?: OrganizationType,
): ReportDefinition[] {
  return REPORTS.filter(
    (r) =>
      r.audiences.includes(audience) &&
      (!r.organizationTypes || !organizationType || r.organizationTypes.includes(organizationType)),
  );
}

/** Permissions the membership is missing for a report, in catalog order. */
export function missingFor(
  definition: ReportDefinition,
  held: ReadonlySet<PermissionKey>,
): PermissionKey[] {
  return definition.requires.filter((key) => !held.has(key));
}

export const GROUP_ORDER: ReportGroup[] = ["money", "operations", "customers", "fleet", "me"];
