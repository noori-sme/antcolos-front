import type {
  DriverLoad, DriverLoadPage, LoadDocument, RecordMilestoneInput, UploadLoadDocumentInput,
} from "@/types/driver-load";
import type { DriverAnswer } from "@/types/load-record";
import type { ServiceContext } from "./context";

/**
 * The driver's own loads on the real API (F1.4, plan 16):
 * ../antcolos/docs/requirements/loads-api-contract.md §10–§13. http-only.
 * Every write sends source mobile_web and one Idempotency-Key per intent.
 */
export interface DriverLoadsService {
  /** §12 The caller's active loads, earliest pickup first. */
  list(ctx: ServiceContext, page: number): Promise<DriverLoadPage>;
  /** §12 One of the caller's loads with its next milestones. */
  get(ctx: ServiceContext, loadId: string): Promise<DriverLoad>;
  /** §11 Record a milestone; returns the load as it is now. */
  recordMilestone(
    ctx: ServiceContext,
    loadId: string,
    input: RecordMilestoneInput,
    idempotencyKey: string,
  ): Promise<DriverLoad>;
  /** §13 Upload a BOL or POD for a stop. */
  uploadDocument(
    ctx: ServiceContext,
    loadId: string,
    input: UploadLoadDocumentInput,
    idempotencyKey: string,
  ): Promise<LoadDocument>;
  /** §10 Accept the load. */
  accept(ctx: ServiceContext, loadId: string, idempotencyKey: string): Promise<DriverAnswer>;
  /** §10 Turn the load down; the driver comes off it. */
  reject(ctx: ServiceContext, loadId: string, reason: string, idempotencyKey: string): Promise<DriverAnswer>;
}
