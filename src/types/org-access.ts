/**
 * Organization invitations, roles and the permission catalog as the NestJS
 * identity API returns them:
 *   ../antcolos/docs/requirements/invitations-api-contract.md
 *   ../antcolos/docs/requirements/permissions-api-contract.md §1–2
 *
 * Import from "@/types/org-access" directly. The in-memory access domain in
 * "@/types/access" (`Invitation`, `PermissionTemplate`) is a different model.
 *
 * Permission keys here are the backend's own `resource.action` strings,
 * unmapped; screens convert them where they need UI keys.
 */

/** Contract `InvitationStatus`, lower-cased. */
export const ORG_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "expired",
  "revoked",
  "declined",
  /** A member's request, waiting for an approver. No email sent yet. */
  "awaiting_approval",
  /** A member's request that an approver declined. */
  "rejected_by_admin",
] as const;
export type OrgInvitationStatus = (typeof ORG_INVITATION_STATUSES)[number];

export interface OrgInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** System role slug (`DRIVER`) or custom role UUID. */
  roleId: string;
  /** Undefined when the API sent a status this client does not know. */
  status?: OrgInvitationStatus;
  organizationId: string;
  invitedByUserId: string;
  invitedUserId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  acceptedUserId: string | null;
}

/** List rows also carry the effective permissions granted on accept. */
export interface OrgInvitationListItem extends OrgInvitation {
  permissions: string[];
}

export interface OrgInvitationListQuery {
  page?: number;
  pageSize?: number;
  status?: OrgInvitationStatus;
  roleId?: string;
}

/** `POST /organizations/invitations`: by email, or by existing user id. */
export type CreateOrgInvitationInput =
  | {
      email: string;
      firstName: string;
      lastName: string;
      roleId: string;
      permissions?: string[];
    }
  | { userId: string; roleId: string; permissions?: string[] };

/** `POST /organizations/invitation-requests/:id/approve` optional overrides. */
export interface ApproveInvitationRequestInput {
  roleId?: string;
  permissions?: string[];
}

export interface OrgRole {
  /** System roles: the slug (`DRIVER`). Custom roles: a UUID. */
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  /** Custom roles only. */
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateOrgRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateOrgRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
  /** true resets assigned members to the new template (contract §2). */
  syncMembers?: boolean;
}

export interface PermissionCatalogAction {
  action: string;
  label: string;
}
export interface PermissionCatalogResource {
  resource: string;
  label: string;
  actions: PermissionCatalogAction[];
}
export interface PermissionCatalogModule {
  module: string;
  label: string;
  resources: PermissionCatalogResource[];
}
export interface PermissionCatalog {
  modules: PermissionCatalogModule[];
}
