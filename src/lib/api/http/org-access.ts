import { apiClient } from "../client";
import type { OrgInvitationsService, OrgRolesService } from "../contracts/org-access";
import type { Paginated } from "@/types/common";
import type {
  OrgInvitation, OrgInvitationListItem, OrgInvitationStatus, OrgRole, PermissionCatalog,
} from "@/types/org-access";
import { type Dto, nullableStr, obj, objects, queryParams, str, strings, toPage } from "./dto";

/** Contract `InvitationStatus` → canonical. Anything else stays undefined. */
const STATUS: Record<string, OrgInvitationStatus> = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  REVOKED: "revoked",
  DECLINED: "declined",
  PENDING_ADMIN_APPROVAL: "awaiting_approval",
  REJECTED_BY_ADMIN: "rejected_by_admin",
};
const API_STATUS = Object.fromEntries(
  Object.entries(STATUS).map(([api, ui]) => [ui, api]),
) as Record<OrgInvitationStatus, string>;

/** invitations-api-contract.md §Invitation → `OrgInvitation`. */
export function toOrgInvitation(dto: Dto): OrgInvitation {
  const status = str(dto.status);
  return {
    id: str(dto.id) ?? "",
    email: str(dto.email) ?? "",
    firstName: str(dto.firstName) ?? "",
    lastName: str(dto.lastName) ?? "",
    roleId: str(dto.roleId) ?? "",
    status: status && Object.hasOwn(STATUS, status) ? STATUS[status] : undefined,
    organizationId: str(dto.organizationId) ?? "",
    invitedByUserId: str(dto.invitedByUserId) ?? "",
    invitedUserId: nullableStr(dto.invitedUserId) ?? null,
    expiresAt: str(dto.expiresAt) ?? "",
    createdAt: str(dto.createdAt) ?? "",
    updatedAt: str(dto.updatedAt) ?? "",
    acceptedAt: nullableStr(dto.acceptedAt) ?? null,
    acceptedUserId: nullableStr(dto.acceptedUserId) ?? null,
  };
}

export function toOrgInvitationListItem(dto: Dto): OrgInvitationListItem {
  return { ...toOrgInvitation(dto), permissions: strings(dto.permissions) };
}

export function toOrgInvitationPage(body: unknown): Paginated<OrgInvitationListItem> {
  return toPage(body, toOrgInvitationListItem);
}

/** permissions-api-contract.md §2 role → `OrgRole`. */
export function toOrgRole(dto: Dto): OrgRole {
  return {
    id: str(dto.id) ?? "",
    name: str(dto.name) ?? "",
    description: str(dto.description),
    permissions: strings(dto.permissions),
    createdAt: str(dto.createdAt),
    updatedAt: str(dto.updatedAt),
  };
}

/** `{ roles: [...] }` → roles with an id. */
export function toOrgRoles(body: unknown): OrgRole[] {
  return objects(obj(body)?.roles).map(toOrgRole).filter((r) => r.id);
}

/** permissions-api-contract.md §1 → `PermissionCatalog`. */
export function toPermissionCatalog(body: unknown): PermissionCatalog {
  return {
    modules: objects(obj(body)?.modules).map((m) => ({
      module: str(m.module) ?? "",
      label: str(m.label) ?? str(m.module) ?? "",
      resources: objects(m.resources).map((r) => ({
        resource: str(r.resource) ?? "",
        label: str(r.label) ?? str(r.resource) ?? "",
        actions: objects(r.actions)
          .filter((a) => str(a.action))
          .map((a) => ({ action: str(a.action)!, label: str(a.label) ?? str(a.action)! })),
      })),
    })),
  };
}

const invitation = (body: unknown) => toOrgInvitation(obj(body) ?? {});
const id = encodeURIComponent;

export const httpOrgInvitationsService: OrgInvitationsService = {
  async list(_ctx, query) {
    const res = await apiClient.get("/organizations/invitations", {
      params: queryParams({
        page: query.page,
        pageSize: query.pageSize,
        status: query.status ? API_STATUS[query.status] : undefined,
        roleId: query.roleId,
      }),
    });
    return toOrgInvitationPage(res.data);
  },
  async create(_ctx, input) {
    const res = await apiClient.post("/organizations/invitations", input);
    return invitation(res.data);
  },
  async resend(_ctx, invitationId) {
    const res = await apiClient.post(`/organizations/invitations/${id(invitationId)}/resend`);
    return invitation(res.data);
  },
  async revoke(_ctx, invitationId) {
    const res = await apiClient.post(`/organizations/invitations/${id(invitationId)}/revoke`);
    return invitation(res.data);
  },
  async listRequests(_ctx, query) {
    const res = await apiClient.get("/organizations/invitation-requests", {
      params: queryParams({ page: query.page, pageSize: query.pageSize }),
    });
    return toOrgInvitationPage(res.data);
  },
  async approveRequest(_ctx, requestId, input) {
    const res = await apiClient.post(
      `/organizations/invitation-requests/${id(requestId)}/approve`,
      input ?? {},
    );
    return invitation(res.data);
  },
  async rejectRequest(_ctx, requestId) {
    const res = await apiClient.post(`/organizations/invitation-requests/${id(requestId)}/reject`);
    return invitation(res.data);
  },
};

export const httpOrgRolesService: OrgRolesService = {
  async list() {
    const res = await apiClient.get("/organizations/roles");
    return toOrgRoles(res.data);
  },
  async create(_ctx, input) {
    const res = await apiClient.post("/organizations/roles", input);
    return toOrgRole(obj(res.data) ?? {});
  },
  async update(_ctx, roleId, input) {
    const res = await apiClient.patch(`/organizations/roles/${id(roleId)}`, input);
    return toOrgRole(obj(res.data) ?? {});
  },
  async remove(_ctx, roleId) {
    await apiClient.delete(`/organizations/roles/${id(roleId)}`);
  },
  async catalog() {
    const res = await apiClient.get("/permissions/catalog");
    return toPermissionCatalog(res.data);
  },
};
