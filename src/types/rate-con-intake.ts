/**
 * Rate Con intake (F1.1): a stored Rate Confirmation, its reviewed fields and
 * the load it is approved into. Mirrors
 * ../antcolos/docs/requirements/documents-api-contract.md §1–§10; enum values
 * are lower case here and mapped explicitly in the http adapter.
 */

export type RateConDocumentStatus =
  | "expected"
  | "received"
  | "extracted"
  | "reviewed"
  | "accepted";

export type ExtractionRunStatus = "pending" | "running" | "succeeded" | "partial" | "failed";

export interface ExtractionRun {
  id: string;
  attempt: number;
  status: ExtractionRunStatus;
  provider: string | null;
  model: string | null;
  /** Why a run failed, e.g. `OCR_TIMEOUT`. */
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RateConDocument {
  id: string;
  status: RateConDocumentStatus;
  version: number;
  /** Set once the Rate Con is approved into a load. */
  loadId: string | null;
  receivedAt: string;
  file: { id: string; filename: string; mimeType: string; sizeBytes: number | null };
  latestRun: ExtractionRun | null;
}

export interface SignedFileUrl {
  url: string;
  expiresAt: string;
}

export type RiskTier = "high" | "medium" | "low";
export type FieldReviewStatus = "unreviewed" | "confirmed" | "corrected";

/** Fractions of the page (0–1), origin top-left. */
export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldCorrection {
  id: string;
  value: string | null;
  correctedByUserId: string;
  correctedAt: string;
}

export interface ReviewField {
  id: string;
  /** Dotted schema path, e.g. `pickups.0.address.city`. */
  path: string;
  tier: RiskTier;
  requiresConfirmation: boolean;
  reviewStatus: FieldReviewStatus;
  predictedValue: string | null;
  /** The latest correction's value, else the prediction. */
  currentValue: string | null;
  correction: FieldCorrection | null;
  confidence: number | null;
  /** 1-based; null when the value was not located. */
  page: number | null;
  box: FieldBox | null;
}

export interface TierCounts {
  total: number;
  unreviewed: number;
  confirmed: number;
  corrected: number;
}

export interface DocumentReview {
  documentId: string;
  documentStatus: RateConDocumentStatus;
  /** Null while no run has finished. */
  extractionId: string | null;
  summary: {
    high: TierCounts;
    medium: TierCounts;
    low: TierCounts;
    highRiskPending: number;
    canComplete: boolean;
  };
  /** In the server's review order; never re-sort. */
  fields: ReviewField[];
}

export type ReviewDecision =
  | { fieldId: string; action: "confirm" }
  | { fieldId: string; action: "correct"; value: string | null };

export interface LoadDraftStop {
  type: "pickup" | "delivery";
  facilityName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string | null;
  /** Local date `YYYY-MM-DD`. */
  scheduledDate: string | null;
  /** UTC instants; show in `timezone`. */
  windowStart: string | null;
  windowEnd: string | null;
}

export interface LoadDraft {
  brokerName: string | null;
  brokerMcNumber: string | null;
  brokerPhone: string | null;
  brokerEmail: string | null;
  brokerLoadNumber: string | null;
  /** Backend enum value, e.g. `DRY_VAN`. */
  equipmentType: string | null;
  weightLbs: number | null;
  commodity: string | null;
  rateTotal: string | null;
  referenceNumbers: string[];
  specialInstructions: string | null;
  stops: LoadDraftStop[];
}

export interface MissingValue {
  /** Draft field, e.g. `stops[1].state`. */
  field: string;
  /** Rate Con paths to correct in the review; empty when there is none. */
  paths: string[];
  required: boolean;
}

export type ApprovalAction = "create" | "update";

export interface LoadDraftView {
  documentId: string;
  documentStatus: RateConDocumentStatus;
  extractionId: string | null;
  action: ApprovalAction;
  matchedLoadId: string | null;
  draft: LoadDraft | null;
  warnings: string[];
  missing: MissingValue[];
  problems: string[];
  canApprove: boolean;
}

export interface ApprovalResult {
  action: ApprovalAction;
  document: RateConDocument;
  loadId: string;
}
