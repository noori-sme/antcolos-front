/**
 * Organization people as the NestJS people lists return them
 * (../antcolos/docs/requirements/users-api-contract.md §2–§4). Only what the
 * truck assignee picker needs; the people screens move onto this in F0.2.
 */
export const ORG_PEOPLE_FAMILIES = ["drivers", "dispatchers", "admins"] as const;
export type OrgPeopleFamily = (typeof ORG_PEOPLE_FAMILIES)[number];

export interface OrgPerson {
  userId: string;
  membershipId?: string;
  name: string;
  email?: string;
  username?: string;
  /** Drivers only: the truck this person currently drives in this org. */
  currentTruckUnitNumber?: string;
}

export interface OrgPeopleQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}
