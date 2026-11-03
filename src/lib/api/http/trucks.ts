import { apiClient } from "../client";
import type { TrucksService } from "../contracts/trucks";
import { type Dto, nullableStr, num, obj, oneOf, queryParams, str, toPage } from "./dto";
import {
  TRUCK_CAB_TYPES, TRUCK_DISPATCHER_COVERAGES, TRUCK_EQUIPMENT_TYPES, TRUCK_FUEL_TYPES,
  TRUCK_OPERATIONAL_STATUSES, TRUCK_OWNER_TYPES, TRUCK_OWNERSHIP_TYPES,
  TRUCK_VERIFICATION_STATUSES,
  type FleetTruck, type Paginated, type TruckAssignment, type TruckLegalOwner,
  type TruckListFilters, type TruckOperating,
} from "@/types/fleet-truck";

export function toTruckAssignment(dto: Dto): TruckAssignment | undefined {
  const assignmentId = str(dto.assignmentId);
  const userId = str(dto.userId);
  if (!assignmentId || !userId) return undefined;
  return {
    assignmentId,
    userId,
    name: str(dto.name) ?? "",
    startAt: str(dto.startAt),
    coverage: oneOf(TRUCK_DISPATCHER_COVERAGES, dto.coverage),
  };
}

export function toTruckLegalOwner(dto: Dto): TruckLegalOwner {
  return {
    ownershipId: str(dto.ownershipId),
    ownerType: oneOf(TRUCK_OWNER_TYPES, dto.ownerType),
    ownerOrganizationId: nullableStr(dto.ownerOrganizationId),
    ownerUserId: nullableStr(dto.ownerUserId),
    ownershipType: oneOf(TRUCK_OWNERSHIP_TYPES, dto.ownershipType),
    verificationStatus: oneOf(TRUCK_VERIFICATION_STATUSES, dto.verificationStatus),
    startAt: str(dto.startAt),
    endAt: nullableStr(dto.endAt),
  };
}

export function toTruckOperating(dto: Dto): TruckOperating {
  return {
    operatingId: str(dto.operatingId),
    organizationId: str(dto.organizationId),
    unitNumber: str(dto.unitNumber),
    homeTerminalCity: str(dto.homeTerminalCity),
    homeTerminalState: str(dto.homeTerminalState),
    notes: str(dto.notes),
    operationalStatus: oneOf(TRUCK_OPERATIONAL_STATUSES, dto.operationalStatus),
    verificationStatus: oneOf(TRUCK_VERIFICATION_STATUSES, dto.verificationStatus),
    startAt: str(dto.startAt),
    endAt: nullableStr(dto.endAt),
  };
}

/** Contract §Truck → canonical `FleetTruck`. */
export function toTruck(dto: Dto): FleetTruck {
  const legalOwner = obj(dto.legalOwner);
  const operating = obj(dto.operating);
  const driver = obj(dto.currentDriver);
  const dispatchers = Array.isArray(dto.currentDispatchers) ? dto.currentDispatchers : [];
  return {
    id: str(dto.id) ?? "",
    vin: str(dto.vin) ?? "",
    licensePlate: str(dto.licensePlate),
    licensePlateState: str(dto.licensePlateState),
    year: num(dto.year),
    make: str(dto.make),
    model: str(dto.model),
    color: str(dto.color),
    equipmentType: oneOf(TRUCK_EQUIPMENT_TYPES, dto.equipmentType),
    trailerLengthFt: num(dto.trailerLengthFt),
    trailerNumber: str(dto.trailerNumber),
    payloadLbs: num(dto.payloadLbs),
    gvwrLbs: num(dto.gvwrLbs),
    registrationExpiresAt: str(dto.registrationExpiresAt),
    insuranceExpiresAt: str(dto.insuranceExpiresAt),
    eldProvider: str(dto.eldProvider),
    eldDeviceId: str(dto.eldDeviceId),
    fuelType: oneOf(TRUCK_FUEL_TYPES, dto.fuelType),
    axleCount: num(dto.axleCount),
    cabType: oneOf(TRUCK_CAB_TYPES, dto.cabType),
    archivedAt: nullableStr(dto.archivedAt),
    legalOwner: legalOwner ? toTruckLegalOwner(legalOwner) : null,
    operating: operating ? toTruckOperating(operating) : null,
    unitNumber: str(dto.unitNumber),
    homeTerminalCity: str(dto.homeTerminalCity),
    homeTerminalState: str(dto.homeTerminalState),
    notes: str(dto.notes),
    ownershipType: oneOf(TRUCK_OWNERSHIP_TYPES, dto.ownershipType),
    operationalStatus: oneOf(TRUCK_OPERATIONAL_STATUSES, dto.operationalStatus),
    currentDriver: driver ? (toTruckAssignment(driver) ?? null) : null,
    currentDispatchers: dispatchers
      .map((d) => obj(d))
      .filter((d): d is Dto => Boolean(d))
      .map(toTruckAssignment)
      .filter((a): a is TruckAssignment => Boolean(a)),
    createdByUserId: str(dto.createdByUserId),
    updatedByUserId: str(dto.updatedByUserId),
    source: str(dto.source),
    createdAt: str(dto.createdAt),
    updatedAt: str(dto.updatedAt),
  };
}

export function toTruckPage(body: unknown): Paginated<FleetTruck> {
  return toPage(body, toTruck);
}

export const httpTrucksService: TrucksService = {
  async list(_ctx, filters) {
    const res = await apiClient.get("/trucks", { params: queryParams({ ...filters }) });
    return toTruckPage(res.data);
  },
  async get(_ctx, truckId) {
    const res = await apiClient.get(`/trucks/${encodeURIComponent(truckId)}`);
    // §3 returns the truck unwrapped; tolerate a `{ data }` envelope too.
    // A truck has no `data` key, so `data` can only be an envelope.
    const body = obj(res.data);
    return toTruck(obj(body?.data) ?? body ?? {});
  },
};
