import { beforeEach, describe, expect, it } from "vitest";
import { effectivePermissions } from "@/lib/permissions/effective";
import { OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import type { Membership, PermissionKey } from "@/types";
import {
  MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER, NEWCOMER_USER,
} from "./fixtures";
import {
  grantMembership, liveMembershipFor, resetRoster, rosterServerSnapshot,
  rosterSnapshot, subscribeRoster,
} from "./membership-store";

/**
 * ★ A SEAT THAT APPEARS WHILE THE TAB IS OPEN ★
 *
 * The session used to read its memberships straight off a frozen fixture array,
 * with a comment explaining that nothing could change so nothing needed
 * notifying. That was true until something could grant a seat — and then it was
 * the difference between a `Membership` record existing and a person being able
 * to use their portal. Telling a driver who has just accepted an invitation to
 * reload the page is not letting them in.
 *
 * These tests prove the store underneath that, at the level a service will use
 * it. What a rendered page does with it is proved in the browser suite, because
 * "the portal appears without a reload" is a claim about a page and the only
 * honest way to check it is to render one.
 *
 * ★ NOT A PERMISSION SYSTEM ★
 * Note what the permission test below does: it takes the granted membership and
 * runs it through `effectivePermissions`, the one that already exists. The
 * store contributes nothing to the answer. A seat granted here is subject to
 * exactly the rules a seeded seat is subject to, because it goes through
 * exactly the same function.
 */

const CARRIER = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;

function driverSeat(overrides: Partial<Membership> = {}): Membership {
  return {
    id: "mem_test_driver",
    userId: NEWCOMER_USER.id,
    organizationId: CARRIER.id,
    status: "active",
    title: "Driver",
    templateIds: [`tpl_${CARRIER.id}_driver`],
    grants: [],
    revocations: [],
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "dp_test",
    isOwner: false,
    joinedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  resetRoster();
});

describe("the roster is readable the way React reads an external store", () => {
  it("gives the demo account its seeded seats", () => {
    const roster = rosterSnapshot("demo");
    expect(roster.memberships.length).toBeGreaterThan(0);
    expect(roster.memberships.every((m) => m.userId === MOCK_USER.id)).toBe(true);
  });

  it("gives a newcomer nothing, because they belong to nothing", () => {
    expect(rosterSnapshot("newcomer").memberships).toHaveLength(0);
    expect(rosterSnapshot("newcomer").organizations).toHaveLength(0);
  });

  it("returns a stable snapshot while nothing changes", () => {
    // `useSyncExternalStore` re-reads on every render and compares by identity.
    // A getter that rebuilt its array each call would re-render forever.
    expect(rosterSnapshot("demo")).toBe(rosterSnapshot("demo"));
    expect(rosterSnapshot("newcomer")).toBe(rosterSnapshot("newcomer"));
  });

  it("keeps the SERVER snapshot stable, and free of anything granted in a tab", () => {
    // React calls the server snapshot during render and again at hydration and
    // throws if they differ. The server has no tab, so it cannot know about a
    // seat granted in one.
    const before = rosterServerSnapshot("newcomer");
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });

    expect(rosterServerSnapshot("newcomer")).toBe(before);
    expect(rosterServerSnapshot("newcomer").memberships).toHaveLength(0);
    // ...while the client snapshot has moved on.
    expect(rosterSnapshot("newcomer").memberships).toHaveLength(1);
  });
});

describe("granting a seat", () => {
  it("makes it readable, and tells subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeRoster(() => { notified += 1; });

    const result = grantMembership({
      scenario: "newcomer", membership: driverSeat(), organization: CARRIER,
    });

    expect(result.status).toBe("granted");
    expect(notified).toBe(1);
    expect(rosterSnapshot("newcomer").memberships).toHaveLength(1);
    expect(rosterSnapshot("newcomer").memberships[0].id).toBe("mem_test_driver");
    unsubscribe();
  });

  it("changes the snapshot's identity, so a reader re-renders", () => {
    const before = rosterSnapshot("newcomer");
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    expect(rosterSnapshot("newcomer")).not.toBe(before);
  });

  it("carries the organization, so the seat is not a workspace with no name", () => {
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    const orgs = rosterSnapshot("newcomer").organizations;
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe(CARRIER.id);
  });

  it("stops after one subscriber unsubscribes", () => {
    let notified = 0;
    const unsubscribe = subscribeRoster(() => { notified += 1; });
    unsubscribe();
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    expect(notified).toBe(0);
  });

  it("leaves the other scenario's roster alone", () => {
    const demoBefore = rosterSnapshot("demo").memberships.length;
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    expect(rosterSnapshot("demo").memberships).toHaveLength(demoBefore);
  });
});

describe("granting the same seat twice", () => {
  it("produces one seat and reports the one already held", () => {
    const first = grantMembership({
      scenario: "newcomer", membership: driverSeat(), organization: CARRIER,
    });
    const second = grantMembership({
      // A retry, with a fresh id, as a caller re-running a half-finished
      // sequence would send. It is the PERSON and the ORGANIZATION that make it
      // the same seat, never the id the caller happened to generate.
      scenario: "newcomer",
      membership: driverSeat({ id: "mem_test_driver_retry" }),
      organization: CARRIER,
    });

    expect(first.status).toBe("granted");
    expect(second.status).toBe("already_held");
    expect(second.membership.id).toBe("mem_test_driver");
    expect(rosterSnapshot("newcomer").memberships).toHaveLength(1);
  });

  it("notifies once, not twice", () => {
    let notified = 0;
    const unsubscribe = subscribeRoster(() => { notified += 1; });
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    grantMembership({
      scenario: "newcomer", membership: driverSeat({ id: "other" }), organization: CARRIER,
    });
    expect(notified).toBe(1);
    unsubscribe();
  });

  it("adds the organization once", () => {
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    grantMembership({
      scenario: "newcomer", membership: driverSeat({ id: "other" }), organization: CARRIER,
    });
    expect(rosterSnapshot("newcomer").organizations).toHaveLength(1);
  });

  it("does give a second seat in a DIFFERENT organization", () => {
    const other = MOCK_ORGANIZATIONS.find((o) => o.id === "org_cascade")!;
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    const second = grantMembership({
      scenario: "newcomer",
      membership: driverSeat({ id: "mem_second", organizationId: other.id }),
      organization: other,
    });
    // One person may drive for two carriers. That is two relationships and two
    // seats, and it is not a duplicate.
    expect(second.status).toBe("granted");
    expect(rosterSnapshot("newcomer").memberships).toHaveLength(2);
  });

  it("finds the live seat by person and organization", () => {
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    expect(liveMembershipFor("newcomer", NEWCOMER_USER.id, CARRIER.id)?.id)
      .toBe("mem_test_driver");
    expect(liveMembershipFor("newcomer", "usr_somebody_else", CARRIER.id)).toBeUndefined();
  });

  it("does not treat a seat somebody has left as one they hold", () => {
    grantMembership({
      scenario: "newcomer",
      membership: driverSeat({ id: "mem_gone", status: "left" }),
      organization: CARRIER,
    });
    // Somebody who left and came back gets a new seat; the old one is history.
    const again = grantMembership({
      scenario: "newcomer", membership: driverSeat({ id: "mem_back" }), organization: CARRIER,
    });
    expect(again.status).toBe("granted");
  });
});

describe("a granted seat gets its permissions from the system that already exists", () => {
  it("resolves through effectivePermissions, not through this store", () => {
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    const seat = rosterSnapshot("newcomer").memberships[0];

    const permissions = effectivePermissions(seat, CARRIER, MOCK_TEMPLATES);

    // What a driver seat is for: their own loads, their own paperwork, their
    // own pay. Not the workspace.
    expect(permissions.has("loads:view" as PermissionKey)).toBe(true);
    expect(permissions.has("members:edit" as PermissionKey)).toBe(false);
    expect(permissions.has("permissions:manage" as PermissionKey)).toBe(false);
    expect(permissions.has("invitations:create" as PermissionKey)).toBe(false);
  });

  it("keeps the record scope that makes a driver seat narrow", () => {
    grantMembership({ scenario: "newcomer", membership: driverSeat(), organization: CARRIER });
    const seat = rosterSnapshot("newcomer").memberships[0];
    expect(seat.scope).toEqual(OWN_RECORDS_SCOPE);
    expect(seat.isOwner).toBe(false);
    expect(seat.driverProfileId).toBe("dp_test");
  });
});
