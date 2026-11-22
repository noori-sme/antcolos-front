import { apiClient } from "../client";
import type { MaintenanceService } from "../contracts/maintenance";
import { type Dto, nullableStr, num, obj, objects, oneOf, str, toPage } from "./dto";
import {
  DUE_STATUSES, MAINTENANCE_CATEGORIES, MAINTENANCE_TASK_STATUSES,
  type LatestReading, type MaintenanceSchedule, type MaintenanceTask, type MeterReading,
  type MyTruckMaintenance, type ScheduleDue, type TruckMaintenance,
} from "@/types/maintenance-live";

const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
const id = (v: string) => encodeURIComponent(v);
const nn = (v: unknown): number | null => num(v) ?? null;
const ns = (v: unknown): string | null => nullableStr(v) ?? null;
/** Unknown enum values keep their raw string; the UI labels them through a fallback. */
const known = <T extends string>(list: readonly T[], v: unknown): T | string =>
  oneOf(list, v) ?? str(v) ?? "";

export function toLatestReading(dto: Dto | undefined): LatestReading {
  return {
    odometerMiles: nn(dto?.odometerMiles),
    odometerReadAt: ns(dto?.odometerReadAt),
    engineHours: nn(dto?.engineHours),
    engineHoursReadAt: ns(dto?.engineHoursReadAt),
  };
}

function toDue(dto: Dto | undefined): ScheduleDue {
  return {
    status: oneOf(DUE_STATUSES, dto?.status) ?? "UNKNOWN",
    nextDueAt: ns(dto?.nextDueAt),
    daysLeft: nn(dto?.daysLeft),
    nextDueOdometerMiles: nn(dto?.nextDueOdometerMiles),
    milesLeft: nn(dto?.milesLeft),
    nextDueEngineHours: nn(dto?.nextDueEngineHours),
    engineHoursLeft: nn(dto?.engineHoursLeft),
  };
}

export function toSchedule(dto: Dto): MaintenanceSchedule {
  const openTask = obj(dto.openTask);
  return {
    id: str(dto.id) ?? "",
    truckId: str(dto.truckId) ?? "",
    title: str(dto.title) ?? "",
    category: known(MAINTENANCE_CATEGORIES, dto.category),
    everyDays: nn(dto.everyDays),
    everyMiles: nn(dto.everyMiles),
    everyEngineHours: nn(dto.everyEngineHours),
    warnDays: nn(dto.warnDays),
    warnMiles: nn(dto.warnMiles),
    warnEngineHours: nn(dto.warnEngineHours),
    lastServiceAt: str(dto.lastServiceAt) ?? "",
    lastServiceOdometerMiles: nn(dto.lastServiceOdometerMiles),
    lastServiceEngineHours: nn(dto.lastServiceEngineHours),
    cycle: num(dto.cycle) ?? 1,
    archivedAt: ns(dto.archivedAt),
    due: toDue(obj(dto.due)),
    openTask: openTask
      ? { id: str(openTask.id) ?? "", status: known(MAINTENANCE_TASK_STATUSES, openTask.status) }
      : null,
  };
}

export function toTask(dto: Dto): MaintenanceTask {
  return {
    id: str(dto.id) ?? "",
    scheduleId: str(dto.scheduleId) ?? "",
    truckId: str(dto.truckId) ?? "",
    unitNumber: ns(dto.unitNumber),
    title: str(dto.title) ?? "",
    category: known(MAINTENANCE_CATEGORIES, dto.category),
    cycle: num(dto.cycle) ?? 1,
    status: known(MAINTENANCE_TASK_STATUSES, dto.status),
    dueAt: ns(dto.dueAt),
    dueOdometerMiles: nn(dto.dueOdometerMiles),
    dueEngineHours: nn(dto.dueEngineHours),
    openedAt: str(dto.openedAt) ?? "",
    acknowledgedAt: ns(dto.acknowledgedAt),
    deferredUntil: ns(dto.deferredUntil),
    deferReason: ns(dto.deferReason),
    completedAt: ns(dto.completedAt),
    completedOdometerMiles: nn(dto.completedOdometerMiles),
    completedEngineHours: nn(dto.completedEngineHours),
    completionNote: ns(dto.completionNote),
  };
}

export function toReading(dto: Dto): MeterReading {
  return {
    id: str(dto.id) ?? "",
    truckId: str(dto.truckId) ?? "",
    odometerMiles: nn(dto.odometerMiles),
    engineHours: nn(dto.engineHours),
    readAt: str(dto.readAt) ?? "",
    source: str(dto.source) ?? "",
  };
}

export function toTruckMaintenance(body: unknown): TruckMaintenance {
  const dto = obj(body) ?? {};
  return {
    truckId: str(dto.truckId) ?? "",
    latestReading: toLatestReading(obj(dto.latestReading)),
    schedules: objects(dto.schedules).map(toSchedule),
  };
}

export function toMyTruck(body: unknown): MyTruckMaintenance {
  const dto = obj(body) ?? {};
  return {
    ...toTruckMaintenance(dto),
    unitNumber: ns(dto.unitNumber),
    openTasks: objects(dto.openTasks).map(toTask),
  };
}

/** `status=OPEN&status=ACKNOWLEDGED`, the shape the API's repeatable param reads. */
export function taskQuery(filters: {
  status?: readonly string[];
  truckId?: string;
  page: number;
  pageSize: number;
}): URLSearchParams {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
  if (filters.truckId) params.set("truckId", filters.truckId);
  for (const status of filters.status ?? []) params.append("status", status);
  return params;
}

export const httpMaintenanceService: MaintenanceService = {
  async forTruck(_ctx, truckId) {
    const res = await apiClient.get(`/trucks/${id(truckId)}/maintenance`);
    return toTruckMaintenance(res.data);
  },
  async createSchedule(_ctx, truckId, input, key) {
    const res = await apiClient.post(`/trucks/${id(truckId)}/maintenance/schedules`, input, idempotent(key));
    return toSchedule(obj(res.data) ?? {});
  },
  async updateSchedule(_ctx, scheduleId, input) {
    const res = await apiClient.patch(`/maintenance/schedules/${id(scheduleId)}`, input);
    return toSchedule(obj(res.data) ?? {});
  },
  async archiveSchedule(_ctx, scheduleId, key) {
    const res = await apiClient.post(`/maintenance/schedules/${id(scheduleId)}/archive`, {}, idempotent(key));
    return toSchedule(obj(res.data) ?? {});
  },
  async recordReading(_ctx, truckId, input, key) {
    const res = await apiClient.post(`/trucks/${id(truckId)}/meter-readings`, input, idempotent(key));
    return toReading(obj(res.data) ?? {});
  },
  async listTasks(_ctx, filters) {
    const res = await apiClient.get("/maintenance/tasks", { params: taskQuery(filters) });
    return toPage(res.data, toTask);
  },
  async acknowledgeTask(_ctx, taskId, key) {
    const res = await apiClient.post(`/maintenance/tasks/${id(taskId)}/acknowledge`, {}, idempotent(key));
    return toTask(obj(res.data) ?? {});
  },
  async deferTask(_ctx, taskId, input, key) {
    const res = await apiClient.post(`/maintenance/tasks/${id(taskId)}/defer`, input, idempotent(key));
    return toTask(obj(res.data) ?? {});
  },
  async completeTask(_ctx, taskId, input, key) {
    const res = await apiClient.post(`/maintenance/tasks/${id(taskId)}/complete`, input, idempotent(key));
    return toTask(obj(res.data) ?? {});
  },
  async myTruck() {
    // Not driving a truck here (404 NO_CURRENT_TRUCK) is an answer, not an error.
    const res = await apiClient.get("/maintenance/my-truck", {
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    if (res.status !== 404) return toMyTruck(res.data);
    if (obj(res.data)?.error === "NO_CURRENT_TRUCK") return null;
    throw new Error(str(obj(res.data)?.message) ?? "Your truck's maintenance is not available");
  },
  async recordMyReading(_ctx, input, key) {
    const res = await apiClient.post("/maintenance/my-truck/meter-readings", input, idempotent(key));
    return toReading(obj(res.data) ?? {});
  },
  async acknowledgeMyTask(_ctx, taskId, key) {
    const res = await apiClient.post(`/maintenance/my-truck/tasks/${id(taskId)}/acknowledge`, {}, idempotent(key));
    return toTask(obj(res.data) ?? {});
  },
};
