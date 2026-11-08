import { apiClient } from "../client";
import type { TrucksService } from "../contracts/trucks";
import { type Dto, nullableStr, num, obj, oneOf, queryParams, str, toPage } from "./dto";
import {
  TRUCK_ASSIGNMENT_STATUSES, TRUCK_ASSIGNMENT_TYPES,
  TRUCK_CAB_TYPES, TRUCK_DISPATCHER_COVERAGES, TRUCK_EQUIPMENT_TYPES, TRUCK_FUEL_TYPES,
  TRUCK_OPERATIONAL_STATUSES, TRUCK_OWNER_TYPES, TRUCK_OWNERSHIP_TYPES,
  TRUCK_VERIFICATION_STATUSES,
  type FleetTruck, type Paginated, type TruckAssignment, type TruckAssignmentRow,
  type TruckLegalOwner, type TruckListFilters, type TruckLookup, type TruckOperating,
  type TruckOperatingRow, type TruckOperationalStatus, type TruckOwnershipRow,
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

/** §1b → `TruckLookup`. Missing flags read as false. */
export function toTruckLookup(dto: Dto): TruckLookup {
  return {
    id: str(dto.id) ?? "",
    vin: str(dto.vin) ?? "",
    year: num(dto.year),
    make: str(dto.make),
    model: str(dto.model),
    color: str(dto.color),
    equipmentType: oneOf(TRUCK_EQUIPMENT_TYPES, dto.equipmentType),
    licensePlate: str(dto.licensePlate),
    licensePlateState: str(dto.licensePlateState),
    alreadyOnFleet: dto.alreadyOnFleet === true,
    archived: dto.archived === true,
    unitNumber: str(dto.unitNumber),
  };
}

/** §Assignment row → `TruckAssignmentRow`. */
export function toTruckAssignmentRow(dto: Dto): TruckAssignmentRow {
  return {
    id: str(dto.id) ?? "",
    truckId: str(dto.truckId) ?? "",
    userId: str(dto.userId) ?? "",
    userName: str(dto.userName) ?? "",
    type: oneOf(TRUCK_ASSIGNMENT_TYPES, dto.type),
    coverage: oneOf(TRUCK_DISPATCHER_COVERAGES, dto.coverage),
    status: oneOf(TRUCK_ASSIGNMENT_STATUSES, dto.status),
    startAt: str(dto.startAt),
    endAt: nullableStr(dto.endAt) ?? null,
    assignedByUserId: str(dto.assignedByUserId),
    endedByUserId: nullableStr(dto.endedByUserId) ?? null,
    replacedByAssignmentId: nullableStr(dto.replacedByAssignmentId) ?? null,
    createdAt: str(dto.createdAt),
  };
}

/** §12 ownership row → `TruckOwnershipRow`. */
export function toTruckOwnershipRow(dto: Dto): TruckOwnershipRow {
  return {
    ...toTruckLegalOwner(dto),
    id: str(dto.id) ?? "",
    truckId: str(dto.truckId),
    createdByUserId: str(dto.createdByUserId),
    endedByUserId: nullableStr(dto.endedByUserId) ?? null,
  };
}

/** §11 operating row → `TruckOperatingRow`. */
export function toTruckOperatingRow(dto: Dto): TruckOperatingRow {
  return {
    ...toTruckOperating(dto),
    id: str(dto.id) ?? "",
    truckId: str(dto.truckId),
    createdByUserId: str(dto.createdByUserId),
    endedByUserId: nullableStr(dto.endedByUserId) ?? null,
  };
}

const STATUS_PATH: Record<TruckOperationalStatus, string> = {
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
  MAINTENANCE: "maintenance",
};

const truckPath = (truckId: string) => `/trucks/${encodeURIComponent(truckId)}`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
/** Truck responses are unwrapped; tolerate a `{ data }` envelope too. */
const unwrap = (data: unknown): Dto => {
  const body = obj(data);
  return obj(body?.data) ?? body ?? {};
};

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
  async lookupByVin(_ctx, vin) {
    // An unknown VIN is a 404, which is an answer here, not an error.
    const res = await apiClient.get("/trucks/lookup", {
      params: { vin },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    return res.status === 404 ? null : toTruckLookup(unwrap(res.data));
  },
  async create(_ctx, input, idempotencyKey) {
    const res = await apiClient.post("/trucks", input, idempotent(idempotencyKey));
    return toTruck(unwrap(res.data));
  },
  async update(_ctx, truckId, input) {
    const res = await apiClient.patch(truckPath(truckId), input);
    return toTruck(unwrap(res.data));
  },
  async archive(_ctx, truckId) {
    await apiClient.delete(truckPath(truckId));
  },
  async setStatus(_ctx, truckId, status, reason, idempotencyKey) {
    const res = await apiClient.post(
      `${truckPath(truckId)}/${STATUS_PATH[status]}`,
      reason ? { reason } : {},
      idempotent(idempotencyKey),
    );
    return toTruck(unwrap(res.data));
  },
  async endOperating(_ctx, truckId, operatingId, idempotencyKey) {
    const res = await apiClient.post(
      `${truckPath(truckId)}/operating-carriers/${encodeURIComponent(operatingId)}/end`,
      {},
      idempotent(idempotencyKey),
    );
    return toTruckOperatingRow(unwrap(res.data));
  },
  async replaceOwnership(_ctx, truckId, ownershipId, input, idempotencyKey) {
    const res = await apiClient.post(
      `${truckPath(truckId)}/ownership/${encodeURIComponent(ownershipId)}/replace`,
      input,
      idempotent(idempotencyKey),
    );
    return toTruckOwnershipRow(unwrap(res.data));
  },
  async assign(_ctx, truckId, input, idempotencyKey) {
    const body = input.type === "DRIVER" ? { userId: input.userId, type: input.type } : input;
    const res = await apiClient.post(
      `${truckPath(truckId)}/assignments`,
      body,
      idempotent(idempotencyKey),
    );
    return toTruckAssignmentRow(unwrap(res.data));
  },
  async replaceAssignment(_ctx, truckId, assignmentId, input, idempotencyKey) {
    const res = await apiClient.post(
      `${truckPath(truckId)}/assignments/${encodeURIComponent(assignmentId)}/replace`,
      input,
      idempotent(idempotencyKey),
    );
    return toTruckAssignmentRow(unwrap(res.data));
  },
  async removeAssignment(_ctx, truckId, assignmentId, idempotencyKey) {
    const res = await apiClient.post(
      `${truckPath(truckId)}/assignments/${encodeURIComponent(assignmentId)}/remove`,
      {},
      idempotent(idempotencyKey),
    );
    return toTruckAssignmentRow(unwrap(res.data));
  },
};
