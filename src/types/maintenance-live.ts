/**
 * Truck maintenance as the NestJS API returns it (backend plan 48,
 * ../antcolos/docs/requirements/maintenance-api-contract.md). Not the mock
 * maintenance types in `fleet-operations.ts`, which model defects, repair
 * orders and trailers for the demo area.
 */

export const MAINTENANCE_CATEGORIES = [
  "OIL_CHANGE", "PREVENTIVE_SERVICE", "INSPECTION", "TIRES", "BRAKES", "OTHER",
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const DUE_STATUSES = ["OK", "DUE_SOON", "OVERDUE", "UNKNOWN"] as const;
export type DueStatus = (typeof DUE_STATUSES)[number];

export const MAINTENANCE_TASK_STATUSES = [
  "OPEN", "ACKNOWLEDGED", "DEFERRED", "COMPLETED", "CANCELLED",
] as const;
export type MaintenanceTaskStatus = (typeof MAINTENANCE_TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES: readonly MaintenanceTaskStatus[] = ["OPEN", "ACKNOWLEDGED", "DEFERRED"];

export interface LatestReading {
  odometerMiles: number | null;
  odometerReadAt: string | null;
  engineHours: number | null;
  engineHoursReadAt: string | null;
}

export interface MeterReading {
  id: string;
  truckId: string;
  odometerMiles: number | null;
  engineHours: number | null;
  readAt: string;
  source: string;
}

export interface ScheduleDue {
  status: DueStatus;
  nextDueAt: string | null;
  daysLeft: number | null;
  nextDueOdometerMiles: number | null;
  milesLeft: number | null;
  nextDueEngineHours: number | null;
  engineHoursLeft: number | null;
}

export interface MaintenanceSchedule {
  id: string;
  truckId: string;
  title: string;
  /** A category this build does not know keeps its raw value. */
  category: MaintenanceCategory | string;
  everyDays: number | null;
  everyMiles: number | null;
  everyEngineHours: number | null;
  warnDays: number | null;
  warnMiles: number | null;
  warnEngineHours: number | null;
  lastServiceAt: string;
  lastServiceOdometerMiles: number | null;
  lastServiceEngineHours: number | null;
  cycle: number;
  archivedAt: string | null;
  due: ScheduleDue;
  openTask: { id: string; status: MaintenanceTaskStatus | string } | null;
}

export interface MaintenanceTask {
  id: string;
  scheduleId: string;
  truckId: string;
  unitNumber: string | null;
  title: string;
  category: MaintenanceCategory | string;
  cycle: number;
  status: MaintenanceTaskStatus | string;
  dueAt: string | null;
  dueOdometerMiles: number | null;
  dueEngineHours: number | null;
  openedAt: string;
  acknowledgedAt: string | null;
  deferredUntil: string | null;
  deferReason: string | null;
  completedAt: string | null;
  completedOdometerMiles: number | null;
  completedEngineHours: number | null;
  completionNote: string | null;
}

export interface TruckMaintenance {
  truckId: string;
  latestReading: LatestReading;
  schedules: MaintenanceSchedule[];
}

export interface MyTruckMaintenance extends TruckMaintenance {
  unitNumber: string | null;
  openTasks: MaintenanceTask[];
}

export interface ScheduleInput {
  title?: string;
  category?: MaintenanceCategory;
  everyDays?: number | null;
  everyMiles?: number | null;
  everyEngineHours?: number | null;
  warnDays?: number | null;
  warnMiles?: number | null;
  warnEngineHours?: number | null;
  lastServiceAt?: string;
  lastServiceOdometerMiles?: number | null;
  lastServiceEngineHours?: number | null;
}

export interface ReadingInput {
  odometerMiles?: number;
  engineHours?: number;
}

export interface CompleteTaskInput {
  completedAt?: string;
  odometerMiles?: number;
  engineHours?: number;
  note?: string;
}

export interface MaintenanceTaskFilters {
  status?: readonly MaintenanceTaskStatus[];
  page: number;
  pageSize: number;
}
