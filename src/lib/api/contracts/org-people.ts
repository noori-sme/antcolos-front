import type { Paginated } from "@/types/common";
import type {
  OrgPeopleFamily, OrgPeopleQuery, OrgPerson, OrgPersonDetail,
} from "@/types/org-people";
import type { ServiceContext } from "./context";

/**
 * Organization people (NestJS `/organizations/{drivers,dispatchers,admins}`,
 * ../antcolos/docs/requirements/users-api-contract.md). Each family needs its
 * own permission (`membership.list_drivers`, `…_dispatchers`, `…_admins`).
 */
export interface OrgPeopleService {
  /** §2–§4 List. Active members of that system role in this org, name order. */
  list(
    ctx: ServiceContext,
    family: OrgPeopleFamily,
    query: OrgPeopleQuery,
  ): Promise<Paginated<OrgPerson>>;
  /** §2–§4 Get. Not an active member of that family → rejects (404). */
  get(ctx: ServiceContext, family: OrgPeopleFamily, userId: string): Promise<OrgPersonDetail>;
}
