import type { Paginated } from "@/types/common";
import type { OrgMember, OrgMemberListQuery } from "@/types/org-members";
import type { ServiceContext } from "./context";

/**
 * The organization's members (NestJS `/organizations/members`,
 * ../antcolos/docs/requirements/membership-api-contract.md §2). The tenant
 * comes from the token.
 */
export interface OrgMembersService {
  /** Active members, join-date order, paginated. Needs `membership.list`. */
  list(ctx: ServiceContext, query: OrgMemberListQuery): Promise<Paginated<OrgMember>>;
  /**
   * End someone's membership. Needs `membership.remove`. Rejects with the
   * backend's message: 404 already removed, 409 the last admin.
   */
  remove(ctx: ServiceContext, userId: string): Promise<void>;
  /**
   * Give a member another role (built-in or custom), with that role's own permissions.
   * Needs `membership.manage_permissions`; the backend refuses a role whose permissions the
   * caller does not hold, and keeps the last admin.
   */
  changeRole(ctx: ServiceContext, membershipId: string, roleId: string): Promise<void>;
}
