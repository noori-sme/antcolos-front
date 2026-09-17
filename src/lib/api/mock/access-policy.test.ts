import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import {
  liveMembershipFor, resetRoster, rosterSnapshot, setMembershipStatus,
} from "@/lib/session/membership-store";
import { ordinaryDocumentKeys, splitByRestriction } from "@/lib/documents/requirements";
import { isRestrictedDocumentType } from "@/lib/documents/catalog";
import { documentRequirements, resetDriverMock } from "@/features/driver/mock-driver";
import {
  activateCarrierRelationship, liveRelationship, profileForUser, resetDriverRegistry,
} from "./driver-registry";
import { documentsForSubject, resetDocumentStore } from "./document-store";
import { auditLedger, resetAuditLedger } from "./audit-ledger";
import * as access from "./access";
import { endSeat, leaveOrganization, mockAccessService, rosterOf } from "./access";
import { resetAccessStore } from "./access-store";
import { resetWorkforceStore } from "./workforce-store";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";

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
    "INV-DRIVER-ACCT", { returningFromAuth: true },
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
      "INV-DRIVER-ACCT", { returningFromAuth: true },
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
      "INV-DRIVER-ACCT", { returningFromAuth: true },
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
      "INV-DRIVER-ACCT", { returningFromAuth: true }, { sharedDocumentKeys: [] },
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

  it("never promotes a carrier's asserted historical date to an observed one", () => {
    // A seeded relationship stands in for an imported one here: it has a start
    // date this product did not watch begin. Accepting says nothing about what
    // a spreadsheet claimed about last March, so nothing may rewrite the basis.
    const relationship = liveRelationship("dp_sam", "org_cascade")!;
    expect(relationship.startedAt).toBeTruthy();
    const basis = relationship.startedAtBasis;
    const date = relationship.startedAt;

    activateCarrierRelationship("dp_sam", "org_cascade");
    const after = liveRelationship("dp_sam", "org_cascade")!;
    expect(after.startedAt).toBe(date);
    expect(after.startedAtBasis).toBe(basis);
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
    expect(seat!.templateIds).toEqual([]);
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
      "INV-DRIVER-ACCT", { returningFromAuth: true },
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
    const lookup = await mockAccessService.lookUp("INV-DISPATCHORG", { returningFromAuth: true });
    expect(lookup.status).toBe("organization-invitation");

    const before = rosterOf(NORTHLINE.id).length;
    const result = await mockAccessService.accept(
      "INV-DISPATCHORG", { returningFromAuth: true }, { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("not-acceptable");
    expect(rosterOf(NORTHLINE.id)).toHaveLength(before);
  });
});
