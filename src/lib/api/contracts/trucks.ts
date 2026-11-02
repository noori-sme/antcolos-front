import type { FleetTruck, Paginated, TruckListFilters } from "@/types/fleet-truck";
import type { ServiceContext } from "./context";

/**
 * The real truck registry (NestJS `/trucks`,
 * ../antcolos/docs/requirements/fleet-api-contract.md). Permission `truck.read`.
 *
 * Not to be confused with `FleetService`, the in-memory operational layer.
 * The tenant comes from the JWT; `ctx` scopes the cache, not the request.
 */
export interface TrucksService {
  /** §2 List trucks. */
  list(ctx: ServiceContext, filters: TruckListFilters): Promise<Paginated<FleetTruck>>;
  /** §3 Get truck. Unknown, or no relationship with this org, rejects (404). */
  get(ctx: ServiceContext, truckId: string): Promise<FleetTruck>;
}
