import { apiClient } from "../client";
import type { OrgPeopleService } from "../contracts/org-people";
import { type Dto, obj, queryParams, str, toPage } from "./dto";
import type { OrgPerson } from "@/types/org-people";

/** Users contract §2–§4 list item → `OrgPerson`. */
export function toOrgPerson(dto: Dto): OrgPerson {
  const fullName = [str(dto.firstName), str(dto.lastName)].filter(Boolean).join(" ");
  return {
    userId: str(dto.userId) ?? "",
    membershipId: str(dto.membershipId),
    name: str(dto.name) ?? fullName,
    email: str(dto.email),
    username: str(dto.username),
    currentTruckUnitNumber: str(obj(dto.currentTruck)?.unitNumber),
  };
}

export const httpOrgPeopleService: OrgPeopleService = {
  async list(_ctx, family, query) {
    const res = await apiClient.get(`/organizations/${family}`, {
      params: queryParams({ ...query }),
    });
    return toPage(res.data, toOrgPerson);
  },
};
