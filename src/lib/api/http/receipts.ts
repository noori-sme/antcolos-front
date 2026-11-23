import { apiClient, fileApiClient } from "../client";
import type { ReceiptsService } from "../contracts/receipts";
import { type Dto, num, obj, objects, oneOf, queryParams, str, toPage } from "./dto";
import {
  RECEIPT_FAILURES, RECEIPT_KINDS, RECEIPT_STATUSES,
  type ConfirmReceiptInput, type PredictedField, type Receipt, type ReceiptDetail,
} from "@/types/receipt";

/** ../antcolos/docs/requirements/receipts-api-contract.md (backend plan 50). */

const text = (v: unknown): string | null => str(v) ?? null;

export function toReceipt(dto: Dto): Receipt {
  return {
    id: str(dto.id) ?? "",
    documentId: str(dto.documentId) ?? "",
    // An unknown kind or status is shown as unknown, with no actions; never cast.
    kind: oneOf(RECEIPT_KINDS, dto.kind) ?? "UNKNOWN",
    status: oneOf(RECEIPT_STATUSES, dto.status) ?? "UNKNOWN",
    truckId: text(dto.truckId),
    loadId: text(dto.loadId),
    driverUserId: str(dto.driverUserId) ?? "",
    purchasedAt: text(dto.purchasedAt),
    totalAmount: text(dto.totalAmount),
    currency: str(dto.currency) ?? "USD",
    vendor: text(dto.vendor),
    city: text(dto.city),
    state: text(dto.state),
    gallons: text(dto.gallons),
    unitPrice: text(dto.unitPrice),
    category: text(dto.category),
    partsAmount: text(dto.partsAmount),
    laborAmount: text(dto.laborAmount),
    odometerMiles: num(dto.odometerMiles) ?? null,
    arithmeticWarning: dto.arithmeticWarning === true,
    rejectReason: text(dto.rejectReason),
    confirmedByUserId: text(dto.confirmedByUserId),
    confirmedAt: text(dto.confirmedAt),
    createdByUserId: str(dto.createdByUserId) ?? "",
    createdAt: str(dto.createdAt) ?? "",
    updatedAt: str(dto.updatedAt) ?? "",
  };
}

function toPredictedField(dto: Dto): PredictedField | null {
  const path = str(dto.path);
  if (!path) return null;
  const v = dto.value;
  const value = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;
  return { path, value, confidence: num(dto.confidence) ?? null };
}

export function toReceiptDetail(dto: Dto): ReceiptDetail {
  return {
    ...toReceipt(dto),
    fields: objects(dto.fields)
      .map(toPredictedField)
      .filter((f): f is PredictedField => f !== null),
    failures: (Array.isArray(dto.failures) ? dto.failures : [])
      .map((f) => oneOf(RECEIPT_FAILURES, f))
      .filter((f): f is NonNullable<typeof f> => f !== undefined),
  };
}

/** Only the keys the person set; `null` clears, an absent key keeps what was read. */
export function toConfirmBody(input: ConfirmReceiptInput): Dto {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

const receipt = (id: string) => `/receipts/${encodeURIComponent(id)}`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
const single = (data: unknown): Dto => obj(data) ?? {};

export const httpReceiptsService: ReceiptsService = {
  async upload(_ctx, input, idempotencyKey) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("kind", input.kind);
    if (input.truckId) form.append("truckId", input.truckId);
    if (input.loadId) form.append("loadId", input.loadId);
    const res = await fileApiClient.post("/receipts", form, idempotent(idempotencyKey));
    // 202 is a new receipt; 200 is a file this organization already has.
    return { receipt: toReceipt(single(res.data)), duplicate: res.status === 200 };
  },
  async list(_ctx, filters) {
    const res = await apiClient.get("/receipts", {
      params: queryParams({
        status: filters.status,
        kind: filters.kind,
        truckId: filters.truckId,
        loadId: filters.loadId,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    });
    return toPage(res.data, toReceipt);
  },
  async get(_ctx, id) {
    return toReceiptDetail(single((await apiClient.get(receipt(id))).data));
  },
  async confirm(_ctx, id, input, idempotencyKey) {
    const res = await apiClient.post(`${receipt(id)}/confirm`, toConfirmBody(input), idempotent(idempotencyKey));
    return toReceipt(single(res.data));
  },
  async reject(_ctx, id, reason, idempotencyKey) {
    const res = await apiClient.post(`${receipt(id)}/reject`, { reason }, idempotent(idempotencyKey));
    return toReceipt(single(res.data));
  },
};
