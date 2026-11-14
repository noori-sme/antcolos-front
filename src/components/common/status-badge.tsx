import { Badge } from "@/components/ui/badge";
import {
  DRIVER_STATUS, FIELD_REVIEW_STATUS, LOAD_STATUS, RATE_CON_STATUS, TRUCK_STATUS,
} from "@/config/statuses";
import type { DriverStatus, LoadStatus, TruckStatus } from "@/types";
import type { RateConDisplayStatus } from "@/lib/rate-con/status";
import type { FieldReviewStatus } from "@/types/rate-con-intake";

export function LoadStatusBadge({ status }: { status: LoadStatus }) {
  const meta = LOAD_STATUS[status];
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
