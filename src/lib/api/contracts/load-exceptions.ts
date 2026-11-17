import type {
  LoadException, LoadExceptionPage, ReportExceptionInput, ResolveExceptionInput,
} from "@/types/load-exception";
import type { ServiceContext } from "./context";

/**
 * Exceptions on a load (F1.5): ../antcolos/docs/requirements/loads-api-contract.md §14.
 * Idempotent routes take one key per user intent.
 */
export interface LoadExceptionsService {
  /** A load's exceptions, newest first (load.read). */
  listForLoad(ctx: ServiceContext, loadId: string): Promise<LoadException[]>;
  /** The organization's open and acknowledged exceptions (load.read). */
  listOpen(ctx: ServiceContext, page: number): Promise<LoadExceptionPage>;
  /** Report one: the load's driver (load.respond) or a dispatcher (load.update). */
  report(
    ctx: ServiceContext,
    loadId: string,
    input: ReportExceptionInput,
    idempotencyKey: string,
  ): Promise<LoadException>;
  /** OPEN → ACKNOWLEDGED, owned by the caller (load.update). */
  acknowledge(ctx: ServiceContext, loadId: string, exceptionId: string, idempotencyKey: string): Promise<LoadException>;
  /** → RESOLVED with a resolution and an optional cost (load.update). */
  resolve(
    ctx: ServiceContext,
    loadId: string,
    exceptionId: string,
    input: ResolveExceptionInput,
    idempotencyKey: string,
  ): Promise<LoadException>;
}
