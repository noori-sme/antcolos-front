/**
 * Exceptions beside a load's status (F1.5, backend plan 36):
 * ../antcolos/docs/requirements/loads-api-contract.md §14.
 */
export const LOAD_EXCEPTION_TYPES = [
  "pickup_delay",
  "delivery_delay",
  "facility_issue",
  "truck_breakdown",
  "driver_unavailable",
  "broker_change",
  "missing_document",
  "rate_dispute",
  "payment_dispute",
  "tracking_failure",
  "other",
] as const;
export type LoadExceptionType = (typeof LOAD_EXCEPTION_TYPES)[number];

export const LOAD_EXCEPTION_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type LoadExceptionSeverity = (typeof LOAD_EXCEPTION_SEVERITIES)[number];

export type LoadExceptionStatus = "open" | "acknowledged" | "resolved";

export interface LoadException {
  id: string;
  loadId: string;
  brokerLoadNumber: string | null;
  stopSequence: number | null;
  type: LoadExceptionType;
  severity: LoadExceptionSeverity;
  status: LoadExceptionStatus;
  notes: string;
  occurredAt: string;
  openedAt: string;
  openedByUserId: string;
  source: string;
  ownerUserId: string | null;
  acknowledgedAt: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  /** USD decimal string ("150.00"); null when none, and always for a driver. */
  financialImpact: string | null;
}

export interface ReportExceptionInput {
  type: LoadExceptionType;
  severity: LoadExceptionSeverity;
  notes: string;
  stopSequence?: number | null;
  /** `web` from the dispatcher screens, `mobile_web` from the driver app. */
  source: "web" | "mobile_web";
}

export interface ResolveExceptionInput {
  resolution: string;
  /** USD, e.g. "150.00"; empty for none. */
  financialImpact?: string;
}

export interface LoadExceptionPage {
  items: LoadException[];
  page: number;
  totalPages: number;
  totalItems: number;
}
