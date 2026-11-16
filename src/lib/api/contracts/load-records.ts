import type {
  CancelLoadInput, DriverAnswer, LoadRecord, LoadRecordPage, LoadRecordQuery, LoadRecordStatus,
  LoadTimelinePage,
} from "@/types/load-record";
import type { ServiceContext } from "./context";

/**
 * Booked loads on the real API (F1.2, plan 14):
 * ../antcolos/docs/requirements/loads-api-contract.md. The tenant comes from
 * the JWT; `ctx` scopes the cache, not the request. Idempotent routes take one
 * key per user intent, reused when that intent is retried.
 */
export interface LoadRecordsService {
  /** §2 This organization's loads. */
  list(ctx: ServiceContext, query: LoadRecordQuery): Promise<LoadRecordPage>;
  /** §3 One load with its stops and allowed transitions. */
  get(ctx: ServiceContext, loadId: string): Promise<LoadRecord>;
  /** §8 What happened to the load, oldest first. */
  timeline(ctx: ServiceContext, loadId: string, page: number): Promise<LoadTimelinePage>;
  /** §6 One step along the trip; `to` must be in allowedTransitions. */
  transition(
    ctx: ServiceContext,
    loadId: string,
    to: LoadRecordStatus,
    idempotencyKey: string,
  ): Promise<LoadRecord>;
  /** §5 Cancel before the freight is loaded. */
  cancel(
    ctx: ServiceContext,
    loadId: string,
    input: CancelLoadInput,
    idempotencyKey: string,
  ): Promise<LoadRecord>;
  /** §7 Audited correction back to an earlier state. */
  correctStatus(
    ctx: ServiceContext,
    loadId: string,
    to: LoadRecordStatus,
    reason: string,
    idempotencyKey: string,
  ): Promise<LoadRecord>;
  /** §9 Book a truck before the trip starts. */
  bookTruck(ctx: ServiceContext, loadId: string, truckId: string, idempotencyKey: string): Promise<LoadRecord>;
  /** §9 Take the truck off before the trip starts. */
  unbookTruck(ctx: ServiceContext, loadId: string, idempotencyKey: string): Promise<LoadRecord>;
  /** §10 Assign a driver (an active member with the Driver role). */
  assignDriver(ctx: ServiceContext, loadId: string, userId: string, idempotencyKey: string): Promise<LoadRecord>;
  /** §10 Take the driver off. */
  unassignDriver(ctx: ServiceContext, loadId: string, idempotencyKey: string): Promise<LoadRecord>;
  /** §10 Record that the driver accepted. */
  acceptForDriver(ctx: ServiceContext, loadId: string, idempotencyKey: string): Promise<DriverAnswer>;
  /** §10 Record that the driver turned the load down; they come off it. */
  rejectForDriver(ctx: ServiceContext, loadId: string, reason: string, idempotencyKey: string): Promise<DriverAnswer>;
}
