import { apiClient } from "../client";
import type {
  CarrierAuthorityService, OrgDirectoryService, SelfMembershipsService,
} from "../contracts/carrier-authority";
import { type Dto, nullableStr, num, obj, objects, oneOf, str, toPage } from "./dto";
import {
  CARRIER_AUTHORITY_STATUSES, type CarrierAuthorityRecord, type DirectoryCarrier, type MyOrganization,
} from "@/types/carrier-authority";

export function toAuthorityRecord(dto: Dto): CarrierAuthorityRecord {
  return {
    id: str(dto.id) ?? "",
    dotNumber: str(dto.dotNumber) ?? "",
    mcNumber: nullableStr(dto.mcNumber) ?? null,
    status: oneOf(CARRIER_AUTHORITY_STATUSES, dto.status) ?? str(dto.status) ?? "",
    allowedToOperate: dto.allowedToOperate === true,
    outOfService: dto.outOfService === true,
    authorities: objects(dto.authorities).map((a) => ({
      docketNumber: str(a.docketNumber) ?? "",
      type: str(a.type) ?? "",
      status: str(a.status) ?? "",
    })),
    authoritySince: nullableStr(dto.authoritySince) ?? null,
    authorityAgeDays: num(dto.authorityAgeDays) ?? null,
    checkedAt: str(dto.checkedAt) ?? "",
  };
}

export function toDirectoryCarrier(dto: Dto): DirectoryCarrier | undefined {
  const organizationId = str(dto.organizationId);
  if (!organizationId) return undefined;
  return {
    organizationId,
    name: str(dto.name) ?? "",
    handle: nullableStr(dto.handle) ?? null,
    mcNumber: nullableStr(dto.mcNumber) ?? null,
    dotNumber: nullableStr(dto.dotNumber) ?? null,
  };
}

export function toMyOrganization(dto: Dto): MyOrganization | undefined {
  const organizationId = str(dto.organizationId);
  if (!organizationId) return undefined;
  return {
    organizationId,
    name: str(dto.organizationName) ?? "",
    type: str(dto.organizationType) ?? "",
    roleId: str(dto.roleId) ?? "",
    joinedAt: str(dto.joinedAt) ?? "",
  };
}

export const httpCarrierAuthorityService: CarrierAuthorityService = {
  async current() {
    const res = await apiClient.get("/carrier-authority");
    const current = obj(obj(res.data)?.current);
    return current ? toAuthorityRecord(current) : null;
  },
  async history(_ctx, page) {
    const res = await apiClient.get("/carrier-authority/history", { params: page });
    return toPage(res.data, toAuthorityRecord);
  },
  async refresh() {
    const res = await apiClient.post("/carrier-authority/refresh", {});
    const body = obj(res.data) ?? {};
    return { record: toAuthorityRecord(obj(body.record) ?? {}), changed: body.changed === true };
  },
};

export const httpOrgDirectoryService: OrgDirectoryService = {
  async searchCarriers(_ctx, q) {
    const res = await apiClient.get("/organizations/carriers/search", { params: { q, page: 1, pageSize: 20 } });
    return objects(obj(res.data)?.data)
      .map(toDirectoryCarrier)
      .filter((c): c is DirectoryCarrier => c !== undefined);
  },
};

export const httpSelfMembershipsService: SelfMembershipsService = {
  async list() {
    const res = await apiClient.get("/users/me/memberships");
    // A contract-documented bare array (api conventions); tolerate `{ data }` too.
    const rows = Array.isArray(res.data) ? res.data : objects(obj(res.data)?.data);
    return objects(rows)
      .map(toMyOrganization)
      .filter((m): m is MyOrganization => m !== undefined);
  },
  async leave(_ctx, organizationId) {
    // 200 with an empty body: nothing to map. A 404 is an answer (already left), not an error.
    const res = await apiClient.post(`/users/me/memberships/${encodeURIComponent(organizationId)}/leave`, {}, {
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    return { alreadyLeft: res.status === 404 };
  },
};
