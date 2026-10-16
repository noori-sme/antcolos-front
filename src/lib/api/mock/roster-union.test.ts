import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { services } from "@/lib/api";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import {
  resetRoster, rosterSnapshot, setMembershipStatus, subscribeRoster,
} from "@/lib/session/membership-store";
import { memberById, membersOf, resetMembershipDirectory } from "./membership-directory";
import { resetTemplateStore } from "./template-store";
import { resetAccessStore } from "./access-store";
import { liveSeatFor, rosterOf } from "./access";

/**
 * The roster is answered by TWO stores, and this is what that costs.
 *
 * The membership directory holds who is IN an organization. The session store
 * holds the seats THIS TAB has, including any granted at runtime by somebody
 * accepting an invitation. `rosterOf` reads both, and every one of these tests
 * exists because unioning the READ path while leaving a WRITE path pointed at
 * one store produced a specific, demonstrable lie:
 *
 *   • a removed person came back from the fixture copy, reading `active`
 *   • ending a colleague's seat did nothing and reported success
 *   • one person could hold two live seats in one organization
 *   • a directory write changed the answer and notified nobody
 *
 * None of this is security — both stores are in-memory fixtures. It is
 * consistency, which is the property a roster has to have before any
 * authorization built on it can mean anything.
 */

const NORTHLINE = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;

/** A seat present in BOTH stores: every fixture membership is. */
const IN_BOTH = "mem_meridian_dispatcher";
/** A seat present in the directory ONLY. */
const DIRECTORY_ONLY = "mem_northline_paige";

beforeEach(() => {
  resetTemplateStore();
  resetAccessStore();
  resetRoster();
  resetMembershipDirectory();
});

describe("the two stores overlap, and the session copy is authoritative", () => {
  it("still holds ids that exist in both", () => {
    // If this stops being true the rest of the file is testing nothing.
    const session = new Set(
      rosterSnapshot("demo").memberships
        .filter((m) => m.organizationId === "org_meridian").map((m) => m.id),
    );
    const directory = membersOf("org_meridian").map((m) => m.membershipId);
    expect(directory.filter((id) => session.has(id))).toContain(IN_BOTH);
  });

  it("lists nobody twice", () => {
    for (const org of MOCK_ORGANIZATIONS) {
      const ids = rosterOf(org.id).map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("answers with the session copy's status, suspended or left", () => {
    setMembershipStatus("demo", IN_BOTH, "suspended");
    expect(rosterOf("org_meridian").find((m) => m.id === IN_BOTH)?.status).toBe("suspended");

    setMembershipStatus("demo", IN_BOTH, "left");
    // ★ The regression: `left` used to fall through to the directory's active
    // fixture copy, because the id was not claimed before the status was read.
    expect(rosterOf("org_meridian").some((m) => m.id === IN_BOTH)).toBe(false);
  });
});

describe("ending a seat ends it, in whichever store owns it", () => {
  it("removes somebody whose seat is in both stores", async () => {
    const ctx = contextFor("org_meridian", { with: ["members:suspend"] });
    expect(rosterOf("org_meridian").some((m) => m.id === ctx.membershipId)).toBe(true);

    const result = await services.access.leaveOrganization(ctx);
    expect(result.status).toBe("ended");
    expect(rosterOf("org_meridian").some((m) => m.id === ctx.membershipId)).toBe(false);
  });

  it("removes a colleague whose seat is only in the directory", async () => {
    const ctx = contextFor("org_northline");
    const before = rosterOf("org_northline").length;

    const result = await services.access.endSeat(ctx, DIRECTORY_ONLY, "no longer with us");
    expect(result.status).toBe("ended");
    // It used to return `ended` and change nothing at all.
    expect(rosterOf("org_northline").some((m) => m.id === DIRECTORY_ONLY)).toBe(false);
    expect(rosterOf("org_northline")).toHaveLength(before - 1);
  });

  it("takes their permissions with them", async () => {
    const ctx = contextFor("org_northline");
    await services.access.endSeat(ctx, DIRECTORY_ONLY, "no longer with us");
    expect(memberById(DIRECTORY_ONLY)?.permissions.size).toBe(0);
  });

  it("still refuses to remove the last owner", async () => {
    const ctx = contextFor("org_northline");
    const owners = rosterOf("org_northline").filter((m) => m.isOwner);
    expect(owners).toHaveLength(1);
    const result = await services.access.leaveOrganization(ctx);
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("last_owner");
    expect(rosterOf("org_northline").filter((m) => m.isOwner)).toHaveLength(1);
  });
});

describe("one person, one live seat per organization", () => {
  it("resumes the seat somebody already holds rather than minting a second", async () => {
    const ctx = contextFor("org_northline");
    const paige = memberById(DIRECTORY_ONLY)!;
    const before = rosterOf("org_northline").length;

    const invitation = await services.access.create(ctx, {
      kind: "employee",
      roleName: "Employee",
      recipientName: paige.displayName,
      recipientEmail: "paige@example.com",
      permissions: ["loads:view"],
      expiresAt: null,
    });

    const result = await services.access.accept(
      invitation.token!,
      {
        userId: paige.userId,
        email: "paige@example.com",
        displayName: paige.displayName,
        scenario: "demo",
      },
      { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("accepted");

    /*
     * ★ THE REGRESSION ★
     * The acceptance path used to ask `liveMembershipFor`, which sees only the
     * session store. Paige's seat is in the directory, so she read as holding
     * none and was handed a second one — two live seats in one organization,
     * two answers to what she may do here, and two rows on the People screen.
     */
    const seats = rosterOf("org_northline").filter((m) => m.userId === paige.userId);
    expect(seats).toHaveLength(1);
    expect(seats[0].id).toBe(DIRECTORY_ONLY);
    expect(rosterOf("org_northline")).toHaveLength(before);
  });

  it("answers `liveSeatFor` from either store", () => {
    const paige = memberById(DIRECTORY_ONLY)!;
    expect(liveSeatFor(paige.userId, "org_northline")?.id).toBe(DIRECTORY_ONLY);
    // And a seat the session store owns, which it could already see.
    const sam = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!;
    expect(liveSeatFor(sam.userId, "org_northline")?.id).toBe("mem_northline_owner");
  });

  it("does not resume a seat somebody left", async () => {
    const ctx = contextFor("org_northline");
    const paige = memberById(DIRECTORY_ONLY)!;
    await services.access.endSeat(ctx, DIRECTORY_ONLY, "left the company");
    // History, not a reason to refuse them a new seat later.
    expect(liveSeatFor(paige.userId, "org_northline")).toBeUndefined();
  });
});

describe("a directory write reaches the screens", () => {
  it("notifies the one roster subscription", async () => {
    const ctx = contextFor("org_northline");
    const created = await services.access.createTemplate(ctx, {
      name: "Notify probe", description: "", permissions: ["loads:view", "loads:export"],
    });
    if (created.status !== "saved") throw new Error(created.message);

    let fired = 0;
    const unsubscribe = subscribeRoster(() => { fired += 1; });
    await services.access.applyToMembership(ctx, DIRECTORY_ONLY, created.template.id);
    unsubscribe();

    expect(fired).toBeGreaterThan(0);
  });

  it("and the change is visible through the directory's own reader", async () => {
    const ctx = contextFor("org_northline");
    const created = await services.access.createTemplate(ctx, {
      name: "Export role", description: "", permissions: ["loads:view", "loads:export"],
    });
    if (created.status !== "saved") throw new Error(created.message);

    expect(memberById(DIRECTORY_ONLY)!.permissions.has("loads:export")).toBe(false);
    await services.access.applyToMembership(ctx, DIRECTORY_ONLY, created.template.id);
    expect(memberById(DIRECTORY_ONLY)!.permissions.has("loads:export")).toBe(true);
  });
});

describe("the union stays inside one organization", () => {
  it("never lists a foreign seat", () => {
    for (const org of MOCK_ORGANIZATIONS) {
      for (const m of rosterOf(org.id)) expect(m.organizationId).toBe(org.id);
    }
  });

  it("never answers `liveSeatFor` with a seat from elsewhere", () => {
    for (const m of MOCK_MEMBERSHIPS) {
      const elsewhere = MOCK_ORGANIZATIONS.find((o) => o.id !== m.organizationId)!;
      const found = liveSeatFor(m.userId, elsewhere.id);
      if (found) expect(found.organizationId).toBe(elsewhere.id);
    }
  });

  it("counts only this organization's holders", async () => {
    const ctx = contextFor("org_northline");
    for (const summary of await services.access.templates(ctx)) {
      expect(summary.template.organizationId).toBe(NORTHLINE.id);
      expect(summary.memberCount).toBeLessThanOrEqual(rosterOf(NORTHLINE.id).length);
    }
  });
});
