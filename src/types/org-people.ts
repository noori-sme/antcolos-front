/**
 * Organization people as the NestJS people routes return them
 * (../antcolos/docs/requirements/users-api-contract.md §1–§4). One shape for
 * all three families; the family-specific fields are optional.
 */
export const ORG_PEOPLE_FAMILIES = ["drivers", "dispatchers", "admins"] as const;
export type OrgPeopleFamily = (typeof ORG_PEOPLE_FAMILIES)[number];

/** A driver's current truck (drivers list/detail). */
export interface OrgPersonTruck {
  assignmentId: string;
  truckId?: string;
  unitNumber?: string;
  startAt?: string;
}

/** One of a dispatcher's current truck assignments. */
export interface OrgPersonAssignment extends OrgPersonTruck {
  coverage?: string;
}

export interface OrgPersonAddress {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface OrgPerson {
  userId: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  /** Display name; falls back to first + last name. */
  name: string;
  username?: string;
  email: string;
  phone?: string;
  roleId: string;
  roleName: string;
  joinedAt: string;
  /** `ACTIVE`, `SUSPENDED`, `CLOSED`, … as the backend sends it. */
  accountStatus: string;
  /** Drivers only; `null` when the driver has no current truck. */
  currentTruck?: OrgPersonTruck | null;
  /** Dispatchers only; empty when none. */
  currentAssignments?: OrgPersonAssignment[];
  /** Admins only. */
  hasPermissionOverrides?: boolean;
}

/** Get adds the address (§2). */
export interface OrgPersonDetail extends OrgPerson {
  address: OrgPersonAddress | null;
}

export interface OrgPeopleQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}
