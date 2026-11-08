import { describe, expect, it } from "vitest";
import type { OrgPerson } from "@/types/org-people";
import { toTeamRoster } from "./team-roster";

function person(overrides: Partial<OrgPerson>): OrgPerson {
  return {
    userId: "u1", membershipId: "m1", firstName: "Jordan", lastName: "Lee", name: "Jordan Lee",
    email: "jordan@example.com", roleId: "DRIVER", roleName: "Driver",
    joinedAt: "2026-08-27T12:00:00.000Z", accountStatus: "ACTIVE",
    ...overrides,
  };
}

describe("toTeamRoster", () => {
  it("lists drivers, then dispatchers, then admins with their role", () => {
    const roster = toTeamRoster({
      drivers: [person({ userId: "d1", email: "d@example.com" })],
      dispatchers: [person({ userId: "s1", email: "s@example.com" })],
      admins: [person({ userId: "a1", email: "a@example.com" })],
    });
    expect(roster.map((m) => [m.userId, m.role])).toEqual([
      ["d1", "Driver"], ["s1", "Dispatcher"], ["a1", "Admin"],
    ]);
  });

  it("lists a person once, matched by email case-insensitively (first list wins)", () => {
    const roster = toTeamRoster({
      drivers: [person({ userId: "u1", email: "Same@Example.com" })],
      admins: [person({ userId: "u1", email: "same@example.com" })],
    });
    expect(roster).toHaveLength(1);
    expect(roster[0].role).toBe("Driver");
  });

  it("skips a failed list, people without email, and names from first + last", () => {
    const roster = toTeamRoster({
      drivers: undefined,
      dispatchers: [
        person({ userId: "s1", email: "", firstName: "No", lastName: "Email" }),
        person({ userId: "s2", email: "s2@example.com", firstName: "", lastName: "", name: "Display" }),
      ],
    });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ userId: "s2", name: "Display", status: "ACTIVE" });
  });
});
