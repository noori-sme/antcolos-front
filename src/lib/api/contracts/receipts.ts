import type { Paginated } from "@/types/common";
import type {
  ConfirmReceiptInput, Receipt, ReceiptDetail, ReceiptFilters, UploadReceiptInput, UploadReceiptResult,
} from "@/types/receipt";
import type { ServiceContext } from "./context";

/**
 * Receipts on the real API (F2.1, backend plan 50):
 * ../antcolos/docs/requirements/receipts-api-contract.md. http-only.
 * Upload, confirm and reject take one Idempotency-Key per intent.
 * What a caller sees is decided by the backend: with only read_own,
 * the list and the detail are the caller's own receipts.
 */
export interface ReceiptsService {
  /** POST /receipts (multipart). */
  upload(ctx: ServiceContext, input: UploadReceiptInput, idempotencyKey: string): Promise<UploadReceiptResult>;
  /** GET /receipts, newest first. */
  list(ctx: ServiceContext, filters: ReceiptFilters): Promise<Paginated<Receipt>>;
  /** GET /receipts/:id, with what was read and why it waits for a person. */
  get(ctx: ServiceContext, id: string): Promise<ReceiptDetail>;
  /** POST /receipts/:id/confirm with optional corrections. */
  confirm(ctx: ServiceContext, id: string, input: ConfirmReceiptInput, idempotencyKey: string): Promise<Receipt>;
  /** POST /receipts/:id/reject with a reason. */
  reject(ctx: ServiceContext, id: string, reason: string, idempotencyKey: string): Promise<Receipt>;
}
