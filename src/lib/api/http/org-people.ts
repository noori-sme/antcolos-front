import { apiClient } from "../client";
import type { OrgPeopleService } from "../contracts/org-people";
import { type Dto, obj, objects, queryParams, str, toPage } from "./dto";
import type {
  OrgPerson, OrgPersonAddress, OrgPersonAssignment, OrgPersonDetail, OrgPersonTruck,
} from "@/types/org-people";

function toTruck(dto: Dto): OrgPersonTruck {
  return {
    assignmentId: str(dto.assignmentId) ?? "",
    truckId: str(dto.truckId),
    unitNumber: str(dto.unitNumber),
    startAt: str(dto.startAt),
  };
}

function toAssignment(dto: Dto): OrgPersonAssignment {
  return { ...toTruck(dto), coverage: str(dto.coverage) };
}

function toAddress(dto: Dto): OrgPersonAddress {
  return {
    addressLine1: str(dto.addressLine1),
    addressLine2: str(dto.addressLine2),
    postalCode: str(dto.postalCode),
    city: str(dto.city),
    state: str(dto.state),
    country: str(dto.country),
  };
}

/** Users contract §2–§4 list item → `OrgPerson`. Family fields only when sent. */
export function toOrgPerson(dto: Dto): OrgPerson {
  const firstName = str(dto.firstName) ?? "";
  const lastName = str(dto.lastName) ?? "";
  const person: OrgPerson = {
    userId: str(dto.userId) ?? "",
    membershipId: str(dto.membershipId) ?? "",
    firstName,
    lastName,
    name: str(dto.name) ?? [firstName, lastName].filter(Boolean).join(" "),
    username: str(dto.username),
    email: str(dto.email) ?? "",
    phone: str(dto.phone),
    roleId: str(dto.roleId) ?? "",
    roleName: str(dto.roleName) ?? "",
    joinedAt: str(dto.joinedAt) ?? "",
    accountStatus: str(dto.accountStatus) ?? "",
  };
  if ("currentTruck" in dto) {
    const truck = obj(dto.currentTruck);
    person.currentTruck = truck ? toTruck(truck) : null;
  }
  if ("currentAssignments" in dto) {
    person.currentAssignments = objects(dto.currentAssignments).map(toAssignment);
  }
  if ("hasPermissionOverrides" in dto) {
    person.hasPermissionOverrides = dto.hasPermissionOverrides === true;
  }
  return person;
}

/** Get: the list item plus `address`. */
export function toOrgPersonDetail(dto: Dto): OrgPersonDetail {
  const address = obj(dto.address);
  return { ...toOrgPerson(dto), address: address ? toAddress(address) : null };
}

export const httpOrgPeopleService: OrgPeopleService = {
  async list(_ctx, family, query) {
    const res = await apiClient.get(`/organizations/${family}`, {
      params: queryParams({ ...query }),
    });
    return toPage(res.data, toOrgPerson);
  },
  async get(_ctx, family, userId) {
    const res = await apiClient.get(`/organizations/${family}/${encodeURIComponent(userId)}`);
    // Unwrapped per the contract; tolerate a `{ data }` envelope too.
    const body = obj(res.data);
    return toOrgPersonDetail(obj(body?.data) ?? body ?? {});
  },
};
