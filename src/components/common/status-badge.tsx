import { Badge } from "@/components/ui/badge";
import {
  DRIVER_STATUS, FIELD_REVIEW_STATUS, LOAD_EXCEPTION_SEVERITY, LOAD_EXCEPTION_STATUS, LOAD_RECORD_STATUS, LOAD_STATUS, RATE_CON_STATUS,
  TRUCK_OPERATIONAL_STATUS, TRUCK_STATUS, MAINTENANCE_DUE_STATUS, MAINTENANCE_TASK_STATUS,
} from "@/config/statuses";
import type { TruckOperationalStatus as ApiTruckStatus } from "@/types/fleet-truck";
import type { DueStatus, MaintenanceTaskStatus } from "@/types/maintenance-live";
import type { LoadExceptionSeverity, LoadExceptionStatus } from "@/types/load-exception";
import type { LoadRecordStatus } from "@/types/load-record";
import type { DriverStatus, LoadStatus, TruckStatus } from "@/types";
import type { RateConDisplayStatus } from "@/lib/rate-con/status";
import type { FieldReviewStatus } from "@/types/rate-con-intake";

export function LoadStatusBadge({ status }: { status: LoadStatus }) {
  const meta = LOAD_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function LoadRecordStatusBadge({ status }: { status: LoadRecordStatus }) {
  const meta = LOAD_RECORD_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** A real-API truck status (plan 15); unknown values are not guessed. */
export function TruckOperationalBadge({ status }: { status: ApiTruckStatus }) {
  const meta = TRUCK_OPERATIONAL_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function TruckStatusBadge({ status }: { status: TruckStatus }) {
  const meta = TRUCK_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function DriverStatusBadge({ status }: { status: DriverStatus }) {
  const meta = DRIVER_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function RateConStatusBadge({ status }: { status: RateConDisplayStatus }) {
  const meta = RATE_CON_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function FieldReviewStatusBadge({ status }: { status: FieldReviewStatus }) {
  const meta = FIELD_REVIEW_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function ExceptionSeverityBadge({ severity }: { severity: LoadExceptionSeverity }) {
  const meta = LOAD_EXCEPTION_SEVERITY[severity];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function ExceptionStatusBadge({ status }: { status: LoadExceptionStatus }) {
  const meta = LOAD_EXCEPTION_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** A real-API maintenance due status (plan 24). */
export function MaintenanceDueBadge({ status }: { status: DueStatus }) {
  const meta = MAINTENANCE_DUE_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** A real-API maintenance task status (plan 24); an unknown value shows as-is. */
export function MaintenanceTaskBadge({ status }: { status: string }) {
  const meta = MAINTENANCE_TASK_STATUS[status as MaintenanceTaskStatus];
  return <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? status}</Badge>;
}

