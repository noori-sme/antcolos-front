import type {
  AssignTruckInput, CreateTruckInput, FleetTruck, Paginated, ReplaceAssignmentInput,
  ReplaceOwnershipInput, TruckAssignmentRow, TruckListFilters, TruckLookup,
  TruckOperatingRow, TruckOperationalStatus, TruckOwnershipRow, UpdateTruckInput,
} from "@/types/fleet-truck";
import type { ServiceContext } from "./context";

/**
 * The real truck registry (NestJS `/trucks`,
 * ../antcolos/docs/requirements/fleet-api-contract.md). Reads need `truck.read`;
 * writes need `truck.create` / `truck.update` / `truck.delete` as noted.
 *
 * Not to be confused with `FleetService`, the in-memory operational layer.
 * The tenant comes from the JWT; `ctx` scopes the cache, not the request.
 *
 * Methods the contract marks idempotent take an `idempotencyKey`: one key per
 * user intent, reused when the same submit is retried.
 */
export interface TrucksService {
  /** §2 List trucks. */
  list(ctx: ServiceContext, filters: TruckListFilters): Promise<Paginated<FleetTruck>>;
  /** §3 Get truck. Unknown, or no relationship with this org, rejects (404). */
  get(ctx: ServiceContext, truckId: string): Promise<FleetTruck>;
  /** §1b Physical identity by VIN; `null` when the VIN is unknown (404). */
  lookupByVin(ctx: ServiceContext, vin: string): Promise<TruckLookup | null>;
  /** §1 Create (unknown VIN) or attach (known VIN). `truck.create`. */
  create(ctx: ServiceContext, input: CreateTruckInput, idempotencyKey: string): Promise<FleetTruck>;
  /** §4 Partial update. `truck.update`; identity fields need the legal owner. */
  update(ctx: ServiceContext, truckId: string, input: UpdateTruckInput): Promise<FleetTruck>;
  /** §5 Archive. `truck.delete` and the legal owner. */
  archive(ctx: ServiceContext, truckId: string): Promise<void>;
  /** §6 This organization's status → `status`. `truck.update`. */
  setStatus(
    ctx: ServiceContext,
    truckId: string,
    status: TruckOperationalStatus,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<FleetTruck>;
  /** §11 Leave this organization's fleet list. `truck.update`. */
  endOperating(
    ctx: ServiceContext,
    truckId: string,
    operatingId: string,
    idempotencyKey: string,
  ): Promise<TruckOperatingRow>;
  /** §12 Hand off legal ownership. `truck.update` and the current owner. */
  replaceOwnership(
    ctx: ServiceContext,
    truckId: string,
    ownershipId: string,
    input: ReplaceOwnershipInput,
    idempotencyKey: string,
  ): Promise<TruckOwnershipRow>;
  /** §8 Assign a driver or dispatcher. `truck.update`. */
  assign(
    ctx: ServiceContext,
    truckId: string,
    input: AssignTruckInput,
    idempotencyKey: string,
  ): Promise<TruckAssignmentRow>;
  /** §9 Replace a current assignment; returns the new row. `truck.update`. */
  replaceAssignment(
    ctx: ServiceContext,
    truckId: string,
    assignmentId: string,
    input: ReplaceAssignmentInput,
    idempotencyKey: string,
  ): Promise<TruckAssignmentRow>;
  /** §10 Remove a current assignment; returns the closed row. `truck.update`. */
  removeAssignment(
    ctx: ServiceContext,
    truckId: string,
    assignmentId: string,
    idempotencyKey: string,
  ): Promise<TruckAssignmentRow>;
}
