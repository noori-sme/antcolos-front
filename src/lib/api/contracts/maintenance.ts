import type { Paginated } from "@/types/fleet-truck";
import type {
  CompleteTaskInput, MaintenanceSchedule, MaintenanceTask, MaintenanceTaskFilters,
  MeterReading, MyTruckMaintenance, ReadingInput, ScheduleInput, TruckMaintenance,
} from "@/types/maintenance-live";
import type { ServiceContext } from "./context";

/**
 * Truck maintenance on the NestJS API (backend plan 48,
 * ../antcolos/docs/requirements/maintenance-api-contract.md). http-only, like
 * trucks. Writes the contract marks idempotent take an `idempotencyKey`: one
 * per user intent, reused on retry.
 */
export interface MaintenanceService {
  /** `maintenance.read` */
  forTruck(ctx: ServiceContext, truckId: string): Promise<TruckMaintenance>;
  /** `maintenance.manage` */
  createSchedule(ctx: ServiceContext, truckId: string, input: ScheduleInput, idempotencyKey: string): Promise<MaintenanceSchedule>;
  /** `maintenance.manage`; naturally idempotent (PATCH). */
  updateSchedule(ctx: ServiceContext, scheduleId: string, input: ScheduleInput): Promise<MaintenanceSchedule>;
  /** `maintenance.manage`; cancels the open task. */
  archiveSchedule(ctx: ServiceContext, scheduleId: string, idempotencyKey: string): Promise<MaintenanceSchedule>;
  /** `maintenance.record_reading` */
  recordReading(ctx: ServiceContext, truckId: string, input: ReadingInput, idempotencyKey: string): Promise<MeterReading>;
  /** `maintenance.read`; open work first. */
  listTasks(ctx: ServiceContext, filters: MaintenanceTaskFilters): Promise<Paginated<MaintenanceTask>>;
  /** `maintenance.manage` */
  acknowledgeTask(ctx: ServiceContext, taskId: string, idempotencyKey: string): Promise<MaintenanceTask>;
  /** `maintenance.manage`; `deferredUntil` in the future, at most 90 days out. */
  deferTask(ctx: ServiceContext, taskId: string, input: { reason: string; deferredUntil: string }, idempotencyKey: string): Promise<MaintenanceTask>;
  /** `maintenance.manage` */
  completeTask(ctx: ServiceContext, taskId: string, input: CompleteTaskInput, idempotencyKey: string): Promise<MaintenanceTask>;
  /** `maintenance.read_own`; `null` when the caller drives no truck here (404 NO_CURRENT_TRUCK). */
  myTruck(ctx: ServiceContext): Promise<MyTruckMaintenance | null>;
  /** `maintenance.update_own` */
  recordMyReading(ctx: ServiceContext, input: ReadingInput, idempotencyKey: string): Promise<MeterReading>;
  /** `maintenance.update_own` */
  acknowledgeMyTask(ctx: ServiceContext, taskId: string, idempotencyKey: string): Promise<MaintenanceTask>;
}
