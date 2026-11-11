/**
 * One row of the organization's member roster (NestJS
 * `GET /organizations/members`, membership-api-contract.md §2). Every role,
 * custom roles included. Plan 12.
 */
export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  /** A system slug (`DRIVER`, `ADMIN`, …) or a custom role's id. Display `roleName`, never branch on it. */
  roleId: string;
  roleName: string;
  hasPermissionOverrides: boolean;
  joinedAt: string;
}

export interface OrgMemberListQuery {
  page?: number;
  pageSize?: number;
}
