import type { RateConDocument, RateConDocumentStatus } from "@/types/rate-con-intake";

/** What the screen calls a Rate Con: its document status, or that the read failed. */
export type RateConDisplayStatus = RateConDocumentStatus | "read_failed";

/**
 * A failed read leaves the document RECEIVED, which on its own reads as
 * "still reading". When the latest run failed and no fields exist yet, say so.
 */
export function rateConDisplayStatus(
  document: Pick<RateConDocument, "status" | "latestRun">,
): RateConDisplayStatus {
  if (document.status === "received" && document.latestRun?.status === "failed") return "read_failed";
  return document.status;
}
