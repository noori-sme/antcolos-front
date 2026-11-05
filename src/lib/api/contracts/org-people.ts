import type { Paginated } from "@/types/common";
import type { OrgPeopleFamily, OrgPeopleQuery, OrgPerson } from "@/types/org-people";
import type { ServiceContext } from "./context";

/**
 * Organization people lists (NestJS `/organizations/{drivers,dispatchers,admins}`,
 * ../antcolos/docs/requirements/users-api-contract.md). Each list needs its own
 * permission (`membership.list_drivers`, `…_dispatchers`, `…_admins`).
 */
export interface OrgPeopleService {
  /** §2–§4 List. Active members of that system role in this org, name order. */
  list(
    ctx: ServiceContext,
    family: OrgPeopleFamily,
    query: OrgPeopleQuery,
  ): Promise<Paginated<OrgPerson>>;
}
