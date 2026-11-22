import type { Paginated } from "@/types/fleet-truck";
import type { AvailabilityQuery, TruckAvailability } from "@/types/fleet-availability";
import type { ServiceContext } from "./context";

/**
 * Truck availability on the real API (F2.5, backend plan 47): one row per truck this
 * organization operates, soonest empty first. Read-only; needs trucks:view (truck.read).
 */
export interface FleetAvailabilityService {
  list(ctx: ServiceContext, query: AvailabilityQuery): Promise<Paginated<TruckAvailability>>;
}
