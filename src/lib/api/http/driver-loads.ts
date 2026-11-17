import { apiClient, fileApiClient } from "../client";
import type { DriverLoadsService } from "../contracts/driver-loads";
import { type Dto, num, obj, objects, oneOf, str, strings } from "./dto";
import { toLoadExceptions } from "./load-exceptions";
import { toDriverAnswer, toLoadStatus, toStop } from "./load-records";
import type {
  DriverLoad, DriverLoadPage, DriverMilestone, LoadDocument, LoadDocumentType, NextMilestone,
} from "@/types/driver-load";

/** ../antcolos/docs/requirements/loads-api-contract.md §10–§13 (plans 32–34). */

const MILESTONE: Record<string, DriverMilestone> = {
  START_TRIP: "start_trip",
  ARRIVED: "arrived",
  LOADED: "loaded",
  AWAITING_RELEASE: "awaiting_release",
  RELEASED: "released",
  DEPARTED: "departed",
  DELIVERED: "delivered",
};
const MILESTONE_CODE = Object.fromEntries(
  Object.entries(MILESTONE).map(([code, m]) => [m, code]),
) as Record<DriverMilestone, string>;
const DOC_TYPE: Record<string, LoadDocumentType> = {
  RATE_CONFIRMATION: "rate_confirmation",
  BOL: "bol",
  POD: "pod",
};
const DOC_STATUS: Record<string, LoadDocument["status"]> = {
  EXPECTED: "expected",
  RECEIVED: "received",
  EXTRACTED: "extracted",
  REVIEWED: "reviewed",
  ACCEPTED: "accepted",
};

const text = (v: unknown): string | null => str(v) ?? null;

export function toLoadDocument(dto: Dto): LoadDocument | null {
  const type = oneOf(Object.keys(DOC_TYPE), dto.type);
  const status = oneOf(Object.keys(DOC_STATUS), dto.status);
  // A document type the screen does not know is left out, not guessed.
  if (!type || !status) return null;
  return {
    id: str(dto.id) ?? "",
    type: DOC_TYPE[type],
    status: DOC_STATUS[status],
    stopSequence: num(dto.stopSequence) ?? null,
    version: num(dto.version) ?? 1,
    superseded: dto.superseded === true,
    source: str(dto.source) ?? "",
    uploadedByUserId: str(dto.uploadedByUserId) ?? "",
    receivedAt: str(dto.receivedAt) ?? "",
  };
}

function toNextMilestone(dto: Dto): NextMilestone | null {
  const code = oneOf(Object.keys(MILESTONE), dto.milestone);
  // A milestone the screen does not know is not offered as a button.
  if (!code) return null;
  return { milestone: MILESTONE[code], stopSequence: num(dto.stopSequence) ?? null };
}

export function toDriverLoad(dto: Dto): DriverLoad {
  return {
    id: str(dto.id) ?? "",
    status: toLoadStatus(dto.status),
    statusChangedAt: str(dto.statusChangedAt) ?? "",
    brokerLoadNumber: str(dto.brokerLoadNumber) ?? "",
    referenceNumbers: strings(dto.referenceNumbers),
    equipmentType: str(dto.equipmentType) ?? "OTHER",
    weightLbs: num(dto.weightLbs) ?? null,
    commodity: text(dto.commodity),
    specialInstructions: text(dto.specialInstructions),
    requiresBrokerRelease: dto.requiresBrokerRelease === true,
    truckId: text(dto.truckId),
    driverAssignedAt: text(dto.driverAssignedAt),
    driverAcceptedAt: text(dto.driverAcceptedAt),
    stops: objects(dto.stops).map(toStop).sort((a, b) => a.sequence - b.sequence),
    documents: objects(dto.documents)
      .map(toLoadDocument)
      .filter((d): d is LoadDocument => d !== null),
    exceptions: toLoadExceptions(objects(dto.exceptions)),
    nextMilestones: objects(dto.nextMilestones)
      .map(toNextMilestone)
      .filter((m): m is NextMilestone => m !== null),
  };
}

export function toDriverLoadPage(body: unknown): DriverLoadPage {
  const root = obj(body) ?? {};
  const meta = obj(root.meta) ?? {};
  const items = objects(root.data).map(toDriverLoad);
  return {
    items,
    page: num(meta.page) ?? 1,
    pageSize: num(meta.pageSize) ?? items.length,
    totalItems: num(meta.totalItems) ?? items.length,
    totalPages: num(meta.totalPages) ?? 1,
  };
}

/** The milestone command body (contract §11); the channel is always the driver's phone app. */
export function toMilestoneBody(input: { milestone: DriverMilestone; stopSequence?: number | null }): Dto {
  return {
    milestone: MILESTONE_CODE[input.milestone],
    ...(input.stopSequence != null ? { stopSequence: input.stopSequence } : {}),
    source: "mobile_web",
  };
}

const load = (id: string) => `/loads/${encodeURIComponent(id)}`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
const single = (data: unknown): Dto => {
  const root = obj(data);
  return obj(root?.data) ?? root ?? {};
};

export const httpDriverLoadsService: DriverLoadsService = {
  async list(_ctx, page) {
    const res = await apiClient.get("/loads/assigned", { params: { page, pageSize: 50 } });
    return toDriverLoadPage(res.data);
  },
  async get(_ctx, loadId) {
    return toDriverLoad(single((await apiClient.get(`/loads/assigned/${encodeURIComponent(loadId)}`)).data));
  },
  async recordMilestone(_ctx, loadId, input, idempotencyKey) {
    const res = await apiClient.post(`${load(loadId)}/milestones`, toMilestoneBody(input), idempotent(idempotencyKey));
    return toDriverLoad(single(res.data));
  },
  async uploadDocument(_ctx, loadId, input, idempotencyKey) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("type", input.type === "bol" ? "BOL" : "POD");
    if (input.stopSequence != null) form.append("stopSequence", String(input.stopSequence));
    form.append("source", "mobile_web");
    const res = await fileApiClient.post(`${load(loadId)}/documents`, form, idempotent(idempotencyKey));
    const doc = toLoadDocument(single(res.data));
    if (!doc) throw new Error("Unexpected document from the API");
    return doc;
  },
  async accept(_ctx, loadId, idempotencyKey) {
    const res = await apiClient.post(`${load(loadId)}/driver/accept`, undefined, idempotent(idempotencyKey));
    return toDriverAnswer(single(res.data));
  },
  async reject(_ctx, loadId, reason, idempotencyKey) {
    const res = await apiClient.post(`${load(loadId)}/driver/reject`, { reason: reason.trim() }, idempotent(idempotencyKey));
    return toDriverAnswer(single(res.data));
  },
};
