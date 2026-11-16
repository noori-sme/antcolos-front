import { apiClient } from "../client";
import type { LoadRecordsService } from "../contracts/load-records";
import { type Dto, num, obj, objects, oneOf, queryParams, str, strings } from "./dto";
import type {
  CancellationParty, CancelLoadInput, LoadRecord, LoadRecordPage, LoadRecordQuery,
  LoadRecordSource, LoadRecordStatus, LoadRecordStop, LoadTimelineEntry, LoadTimelinePage,
} from "@/types/load-record";

/**
 * ../antcolos/docs/requirements/loads-api-contract.md (plans 22, 29, 30).
 * Every enum is mapped explicitly; an unknown status throws rather than guess.
 */

const STATUS: Record<string, LoadRecordStatus> = {
  BOOKED: "booked",
  RC_RECEIVED: "rc_received",
  DRIVER_ASSIGNED: "driver_assigned",
  DRIVER_ACCEPTED: "driver_accepted",
  EN_ROUTE_PICKUP: "en_route_pickup",
  ARRIVED_PICKUP: "arrived_pickup",
  LOADED: "loaded",
  AWAITING_BROKER_RELEASE: "awaiting_broker_release",
  IN_TRANSIT: "in_transit",
  ARRIVED_DELIVERY: "arrived_delivery",
  DELIVERED: "delivered",
  POD_RECEIVED: "pod_received",
  INVOICE_READY: "invoice_ready",
  CANCELLED: "cancelled",
};
const STATUS_CODE = Object.fromEntries(
  Object.entries(STATUS).map(([code, status]) => [status, code]),
) as Record<LoadRecordStatus, string>;
const PARTY: Record<string, CancellationParty> = {
  BROKER: "broker",
  SHIPPER: "shipper",
  CARRIER: "carrier",
  OTHER: "other",
};
const SOURCE: Record<string, LoadRecordSource> = {
  MANUAL: "manual",
  BROWSER_EXTENSION: "browser_extension",
  RATE_CONFIRMATION: "rate_confirmation",
};
const STOP_TYPE: Record<string, LoadRecordStop["type"]> = { PICKUP: "pickup", DELIVERY: "delivery" };

function mapped<T>(table: Record<string, T>, value: unknown, what: string): T {
  const key = oneOf(Object.keys(table), value);
  if (!key) throw new Error(`Unexpected ${what} from the API: ${String(value)}`);
  return table[key];
}
const optional = <T,>(table: Record<string, T>, value: unknown): T | null => {
  const key = oneOf(Object.keys(table), value);
  return key ? table[key] : null;
};
const text = (v: unknown): string | null => str(v) ?? null;

function toStop(dto: Dto): LoadRecordStop {
  return {
    sequence: num(dto.sequence) ?? 0,
    type: mapped(STOP_TYPE, dto.type, "stop type"),
    facilityName: text(dto.facilityName),
    addressLine1: text(dto.addressLine1),
    city: str(dto.city) ?? "",
    state: str(dto.state) ?? "",
    postalCode: text(dto.postalCode),
    // Required by the contract; never guess a zone (a wrong one shifts the window).
    timezone: str(dto.timezone) ?? "",
    scheduledDate: text(dto.scheduledDate),
    windowStart: text(dto.windowStart),
    windowEnd: text(dto.windowEnd),
    appointmentConfirmed: dto.appointmentConfirmed === true,
    contactName: text(dto.contactName),
    contactPhone: text(dto.contactPhone),
    notes: text(dto.notes),
  };
}

export function toLoadRecord(dto: Dto): LoadRecord {
  return {
    id: str(dto.id) ?? "",
    status: mapped(STATUS, dto.status, "load status"),
    statusChangedAt: str(dto.statusChangedAt) ?? str(dto.updatedAt) ?? "",
    // A state the screen does not know yet is not offered as a button.
    allowedTransitions: strings(dto.allowedTransitions)
      .map((code) => optional(STATUS, code))
      .filter((s): s is LoadRecordStatus => s !== null),
    requiresBrokerRelease: dto.requiresBrokerRelease === true,
    source: mapped(SOURCE, dto.source, "load source"),
    brokerName: str(dto.brokerName) ?? "",
    brokerMcNumber: str(dto.brokerMcNumber) ?? "",
    brokerContactName: text(dto.brokerContactName),
    brokerPhone: text(dto.brokerPhone),
    brokerEmail: text(dto.brokerEmail),
    brokerLoadNumber: str(dto.brokerLoadNumber) ?? "",
    firstPickupDate: str(dto.firstPickupDate) ?? "",
    equipmentType: str(dto.equipmentType) ?? "OTHER",
    weightLbs: num(dto.weightLbs) ?? null,
    commodity: text(dto.commodity),
    totalMiles: num(dto.totalMiles) ?? null,
    rateTotal: text(dto.rateTotal),
    referenceNumbers: strings(dto.referenceNumbers),
    specialInstructions: text(dto.specialInstructions),
    notes: text(dto.notes),
    stops: objects(dto.stops).map(toStop).sort((a, b) => a.sequence - b.sequence),
    cancelledAt: text(dto.cancelledAt),
    cancelReason: text(dto.cancelReason),
    cancelledByParty: optional(PARTY, dto.cancelledByParty),
    tonuAmount: text(dto.tonuAmount),
    createdAt: str(dto.createdAt) ?? "",
    updatedAt: str(dto.updatedAt) ?? "",
  };
}

function meta(root: Dto) {
  const m = obj(root.meta) ?? {};
  return {
    page: num(m.page) ?? 1,
    pageSize: num(m.pageSize) ?? 0,
    totalItems: num(m.totalItems) ?? 0,
    totalPages: num(m.totalPages) ?? 0,
  };
}

export function toLoadRecordPage(body: unknown): LoadRecordPage {
  const root = obj(body) ?? {};
  return { items: objects(root.data).map(toLoadRecord), ...meta(root) };
}

function toTimelineEntry(dto: Dto): LoadTimelineEntry {
  const details = obj(dto.details) ?? {};
  const actor = obj(dto.actor);
  return {
    id: str(dto.id) ?? "",
    type: str(dto.type) ?? "unknown",
    occurredAt: str(dto.occurredAt) ?? "",
    source: str(dto.source) ?? "unknown",
    actor: actor && str(actor.id) ? { id: str(actor.id)!, name: text(actor.name) } : null,
    from: optional(STATUS, details.from),
    to: optional(STATUS, details.to),
    reason: text(details.reason),
    party: optional(PARTY, details.party),
    tonuAmount: text(details.tonuAmount),
    changedFields: strings(details.changedFields),
  };
}

export function toLoadTimelinePage(body: unknown): LoadTimelinePage {
  const root = obj(body) ?? {};
  const { page, totalItems, totalPages } = meta(root);
  return { items: objects(root.data).map(toTimelineEntry), page, totalItems, totalPages };
}

export function toLoadListParams(query: LoadRecordQuery) {
  return queryParams({
    page: query.page,
    pageSize: query.pageSize,
    status: query.status ? STATUS_CODE[query.status] : undefined,
    q: query.search?.trim() || undefined,
    sortBy: query.sortBy,
    sortOrder: query.sortDir,
  });
}

export function toCancelBody(input: CancelLoadInput): Dto {
  const out: Dto = { reason: input.reason.trim() };
  if (input.party) out.party = input.party.toUpperCase();
  if (input.tonuAmount) out.tonuAmount = input.tonuAmount;
  return out;
}

const load = (id: string) => `/loads/${encodeURIComponent(id)}`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
/** Responses are unwrapped; tolerate a `{ data }` envelope too. */
const single = (data: unknown): Dto => {
  const root = obj(data);
  return obj(root?.data) ?? root ?? {};
};

export const httpLoadRecordsService: LoadRecordsService = {
  async list(_ctx, query) {
    const res = await apiClient.get("/loads", { params: toLoadListParams(query) });
    return toLoadRecordPage(res.data);
  },
  async get(_ctx, loadId) {
    return toLoadRecord(single((await apiClient.get(load(loadId))).data));
  },
  async timeline(_ctx, loadId, page) {
    const res = await apiClient.get(`${load(loadId)}/timeline`, { params: { page, pageSize: 50 } });
    return toLoadTimelinePage(res.data);
  },
  async transition(_ctx, loadId, to, idempotencyKey) {
    const res = await apiClient.post(
      `${load(loadId)}/transitions`,
      { to: STATUS_CODE[to] },
      idempotent(idempotencyKey),
    );
    return toLoadRecord(single(res.data));
  },
  async cancel(_ctx, loadId, input, idempotencyKey) {
    const res = await apiClient.post(`${load(loadId)}/cancel`, toCancelBody(input), idempotent(idempotencyKey));
    return toLoadRecord(single(res.data));
  },
  async correctStatus(_ctx, loadId, to, reason, idempotencyKey) {
    const res = await apiClient.post(
      `${load(loadId)}/correct-status`,
      { to: STATUS_CODE[to], reason: reason.trim() },
      idempotent(idempotencyKey),
    );
    return toLoadRecord(single(res.data));
  },
};
