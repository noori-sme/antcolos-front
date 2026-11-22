import { apiClient } from "../client";
import type { DriverCredentialsService } from "../contracts/driver-credentials";
import { type Dto, nullableStr, obj, oneOf, queryParams, str, toPage } from "./dto";
import {
  CREDENTIAL_STATUSES, CREDENTIAL_TYPES,
  type CredentialHistoryEntry, type DriverCredential,
} from "@/types/driver-credential";

/** Contract "Credential object" → `DriverCredential`. */
export function toDriverCredential(dto: Dto): DriverCredential {
  return {
    id: str(dto.id) ?? "",
    userId: str(dto.userId) ?? "",
    type: oneOf(CREDENTIAL_TYPES, dto.type) ?? "OTHER",
    label: str(dto.label) ?? "",
    status: oneOf(CREDENTIAL_STATUSES, dto.status) ?? "NOT_HELD",
    issuedAt: nullableStr(dto.issuedAt) ?? null,
    effectiveAt: nullableStr(dto.effectiveAt) ?? null,
    expiresAt: nullableStr(dto.expiresAt) ?? null,
    source: str(dto.source) ?? "",
    updatedByUserId: str(dto.updatedByUserId) ?? "",
    createdAt: str(dto.createdAt) ?? "",
    updatedAt: str(dto.updatedAt) ?? "",
  };
}

/** Contract history entry → `CredentialHistoryEntry`. */
export function toCredentialHistoryEntry(dto: Dto): CredentialHistoryEntry {
  return {
    id: str(dto.id) ?? "",
    type: str(dto.type) ?? "",
    occurredAt: str(dto.occurredAt) ?? "",
    source: str(dto.source) ?? "",
    actorId: nullableStr(dto.actorId) ?? null,
    details: obj(dto.details) ?? {},
  };
}

const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
const one = (body: unknown) => toDriverCredential(obj(body) ?? {});
const path = (id: string) => `/credentials/${encodeURIComponent(id)}`;

export const httpDriverCredentialsService: DriverCredentialsService = {
  async list(_ctx, query) {
    const res = await apiClient.get("/credentials", { params: queryParams({ ...query }) });
    return toPage(res.data, toDriverCredential);
  },
  async listMine(_ctx, query = {}) {
    const res = await apiClient.get("/credentials/mine", { params: queryParams({ ...query }) });
    return toPage(res.data, toDriverCredential);
  },
  async create(_ctx, input, idempotencyKey) {
    const res = await apiClient.post("/credentials", input, idempotent(idempotencyKey));
    return one(res.data);
  },
  async update(_ctx, id, input) {
    const res = await apiClient.patch(path(id), input);
    return one(res.data);
  },
  async changeStatus(_ctx, id, input, idempotencyKey) {
    const res = await apiClient.post(`${path(id)}/status`, input, idempotent(idempotencyKey));
    return one(res.data);
  },
  async history(_ctx, id, query = {}) {
    const res = await apiClient.get(`${path(id)}/history`, { params: queryParams({ ...query }) });
    return toPage(res.data, toCredentialHistoryEntry);
  },
};
