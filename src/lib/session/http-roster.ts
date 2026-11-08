import type { Membership, Organization } from "@/types";
import type { SessionRoster } from "./membership-store";

/**
 * One row of `GET /api/v1/users/me/memberships`
 * (`../antcolos/docs/requirements/membership-api-contract.md`).
 */
export interface MyMembershipDto {
  organizationId: string;
  organizationName: string;
  organizationType: "CARRIER" | "DISPATCHING_COMPANY";
  /** System slug (`ADMIN`, `DISPATCHER`, `DRIVER`, `ACCOUNTANT`) or a custom role UUID. */
  roleId: string;
  joinedAt: string;
}

const ROLE_TITLES: Record<string, string> = {
  ADMIN: "Admin",
  DISPATCHER: "Dispatcher",
  DRIVER: "Driver",
  ACCOUNTANT: "Accountant",
};

/**
 * The http-mode session roster (plan 08): the membership for the organization
 * the tenant JWT is scoped to, with its real name. Other memberships are
 * left out, because switching to them needs a token for that organization
 * and the backend has no switch endpoint yet. Permissions are not taken from
 * here: they come from `/users/me/permissions`.
 *
 * The API returns no membership id, so the id is `org:<organizationId>`. The
 * title is display only (never a permission source). A custom role reads
 * "Member".
 */
export function toSessionRoster(
  rows: MyMembershipDto[],
  me: { userId: string; organizationId: string | null | undefined; timeZone: string },
): SessionRoster {
  const row = rows.find((r) => r.organizationId === me.organizationId);
  if (!row) return { memberships: [], organizations: [] };

  const organization: Organization = {
    id: row.organizationId,
    type: row.organizationType === "CARRIER" ? "CARRIER" : "DISPATCH_AGENCY",
    legalName: row.organizationName,
    displayName: row.organizationName,
    timeZone: me.timeZone,
    // Not returned by this API; the join date is the closest fact we have.
    createdAt: row.joinedAt,
  };

  const membership: Membership = {
    id: `org:${row.organizationId}`,
    userId: me.userId,
    organizationId: row.organizationId,
    status: "active",
    title: ROLE_TITLES[row.roleId] ?? "Member",
    appliedTemplates: [],
    grants: [],
    revocations: [],
    scope: { loads: "all", financials: "all" },
    isOwner: false,
    joinedAt: row.joinedAt,
  };

  return { memberships: [membership], organizations: [organization] };
}
