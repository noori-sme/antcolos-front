import { apiClient } from "../client";
import type { FleetAvailabilityService } from "../contracts/fleet-availability";
import { type Dto, oneOf, queryParams, str, toPage } from "./dto";
import { TRUCK_EQUIPMENT_TYPES, TRUCK_OPERATIONAL_STATUSES } from "@/types/fleet-truck";
import { AVAILABILITY_BUCKETS, type TruckAvailability } from "@/types/fleet-availability";

const text = (v: unknown): string | null => str(v) ?? null;

/** One row of GET /fleet/availability; an unknown bucket reads as UNKNOWN, never dropped. */
export function toTruckAvailability(dto: Dto): TruckAvailability {
  return {
    truckId: str(dto.truckId) ?? "",
    unitNumber: text(dto.unitNumber),
    equipmentType: oneOf(TRUCK_EQUIPMENT_TYPES, dto.equipmentType),
    operationalStatus: oneOf(TRUCK_OPERATIONAL_STATUSES, dto.operationalStatus),
    bucket: oneOf(AVAILABILITY_BUCKETS, dto.bucket) ?? "UNKNOWN",
    estimatedEmptyAt: text(dto.estimatedEmptyAt),
    emptyCity: text(dto.emptyCity),
    emptyState: text(dto.emptyState),
    activeLoadId: text(dto.activeLoadId),
  };
}

export const httpFleetAvailabilityService: FleetAvailabilityService = {
  async list(_ctx, query) {
    const res = await apiClient.get("/fleet/availability", { params: queryParams({ ...query }) });
    return toPage(res.data, toTruckAvailability);
  },
};
