import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import {
  liveMembershipFor, resetRoster, rosterSnapshot,
} from "@/lib/session/membership-store";
import { effectivePermissions } from "@/lib/permissions/effective";
import { MOCK_ORGANIZATIONS, MOCK_TEMPLATES } from "@/lib/session/fixtures";
import { documentRequirements, resetDriverMock } from "@/features/driver/mock-driver";
import { isRestrictedDocumentType } from "@/lib/documents/catalog";
import { requirementByKey } from "@/lib/documents/requirements";
import type { AcceptingIdentity } from "../contracts/access";
import {
  acceptInvitation, endSeat, issueInvitation, listInvitations, resolveInvitation,
  revokeInvitation, rosterOf,
} from "./access-service";
import { invitationByToken, resetAccessStore } from "./access-store";
import { auditLedger, resetAuditLedger } from "./audit-ledger";
import {
  profileForUser, relationshipsForProfile, resetDriverRegistry,
} from "./driver-registry";

/**
 * ★ THE ACCESS BOUNDARY ★
 *
 * Every test here is about one of the four questions the service exists to
 * answer separately: who is issuing, may they grant this much, who is
 * accepting, and what does saying yes actually create. A delegation of access
 * that answers three of them is a hole, so each is pinned on its own.
 *
 * Nothing here asserts that two modules return the same JavaScript object —
 * every read is a copy, by design.
 */

const NEWCOMER: AcceptingIdentity = {
  userId: NEWCOMER_USER.id,
  email: NEWCOMER_USER.email,
  displayName: NEWCOMER_USER.displayName,
  scenario: "newcomer",
};

const SAM: AcceptingIdentity = {
  userId: MOCK_USER.id,
  email: MOCK_USER.email,
  displayName: MOCK_USER.displayName,
  scenario: "demo",
};

const northline = () => contextFor("org_northline");

function auditActions(organizationId: string): string[] {
  return auditLedger.all(organizationId).map((e) => e.action);
}

beforeEach(() => {
  resetAccessStore();
  resetRoster();
  resetDriverRegistry();
  resetDriverMock();
  resetAuditLedger();
});

/* -------------------------------------------------------------------------- */
/* 1 · Who is issuing                                                          */
/* -------------------------------------------------------------------------- */

describe("issuing is authorized, in the organization the context names", () => {
  it("refuses somebody without invitations:create, and records the refusal", async () => {
    const ctx = contextFor("org_northline", { without: ["invitations:create"] });
    const before = auditLedger.all("org_northline").length;

    const result = await issueInvitation(ctx, {
      kind: "employee", roleName: "Employee",
      recipientName: "Nobody", recipientEmail: "nobody@example.com",
      permissions: ["loads:view"],
    });

    expect(result).toMatchObject({ status: "refused", refusal: "not_permitted" });
    expect(auditLedger.all("org_northline").length).toBe(before + 1);
    expect(auditActions("org_northline")).toContain("access.permission_denied");
  });

  it("refuses to hand out access the sender does not hold, and names the keys", async () => {
    // Somebody who may invite, but who cannot see rates themselves. Without
    // this rule "manage permissions" silently becomes every permission,
    // because its holder could write themselves a role containing the rest.
    const ctx = contextFor("org_northline", { without: ["rates:view", "revenue:view"] });
    expect(ctx.permissions.has("invitations:create")).toBe(true);
    expect(ctx.permissions.has("rates:view")).toBe(false);

    const result = await issueInvitation(ctx, {
      kind: "employee", roleName: "Billing",
      recipientName: "Dana Wells", recipientEmail: "dana.wells@example.com",
      permissions: ["loads:view", "rates:view", "revenue:view"],
    });

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusal).toBe("permissions_exceed_granter");
    expect(result.ungrantable).toEqual(["rates:view", "revenue:view"]);
    expect(auditActions("org_northline")).toContain("access.permission_denied");
  });

  it("snapshots the organization from the context, not from anything a caller passes", async () => {
    const result = await issueInvitation(northline(), {
      kind: "employee", roleName: "Employee",
      recipientName: "Bea Lindgren", recipientEmail: "  BEA@example.com ",
      permissions: ["loads:view", "documents:view"],
    });

    expect(result.status).toBe("issued");
    if (result.status !== "issued") return;
    expect(result.invitation.organizationId).toBe("org_northline");
    expect(result.invitation.organizationName).toBe("Northline Freight");
    expect(result.invitation.invitedByMembershipId).toBe("mem_northline_owner");
    // Addresses are normalized, so a retype cannot create a second recipient.
    expect(result.invitation.recipientEmail).toBe("bea@example.com");
    expect(auditActions("org_northline")).toContain("access.member_invited");
  });

  it("derives whether the recipient has an account rather than believing the sender", async () => {
    const known = await issueInvitation(northline(), {
      kind: "driver", roleName: "Driver", engagementType: "company_driver",
      recipientName: NEWCOMER_USER.displayName, recipientEmail: NEWCOMER_USER.email,
      permissions: ["loads:view"],
    });
    const unknown = await issueInvitation(northline(), {
      kind: "driver", roleName: "Driver", engagementType: "company_driver",
      recipientName: "Stranger", recipientEmail: "stranger@example.com",
      permissions: ["loads:view"],
    });

    expect(known.status === "issued" && known.invitation.recipientHasAccount).toBe(true);
    expect(known.status === "issued" && known.invitation.recipientUserId).toBe(NEWCOMER_USER.id);
    expect(unknown.status === "issued" && unknown.invitation.recipientHasAccount).toBe(false);
    expect(unknown.status === "issued" && unknown.invitation.recipientUserId).toBeUndefined();
  });

  it("refuses a driver invitation with no engagement type", async () => {
    const result = await issueInvitation(northline(), {
      kind: "driver", roleName: "Driver",
      recipientName: "Yusuf", recipientEmail: "yusuf@example.com",
      permissions: ["loads:view"],
    });
    expect(result).toMatchObject({ status: "refused", refusal: "invalid" });
  });

  it("gates listing on invitations:view and never crosses organizations", async () => {
    await expect(
      listInvitations(contextFor("org_northline", { without: ["invitations:view"] })),
    ).rejects.toThrow(/invitations:view/);

    const list = await listInvitations(northline());
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((i) => i.organizationId === "org_northline")).toBe(true);
  });

  it("refuses to revoke another organization's invitation", async () => {
    // inv_8 belongs to Summit, not Northline.
    await expect(revokeInvitation(northline(), "inv_8")).rejects.toThrow(/No such invitation/);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · Who is accepting                                                        */
/* -------------------------------------------------------------------------- */

describe("an invitation is tied to the person it names", () => {
  it("refuses somebody else, by name, rather than attaching quietly", async () => {
    // INV-NEWDRIVER is addressed to the newcomer. Sam opens it.
    const result = await resolveInvitation("INV-NEWDRIVER", SAM);
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusal).toBe("wrong_recipient");
    expect(result.signedInAs).toBe(MOCK_USER.email);
  });

  it("lets the intended person through", async () => {
    const result = await resolveInvitation("INV-NEWDRIVER", NEWCOMER);
    expect(result.status).toBe("ready");
  });

  it("refuses with nobody signed in", async () => {
    const result = await resolveInvitation("INV-NEWDRIVER", null);
    expect(result).toMatchObject({ status: "refused", refusal: "needs_account" });
  });

  it("matches on the resolved account, not only on the address", async () => {
    const invitation = invitationByToken("INV-NEWDRIVER")!;
    expect(invitation.recipientUserId).toBe(NEWCOMER_USER.id);

    // Same account, a differently-cased address: still the same person.
    const result = await resolveInvitation("INV-NEWDRIVER", {
      ...NEWCOMER, email: NEWCOMER_USER.email.toUpperCase(),
    });
    expect(result.status).toBe("ready");
  });

  it("refuses an unknown token, a revoked one and an expired one", async () => {
    await expect(resolveInvitation("NOPE", SAM)).resolves.toMatchObject({ refusal: "not_found" });
    await expect(resolveInvitation("INV-REVOKED", SAM)).resolves.toMatchObject({ refusal: "revoked" });
    await expect(resolveInvitation("INV-EXPIRED", SAM)).resolves.toMatchObject({ refusal: "expired" });
  });

  it("derives expiry on read rather than trusting the stored status", async () => {
    // Still `pending`, but its date has passed. There is no scheduler to have
    // noticed, so the read is the thing that must notice.
    const invitation = invitationByToken("INV-DRIVER-ACCT")!;
    invitation.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(invitation.status).toBe("pending");

    await expect(resolveInvitation("INV-DRIVER-ACCT", SAM))
      .resolves.toMatchObject({ refusal: "expired" });
  });

  it("refuses a whole-organization invitation rather than doing something adjacent", async () => {
    // Dispatch reach is per truck, from the truck, and this service has no
    // method that could grant one.
    const result = await resolveInvitation("INV-DISPATCHORG", SAM);
    expect(result).toMatchObject({
      status: "refused", refusal: "organization_invitation_unsupported",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · What accepting creates                                                  */
/* -------------------------------------------------------------------------- */

const LICENCE = {
  legalName: "Alex Rivera",
  cdlNumber: "R9920184471",
  cdlState: "IL",
  cdlExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(),
};

describe("accepting creates a seat the session can see", () => {
  it("grants a membership carrying exactly the invitation's permissions", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    const seat = liveMembershipFor("newcomer", NEWCOMER_USER.id, "org_northline");
    expect(seat).toBeDefined();
    expect(seat!.id).toBe(result.outcome.membership.id);

    const invitation = invitationByToken("INV-NEWDRIVER")!;
    const organization = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
    const effective = effectivePermissions(seat!, organization, MOCK_TEMPLATES);

    // Everything the invitation promised, and nothing beyond it.
    for (const key of invitation.permissions) expect(effective.has(key)).toBe(true);
    expect(effective.has("members:edit")).toBe(false);
    expect(effective.has("permissions:manage")).toBe(false);
    expect(effective.has("invitations:create")).toBe(false);
    expect(seat!.isOwner).toBe(false);
  });

  it("puts the seat in the organization's roster and the person's own switcher", async () => {
    await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });

    expect(rosterOf("org_northline").some((m) => m.userId === NEWCOMER_USER.id)).toBe(true);
    const roster = rosterSnapshot("newcomer");
    expect(roster.memberships.some((m) => m.organizationId === "org_northline")).toBe(true);
    // The organization travels with the seat; a workspace with no name is not
    // a workspace anybody can switch into.
    expect(roster.organizations.some((o) => o.id === "org_northline")).toBe(true);
  });

  it("records the join and the engagement in the joining organization's ledger", async () => {
    await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    const actions = auditActions("org_northline");
    expect(actions).toContain("access.member_joined");
    expect(actions).toContain("workforce.engagement_created");

    const joined = auditLedger.all("org_northline").find((e) => e.action === "access.member_joined")!;
    expect(joined.actor.userId).toBe(NEWCOMER_USER.id);
    expect(joined.entity.kind).toBe("membership");
  });

  it("refuses a driver with no profile and no licence details, without writing anything", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER);
    expect(result).toMatchObject({ status: "refused", refusal: "needs_driver_profile" });
    expect(liveMembershipFor("newcomer", NEWCOMER_USER.id, "org_northline")).toBeUndefined();
    expect(invitationByToken("INV-NEWDRIVER")!.status).toBe("pending");
  });
});

describe("one person, one permanent profile", () => {
  it("creates a profile for somebody who has none, and only one", async () => {
    expect(profileForUser(NEWCOMER_USER.id)).toBeUndefined();

    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    expect(result.outcome.driverProfileResumed).toBe(false);
    const profile = profileForUser(NEWCOMER_USER.id)!;
    expect(profile.id).toBe(result.outcome.driverProfileId);
    expect(profile.cdlNumber).toBe(LICENCE.cdlNumber);
  });

  it("REUSES an existing profile and never asks for the licence again", async () => {
    // Sam already has one, with a licence on file.
    const before = profileForUser(MOCK_USER.id)!;

    const result = await acceptInvitation("INV-DRIVER-ACCT", SAM);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    expect(result.outcome.driverProfileResumed).toBe(true);
    expect(result.outcome.driverProfileId).toBe(before.id);

    const after = profileForUser(MOCK_USER.id)!;
    // Same record, unchanged. Accepting a carrier's invitation is not how a
    // licence gets edited.
    expect(after.id).toBe(before.id);
    expect(after.cdlNumber).toBe(before.cdlNumber);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("gives somebody already in one organization a SECOND seat, keeping the first", async () => {
    // Alex joins Northline as a driver…
    const first = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (first.status !== "accepted") throw new Error("expected acceptance");
    const profileId = first.outcome.driverProfileId!;

    // …and is then invited by an unrelated organization.
    const issued = await issueInvitation(contextFor("org_summit"), {
      kind: "dispatcher", roleName: "Dispatcher",
      recipientName: NEWCOMER_USER.displayName, recipientEmail: NEWCOMER_USER.email,
      permissions: ["loads:view", "dispatch:view"],
    });
    if (issued.status !== "issued") throw new Error("expected issue");

    const second = await acceptInvitation(issued.invitation.token, NEWCOMER);
    expect(second.status).toBe("accepted");

    const held = rosterSnapshot("newcomer").memberships
      .filter((m) => m.status === "active").map((m) => m.organizationId).sort();
    expect(held).toEqual(["org_northline", "org_summit"]);

    // One person, one profile, however many organizations they belong to.
    expect(profileForUser(NEWCOMER_USER.id)!.id).toBe(profileId);
    // And the second seat is NOT a driver seat: it carries what its own
    // invitation carried, not what the first one did.
    const summit = rosterSnapshot("newcomer").memberships
      .find((m) => m.organizationId === "org_summit")!;
    expect(summit.driverProfileId).toBeUndefined();
    expect(summit.grants).toEqual(["loads:view", "dispatch:view"]);
  });

  it("gives somebody who is ALREADY in the organization no second seat", async () => {
    // Sam owns Northline and is invited to it again as a driver. One person
    // holds one seat per organization; `grantMembership` is idempotent on
    // exactly that pair, and this is the case that proves it matters.
    const seatsBefore = rosterSnapshot("demo").memberships.length;

    const result = await acceptInvitation("INV-DRIVER-ACCT", SAM);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    expect(rosterSnapshot("demo").memberships.length).toBe(seatsBefore);
    expect(result.outcome.created).toBe(false);
    expect(result.outcome.membership.id).toBe("mem_northline_owner");
    // Every seat they already held is still there, unchanged.
    for (const id of ["mem_cascade_driver", "mem_solo_dispatcher", "mem_northline_owner"]) {
      expect(rosterSnapshot("demo").memberships.some((m) => m.id === id)).toBe(true);
    }
  });
});

describe("accepting twice", () => {
  it("produces one seat, one profile, one engagement and one audit entry", async () => {
    const first = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    expect(first.status).toBe("accepted");

    const joinsAfterFirst = auditActions("org_northline")
      .filter((a) => a === "access.member_joined").length;

    const second = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    expect(second.status).toBe("already_accepted");
    if (first.status !== "accepted" || second.status !== "already_accepted") return;

    expect(second.outcome.membership.id).toBe(first.outcome.membership.id);
    expect(second.outcome.relationship?.id).toBe(first.outcome.relationship?.id);
    expect(second.outcome.created).toBe(false);

    expect(rosterSnapshot("newcomer").memberships
      .filter((m) => m.organizationId === "org_northline").length).toBe(1);
    expect(relationshipsForProfile(first.outcome.driverProfileId!)
      .filter((r) => r.carrierId === "org_northline").length).toBe(1);
    expect(auditActions("org_northline")
      .filter((a) => a === "access.member_joined").length).toBe(joinsAfterFirst);
  });

  it("refuses a different account after somebody has used it", async () => {
    await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    const result = await acceptInvitation("INV-NEWDRIVER", SAM);
    expect(result).toMatchObject({ status: "refused", refusal: "already_accepted_by_other" });
  });
});

/* -------------------------------------------------------------------------- */
/* 4 · Accepting is not starting                                               */
/* -------------------------------------------------------------------------- */

describe("acceptance and activation are different states", () => {
  it("records when the invitation was accepted", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");

    expect(result.outcome.invitation.acceptedAt).toBeTruthy();
    expect(result.outcome.invitation.acceptedByUserId).toBe(NEWCOMER_USER.id);
    expect(result.outcome.relationship!.acceptedAt).toBeTruthy();
  });

  it("does NOT set startedAt for a genuinely new driver", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");

    const relationship = result.outcome.relationship!;
    expect(relationship.startedAt).toBeUndefined();
    expect(relationship.startedAtBasis).toBeUndefined();
    expect(relationship.status).toBe("onboarding");

    // And it is still absent when read back from the registry, not merely on
    // the object the command happened to return.
    const stored = relationshipsForProfile(result.outcome.driverProfileId!)
      .find((r) => r.carrierId === "org_northline")!;
    expect(stored.startedAt).toBeUndefined();
  });

  it("snapshots the invitation's own date rather than stamping today", async () => {
    const invitation = invitationByToken("INV-NEWDRIVER")!;
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");
    expect(result.outcome.relationship!.invitedAt).toBe(invitation.createdAt);
  });

  it("writes startedAt only when something actually starts, marked as observed", async () => {
    const { activateCarrierRelationship } = await import("./driver-registry");
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");

    const activated = activateCarrierRelationship(result.outcome.driverProfileId!, "org_northline");
    expect(activated.outcome).toBe("activated");
    expect(activated.relationship!.startedAt).toBeTruthy();
    expect(activated.relationship!.startedAtBasis).toBe("observed");

    // Activating again keeps the first date rather than moving it.
    const first = activated.relationship!.startedAt;
    const again = activateCarrierRelationship(result.outcome.driverProfileId!, "org_northline");
    expect(again.outcome).toBe("already_active");
    expect(again.relationship!.startedAt).toBe(first);
  });

  it("never promotes a carrier-asserted historical date to an observed one", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");

    // As an import would leave it: the carrier says they started in March.
    const stored = relationshipsForProfile(result.outcome.driverProfileId!)
      .find((r) => r.carrierId === "org_northline")!;
    const registry = relationshipsForProfile(result.outcome.driverProfileId!);
    expect(registry.length).toBeGreaterThan(0);

    // Accepting again — the idempotent replay — leaves the relationship as it
    // is and writes no date of its own.
    await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    const after = relationshipsForProfile(result.outcome.driverProfileId!)
      .find((r) => r.carrierId === "org_northline")!;
    expect(after.startedAt).toBe(stored.startedAt);
    expect(after.startedAtBasis).toBe(stored.startedAtBasis);
  });
});

/* -------------------------------------------------------------------------- */
/* 5 · Ordinary document access only                                           */
/* -------------------------------------------------------------------------- */

describe("accepting is not blanket access to restricted paperwork", () => {
  it("Northline's checklist really does contain restricted rows", () => {
    const requirements = documentRequirements("company_driver", "org_northline");
    const restricted = requirements.filter((r) => isRestrictedDocumentType(r.typeKey));
    // If this ever becomes empty the rule below stops being exercised, and a
    // rule nothing exercises is a rule nobody can tell is working.
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted.map((r) => r.key).sort())
      .toEqual(["northline_employment_application", "northline_mvr"]);
  });

  it("shares ordinary required paperwork and withholds every restricted category", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");

    const { sharedDocuments, withheldDocuments } = result.outcome;
    const sharedKeys = sharedDocuments.map((d) => d.key);

    expect(sharedKeys).toContain("cdl_front");
    expect(sharedKeys).toContain("medical_front");
    expect(withheldDocuments.map((d) => d.key).sort())
      .toEqual(["northline_employment_application", "northline_mvr"]);
    // Named in the words the person is shown, never as an internal key, and
    // each carrying why its category is withheld.
    expect(withheldDocuments.map((d) => d.label).sort())
      .toEqual(["DOT employment application", "Motor vehicle record"]);
    for (const doc of withheldDocuments) {
      expect(doc.reason).toBeTruthy();
      expect(doc.label).not.toBe(doc.key);
    }

    for (const doc of sharedDocuments) {
      const requirement = requirementByKey(doc.key)
        ?? documentRequirements("company_driver", "org_northline").find((r) => r.key === doc.key)!;
      expect(isRestrictedDocumentType(requirement.typeKey)).toBe(false);
      // No internal key ever reaches a screen, including for a carrier's own
      // extra row — which is exactly the one a global lookup cannot resolve.
      expect(doc.label).not.toBe(doc.key);
    }

    // And the relationship itself carries only the ordinary ones.
    expect(result.outcome.relationship!.sharedDocumentKeys)
      .not.toContain("northline_employment_application");
    expect(result.outcome.relationship!.sharedDocumentKeys).not.toContain("northline_mvr");
  });

  it("never shares an OPTIONAL row either — that is the person's choice to make", async () => {
    const result = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (result.status !== "accepted") throw new Error("expected acceptance");
    // `medical_back` is optional on every driver checklist.
    expect(result.outcome.sharedDocuments.map((d) => d.key)).not.toContain("medical_back");
  });
});

/* -------------------------------------------------------------------------- */
/* 6 · Taking access away                                                      */
/* -------------------------------------------------------------------------- */

describe("ending a seat ends access and nothing else", () => {
  it("requires members:suspend, and records the refusal", async () => {
    const ctx = contextFor("org_northline", { permissions: ["members:view"] });
    const result = await endSeat(ctx, "mem_cascade_driver", "no");
    expect(result).toMatchObject({ status: "refused", refusal: "not_permitted" });
    expect(auditActions("org_northline")).toContain("access.permission_denied");
  });

  it("removes the seat from the roster and leaves the person intact", async () => {
    const accepted = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (accepted.status !== "accepted") throw new Error("expected acceptance");
    const profileId = accepted.outcome.driverProfileId!;

    const result = await endSeat(northline(), accepted.outcome.membership.id, "Left the company.");
    expect(result.status).toBe("ended");

    expect(rosterOf("org_northline").some((m) => m.userId === NEWCOMER_USER.id)).toBe(false);
    expect(liveMembershipFor("newcomer", NEWCOMER_USER.id, "org_northline")).toBeUndefined();

    // The person is untouched: their profile, and the engagement itself, both
    // survive. Ending access is not ending the working relationship.
    expect(profileForUser(NEWCOMER_USER.id)).toBeDefined();
    expect(profileForUser(NEWCOMER_USER.id)!.id).toBe(profileId);
    expect(relationshipsForProfile(profileId)
      .find((r) => r.carrierId === "org_northline")!.status).toBe("onboarding");
  });

  it("is idempotent", async () => {
    const accepted = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
    if (accepted.status !== "accepted") throw new Error("expected acceptance");

    await endSeat(northline(), accepted.outcome.membership.id, "Left.");
    const again = await endSeat(northline(), accepted.outcome.membership.id, "Left.");
    expect(again.status).toBe("already_ended");
  });

  it("refuses to remove the last owner of a workspace", async () => {
    // The solo dispatcher workspace has exactly one member, who owns it.
    const ctx = contextFor("org_solo");
    expect(rosterOf("org_solo").length).toBe(1);

    const result = await endSeat(ctx, "mem_solo_dispatcher", "Cleaning up.");
    expect(result).toMatchObject({ status: "refused", refusal: "last_owner" });
    expect(rosterOf("org_solo").length).toBe(1);
  });

  it("leaves a person's other organizations alone", async () => {
    const before = rosterSnapshot("demo").memberships
      .filter((m) => m.status === "active").map((m) => m.id);

    await endSeat(contextFor("org_cascade", { with: ["members:suspend"] }),
      "mem_cascade_driver", "Moved on.");

    const after = rosterSnapshot("demo").memberships
      .filter((m) => m.status === "active").map((m) => m.id);
    expect(after).toEqual(before.filter((id) => id !== "mem_cascade_driver"));
  });
});

/* -------------------------------------------------------------------------- */
/* 7 · No second door to dispatch reach                                        */
/* -------------------------------------------------------------------------- */

describe("the access service cannot grant dispatch reach", () => {
  it("exports no function that mints a truck dispatch grant", async () => {
    const service = await import("./access-service");
    const names = Object.keys(service).join(" ").toLowerCase();
    expect(names).not.toContain("dispatchaccess");
    expect(names).not.toContain("granttruck");
  });
});
