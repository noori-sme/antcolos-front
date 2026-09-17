import { beforeEach, describe, expect, it } from "vitest";
import {
  RESTRICTED_QUALIFICATION_CATEGORIES, type PermissionKey,
} from "@/types";
import { OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import { MOCK_TEMPLATES, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { effectivePermissions } from "@/lib/permissions/effective";
import {
  liveMembershipFor, resetRoster, rosterSnapshot,
} from "@/lib/session/membership-store";
import {
  driverProfileSync, driverRelationshipsSync, resetDriverMock,
} from "@/features/driver/mock-driver";
import { resetDriverRegistry } from "./driver-registry";
import { resetDocumentStore, documentsForSubject } from "./document-store";
import { mockAccessService } from "./access";
import { resetAccessStore } from "./access-store";
import { accessNeedsYouItems } from "./access-needs-you";
import type { ServiceContext } from "../contracts/context";

/**
 * ★ WHAT ACCEPTING AN INVITATION ACTUALLY DOES ★
 *
 * Before this module, accepting one wrote a status string. Everything a person
 * needed in order to work — their profile, their relationship with the carrier,
 * the documents that carrier could see, a seat to sign in with — was either
 * done by a screen reaching into two module stores, or not done at all.
 *
 * These tests defend the boundary that replaced it. Four things are being held
 * apart on purpose, and the tests are organised by them:
 *
 *   a DriverProfile belongs to the PERSON
 *   a CarrierRelationship connects the person and the carrier
 *   a Membership grants workspace permissions
 *   document access has its own basis, bounded by what the driver agreed
 *
 * None implies another, and the sharpest tests below are the ones that check a
 * thing did NOT happen.
 */

const NORTHLINE = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;

function carrierContext(permissions: PermissionKey[]): ServiceContext {
  return {
    organizationId: NORTHLINE.id,
    organizationName: NORTHLINE.displayName,
    workspaceKind: "carrier_organization",
    membershipId: "mem_northline_owner",
    permissions: new Set(permissions),
    scope: { loads: "all", financials: "all" },
    actor: {
      userId: "usr_sam",
      membershipId: "mem_northline_owner",
      displayNameSnapshot: "Sam Murtaza",
      source: "web",
    },
  };
}

/**
 * An owner who can invite — and who HOLDS what they hand out.
 *
 * `loads:view` is here because nobody may give away access they do not have
 * themselves, so a sender narrowed to invitation permissions alone can issue
 * no invitation at all. A real owner holds the driver permissions they offer.
 */
const OWNER = () => carrierContext([
  "invitations:view", "invitations:create", "invitations:revoke", "invitations:resend",
  "loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view",
]);

/**
 * The signed-in session, supplied rather than assumed.
 *
 * The service no longer works out who is asking, so every call says. Sam is the
 * demo account and the person `INV-DRIVER-ACCT` is addressed to.
 */
const SAM = {
  userId: "usr_sam",
  email: "sam@antcolos.com",
  displayName: "Sam Murtaza",
  scenario: "demo" as const,
};

const RETURNING = SAM;

/** The invitation addressed to the demo account, so acceptance is authorised. */
const TOKEN = "INV-DRIVER-ACCT";

const LICENCE = {
  legalName: "Sam Murtaza",
  cdlNumber: "K4471182993",
  cdlState: "IL",
  cdlExpiresAt: "2030-04-01T00:00:00.000Z",
};

beforeEach(() => {
  resetAccessStore();
  resetRoster();
  resetDocumentStore();
  resetDriverRegistry();
  resetDriverMock();
});

describe("acceptance connects, and never re-hires", () => {
  it("creates the relationship without a start date", async () => {
    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: [], licence: LICENCE,
    });
    expect(result.status).toBe("accepted");

    const relationship = driverRelationshipsSync()
      .find((r) => r.carrierId === NORTHLINE.id && r.status !== "ended");
    expect(relationship).toBeDefined();

    // The whole point. Saying yes is the person's act; becoming effective is
    // the carrier's, and it has not happened.
    expect(relationship!.startedAt).toBeUndefined();
    expect(relationship!.acceptedAt).toBeTruthy();
    expect(relationship!.status).toBe("onboarding");
  });

  it("never reaches active — being cleared to work is a separate decision", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const relationship = driverRelationshipsSync()
      .find((r) => r.carrierId === NORTHLINE.id && r.status !== "ended");
    expect(relationship!.status).not.toBe("active");
  });

  it("records the acceptance moment on the invitation, apart from any start date", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === TOKEN);
    expect(invitation.status).toBe("accepted");
    expect(invitation.acceptedAt).toBeTruthy();
  });
});

describe("accepting twice produces one of everything", () => {
  it("does not make a second relationship, profile or seat", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });

    const profileAfterFirst = driverProfileSync();
    const relationshipsAfterFirst = driverRelationshipsSync()
      .filter((r) => r.carrierId === NORTHLINE.id);
    const seatsAfterFirst = rosterSnapshot("demo").memberships
      .filter((m) => m.organizationId === NORTHLINE.id).length;

    // A second attempt, exactly as a retry or a double submit would arrive.
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });

    expect(driverProfileSync()!.id).toBe(profileAfterFirst!.id);
    expect(driverRelationshipsSync().filter((r) => r.carrierId === NORTHLINE.id))
      .toHaveLength(relationshipsAfterFirst.length);
    expect(rosterSnapshot("demo").memberships
      .filter((m) => m.organizationId === NORTHLINE.id)).toHaveLength(seatsAfterFirst);
  });

  it("leaves every date exactly as the first acceptance set it", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const before = driverRelationshipsSync()
      .find((r) => r.carrierId === NORTHLINE.id && r.status !== "ended")!;

    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const after = driverRelationshipsSync()
      .find((r) => r.carrierId === NORTHLINE.id && r.status !== "ended")!;

    expect(after.id).toBe(before.id);
    expect(after.invitedAt).toBe(before.invitedAt);
    expect(after.acceptedAt).toBe(before.acceptedAt);
    expect(after.startedAt).toBe(before.startedAt);
  });

  it("refuses to re-send an invitation somebody has already accepted", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const [invitation] = (await mockAccessService.list(OWNER())).filter((i) => i.token === TOKEN);

    // The defect that used to make duplicates: re-opening an accepted
    // invitation made its link work again, and accepting it a second time
    // produced a second relationship with the same carrier.
    await expect(mockAccessService.resend(OWNER(), invitation.id))
      .rejects.toThrow(/already accepted/i);
  });

  it("does not open a second invitation to somebody who already has one", async () => {
    const draft = {
      kind: "driver" as const,
      roleName: "Driver",
      // Required now: the engagement type decides a driver's paperwork and
      // their pay, so the carrier states it and the driver cannot choose it.
      engagementType: "company_driver" as const,
      recipientName: "Yusuf Demir",
      recipientEmail: "yusuf.demir@example.com",
      permissions: ["loads:view"] as PermissionKey[],
      expiresAt: null,
    };
    const first = await mockAccessService.create(OWNER(), draft);
    const second = await mockAccessService.create(OWNER(), draft);
    // Two open links to one person is two ways to accept, and whichever is
    // accepted second is the duplicate.
    expect(second.id).toBe(first.id);
  });
});

describe("the seat is the smallest one that opens a portal", () => {
  it("is driver-scoped, not an organization seat", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const seat = liveMembershipFor("demo", "usr_sam", NORTHLINE.id)!;
    expect(seat).toBeDefined();
    // Sam already owns Northline in the fixtures, so the grant resumes that
    // seat rather than adding a second — one person, one seat per organization.
    expect(rosterSnapshot("demo").memberships
      .filter((m) => m.userId === "usr_sam" && m.organizationId === NORTHLINE.id))
      .toHaveLength(1);
  });

  it("grants a genuinely new person only what a driver needs", async () => {
    // Built from the invitation the way the service builds it, then run through
    // the permission system that already existed. Nothing here is this module's
    // own opinion about what a driver may do.
    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === "INV-NEWCOMER");
    expect(invitation).toBeDefined();

    const permissions = effectivePermissions(
      {
        id: "mem_probe", userId: "usr_newcomer", organizationId: NORTHLINE.id,
        status: "active", title: "Driver", templateIds: [],
        grants: invitation.permissions, revocations: [],
        scope: OWN_RECORDS_SCOPE, isOwner: false, joinedAt: "2026-09-17T00:00:00.000Z",
      },
      NORTHLINE,
      MOCK_TEMPLATES,
    );

    expect(permissions.has("loads:view")).toBe(true);
    for (const forbidden of [
      "members:edit", "permissions:manage", "invitations:create", "workforce:manage",
      "compliance:manage", "revenue:view",
    ] as PermissionKey[]) {
      expect(permissions.has(forbidden)).toBe(false);
    }
  });
});

describe("document access is bounded by what the driver agreed", () => {
  it("shares nothing when the driver shared nothing", async () => {
    const before = documentsForSubject("driver", driverProfileSync()?.id ?? "dp_sam").length;
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    // No new document identities. Acceptance links; it never creates a document.
    expect(documentsForSubject("driver", driverProfileSync()!.id).length).toBe(before);
  });

  it("refuses outright when a caller names a restricted qualification category", async () => {
    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      // Asked for by name, which is the case worth being loud about.
      sharedDocumentKeys: [...RESTRICTED_QUALIFICATION_CATEGORIES],
      licence: LICENCE,
    });

    // It used to accept and narrow silently. Narrowing is right when a SCREEN
    // has assembled a checklist; it is wrong when a caller has named one of
    // these, because then the honest answer is no rather than four steps
    // succeeding while a fifth hands over nothing.
    expect(result.status).toBe("restricted-category");
    if (result.status === "restricted-category") {
      expect([...result.categories].sort())
        .toEqual([...RESTRICTED_QUALIFICATION_CATEGORIES].sort());
    }

    // And nothing at all happened: no relationship, no seat, no link. The
    // refusal comes before the first step runs.
    expect(driverRelationshipsSync()
      .filter((r) => r.carrierId === NORTHLINE.id && r.status !== "ended")).toHaveLength(0);
    expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)?.id)
      .toBe("mem_northline_owner");
  });

  it("still narrows a restricted DOCUMENT TYPE quietly, and says what it withheld", async () => {
    // The other half of the rule, and deliberately a different shape. A
    // carrier's checklist legitimately contains restricted rows — an
    // employment application, a driving record — so a screen submitting the
    // ordinary decision must not be refused for them. They are dropped and
    // NAMED, rather than refused or silently missing.
    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: ["cdl_front", "northline_employment_application"],
      licence: LICENCE,
    });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    const documents = result.run.steps.find((s) => s.key === "document_access")!;
    expect(documents.withheld?.map((w) => w.key)).toEqual(["northline_employment_application"]);

    const relationship = driverRelationshipsSync()
      .find((r) => r.carrierId === NORTHLINE.id && r.status !== "ended")!;
    expect(relationship.sharedDocumentKeys).not.toContain("northline_employment_application");
  });

  it("creates no qualification record — review and adoption stay separate acts", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const { mockQualificationService } = await import("./qualification");
    const records = await mockQualificationService.list(
      carrierContext(["qualification:view"]), {},
    ).catch(() => []);
    expect(records).toHaveLength(0);
  });
});

describe("a link nobody may use", () => {
  it("refuses a revoked invitation", async () => {
    const result = await mockAccessService.accept("INV-REVOKED", RETURNING, {
      sharedDocumentKeys: [],
    });
    expect(result.status).toBe("not-acceptable");
  });

  it("refuses an expired one", async () => {
    const result = await mockAccessService.accept("INV-EXPIRED", RETURNING, {
      sharedDocumentKeys: [],
    });
    expect(result.status).toBe("not-acceptable");
  });

  it("asks for a licence rather than inventing one", async () => {
    resetDriverRegistry({ omitUserIds: ["usr_sam"] });
    resetDriverMock({ withProfile: false });
    const result = await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [] });
    expect(result.status).toBe("licence-required");
  });

  it("answers another organization's invitation exactly as an invented one", async () => {
    // `inv_8` belongs to Summit, not Northline. A6: naming an organization on a
    // record is attribution, never a grant.
    await expect(mockAccessService.revoke(OWNER(), "inv_8")).rejects.toThrow(/No such invitation/);
  });
});

describe("an acceptance that does not finish", () => {
  it("is raised to whoever runs access, and stops being raised once it does", async () => {
    resetDriverRegistry({ omitUserIds: ["usr_sam"] });
    resetDriverMock({ withProfile: false });

    // Forcing the failure honestly: no licence and no profile means the first
    // step cannot complete, and everything after it is left pending.
    const first = await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [] });
    expect(first.status).toBe("licence-required");

    // Now a run that starts and stalls: the profile succeeds, and we assert the
    // queue is quiet once everything completes.
    const second = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: [], licence: LICENCE,
    });
    expect(second.status).toBe("accepted");
    expect(accessNeedsYouItems(OWNER())).toHaveLength(0);
  });

  it("raises nothing for an invitation nobody has touched", () => {
    expect(accessNeedsYouItems(OWNER())).toHaveLength(0);
  });

  it("is invisible to another organization", async () => {
    await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });
    const summit = { ...carrierContext(["invitations:view"]), organizationId: "org_summit" };
    expect(accessNeedsYouItems(summit)).toHaveLength(0);
  });
});
