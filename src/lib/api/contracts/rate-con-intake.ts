import type {
  ApprovalResult, DocumentReview, LoadDraftView, RateConDocument, ReviewDecision,
  SignedFileUrl,
} from "@/types/rate-con-intake";
import type { ServiceContext } from "./context";

/**
 * Rate Con intake on the real API (F1.1, plan 13):
 * ../antcolos/docs/requirements/documents-api-contract.md. Every route needs
 * `document.review`; approve also `load.create` (`load.update` for an update).
 * The tenant comes from the JWT; `ctx` scopes the cache, not the request.
 *
 * Idempotent routes take an `idempotencyKey`: one key per user intent, reused
 * when the same intent is retried.
 */
export interface RateConIntakeService {
  /** §1 Upload; extraction is queued (202). */
  upload(ctx: ServiceContext, file: File, idempotencyKey: string): Promise<RateConDocument>;
  /** §2 Status, file and latest run. Poll while the run is pending or running. */
  get(ctx: ServiceContext, documentId: string): Promise<RateConDocument>;
  /** §4 Short-lived signed URL for the original. */
  fileUrl(ctx: ServiceContext, documentId: string): Promise<SignedFileUrl>;
  /** §5 Retry after a FAILED or PARTIAL run. */
  retryExtraction(ctx: ServiceContext, documentId: string, idempotencyKey: string): Promise<RateConDocument>;
  /** §6 Fields in review order with tiers, corrections and counts. */
  review(ctx: ServiceContext, documentId: string): Promise<DocumentReview>;
  /** §7 Confirm or correct fields, all or nothing. */
  decide(
    ctx: ServiceContext,
    documentId: string,
    decisions: ReviewDecision[],
    idempotencyKey: string,
  ): Promise<DocumentReview>;
  /** §8 EXTRACTED → REVIEWED. */
  completeReview(ctx: ServiceContext, documentId: string, idempotencyKey: string): Promise<RateConDocument>;
  /** §9 What approval would write. */
  loadDraft(ctx: ServiceContext, documentId: string): Promise<LoadDraftView>;
  /** §10 Create or update the load; the document becomes ACCEPTED. */
  approve(ctx: ServiceContext, documentId: string, idempotencyKey: string): Promise<ApprovalResult>;
}
