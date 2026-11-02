import type { Paginated } from "@/types/common";
import type {
  ApproveInvitationRequestInput, CreateOrgInvitationInput, CreateOrgRoleInput,
  OrgInvitation, OrgInvitationListItem, OrgInvitationListQuery, OrgRole,
  PermissionCatalog, UpdateOrgRoleInput,
} from "@/types/org-access";
import type { ServiceContext } from "./context";

/**
 * Organization invitations (../antcolos/docs/requirements/invitations-api-contract.md
 * §1–7). The tenant comes from the JWT; `ctx` scopes the cache, not the request.
 *
 * The public token routes (§8–10: preview, accept, reject by link) are not
 * here: they have no organization, and the acceptance screen calls them
 * directly (known drift, docs/plans/01-access-service-layer.md).
 */
export interface OrgInvitationsService {
  /** §1. Requires `invitation.list`. */
  list(ctx: ServiceContext, query: OrgInvitationListQuery): Promise<Paginated<OrgInvitationListItem>>;
  /** §2. Direct invite or approval request, decided by the caller's permissions. */
  create(ctx: ServiceContext, input: CreateOrgInvitationInput): Promise<OrgInvitation>;
  /** §3. Requires `invitation.invite_member`. */
  resend(ctx: ServiceContext, invitationId: string): Promise<OrgInvitation>;
  /** §4. Requires `invitation.revoke`. */
  revoke(ctx: ServiceContext, invitationId: string): Promise<OrgInvitation>;
  /** §5. Requires `invitation.list`. */
  listRequests(
    ctx: ServiceContext, query: Pick<OrgInvitationListQuery, "page" | "pageSize">,
  ): Promise<Paginated<OrgInvitationListItem>>;
  /** §6. Requires `invitation.approve_request`. */
  approveRequest(
    ctx: ServiceContext, requestId: string, input?: ApproveInvitationRequestInput,
  ): Promise<OrgInvitation>;
  /** §7. Requires `invitation.reject_request`. */
  rejectRequest(ctx: ServiceContext, requestId: string): Promise<OrgInvitation>;
}

/**
 * Roles and the permission catalog
 * (../antcolos/docs/requirements/permissions-api-contract.md §1–2).
 * Role routes require `role.manage`.
 */
export interface OrgRolesService {
  list(ctx: ServiceContext): Promise<OrgRole[]>;
  create(ctx: ServiceContext, input: CreateOrgRoleInput): Promise<OrgRole>;
  update(ctx: ServiceContext, roleId: string, input: UpdateOrgRoleInput): Promise<OrgRole>;
  /** Custom roles only; 409 while anything references the role. */
  remove(ctx: ServiceContext, roleId: string): Promise<void>;
  /** §1. Any tenant user. */
  catalog(ctx: ServiceContext): Promise<PermissionCatalog>;
}
