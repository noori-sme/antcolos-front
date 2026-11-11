import { apiClient } from "../client";
import type { OrgMembersService } from "../contracts/org-members";
import { type Dto, queryParams, str, toPage } from "./dto";
import type { OrgMember } from "@/types/org-members";

/** membership-api-contract.md §2 list item → `OrgMember`. */
export function toOrgMember(dto: Dto): OrgMember {
  const email = str(dto.email) ?? "";
  return {
    userId: str(dto.userId) ?? "",
    name: str(dto.name) ?? email,
    email,
    roleId: str(dto.roleId) ?? "",
    roleName: str(dto.roleName) ?? "",
    hasPermissionOverrides: dto.hasPermissionOverrides === true,
    joinedAt: str(dto.joinedAt) ?? "",
  };
}

export const httpOrgMembersService: OrgMembersService = {
  async list(_ctx, query) {
    const res = await apiClient.get("/organizations/members", {
      params: queryParams({ ...query }),
    });
    return toPage(res.data, toOrgMember);
  },
  async remove(_ctx, userId) {
    await apiClient.delete(`/organizations/members/${encodeURIComponent(userId)}`);
  },
};
