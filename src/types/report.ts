import type { IsoDateTime } from "./common";
import type { OrganizationType, PermissionKey } from "./permission";

/**
 * Reporting entities.
 *
 * A report is an ANALYSIS, never a record. Nothing in this file describes a
 * load, an invoice, a settlement, a document, a carrier, a driver, a truck, a
 * trailer, a broker, a shipper or a receiver — those live in their own modules
 * and reporting only ever points back at them by id. If a number here cannot be
 * traced to a record another module owns, it does not belong here.
 */

/**
 * Who a report is written for. The audience is derived in the service from the
 * organization type and the caller's permissions — never asked for by the UI,
 * and never a role name.
 */
export type ReportAudience =
  /** A carrier organization's own operation. */
  | "carrier_org"
  /** A dispatch organization's book of business across the carriers it serves. */
  | "dispatch_org"
  /** One dispatcher's own income, loads and activity. Nothing organization-wide. */
  | "dispatcher_individual";

/** Every presentation of the same numbers. Filters and permissions never change with it. */
export type ReportView = "table" | "bar" | "line" | "summary";

export type MetricUnit =
  | "money"
  | "rate_per_mile"
  | "miles"
  | "percent"
  | "count"
  | "hours"
  | "days";

/** Reading order in the catalog: the money, the work, the people, the equipment. */
export type ReportGroup = "money" | "operations" | "customers" | "fleet" | "me";

/**
 * The modules reporting reads from. Each one is a separate product surface with
 * its own records; reporting holds a typed reference to it and nothing more.
 */
export type ReportSourceKey =
  | "loads"
  | "rate_confirmations"
  | "invoices"
  | "settlements"
  | "documents"
  | "trucks"
  | "carriers"
  | "expenses"
  | "mt_loop"
  | "search_sessions"
  | "opportunities"
  | "dispatcher_attribution"
  | "dispatcher_earnings";

/**
 * Whether the numbers came from a real module, from a clearly marked mock
 * adapter, or from nothing at all. There is no fourth value: a source never
 * looks live when it is not.
 */
export type SourceAvailability = "live" | "mock" | "unavailable";

export interface ReportSourceStatus {
  key: ReportSourceKey;
  /** The module as a person names it. */
  label: string;
  availability: SourceAvailability;
  /** Always populated for mock and unavailable. Written for the reader, not the developer. */
  note: string;
}

/**
 * A pointer from a number back to the records it was computed from. Reporting
 * never copies a record — it carries ids and the module renders them.
 */
export type DrilldownKind =
  | "load"
  | "invoice"
  | "settlement"
  | "document"
  | "truck"
  | "driver"
  | "carrier"
  | "broker"
  | "search_session"
  | "opportunity"
  | "expense";

export interface DrilldownRef {
  kind: DrilldownKind;
  /** Ids belonging to the owning module. Never ids reporting made up. */
  ids: string[];
  /** What the reader is about to open, e.g. "12 loads behind this number". */
  label: string;
}

/** One source record, as reporting is allowed to preview it before handing off. */
export interface DrilldownRecord {
  id: string;
  kind: DrilldownKind;
  title: string;
  subtitle?: string;
  meta: { label: string; value: string }[];
  /** The owning module's screen. Absent when that module has no screen yet. */
  href?: string;
  /** Whether this record is real or a marked fixture. Rendered, never hidden. */
  availability: SourceAvailability;
}

/**
 * How one number is calculated, in words. Every metric carries one; a number
 * without a definition is not shippable.
 */
export interface MetricDefinition {
  key: string;
  label: string;
  unit: MetricUnit;
  /** What the number means. */
  definition: string;
  /** The arithmetic, written out. */
  formula: string;
  /** Modules the arithmetic draws on. */
  sources: ReportSourceKey[];
  /** Permissions required on top of the report's own. */
  requires?: PermissionKey[];
  /** Which direction is good news. Drives how a trend is described, never invented. */
  betterWhen?: "higher" | "lower" | "neutral";
}

export interface ReportDefinition {
  id: ReportId;
  title: string;
  /** One line, in the reader's language. */
  description: string;
  group: ReportGroup;
  audiences: ReportAudience[];
  /** Restricts the report to one kind of workspace. Absent = both. */
  organizationTypes?: OrganizationType[];
  /** Held in addition to reports:view. Enforced in the service, not the UI. */
  requires: PermissionKey[];
  /** Metric keys, in the order they are read. The first is the headline. */
  summaryMetrics: string[];
  /** Metric keys that make up a row in the table and the chart. */
  rowMetrics: string[];
  /** What a row is: "Truck", "Broker", "Week". */
  rowLabel: string;
  /**
   * Views this data actually supports. A report is never given a chart type its
   * shape cannot carry — a single ratio has no bar chart, a set of unordered
   * categories has no line chart.
   */
  views: ReportView[];
  defaultView: ReportView;
  sources: ReportSourceKey[];
}

export type ReportId =
  // Carrier organization
  | "carrier_revenue"
  | "carrier_profit"
  | "carrier_rpm"
  | "carrier_deadhead"
  | "carrier_truck_performance"
  | "carrier_expenses"
  | "carrier_invoice_status"
  | "carrier_receivables"
  | "carrier_settlements"
  | "carrier_broker_performance"
  | "carrier_lane_performance"
  | "carrier_equipment_utilization"
  // Dispatch organization
  | "dispatch_commission_revenue"
  | "dispatch_carrier_performance"
  | "dispatch_dispatcher_performance"
  | "dispatch_booked_loads"
  | "dispatch_average_rpm"
  | "dispatch_booking_success"
  | "dispatch_empty_trucks"
  | "dispatch_time_to_cover"
  | "dispatch_broker_response"
  // Individual dispatcher — own records only
  | "my_income"
  | "my_loads"
  | "my_carriers"
  | "my_performance"
  | "my_activity";

// --- Running a report -------------------------------------------------------

export interface ReportRange {
  /** Inclusive start, ISO instant. */
  from: IsoDateTime;
  /** Exclusive end, ISO instant. */
  to: IsoDateTime;
  /** The preset this came from, when it came from one. */
  presetId?: string;
}

export interface ReportFilters {
  range: ReportRange;
  /**
   * Carrier organizations to include. Only meaningful to a dispatch workspace,
   * where it narrows an already-narrowed set: a carrier that has not shared its
   * records is not selectable and is not included when the filter is empty.
   */
  carrierOrganizationIds?: string[];
}

export interface ReportRequest {
  reportId: ReportId;
  filters: ReportFilters;
}

export interface MetricValue {
  key: string;
  /** null when the metric could not be produced. Never zero standing in for null. */
  value: number | null;
  unit: MetricUnit;
  /** The same metric over the period immediately before this one. */
  previousValue?: number | null;
  /** Percentage change against the previous period. null when there is no base. */
  changePct?: number | null;
  drilldown?: DrilldownRef;
  /** Why there is no number. Rendered in place of the value. */
  unavailable?: {
    reason: "no_source" | "permission" | "no_data";
    detail: string;
  };
}

export interface ReportRow {
  id: string;
  label: string;
  sublabel?: string;
  /** Keyed by metric key. null means "not computable for this row". */
  values: Record<string, number | null>;
  drilldown?: DrilldownRef;
}

export interface ReportTrendPoint {
  key: string;
  label: string;
  values: Record<string, number | null>;
  drilldown?: DrilldownRef;
}

export interface ReportTrend {
  /** Metric keys plotted, in palette order. */
  metricKeys: string[];
  points: ReportTrendPoint[];
  /** The bucket a point covers. */
  granularity: "day" | "week" | "month";
}

export interface ReportColumn {
  key: string;
  label: string;
  unit: MetricUnit;
}

export type ReportNoticeKind =
  | "mock_source"
  | "excluded_records"
  | "no_data"
  | "partial_permission";

export interface ReportNotice {
  kind: ReportNoticeKind;
  message: string;
}

/**
 * A finished report. Everything an export needs is here: the filters it was run
 * with, the definitions behind every column, the numbers, and what the numbers
 * came from. An exporter never re-queries.
 */
export interface ReportResult {
  reportId: ReportId;
  audience: ReportAudience;
  generatedAt: IsoDateTime;
  filters: ReportFilters;
  /** The workspace it was run in, for the export header. */
  organizationId: string;
  organizationName: string;
  summary: MetricValue[];
  columns: ReportColumn[];
  rows: ReportRow[];
  rowLabel: string;
  trend: ReportTrend | null;
  /** The summary-text view: the same numbers, written out. */
  narrative: string[];
  /** Definitions for every metric appearing anywhere in this result. */
  definitions: MetricDefinition[];
  sources: ReportSourceStatus[];
  notices: ReportNotice[];
  /** Source records analyzed, before grouping. */
  recordCount: number;
}

export interface ReportCatalogEntry {
  definition: ReportDefinition;
  /** False when the membership holds reports:view but not this report's keys. */
  available: boolean;
  /** Permissions the membership is missing. Empty when available. */
  missingPermissions: PermissionKey[];
}
