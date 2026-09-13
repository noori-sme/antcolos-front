import { Badge } from "@/components/ui/badge";
import { DRIVER_STATUS, LOAD_STATUS, TRUCK_STATUS } from "@/config/statuses";
import type { DriverStatus, LoadStatus, TruckStatus } from "@/types";

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
