import { describe, expect, it } from "vitest";
import { toSessionRoster, type MyMembershipDto } from "./http-roster";

// From ../antcolos/docs/requirements/membership-api-contract.md (GET /users/me/memberships),
// plus a second organization and a custom role.
const ROWS: MyMembershipDto[] = [
  {
    organizationId: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
    organizationName: "Acme Haulage",
    organizationType: "CARRIER",
    roleId: "DRIVER",
    joinedAt: "2026-08-27T12:00:00.000Z",
  },
  {
    organizationId: "11111111-2222-4333-8444-555555555555",
    organizationName: "Pacific Dispatch LLC",
    organizationType: "DISPATCHING_COMPANY",
    roleId: "0b5e2f7a-1c3d-4e5f-9a8b-7c6d5e4f3a2b",
    joinedAt: "2026-09-01T09:30:00.000Z",
  },
];

const ME = { userId: "u-1", timeZone: "America/Chicago" };

describe("toSessionRoster", () => {
  it("keeps only the JWT's organization, with its real name and type", () => {
    const roster = toSessionRoster(ROWS, { ...ME, organizationId: ROWS[0].organizationId });
    expect(roster.organizations).toEqual([
      expect.objectContaining({
        id: ROWS[0].organizationId,
        displayName: "Acme Haulage",
        legalName: "Acme Haulage",
        type: "CARRIER",
        timeZone: "America/Chicago",
      }),
    ]);
    expect(roster.memberships).toEqual([
      expect.objectContaining({
        id: `org:${ROWS[0].organizationId}`,
        userId: "u-1",
        organizationId: ROWS[0].organizationId,
        status: "active",
        title: "Driver",
        isOwner: false,
      }),
    ]);
  });

  it("maps a dispatching company and names a custom role 'Member'", () => {
    const roster = toSessionRoster(ROWS, { ...ME, organizationId: ROWS[1].organizationId });
    expect(roster.organizations[0].type).toBe("DISPATCH_AGENCY");
    expect(roster.memberships[0].title).toBe("Member");
  });

  it("is empty when the token has no organization or it is not in the list", () => {
    expect(toSessionRoster(ROWS, { ...ME, organizationId: null })).toEqual({ memberships: [], organizations: [] });
    expect(toSessionRoster(ROWS, { ...ME, organizationId: "other" })).toEqual({ memberships: [], organizations: [] });
  });

  it("never carries permissions: those come from /users/me/permissions", () => {
    const [m] = toSessionRoster(ROWS, { ...ME, organizationId: ROWS[0].organizationId }).memberships;
    expect(m.appliedTemplates).toEqual([]);
    expect(m.grants).toEqual([]);
    expect(m.revocations).toEqual([]);
  });
});
