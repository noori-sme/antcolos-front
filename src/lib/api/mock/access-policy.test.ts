import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { PermissionKey } from "@/types";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import {
  liveMembershipFor, resetRoster, rosterSnapshot, setMembershipStatus,
} from "@/lib/session/membership-store";
import { ordinaryDocumentKeys, splitByRestriction } from "@/lib/documents/requirements";
import { isRestrictedDocumentType } from "@/lib/documents/catalog";
import {
  documentRequirements, mockCreateRelationship, resetDriverMock,
} from "@/features/driver/mock-driver";
import {
  activateCarrierRelationship, createOrResumeRelationship, liveRelationship, profileForUser,
  resetDriverRegistry, setAssertedStartForTests,
} from "./driver-registry";
import { documentsForSubject, resetDocumentStore } from "./document-store";
import { auditLedger, resetAuditLedger } from "./audit-ledger";
import * as access from "./access";
import { failAcceptanceStepForTests } from "./access";
import { mockAccessService, rosterOf } from "./access";

const endSeat = mockAccessService.endSeat;
const leaveOrganization = mockAccessService.leaveOrganization;
import { resetAccessStore } from "./access-store";
import { resetWorkforceStore } from "./workforce-store";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";

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


/**
 * ★ THE POLICY THE ACCESS SERVICE ENFORCES, AS OPPOSED TO THE PLUMBING ★
 *
 * `access.test.ts` proves that accepting an invitation creates the right
 * records and `access-interruption.test.ts` proves it survives being
 * interrupted. This file proves the RULES around both: who may hand out what,
 * what joining never hands over, and that access can be taken away again
 * without reaching into a life the organization does not own.
 *
 * Much of what is asserted here came from a second, independent PR-2 built in
 * another session (`claude/pr2-restricted-docs`). Its Access service is not in
 * this tree — there is one — but the behaviors it proved are, and these are the
 * tests that keep them.
 */

const NORTHLINE = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;

function context(permissions: PermissionKey[]): ServiceContext {
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

const DRIVER_ACCESS: PermissionKey[] = [
  "loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view",
];

const SENDER = () => context(["invitations:view", "invitations:create", ...DRIVER_ACCESS]);

const draft = (over: Record<string, unknown> = {}) => ({
  kind: "driver" as const,
  roleName: "Driver",
  engagementType: "company_driver" as const,
  recipientName: "Yusuf Demir",
  recipientEmail: "yusuf.demir@example.com",
  permissions: [...DRIVER_ACCESS],
  expiresAt: null,
  ...over,
});

const denials = () => auditLedger.all(NORTHLINE.id)
  .filter((e) => e.action === "access.permission_denied").length;

/** Seeded fixtures contain refusals of their own, so count the DELTA. */
let denialsAtStart = 0;

beforeEach(() => {
  resetAccessStore();
  resetRoster();
  resetDocumentStore();
  resetAuditLedger();
  resetDriverRegistry();
  resetDriverMock();
  resetWorkforceStore();
  denialsAtStart = denials();
});

/**
 * Northline seeds exactly one seat — its owner — so a removal test needs a seat
 * that is not the last owner. Accepting the driver invitation makes one, which
 * is also the honest shape: the seat you take away is the seat joining created.
 */
async function seatFromAcceptance(): Promise<string> {
  setMembershipStatus("demo", "mem_northline_owner", "left");
  resetDriverRegistry({ omitUserIds: ["usr_sam"] });
  resetDriverMock({ withProfile: false });
  const result = await mockAccessService.accept(
    "INV-DRIVER-ACCT", SAM,
    {
      sharedDocumentKeys: [],
      licence: {
        legalName: "Sam Murtaza", cdlNumber: "K4471182993",
        cdlState: "IL", cdlExpiresAt: "2030-04-01T00:00:00.000Z",
      },
    },
  );
  if (result.status !== "accepted") throw new Error(`expected acceptance, got ${result.status}`);
  return liveMembershipFor("demo", "usr_sam", NORTHLINE.id)!.id;
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                     */
/* -------------------------------------------------------------------------- */

describe("nobody hands out access they do not hold", () => {
  it("refuses, names the exact keys, and records the refusal", async () => {
    // A dispatcher who may invite, but holds no permission to manage roles.
    const ctx = context(["invitations:create", "loads:view"]);
    const before = (await mockAccessService.list(context(["invitations:view"]))).length;
    await expect(mockAccessService.create(ctx, draft({
      permissions: ["loads:view", "permissions:manage"] as PermissionKey[],
    }))).rejects.toBeInstanceOf(PermissionDeniedError);

    // "Some of this is not yours to give" is unactionable. The keys are named.
    expect(denials() - denialsAtStart).toBe(1);
    const latest = auditLedger.all(NORTHLINE.id)
      .filter((e) => e.action === "access.permission_denied")
      .find((e) => e.permissionContext?.missing?.includes("permissions:manage"));
    expect(latest?.permissionContext?.missing).toEqual(["permissions:manage"]);

    // And nothing was issued. (Yusuf already has a seeded invitation, so the
    // check is that no NEW one appeared, not that none exists.)
    expect(await mockAccessService.list(context(["invitations:view"]))).toHaveLength(before);
  });

  it("clamps as well as refusing, so a later caller cannot widen anything", async () => {
    const issued = await mockAccessService.create(SENDER(), draft());
    // Every key on the invitation is one the sender held.
    for (const key of issued.permissions) expect(SENDER().permissions.has(key)).toBe(true);
  });

  it("refuses somebody with no invitations:create at all", async () => {
    await expect(mockAccessService.create(context(["invitations:view"]), draft()))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a driver invitation that does not say which kind of driver", async () => {
    // The engagement type decides paperwork and pay. It is the carrier's to
    // state, and leaving it out would leave the driver to pick their own terms.
    await expect(mockAccessService.create(SENDER(), draft({ engagementType: undefined })))
      .rejects.toThrow(/company driver or an owner-operator/);
  });

  it("refuses an address that is not one", async () => {
    await expect(mockAccessService.create(SENDER(), draft({ recipientEmail: "yusuf" })))
      .rejects.toThrow(/not an email address/);
  });

  it("derives whether the recipient has an account rather than believing the sender", async () => {
    const known = await mockAccessService.create(SENDER(), draft({
      recipientEmail: "sam@antcolos.com", recipientName: "Sam Murtaza",
      // A sender asserting this would be using the invitation form to find out
      // who is on Antcolos. It is read from the directory and the claim ignored.
      recipientHasAccount: false,
    }));
    expect(known.recipientHasAccount).toBe(true);
    expect(known.recipientUserId).toBe("usr_sam");

    const stranger = await mockAccessService.create(SENDER(), draft({
      recipientEmail: "nobody@example.com", recipientHasAccount: true,
    }));
    expect(stranger.recipientHasAccount).toBe(false);
    expect(stranger.recipientUserId).toBeUndefined();
  });

  it("snapshots the organization and the sending seat from the context", async () => {
    const issued = await mockAccessService.create(SENDER(), draft({
      organizationId: "org_cascade", organizationName: "Somewhere Else",
    }));
    expect(issued.organizationId).toBe(NORTHLINE.id);
    expect(issued.organizationName).toBe(NORTHLINE.displayName);
    // Issued from inside an organization by a SEAT, not by a User in the abstract.
    expect(issued.invitedByMembershipId).toBe("mem_northline_owner");
    expect(issued.invitedByName).toBe("Sam Murtaza");
  });
});

/* -------------------------------------------------------------------------- */
/* What joining never hands over                                               */
/* -------------------------------------------------------------------------- */

describe("accepting is not blanket access to restricted paperwork", () => {
  const RESTRICTED_KEYS = () => splitByRestriction(
    documentRequirements("company_driver", NORTHLINE.id),
  ).restricted.map((r) => r.key);

  it("Northline's checklist really does contain restricted rows", () => {
    // Otherwise the test below passes by there being nothing to withhold.
    expect(RESTRICTED_KEYS().length).toBeGreaterThan(0);
    for (const requirement of splitByRestriction(
      documentRequirements("company_driver", NORTHLINE.id),
    ).restricted) {
      expect(isRestrictedDocumentType(requirement.typeKey)).toBe(true);
    }
  });

  it("withholds every restricted category even when one is asked for explicitly", async () => {
    const restricted = RESTRICTED_KEYS();
    const ordinary = ordinaryDocumentKeys(documentRequirements("company_driver", NORTHLINE.id));

    const result = await mockAccessService.accept(
      "INV-DRIVER-ACCT", SAM,
      // Passed in DELIBERATELY. The rule is not that the screen does not offer
      // them — it is that the service does not hand them over.
      { sharedDocumentKeys: [...ordinary, ...restricted] },
    );
    expect(result.status).toBe("accepted");

    const profileId = profileForUser("usr_sam")!.id;
    const relationship = liveRelationship(profileId, NORTHLINE.id)!;
    for (const key of restricted) {
      expect(relationship.sharedDocumentKeys).not.toContain(key);
    }

    // And no link exists for one either, so nothing is readable by another route.
    const linked = documentsForSubject("driver", "dp_sam")
      .flatMap((d) => d.links.filter((l) => !l.unlinkedAt
        && l.contextOrganizationId === NORTHLINE.id))
      .map((l) => l.requirementKey);
    for (const key of restricted) expect(linked).not.toContain(key);
  });

  it("says what was withheld rather than showing a shorter list with no reason", async () => {
    const restricted = RESTRICTED_KEYS();
    const result = await mockAccessService.accept(
      "INV-DRIVER-ACCT", SAM,
      { sharedDocumentKeys: ["cdl_front", ...restricted] },
    );
    if (result.status !== "accepted") throw new Error("expected acceptance");
    const documents = result.run.steps.find((s) => s.key === "document_access")!;
    expect(documents.state).toBe("done");
    expect(documents.detail).toMatch(/NOT shared/);
    expect(documents.detail).toMatch(/asked for separately/);
  });

  it("never sweeps in an optional row — that is the person's choice to make", () => {
    const requirements = documentRequirements("company_driver", NORTHLINE.id);
    const keys = new Set(ordinaryDocumentKeys(requirements));
    for (const requirement of requirements) {
      if (requirement.applicability !== "required") expect(keys.has(requirement.key)).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Taking a seat away                                                          */
/* -------------------------------------------------------------------------- */

describe("ending a seat ends access and nothing else", () => {
  const seatOf = (id: string) => rosterOf(NORTHLINE.id).find((m) => m.id === id);

  it("requires members:suspend, and records the refusal", async () => {
    const seatId = await seatFromAcceptance();
    const result = await endSeat(context(["members:view"]), seatId, "No longer needed.");
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("not_permitted");
    expect(denials() - denialsAtStart).toBe(1);
    expect(seatOf(seatId)).toBeDefined();
  });

  it("removes the seat and leaves the person entirely intact", async () => {
    const seatId = await seatFromAcceptance();
    const before = documentsForSubject("driver", "dp_sam").length;
    const profileBefore = profileForUser("usr_sam");
    const relationshipBefore = liveRelationship(profileBefore!.id, NORTHLINE.id);

    const result = await endSeat(
      context(["members:suspend"]), seatId, "Moved to another team.",
    );
    expect(result.status).toBe("ended");
    expect(seatOf(seatId)).toBeUndefined();

    // ★ AND NOTHING ELSE ★
    // The person is not this organization's to delete. Their profile, their
    // documents and the relationship itself all survive — ending a seat ends
    // the ability to sign in, not a life.
    expect(profileForUser("usr_sam")).toEqual(profileBefore);
    expect(documentsForSubject("driver", "dp_sam")).toHaveLength(before);
    expect(liveRelationship(profileBefore!.id, NORTHLINE.id)).toEqual(relationshipBefore);
  });

  it("is idempotent — ending an ended seat is nothing left to do", async () => {
    const seatId = await seatFromAcceptance();
    const ctx = context(["members:suspend"]);
    await endSeat(ctx, seatId, "Moved on.");
    expect((await endSeat(ctx, seatId, "Moved on.")).status).toBe("already_ended");
  });

  it("refuses to remove the last owner of a workspace", async () => {
    const owners = rosterOf(NORTHLINE.id).filter((m) => m.isOwner);
    expect(owners).toHaveLength(1);
    const result = await endSeat(context(["members:suspend"]), owners[0].id, "Leaving.");
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("last_owner");
    // A workspace nobody can administer is not a state this creates for anybody.
    expect(seatOf(owners[0].id)).toBeDefined();
  });

  it("leaves a person's seats in other organizations alone", async () => {
    const seatId = await seatFromAcceptance();
    const elsewhere = () => rosterSnapshot("demo").memberships
      .filter((m) => m.userId === "usr_sam" && m.organizationId !== NORTHLINE.id
        && m.status === "active")
      .map((m) => m.id);
    const before = elsewhere();
    expect(before.length).toBeGreaterThan(0);
    await endSeat(context(["members:suspend"]), seatId, "Moved on.");
    expect(elsewhere()).toEqual(before);
  });

  it("lets somebody leave without any permission, but not as the last owner", async () => {
    const owners = rosterOf(NORTHLINE.id).filter((m) => m.isOwner);
    expect((await leaveOrganization({ ...context([]), membershipId: owners[0].id })).status)
      .toBe("refused");

    const seatId = await seatFromAcceptance();
    const left = await leaveOrganization({ ...context([]), membershipId: seatId });
    expect(left.status).toBe("ended");
    expect(seatOf(seatId)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Starting is a separate act from accepting                                   */
/* -------------------------------------------------------------------------- */

describe("only activation writes a start date", () => {
  it("accepting leaves it absent, and activating writes it as OBSERVED", async () => {
    const accepted = await mockAccessService.accept(
      "INV-DRIVER-ACCT", SAM, { sharedDocumentKeys: [] },
    );
    expect(accepted.status).toBe("accepted");

    const profileId = profileForUser("usr_sam")!.id;
    const connected = liveRelationship(profileId, NORTHLINE.id)!;
    expect(connected.acceptedAt).toBeTruthy();
    expect(connected.startedAt).toBeUndefined();
    expect(connected.startedAtBasis).toBeUndefined();
    expect(connected.status).toBe("onboarding");

    const activated = activateCarrierRelationship(profileId, NORTHLINE.id);
    expect(activated.outcome).toBe("activated");
    expect(activated.relationship!.startedAt).toBeTruthy();
    // Antcolos watched this happen. That is what `observed` means.
    expect(activated.relationship!.startedAtBasis).toBe("observed");
    expect(activated.relationship!.status).toBe("active");

    // Idempotent, and it keeps the original date.
    const again = activateCarrierRelationship(profileId, NORTHLINE.id);
    expect(again.outcome).toBe("already_active");
    expect(again.relationship!.startedAt).toBe(activated.relationship!.startedAt);
  });

  it("keeps a genuinely CARRIER-ASSERTED date and its basis through activation", () => {
    /*
     * ★ THIS TEST USED TO PASS WITHOUT EXERCISING THE RULE ★
     *
     * It read a SEEDED relationship, whose basis is `observed` and whose status
     * is already `active` — so activation returned `already_active` and changed
     * nothing, and the assertion held for the wrong reason. Behind that there
     * was a real defect: activation wrote `startedAt = today` and
     * `startedAtBasis = "observed"` unconditionally, so activating an imported
     * driver would have replaced the carrier's March with this afternoon and
     * relabelled their claim as something Antcolos watched happen.
     *
     * There is no product path to a `carrier_asserted` date yet — that is the
     * import PR-3 will build — so the state is constructed directly.
     */
    const ASSERTED = "2024-03-04T00:00:00.000Z";
    setAssertedStartForTests("dp_sam", "org_cascade", ASSERTED);

    const before = liveRelationship("dp_sam", "org_cascade")!;
    expect(before.startedAt).toBe(ASSERTED);
    expect(before.startedAtBasis).toBe("carrier_asserted");
    expect(before.status).toBe("onboarding");

    const activated = activateCarrierRelationship("dp_sam", "org_cascade");
    expect(activated.outcome).toBe("activated");

    const after = liveRelationship("dp_sam", "org_cascade")!;
    // The state changed. The date, and whose claim it is, did not.
    expect(after.status).toBe("active");
    expect(after.startedAt).toBe(ASSERTED);
    expect(after.startedAtBasis).toBe("carrier_asserted");
  });

  it("leaves a seeded, already-active relationship alone", () => {
    const before = liveRelationship("dp_sam", "org_cascade")!;
    const again = activateCarrierRelationship("dp_sam", "org_cascade");
    expect(again.outcome).toBe("already_active");
    expect(again.relationship!.startedAt).toBe(before.startedAt);
    expect(again.relationship!.startedAtBasis).toBe(before.startedAtBasis);
  });
});

/* -------------------------------------------------------------------------- */
/* What the module deliberately cannot do                                      */
/* -------------------------------------------------------------------------- */

describe("the access service cannot grant dispatch reach", () => {
  it("exports nothing that mints a truck dispatch grant", () => {
    // A guarantee made by the ABSENCE of a function. Joining an organization is
    // a seat in that organization; reaching another carrier's trucks is a
    // separate, per-truck delegation that the dispatch module owns.
    for (const key of Object.keys(access)) {
      expect(key.toLowerCase()).not.toMatch(/dispatchgrant|granttruck|delegat/);
    }
  });

  it("gives a driver seat the own-records scope and no organization-wide reach", async () => {
    // From acceptance, not from the seeded Owner seat this account already had
    // — otherwise the assertion reads an owner's scope and proves nothing.
    const seatId = await seatFromAcceptance();
    const seat = rosterOf(NORTHLINE.id).find((m) => m.id === seatId);
    expect(seat).toBeDefined();
    expect(seat!.scope).toEqual({ loads: "assigned", financials: "own" });
    expect(seat!.isOwner).toBe(false);
    expect(seat!.appliedTemplates).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Nobody is ever shown an internal key                                        */
/* -------------------------------------------------------------------------- */

describe("what the person reads", () => {
  it("names a carrier's own extra rows by their label, not their key", async () => {
    // A carrier's extras exist only on ITS checklist, so a global lookup
    // resolves the standard requirements and hands back a raw key for exactly
    // the carrier-specific ones. `northline_employment_application` is one, and
    // it is also restricted — so it lands in the withheld list, which is the
    // worst possible place to print an internal identifier.
    const restricted = splitByRestriction(
      documentRequirements("company_driver", NORTHLINE.id),
    ).restricted;
    expect(restricted.map((r) => r.key)).toContain("northline_employment_application");

    const result = await mockAccessService.accept(
      "INV-DRIVER-ACCT", SAM,
      { sharedDocumentKeys: restricted.map((r) => r.key) },
    );
    if (result.status !== "accepted") throw new Error("expected acceptance");

    const withheld = result.run.steps.find((s) => s.key === "document_access")!.withheld!;
    expect(withheld.map((w) => w.label)).toContain("DOT employment application");
    expect(withheld.map((w) => w.label)).toContain("Motor vehicle record");
    for (const document of withheld) {
      expect(document.label).not.toMatch(/^northline_/);
      // And each says WHY it was withheld, in the words the person is shown.
      expect(document.reason).toBeTruthy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* An invitation that is not a person                                          */
/* -------------------------------------------------------------------------- */

describe("a whole-organization invitation", () => {
  it("is refused rather than quietly granting the nearest thing", async () => {
    // A dispatch agency working a carrier's freight is an arrangement between
    // two ORGANIZATIONS: its own scope, its own end date, its own per-truck
    // delegation. Handing a seat to whoever opened the link would be granting
    // reach nobody agreed to — so this flow refuses instead of improvising.
    const lookup = await mockAccessService.lookUp("INV-DISPATCHORG", SAM);
    expect(lookup.status).toBe("organization-invitation");

    const before = rosterOf(NORTHLINE.id).length;
    const result = await mockAccessService.accept(
      "INV-DISPATCHORG", SAM, { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("not-acceptable");
    expect(rosterOf(NORTHLINE.id)).toHaveLength(before);
  });
});

/* -------------------------------------------------------------------------- */
/* Who the invitation is for                                                   */
/* -------------------------------------------------------------------------- */

describe("an invitation is tied to a person, not to whoever holds the link", () => {
  const ALEX = {
    userId: "usr_newcomer",
    email: "alex.rivera@example.com",
    displayName: "Alex Rivera",
    scenario: "demo" as const,
  };
  const SAM = {
    userId: "usr_sam",
    email: "sam@antcolos.com",
    displayName: "Sam Murtaza",
    scenario: "demo" as const,
  };

  it("does not let a forwarded link attach itself to the reader", async () => {
    /*
     * ★ THE DEFECT THIS EXISTS TO CATCH ★
     *
     * `resolve` used to read `options.returningFromAuth ? invitation.recipientEmail : …`
     * — "somebody arrived carrying this link, so assume they are the addressee".
     * A query parameter decided who you were, so `?signedin=1` on a forwarded
     * invitation attached it to whoever opened it. Identity now comes from the
     * session and the link carries no authority of its own.
     */
    const lookup = await mockAccessService.lookUp("INV-NEWCOMER", SAM);
    expect(lookup.status).toBe("wrong-recipient");

    const before = rosterOf(NORTHLINE.id).length;
    const result = await mockAccessService.accept("INV-NEWCOMER", SAM, {
      sharedDocumentKeys: [],
    });
    expect(result.status).toBe("not-acceptable");
    expect(rosterOf(NORTHLINE.id)).toHaveLength(before);

    // And the person it names still gets through.
    expect((await mockAccessService.lookUp("INV-NEWCOMER", ALEX)).status).toBe("valid");
  });

  it("matches on the resolved account rather than only on the address", async () => {
    // The address was how the invitation found them; the account is who they
    // are. Somebody who changed their address on the account still holds it.
    const renamed = { ...ALEX, email: "alex.rivera+work@example.com" };
    expect((await mockAccessService.lookUp("INV-NEWCOMER", renamed)).status).toBe("valid");
  });

  it("asks somebody with no account to make one, rather than guessing", async () => {
    // karin.vogel@example.com has no account, so `recipientUserId` is absent
    // and there is nobody to compare a session against.
    expect((await mockAccessService.lookUp("INV-WRONGUSER", SAM)).status).toBe("needs-account");
    expect((await mockAccessService.lookUp("INV-WRONGUSER", null)).status).toBe("needs-account");
  });

  it("does not let somebody else decline on their behalf", async () => {
    expect(await mockAccessService.decline("INV-NEWCOMER", SAM)).toBeNull();
    const [invitation] = (await mockAccessService.list(context(["invitations:view"])))
      .filter((i) => i.token === "INV-NEWCOMER");
    expect(invitation.status).toBe("pending");
  });
});

/* -------------------------------------------------------------------------- */
/* Somebody who belonged to nothing                                            */
/* -------------------------------------------------------------------------- */

describe("a person with no organization at all", () => {
  const NEWCOMER = {
    userId: "usr_newcomer",
    email: "alex.rivera@example.com",
    displayName: "Alex Rivera",
    scenario: "newcomer" as const,
  };

  it("is put on the organization's roster, with no second copy anywhere", async () => {
    const before = rosterOf(NORTHLINE.id).length;

    const result = await mockAccessService.accept("INV-NEWCOMER", NEWCOMER, {
      sharedDocumentKeys: [],
      licence: {
        legalName: "Alex Rivera", cdlNumber: "R9920184471",
        cdlState: "IL", cdlExpiresAt: "2030-04-01T00:00:00.000Z",
      },
    });
    expect(result.status).toBe("accepted");

    // The seat lands on the roster the session actually reads — the scenario
    // came in with the identity, so no module below the session boundary had to
    // guess which one this tab is on.
    const seats = rosterSnapshot("newcomer").memberships
      .filter((m) => m.userId === "usr_newcomer" && m.organizationId === NORTHLINE.id
        && m.status === "active");
    expect(seats).toHaveLength(1);
    expect(rosterOf(NORTHLINE.id)).toHaveLength(before + 1);

    // And exactly one, with no copy on the other scenario's roster.
    expect(rosterSnapshot("demo").memberships
      .filter((m) => m.userId === "usr_newcomer")).toHaveLength(0);
  });

  it("still refuses when a restricted category is smuggled in among ordinary keys", async () => {
    // The realistic shape: a mostly-ordinary list with one restricted category
    // hidden in it. The filter is over every key, not the first one.
    const result = await mockAccessService.accept("INV-NEWCOMER", NEWCOMER, {
      sharedDocumentKeys: ["cdl_front", "drug_alcohol_test_result", "medical_front"],
      licence: {
        legalName: "Alex Rivera", cdlNumber: "R9920184471",
        cdlState: "IL", cdlExpiresAt: "2030-04-01T00:00:00.000Z",
      },
    });
    expect(result.status).toBe("restricted-category");
    if (result.status === "restricted-category") {
      expect(result.categories).toEqual(["drug_alcohol_test_result"]);
    }
    // Refused before the first step, so the ordinary keys did not travel either.
    expect(rosterSnapshot("newcomer").memberships
      .filter((m) => m.userId === "usr_newcomer" && m.organizationId === NORTHLINE.id))
      .toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Claiming to be somebody else                                                */
/* -------------------------------------------------------------------------- */

describe("an identity that does not match the person it claims", () => {
  const ALEX = {
    userId: "usr_newcomer",
    email: "alex.rivera@example.com",
    displayName: "Alex Rivera",
    scenario: "demo" as const,
  };
  const SAM = {
    userId: "usr_sam",
    email: "sam@antcolos.com",
    displayName: "Sam Murtaza",
    scenario: "demo" as const,
  };

  it("is still refused when somebody claims the addressee's EMAIL with their own id", async () => {
    // The spoofing shape: the address is the invitation's, the account is not.
    // Once an invitation has resolved to an account, the account is what it is
    // tied to, and the address it was found by stops being the answer.
    const spoofed = { ...SAM, email: ALEX.email };
    expect((await mockAccessService.lookUp("INV-NEWCOMER", spoofed)).status)
      .toBe("wrong-recipient");

    const before = rosterOf(NORTHLINE.id).length;
    expect((await mockAccessService.accept("INV-NEWCOMER", spoofed, { sharedDocumentKeys: [] }))
      .status).toBe("not-acceptable");
    expect(rosterOf(NORTHLINE.id)).toHaveLength(before);
  });

  it("does not let somebody finish a run the addressee started", async () => {
    // Alex starts and is interrupted.
    failAcceptanceStepForTests("workspace_membership");
    const started = await mockAccessService.accept("INV-NEWCOMER", ALEX, {
      sharedDocumentKeys: [],
      licence: {
        legalName: "Alex Rivera", cdlNumber: "R9920184471",
        cdlState: "IL", cdlExpiresAt: "2030-04-01T00:00:00.000Z",
      },
    });
    expect(started.status).toBe("incomplete");
    failAcceptanceStepForTests(null);

    // Sam opens the same link. A run is keyed to the person it belongs to, so
    // there is nothing here for him to resume — and finishing somebody else's
    // half-made acceptance would be the sharpest version of taking their seat.
    const lookup = await mockAccessService.lookUp("INV-NEWCOMER", SAM);
    expect(lookup.status).toBe("wrong-recipient");
    expect((await mockAccessService.accept("INV-NEWCOMER", SAM, { sharedDocumentKeys: [] }))
      .status).toBe("not-acceptable");

    // And it is still Alex's to finish.
    const resumed = await mockAccessService.lookUp("INV-NEWCOMER", ALEX);
    expect(resumed.status).toBe("resume");
  });

  it("records nothing when it refuses", async () => {
    const before = auditLedger.all(NORTHLINE.id).length;
    await mockAccessService.accept("INV-NEWCOMER", SAM, { sharedDocumentKeys: [] });
    // A refusal to attach an invitation to the wrong account creates no member,
    // and writes no line claiming one joined.
    expect(auditLedger.all(NORTHLINE.id)).toHaveLength(before);
    expect(auditLedger.all(NORTHLINE.id)
      .filter((e) => e.action === "access.member_joined")).toHaveLength(0);
  });
});

describe("where the identity comes from, and what it is worth", () => {
  it("is read from the session by the screen and from nothing else", () => {
    const screen = readFileSync(
      join(process.cwd(), "src/features/access/acceptance-screen.tsx"), "utf8",
    );
    expect(screen).toContain("useSession()");
    // Not from the address bar. The comment still NAMES `?signedin=1` to say
    // what this replaced, so the check is that nothing reads it — a mention in
    // prose is the record, not a code path.
    expect(screen).not.toContain("useSearchParams");
    expect(screen).not.toMatch(/params\.get\(|searchParams/);
    expect(screen).not.toMatch(/get\("signedin"\)/);
  });

  it("is not reconstructed inside the service", () => {
    // The access module used to resolve the person itself, which put a window
    // read underneath an API-layer module and left one fixture person
    // unreachable from a test.
    const service = readFileSync(join(process.cwd(), "src/lib/api/mock/access.ts"), "utf8");
    expect(service).not.toContain("isNewcomerSession");
    expect(service).not.toMatch(/function currentUser\(/);
  });

  it("tells the HTTP adapter not to put it on the wire", () => {
    // An endpoint that accepts a user id or an email from its caller is an
    // endpoint that accepts anyone's. Written where whoever implements the
    // adapter will read it, not only in a PR description.
    const http = readFileSync(join(process.cwd(), "src/lib/api/http/index.ts"), "utf8");
    expect(http).toContain("IDENTITY DOES NOT CROSS THE WIRE");
  });

  it("says in the contract that it is a simulation, and what a server must do", () => {
    // The honest framing, kept where somebody would rely on it: follow this
    // identity down and it is still a URL.
    const contract = readFileSync(
      join(process.cwd(), "src/lib/api/contracts/access.ts"), "utf8",
    );
    expect(contract).toMatch(/SIMULATION, NOT AN AUTHENTICATED IDENTITY/);
    expect(contract).toMatch(/DERIVES the acting identity from the/);
  });
});

/* -------------------------------------------------------------------------- */
/* A start date the carrier asserted                                           */
/* -------------------------------------------------------------------------- */

describe("a carrier-asserted start date has a way in", () => {
  it("is carried through relationship creation, marked as the carrier's claim", () => {
    const ASSERTED = "2024-03-04T00:00:00.000Z";
    const created = createOrResumeRelationship({
      driverProfileId: "dp_sam",
      carrierId: "org_baxter",
      carrierName: "Baxter Logistics",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: [],
      invitedAt: ASSERTED,
      acceptedAt: new Date().toISOString(),
      // The import path states it. Acceptance never does.
      assertedStartDate: ASSERTED,
    });
    expect(created.outcome).toBe("created");
    expect(created.relationship!.startedAt).toBe(ASSERTED);
    expect(created.relationship!.startedAtBasis).toBe("carrier_asserted");
    // Still not active: the carrier saying somebody has driven for them since
    // March is not Antcolos being told they may drive today.
    expect(created.relationship!.status).toBe("onboarding");
  });

  it("is absent when nobody asserted one", () => {
    const created = createOrResumeRelationship({
      driverProfileId: "dp_sam",
      carrierId: "org_baxter",
      carrierName: "Baxter Logistics",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: [],
      invitedAt: new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
    });
    expect(created.relationship!.startedAt).toBeUndefined();
    expect(created.relationship!.startedAtBasis).toBeUndefined();
  });

  it("survives the driver module's own command instead of being dropped", async () => {
    // The field was DECLARED on `NewRelationshipInput` and silently discarded
    // on the way to the registry, so an import passing it would have watched
    // its carrier-asserted date vanish without a word. This is the path that
    // dropped it.
    const ASSERTED = "2023-11-20T00:00:00.000Z";
    const relationship = await mockCreateRelationship("dp_sam", {
      carrierId: "org_baxter",
      carrierName: "Baxter Logistics",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: [],
      assertedStartDate: ASSERTED,
    });
    expect(relationship.startedAt).toBe(ASSERTED);
    expect(relationship.startedAtBasis).toBe("carrier_asserted");
  });

  it("is never supplied by accepting an invitation", async () => {
    // The field exists so an IMPORT can state a date. Acceptance passing one
    // would be Antcolos inventing history on the carrier's behalf.
    const result = await mockAccessService.accept(
      "INV-DRIVER-ACCT", SAM, { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("accepted");
    const relationship = liveRelationship(profileForUser("usr_sam")!.id, NORTHLINE.id)!;
    expect(relationship.startedAt).toBeUndefined();
    expect(relationship.startedAtBasis).toBeUndefined();
  });
});
