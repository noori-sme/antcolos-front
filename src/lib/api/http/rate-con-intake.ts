import { apiClient, fileApiClient } from "../client";
import type { RateConIntakeService } from "../contracts/rate-con-intake";
import { type Dto, num, obj, objects, oneOf, str, strings } from "./dto";
import type {
  ApprovalAction, ApprovalResult, DocumentReview, ExtractionRun, ExtractionRunStatus,
  FieldBox, FieldReviewStatus, LoadDraft, LoadDraftStop, LoadDraftView, MissingValue,
  RateConDocument, RateConDocumentStatus, ReviewDecision, ReviewField, RiskTier, TierCounts,
} from "@/types/rate-con-intake";

/**
 * ../antcolos/docs/requirements/documents-api-contract.md (plans 20, 21, 26).
 * Every enum is mapped explicitly; an unknown value throws rather than guess.
 */

const DOCUMENT_STATUS: Record<string, RateConDocumentStatus> = {
  EXPECTED: "expected",
  RECEIVED: "received",
  EXTRACTED: "extracted",
  REVIEWED: "reviewed",
  ACCEPTED: "accepted",
};
const RUN_STATUS: Record<string, ExtractionRunStatus> = {
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  PARTIAL: "partial",
  FAILED: "failed",
};
const TIER: Record<string, RiskTier> = { HIGH: "high", MEDIUM: "medium", LOW: "low" };
const REVIEW_STATUS: Record<string, FieldReviewStatus> = {
  UNREVIEWED: "unreviewed",
  CONFIRMED: "confirmed",
  CORRECTED: "corrected",
};
const ACTION: Record<string, ApprovalAction> = { CREATE_LOAD: "create", UPDATE_LOAD: "update" };
const STOP_TYPE: Record<string, LoadDraftStop["type"]> = { PICKUP: "pickup", DELIVERY: "delivery" };

function mapped<T>(table: Record<string, T>, value: unknown, what: string): T {
  const key = oneOf(Object.keys(table), value);
  if (!key) throw new Error(`Unexpected ${what} from the API: ${String(value)}`);
  return table[key];
}

/** A string, or null (the API's "not on the document"). */
const text = (v: unknown): string | null => str(v) ?? null;
/** A field value: strings as they are; anything else the API stored, as JSON text. */
const value = (v: unknown): string | null =>
  typeof v === "string" ? v : v === null || v === undefined ? null : JSON.stringify(v);

function toRun(dto: Dto): ExtractionRun {
  return {
    id: str(dto.id) ?? "",
    attempt: num(dto.attempt) ?? 1,
    status: mapped(RUN_STATUS, dto.status, "extraction status"),
    provider: text(dto.provider),
    model: text(dto.model),
    errorCode: text(dto.errorCode),
    startedAt: text(dto.startedAt),
    finishedAt: text(dto.finishedAt),
  };
}

/** §2 → `RateConDocument`. */
export function toRateConDocument(dto: Dto): RateConDocument {
  const file = obj(dto.file) ?? {};
  const run = obj(dto.latestExtraction);
  return {
    id: str(dto.id) ?? "",
    status: mapped(DOCUMENT_STATUS, dto.status, "document status"),
    version: num(dto.version) ?? 1,
    loadId: text(dto.loadId),
    receivedAt: str(dto.receivedAt) ?? "",
    file: {
      id: str(file.id) ?? "",
      filename: str(file.filename) ?? "",
      mimeType: str(file.mimeType) ?? "",
      sizeBytes: num(file.sizeBytes) ?? null,
    },
    latestRun: run ? toRun(run) : null,
  };
}

function toBox(v: unknown): FieldBox | null {
  const box = obj(v);
  if (!box) return null;
  const [x, y, width, height] = [box.x, box.y, box.width, box.height].map(num);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? null
    : { x, y, width, height };
}

function toField(dto: Dto): ReviewField {
  const correction = obj(dto.correction);
  return {
    id: str(dto.id) ?? "",
    path: str(dto.path) ?? "",
    tier: mapped(TIER, dto.tier, "risk tier"),
    requiresConfirmation: dto.requiresConfirmation === true,
    reviewStatus: mapped(REVIEW_STATUS, dto.reviewStatus, "review status"),
    predictedValue: value(dto.predictedValue),
    currentValue: value(dto.currentValue),
    correction: correction
      ? {
          id: str(correction.id) ?? "",
          value: value(correction.value),
          correctedByUserId: str(correction.correctedByUserId) ?? "",
          correctedAt: str(correction.correctedAt) ?? "",
        }
      : null,
    confidence: num(dto.confidence) ?? null,
    page: num(dto.page) ?? null,
    box: toBox(dto.box),
  };
}

function toCounts(v: unknown): TierCounts {
  const dto = obj(v) ?? {};
  return {
    total: num(dto.total) ?? 0,
    unreviewed: num(dto.unreviewed) ?? 0,
    confirmed: num(dto.confirmed) ?? 0,
    corrected: num(dto.corrected) ?? 0,
  };
}

/** §6 → `DocumentReview`, fields in the server's order. */
export function toDocumentReview(dto: Dto): DocumentReview {
  const summary = obj(dto.summary) ?? {};
  return {
    documentId: str(dto.documentId) ?? "",
    documentStatus: mapped(DOCUMENT_STATUS, dto.documentStatus, "document status"),
    extractionId: text(dto.extractionId),
    summary: {
      high: toCounts(summary.high),
      medium: toCounts(summary.medium),
      low: toCounts(summary.low),
      highRiskPending: num(summary.highRiskPending) ?? 0,
      canComplete: summary.canComplete === true,
    },
    fields: objects(dto.fields).map(toField),
  };
}

/** `ReviewDecision[]` → the §7 body. */
export function toDecisionsBody(decisions: ReviewDecision[]): { decisions: Dto[] } {
  return {
    decisions: decisions.map((d) =>
      d.action === "confirm"
        ? { fieldId: d.fieldId, action: "CONFIRM" }
        : { fieldId: d.fieldId, action: "CORRECT", value: d.value },
    ),
  };
}

function toStop(dto: Dto): LoadDraftStop {
  return {
    type: mapped(STOP_TYPE, dto.type, "stop type"),
    facilityName: text(dto.facilityName),
    addressLine1: text(dto.addressLine1),
    city: text(dto.city),
    state: text(dto.state),
    postalCode: text(dto.postalCode),
    timezone: text(dto.timezone),
    scheduledDate: text(dto.scheduledDate),
    windowStart: text(dto.windowStart),
    windowEnd: text(dto.windowEnd),
  };
}

function toDraft(dto: Dto): LoadDraft {
  return {
    brokerName: text(dto.brokerName),
    brokerMcNumber: text(dto.brokerMcNumber),
    brokerPhone: text(dto.brokerPhone),
    brokerEmail: text(dto.brokerEmail),
    brokerLoadNumber: text(dto.brokerLoadNumber),
    equipmentType: text(dto.equipmentType),
    weightLbs: num(dto.weightLbs) ?? null,
    commodity: text(dto.commodity),
    rateTotal: text(dto.rateTotal),
    referenceNumbers: strings(dto.referenceNumbers),
    specialInstructions: text(dto.specialInstructions),
    stops: objects(dto.stops).map(toStop),
  };
}

function toMissing(dto: Dto): MissingValue {
  return { field: str(dto.field) ?? "", paths: strings(dto.paths), required: dto.required === true };
}

/** §9 → `LoadDraftView`. */
export function toLoadDraftView(dto: Dto): LoadDraftView {
  const draft = obj(dto.draft);
  return {
    documentId: str(dto.documentId) ?? "",
    documentStatus: mapped(DOCUMENT_STATUS, dto.documentStatus, "document status"),
    extractionId: text(dto.extractionId),
    action: mapped(ACTION, dto.action, "approval action"),
    matchedLoadId: text(dto.matchedLoadId),
    draft: draft ? toDraft(draft) : null,
    warnings: strings(dto.warnings),
    missing: objects(dto.missing).map(toMissing),
    problems: strings(dto.problems),
    canApprove: dto.canApprove === true,
  };
}

/** §10 → `ApprovalResult`. */
export function toApprovalResult(dto: Dto): ApprovalResult {
  return {
    action: mapped(ACTION, dto.action, "approval action"),
    document: toRateConDocument(obj(dto.document) ?? {}),
    loadId: str(obj(dto.load)?.id) ?? "",
  };
}

const doc = (id: string) => `/documents/${encodeURIComponent(id)}`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
/** Responses are unwrapped; tolerate a `{ data }` envelope too. */
const body = (data: unknown): Dto => {
  const root = obj(data);
  return obj(root?.data) ?? root ?? {};
};

export const httpRateConIntakeService: RateConIntakeService = {
  async upload(_ctx, file, idempotencyKey) {
    const form = new FormData();
    form.append("file", file);
    const res = await fileApiClient.post("/documents/rate-confirmations", form, idempotent(idempotencyKey));
    return toRateConDocument(body(res.data));
  },
  async get(_ctx, documentId) {
    return toRateConDocument(body((await apiClient.get(doc(documentId))).data));
  },
  async fileUrl(_ctx, documentId) {
    const dto = body((await apiClient.get(`${doc(documentId)}/file`)).data);
    return { url: str(dto.url) ?? "", expiresAt: str(dto.expiresAt) ?? "" };
  },
  async retryExtraction(_ctx, documentId, idempotencyKey) {
    const res = await apiClient.post(`${doc(documentId)}/extractions`, undefined, idempotent(idempotencyKey));
    return toRateConDocument(body(res.data));
  },
  async review(_ctx, documentId) {
    return toDocumentReview(body((await apiClient.get(`${doc(documentId)}/review`)).data));
  },
  async decide(_ctx, documentId, decisions, idempotencyKey) {
    const res = await apiClient.post(
      `${doc(documentId)}/review/decisions`,
      toDecisionsBody(decisions),
      idempotent(idempotencyKey),
    );
    return toDocumentReview(body(res.data));
  },
  async completeReview(_ctx, documentId, idempotencyKey) {
    const res = await apiClient.post(`${doc(documentId)}/review/complete`, undefined, idempotent(idempotencyKey));
    return toRateConDocument(body(res.data));
  },
  async loadDraft(_ctx, documentId) {
    return toLoadDraftView(body((await apiClient.get(`${doc(documentId)}/load-draft`)).data));
  },
  async approve(_ctx, documentId, idempotencyKey) {
    const res = await apiClient.post(`${doc(documentId)}/approve`, undefined, idempotent(idempotencyKey));
    return toApprovalResult(body(res.data));
  },
};
