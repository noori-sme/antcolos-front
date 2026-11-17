import { apiClient } from "../client";
import type { LoadExceptionsService } from "../contracts/load-exceptions";
import { type Dto, num, obj, objects, oneOf, str } from "./dto";
import {
  LOAD_EXCEPTION_SEVERITIES, LOAD_EXCEPTION_TYPES,
  type LoadException, type LoadExceptionPage, type LoadExceptionStatus,
  type ReportExceptionInput, type ResolveExceptionInput,
} from "@/types/load-exception";

/** ../antcolos/docs/requirements/loads-api-contract.md §14 (plan 36). */

const upper = (v: readonly string[]) => v.map((s) => s.toUpperCase());
const STATUS: Record<string, LoadExceptionStatus> = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
};
const text = (v: unknown): string | null => str(v) ?? null;

/** An exception, or null when its type, severity or status is unknown to this screen. */
export function toLoadException(dto: Dto): LoadException | null {
  const type = oneOf(upper(LOAD_EXCEPTION_TYPES), dto.type);
  const severity = oneOf(upper(LOAD_EXCEPTION_SEVERITIES), dto.severity);
  const status = oneOf(Object.keys(STATUS), dto.status);
  if (!type || !severity || !status) return null;
  return {
    id: str(dto.id) ?? "",
    loadId: str(dto.loadId) ?? "",
    brokerLoadNumber: text(dto.brokerLoadNumber),
    stopSequence: num(dto.stopSequence) ?? null,
    type: type.toLowerCase() as LoadException["type"],
    severity: severity.toLowerCase() as LoadException["severity"],
    status: STATUS[status],
    notes: str(dto.notes) ?? "",
    occurredAt: str(dto.occurredAt) ?? "",
    openedAt: str(dto.openedAt) ?? "",
    openedByUserId: str(dto.openedByUserId) ?? "",
    source: str(dto.source) ?? "",
    ownerUserId: text(dto.ownerUserId),
    acknowledgedAt: text(dto.acknowledgedAt),
    resolution: text(dto.resolution),
    resolvedAt: text(dto.resolvedAt),
    financialImpact: text(dto.financialImpact),
  };
}

export const toLoadExceptions = (items: unknown[]): LoadException[] =>
  items
    .map((i) => obj(i))
    .filter((d): d is Dto => d !== undefined)
    .map(toLoadException)
    .filter((e): e is LoadException => e !== null);

export function toReportBody(input: ReportExceptionInput): Dto {
  return {
    type: input.type.toUpperCase(),
    severity: input.severity.toUpperCase(),
    notes: input.notes.trim(),
    ...(input.stopSequence != null ? { stopSequence: input.stopSequence } : {}),
    source: input.source,
  };
}

export function toResolveBody(input: ResolveExceptionInput): Dto {
  const impact = input.financialImpact?.trim();
  return { resolution: input.resolution.trim(), ...(impact ? { financialImpact: impact } : {}) };
}

const base = (loadId: string) => `/loads/${encodeURIComponent(loadId)}/exceptions`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
const listOf = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  const root = obj(data);
  return Array.isArray(root?.data) ? root.data : [];
};
const single = (data: unknown): LoadException => {
  const root = obj(data);
  const exception = toLoadException(obj(root?.data) ?? root ?? {});
  if (!exception) throw new Error("Unexpected exception in the response");
  return exception;
};

export const httpLoadExceptionsService: LoadExceptionsService = {
  async listForLoad(_ctx, loadId) {
    const res = await apiClient.get(base(loadId));
    return toLoadExceptions(listOf(res.data));
  },
  async listOpen(_ctx, page) {
    const res = await apiClient.get("/exceptions", { params: { page, pageSize: 50 } });
    const root = obj(res.data) ?? {};
    const meta = obj(root.meta) ?? {};
    const items = toLoadExceptions(objects(root.data));
    const result: LoadExceptionPage = {
      items,
      page: num(meta.page) ?? page,
      totalPages: num(meta.totalPages) ?? 1,
      totalItems: num(meta.totalItems) ?? items.length,
    };
    return result;
  },
  async report(_ctx, loadId, input, key) {
    const res = await apiClient.post(base(loadId), toReportBody(input), idempotent(key));
    return single(res.data);
  },
  async acknowledge(_ctx, loadId, exceptionId, key) {
    const res = await apiClient.post(
      `${base(loadId)}/${encodeURIComponent(exceptionId)}/acknowledge`,
      {},
      idempotent(key),
    );
    return single(res.data);
  },
  async resolve(_ctx, loadId, exceptionId, input, key) {
    const res = await apiClient.post(
      `${base(loadId)}/${encodeURIComponent(exceptionId)}/resolve`,
      toResolveBody(input),
      idempotent(key),
    );
    return single(res.data);
  },
};
