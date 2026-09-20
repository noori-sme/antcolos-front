import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { PermissionDeniedError, type ServiceContext } from "@/lib/api/contracts/context";
import type { ReferralDraft, ReferringIdentity } from "@/lib/api/contracts/referrals";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import { OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import type { PermissionKey } from "@/types";
import { accountForEmail, resetAccessStore } from "./access-store";
import { membershipsIn } from "./membership-directory";
import { engagementsForOrganization, ensureSeeded as ensureWorkforceSeeded } from "./workforce-store";
import { seedWorkforce } from "./workforce-seed";
import { profileForUser } from "./driver-registry";
import { putReferral, referralById, resetReferralStore } from "./referral-store";
import { abuseReports, candidateStateOf } from "./referrals";

/**
 * Referrals, proved through BEHAVIOUR.
 *
 * Not one assertion in this file reads source text, counts imports or checks
 * that a module does not mention another. Every claim the feature makes about
 * what a referral is NOT — not a membership, not a permission, not an
 * engagement, not access to anybody's documents — is checked by doing the thing
 * and then asking the modules that own those records whether anything changed.
 *
 * That is the only version of the claim worth having. A referral module that
 * imported no membership store but reached one through three hops would pass a
 * structural test and fail every one of these.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const NORTHLINE = "org_northline";
const BAXTER = "org_baxter";

/** Any authenticated person. This one belongs to nothing relevant. */
const SAM: ReferringIdentity = {
  userId: MOCK_USER.id,
  email: MOCK_USER.email,
  displayName: MOCK_USER.displayName,
};

/** A person who already has an Antcolos account and no memberships at all. */
const ALEX: ReferringIdentity = {
  userId: NEWCOMER_USER.id,
  email: NEWCOMER_USER.email,
  displayName: NEWCOMER_USER.displayName,
};

/** A referrer who belongs to no organization in the fixtures whatsoever. */
const OUTSIDER: ReferringIdentity = {
  userId: "usr_outsider",
  email: "jo@example.com",
  displayName: "Jo Tran",
};

function reviewer(
  organizationId: string,
  permissions: PermissionKey[] = ["referrals:review"],
): ServiceContext {
  return {
    organizationId,
    organizationName: organizationId,
    workspaceKind: "carrier_organization",
    membershipId: `mem_${organizationId}_reviewer`,
    permissions: new Set(permissions),
    scope: OWN_RECORDS_SCOPE,
    actor: {
      userId: "usr_reviewer",
      membershipId: `mem_${organizationId}_reviewer`,
      displayNameSnapshot: "A Reviewer",
      source: "web",
    },
  };
}

function draft(over: Partial<ReferralDraft> = {}): ReferralDraft {
  return {
    candidateFullName: "Rae Bonner",
    candidateEmail: "rae.bonner@example.com",
    candidatePhone: "(312) 555-0199",
    proposedTitle: "Driver",
    organizationLookup: { kind: "username", value: "northline-freight" },
    ...over,
  };
}

async function submitted(identity = SAM, over: Partial<ReferralDraft> = {}) {
  const result = await services.referrals.submit(identity, draft(over));
  if (result.status !== "submitted") {
    throw new Error(`Expected a referral, got ${result.refusal}: ${result.message}`);
  }
  return result.referral;
}

beforeEach(() => {
  resetReferralStore();
  resetAccessStore();
  ensureWorkforceSeeded(seedWorkforce);
});

/* -------------------------------------------------------------------------- */
/* 1 & 2 — who may submit                                                      */
/* -------------------------------------------------------------------------- */

describe("submitting a referral", () => {
  it("lets ANY authenticated user refer anybody to any company", async () => {
    // Jo belongs to no organization in the fixtures — not to Northline, not to
    // anything. That is the whole product statement, so it is the first test.
    const result = await services.referrals.submit(OUTSIDER, draft());
    expect(result.status).toBe("submitted");
    if (result.status !== "submitted") return;
    expect(result.referral.targetOrganizationId).toBe(NORTHLINE);
    expect(result.referral.referrerUserId).toBe(OUTSIDER.userId);
  });

  it("refuses somebody who is not signed in, and writes nothing", async () => {
    const before = (await services.referrals.companyInbox(reviewer(NORTHLINE))).length;
    const result = await services.referrals.submit(
      { userId: "", email: "", displayName: "" },
      draft(),
    );
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("not_authenticated");
    const after = await services.referrals.companyInbox(reviewer(NORTHLINE));
    expect(after.length).toBe(before);
  });

  it("resolves the company the person PICKED, keeping what they typed as provenance", async () => {
    // ★ THE BUG THIS EXISTS FOR ★
    // The form used to send the picked organization id back in the `value`
    // field, so a username lookup asked the resolver to find a handle called
    // `org_northline`. It resolved on screen and refused on submit.
    const result = await services.referrals.submit(SAM, draft({
      organizationLookup: {
        kind: "name_search",
        value: "north",
        organizationId: NORTHLINE,
      },
    }));
    expect(result.status).toBe("submitted");
    if (result.status !== "submitted") return;
    expect(result.referral.targetOrganizationId).toBe(NORTHLINE);
    // The search that found it is kept, unchanged. It is the only evidence of
    // how somebody arrived at this company.
    expect(result.referral.lookup).toEqual({ kind: "name_search", submittedValue: "north" });
  });

  it("confirms a picked id rather than trusting it", async () => {
    const result = await services.referrals.submit(SAM, draft({
      organizationLookup: {
        kind: "name_search",
        value: "north",
        organizationId: "org_does_not_exist",
      },
    }));
    expect(result.status).toBe("refused");
    if (result.status === "refused") expect(result.refusal).toBe("organization_unresolved");
  });

  it("never guesses which company was meant", async () => {
    const unresolved = await services.referrals.submit(SAM, draft({
      organizationLookup: { kind: "username", value: "northline" },
    }));
    expect(unresolved.status).toBe("refused");
    if (unresolved.status === "refused") {
      // A PREFIX of a real handle. Resolving it would have introduced somebody
      // to a company nobody named.
      expect(unresolved.refusal).toBe("organization_unresolved");
    }

    const short = await services.referrals.submit(SAM, draft({
      organizationLookup: { kind: "mc_number", value: "114" },
    }));
    expect(short.status).toBe("refused");
  });
});

/* -------------------------------------------------------------------------- */
/* 3 & 4 — a referral, and an acceptance, create none of the real records      */
/* -------------------------------------------------------------------------- */

describe("what a referral and an acceptance do NOT create", () => {
  it("creates no membership, permission, engagement or driver profile", async () => {
    const membersBefore = membershipsIn(NORTHLINE).length;
    const engagementsBefore = engagementsForOrganization(NORTHLINE).length;
    const ctx = reviewer(NORTHLINE, ["referrals:review", "permissions:manage", "members:view"]);
    const templatesBefore = (await services.access.templates(ctx)).length;
    const invitationsBefore = (await services.access.list(
      reviewer(NORTHLINE, ["invitations:view"]),
    )).length;

    const referral = await submitted(SAM, {
      candidateEmail: ALEX.email,
      candidateFullName: ALEX.displayName,
    });

    expect(membershipsIn(NORTHLINE).length).toBe(membersBefore);
    expect(engagementsForOrganization(NORTHLINE).length).toBe(engagementsBefore);
    expect((await services.access.templates(ctx)).length).toBe(templatesBefore);
    expect((await services.access.list(reviewer(NORTHLINE, ["invitations:view"]))).length)
      .toBe(invitationsBefore);
    // Nobody's permanent driver profile was touched either.
    expect(profileForUser(ALEX.userId)).toBeUndefined();

    // ── AND ACCEPTANCE ALONE CHANGES NONE OF THAT ──
    const decision = await services.referrals.accept(ctx, referral.id);
    expect(decision.status).toBe("decided");

    expect(membershipsIn(NORTHLINE).length).toBe(membersBefore);
    expect(engagementsForOrganization(NORTHLINE).length).toBe(engagementsBefore);
    expect((await services.access.templates(ctx)).length).toBe(templatesBefore);
    expect((await services.access.list(reviewer(NORTHLINE, ["invitations:view"]))).length)
      .toBe(invitationsBefore);
    expect(profileForUser(ALEX.userId)).toBeUndefined();

    const after = await services.referrals.companyGet(ctx, referral.id);
    expect(after?.company.state).toBe("accepted");
    // Accepted, and still carrying no id for any of those records.
    expect(after?.resultingInvitationId).toBeUndefined();
    expect(after?.resultingEngagementId).toBeUndefined();
  });

  it("never turns the free-form title into a role or a permission", async () => {
    const ctx = reviewer(NORTHLINE, [
      "referrals:review", "permissions:manage", "members:view", "invitations:view",
    ]);
    const before = (await services.access.templates(ctx)).map((t) => t.template.name);

    // The most dangerous string somebody could type into a free-text field.
    const referral = await submitted(SAM, { proposedTitle: "Owner" });
    await services.referrals.accept(ctx, referral.id);
    const handoff = await services.referrals.handoff(ctx, referral.id);

    expect(handoff?.proposedTitleContext).toBe("Owner");

    // ★ THE HANDOFF CARRIES NO ACCESS, AND THE KEY SET IS THE PROOF ★
    // Exactly these fields and no others: no permissions, no template, no role
    // name, no engagement type, no invitation kind. "Owner" arrives as a string
    // the referrer typed and has nowhere to go but a screen.
    expect(Object.keys(handoff!).sort()).toEqual([
      "candidateHasAccount", "existingEngagementId", "meaningOfAcceptance", "note",
      "proposedTitleContext", "recipientEmail", "recipientName", "referralId",
      "referrerName",
    ]);
    expect(handoff).not.toHaveProperty("permissions");
    expect(handoff).not.toHaveProperty("templateId");
    expect(handoff).not.toHaveProperty("roleName");
    expect(handoff).not.toHaveProperty("kind");
    // Nothing in the referral record became a permission either.
    const stored = referralById(referral.id)!;
    expect(stored).not.toHaveProperty("permissions");
    expect(stored.proposedTitle).toBe("Owner");
    const after = (await services.access.templates(ctx)).map((t) => t.template.name);
    expect(after).toEqual(before);
    // And the reviewer's own access is exactly what it was.
    expect([...ctx.permissions].sort()).toEqual(
      ["invitations:view", "members:view", "permissions:manage", "referrals:review"],
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 5, 6 & 7 — the candidate side                                               */
/* -------------------------------------------------------------------------- */

describe("the candidate's side", () => {
  it("works whether the company decides before or after the claim", async () => {
    const ctx = reviewer(NORTHLINE);

    // ORDER A: company first, then the candidate.
    const first = await submitted(SAM, {
      candidateEmail: ALEX.email, candidateFullName: ALEX.displayName,
    });
    await services.referrals.accept(ctx, first.id);
    const claimedAfter = await services.referrals.claim(first.claim.token, ALEX);
    expect(claimedAfter.status).toBe("claimed");
    if (claimedAfter.status === "claimed") {
      expect(claimedAfter.referral.candidateUserId).toBe(ALEX.userId);
      expect(claimedAfter.referral.company.state).toBe("accepted");
    }

    // ORDER B: the candidate first, then the company. A different company, so
    // the duplicate guard is not what is being measured here.
    const second = await submitted(SAM, {
      candidateEmail: ALEX.email,
      candidateFullName: ALEX.displayName,
      organizationLookup: { kind: "mc_number", value: "MC-1098447" },
    });
    const claimedFirst = await services.referrals.claim(second.claim.token, ALEX);
    expect(claimedFirst.status).toBe("claimed");
    const baxter = reviewer(BAXTER);
    // The company still has a decision to make; claiming did not make it.
    const pending = await services.referrals.companyGet(baxter, second.id);
    expect(pending?.company.state).toBe("pending_review");
    // And the ONLY thing it learned is that there is an account to invite.
    expect(pending?.candidateClaim).toBe("joined");
    const decided = await services.referrals.accept(baxter, second.id);
    expect(decided.status).toBe("decided");
  });

  it("keeps the candidate's Antcolos account when the company rejects", async () => {
    const ctx = reviewer(NORTHLINE);
    const referral = await submitted(SAM, {
      candidateEmail: ALEX.email, candidateFullName: ALEX.displayName,
    });
    await services.referrals.claim(referral.claim.token, ALEX);

    await services.referrals.reject(ctx, referral.id, "Not hiring dispatchers.");

    // The account is still there, still the same one, still theirs.
    expect(accountForEmail(ALEX.email)?.id).toBe(ALEX.userId);
    const after = referralById(referral.id);
    expect(after?.candidateUserId).toBe(ALEX.userId);
    expect(candidateStateOf(after!)).toBe("claimed");
    // And they are still able to be referred elsewhere, sign in, and so on:
    // nothing about the rejection reached a User.
    expect(accountForEmail(ALEX.email)?.email).toBe(NEWCOMER_USER.email);
  });

  it("connects an existing account without duplicating it or revealing it", async () => {
    // Two referrals, identical in every way except the address: one belongs to
    // an Antcolos account, the other belongs to nobody.
    const withAccount = await submitted(SAM, {
      candidateEmail: ALEX.email, candidateFullName: "A Person",
    });
    const withoutAccount = await submitted(SAM, {
      candidateEmail: "nobody.at.all@example.com",
      candidateFullName: "A Person",
      organizationLookup: { kind: "mc_number", value: "MC-1098447" },
    });

    // ★ NON-DISCLOSURE, TESTED BY COMPARISON ★
    // Everything either side can see about the two is structurally identical.
    // There is no field, and no value, that distinguishes the address that has
    // an account from the one that does not.
    const a = await services.referrals.companyGet(reviewer(NORTHLINE), withAccount.id);
    const b = await services.referrals.companyGet(reviewer(BAXTER), withoutAccount.id);
    expect(a?.candidateClaim).toBe(b?.candidateClaim);
    expect(a?.candidateClaim).toBe("not_yet");
    expect(Object.keys(a!).sort()).toEqual(Object.keys(b!).sort());

    const mine = await services.referrals.myReferrals(SAM);
    const mineA = mine.find((r) => r.id === withAccount.id)!;
    const mineB = mine.find((r) => r.id === withoutAccount.id)!;
    expect(Object.keys(mineA).sort()).toEqual(Object.keys(mineB).sort());
    expect(mineA.status).toBe(mineB.status);

    // The referral itself never asserted an account either.
    expect(withAccount.candidateUserId).toBeUndefined();

    // Claiming CONNECTS the account that already existed. No second one.
    const claimed = await services.referrals.claim(withAccount.claim.token, ALEX);
    expect(claimed.status).toBe("claimed");
    if (claimed.status === "claimed") {
      expect(claimed.referral.candidateUserId).toBe(NEWCOMER_USER.id);
    }
    expect(accountForEmail(ALEX.email)?.id).toBe(NEWCOMER_USER.id);
  });
});

/* -------------------------------------------------------------------------- */
/* 8 — duplicates                                                              */
/* -------------------------------------------------------------------------- */

describe("duplicates", () => {
  it("refuses a second open referral for the same person and company, and sends no second email", async () => {
    const first = await submitted(SAM);
    expect(first.emails).toHaveLength(1);

    const again = await services.referrals.submit(SAM, draft());
    expect(again.status).toBe("refused");
    if (again.status === "refused") expect(again.refusal).toBe("duplicate_active");

    // One referral, one queued email. Not two of either.
    const inbox = await services.referrals.companyInbox(reviewer(NORTHLINE));
    const forRae = inbox.filter((r) => r.candidateEmail.includes("rae.bonner"));
    expect(forRae).toHaveLength(1);
    expect(referralById(first.id)?.emails).toHaveLength(1);
  });

  it("caps resends, and refuses them all with one indistinguishable sentence", async () => {
    const referral = await submitted(SAM);
    // Inside the cooldown, so this is refused — and no email is queued.
    const tooSoon = await services.referrals.resend(SAM, referral.id);
    expect(tooSoon.status).toBe("refused");
    expect(referralById(referral.id)?.emails).toHaveLength(1);

    // A person who reported the introduction gets the SAME sentence as one who
    // is merely inside the cooldown. That is the point.
    await services.referrals.reportUnwanted(referral.claim.token);
    const afterReport = await services.referrals.resend(SAM, referral.id);
    expect(afterReport.status).toBe("refused");
    if (afterReport.status === "refused" && tooSoon.status === "refused") {
      expect(afterReport.message).toBe(tooSoon.message);
    }
  });

  it("refuses a new referral to an address that opted out, saying nothing about why", async () => {
    const referral = await submitted(SAM);
    await services.referrals.reportUnwanted(referral.claim.token);

    // A DIFFERENT company, a different referrer: the opt-out is about the
    // address and outlives the referral that caused it.
    const blocked = await services.referrals.submit(OUTSIDER, draft({
      organizationLookup: { kind: "mc_number", value: "MC-1098447" },
    }));
    expect(blocked.status).toBe("refused");
    if (blocked.status !== "refused") return;
    expect(blocked.refusal).toBe("recipient_opted_out");

    // And the sentence is the ordinary rate-limit one, so a sender cannot use
    // the form to find out who has opted out.
    const limited = await services.referrals.submit(OUTSIDER, draft({
      candidateEmail: "someone.else@example.com",
      organizationLookup: { kind: "mc_number", value: "MC-1098447" },
    }));
    expect(limited.status).toBe("submitted");
    expect(blocked.message).toBe(
      "We can't send another introduction to this person right now.",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 9 & 15 — authorization                                                      */
/* -------------------------------------------------------------------------- */

describe("authorization", () => {
  it("hides another company's referrals from both the list and a direct id", async () => {
    const referral = await submitted(SAM);
    const outsider = reviewer(BAXTER);

    const inbox = await services.referrals.companyInbox(outsider);
    expect(inbox.map((r) => r.id)).not.toContain(referral.id);

    // ★ THE DIRECT-ID PATH ENFORCES THE SAME BOUNDARY AS THE LIST ★
    // And it answers "missing", not "forbidden": a forbidden would confirm that
    // a referral for this person exists at a competitor.
    expect(await services.referrals.companyGet(outsider, referral.id)).toBeNull();

    const decision = await services.referrals.accept(outsider, referral.id);
    expect(decision.status).toBe("refused");
    if (decision.status === "refused") expect(decision.refusal).toBe("not_found");

    expect(await services.referrals.handoff(outsider, referral.id)).toBeNull();
    expect(
      await services.referrals.recordInvitation(outsider, referral.id, "inv_forged"),
    ).toBeNull();
  });

  it("writes nothing at all when the caller lacks the permission", async () => {
    const referral = await submitted(SAM);
    const before = referralById(referral.id)!;
    const powerless = reviewer(NORTHLINE, ["members:view"]);

    await expect(services.referrals.companyInbox(powerless))
      .rejects.toBeInstanceOf(PermissionDeniedError);

    const decision = await services.referrals.accept(powerless, referral.id);
    expect(decision.status).toBe("refused");
    if (decision.status === "refused") expect(decision.refusal).toBe("not_permitted");

    // Byte for byte, the referral is what it was: no decision, no history line,
    // no email, no invitation id.
    const after = referralById(referral.id)!;
    expect(after.company).toEqual(before.company);
    expect(after.events).toHaveLength(before.events.length);
    expect(after.emails).toHaveLength(before.emails.length);
    expect(after.lifecycle).toBe(before.lifecycle);
  });

  it("lets the referrer read only their own referrals", async () => {
    await submitted(SAM);
    await submitted(OUTSIDER, {
      candidateEmail: "someone.else@example.com",
      organizationLookup: { kind: "mc_number", value: "MC-1098447" },
    });

    const mine = await services.referrals.myReferrals(SAM);
    expect(mine.every((r) => r.candidateName !== undefined)).toBe(true);
    const theirs = await services.referrals.myReferrals(OUTSIDER);
    const overlap = mine.filter((m) => theirs.some((t) => t.id === m.id));
    expect(overlap).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 11 & 12 — the handoff into the canonical flows                              */
/* -------------------------------------------------------------------------- */

describe("the handoff", () => {
  it("hands off to the EXISTING invitation service, which is what issues one", async () => {
    const ctx = reviewer(NORTHLINE, [
      "referrals:review", "invitations:view", "invitations:create",
      "loads:view", "members:view",
    ]);
    const referral = await submitted(SAM);
    await services.referrals.accept(ctx, referral.id);
    const handoff = await services.referrals.handoff(ctx, referral.id);
    expect(handoff).not.toBeNull();
    expect(handoff!.recipientEmail).toBe("rae.bonner@example.com");

    // THE CANONICAL COMMAND. Not something inside the referral module.
    const invitation = await services.access.create(ctx, {
      kind: "employee",
      roleName: "Dispatcher",
      recipientName: handoff!.recipientName,
      recipientEmail: handoff!.recipientEmail,
      permissions: ["loads:view"],
      expiresAt: null,
      engagementId: handoff!.existingEngagementId,
    });
    expect(invitation.id).toBeTruthy();

    const view = await services.referrals.recordInvitation(ctx, referral.id, invitation.id);
    expect(view?.resultingInvitationId).toBe(invitation.id);
    // The referral's job is done and it says so, rather than pretending to
    // track what the invitation does next.
    expect(view?.lifecycle).toBe("closed");

    // The invitation is a real one, in the access module's own list.
    const listed = await services.access.list(ctx);
    expect(listed.map((i) => i.id)).toContain(invitation.id);
  });

  it("connects an engagement the organization already has instead of duplicating it", async () => {
    const ctx = reviewer(NORTHLINE, [
      "referrals:review", "invitations:view", "invitations:create", "loads:view",
    ]);
    const before = engagementsForOrganization(NORTHLINE).length;

    // Priya already works at Northline and has no Antcolos account.
    const referral = await submitted(SAM, {
      candidateFullName: "Priya Raman",
      candidateEmail: "priya.raman@example.com",
    });
    await services.referrals.accept(ctx, referral.id);
    const handoff = await services.referrals.handoff(ctx, referral.id);
    expect(handoff!.existingEngagementId).toBe("weng_nl_priya");

    const invitation = await services.access.create(ctx, {
      kind: "employee",
      roleName: "Yard hand",
      recipientName: handoff!.recipientName,
      recipientEmail: handoff!.recipientEmail,
      permissions: ["loads:view"],
      expiresAt: null,
      engagementId: handoff!.existingEngagementId,
    });
    const view = await services.referrals.recordInvitation(ctx, referral.id, invitation.id);

    expect(view?.resultingEngagementId).toBe("weng_nl_priya");
    // CONNECTED, not created: the count is exactly what it was.
    expect(engagementsForOrganization(NORTHLINE).length).toBe(before);
  });

  it("refuses a handoff before the company has recorded interest", async () => {
    const ctx = reviewer(NORTHLINE);
    const referral = await submitted(SAM);
    expect(await services.referrals.handoff(ctx, referral.id)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 13 — the token                                                              */
/* -------------------------------------------------------------------------- */

describe("the claim token", () => {
  it("fails closed on reuse, expiry, tampering and the wrong recipient", async () => {
    const referral = await submitted(SAM, {
      candidateEmail: ALEX.email, candidateFullName: ALEX.displayName,
    });

    // WRONG RECIPIENT — and the referral is untouched afterwards.
    const wrong = await services.referrals.claim(referral.claim.token, SAM);
    expect(wrong.status).toBe("refused");
    if (wrong.status === "refused") expect(wrong.refusal).toBe("wrong_recipient");
    expect(referralById(referral.id)?.candidateUserId).toBeUndefined();

    // TAMPERING — a token that is one character different is not a near miss.
    const tampered = await services.referrals.lookUpClaim(
      `${referral.claim.token}X`, ALEX,
    );
    expect(tampered.status).toBe("refused");
    if (tampered.status === "refused") expect(tampered.refusal).toBe("not_found");

    // The real one works, once.
    const ok = await services.referrals.claim(referral.claim.token, ALEX);
    expect(ok.status).toBe("claimed");

    // REUSE — the second attempt is refused and changes nothing.
    const reused = await services.referrals.claim(referral.claim.token, ALEX);
    expect(reused.status).toBe("refused");
    if (reused.status === "refused") expect(reused.refusal).toBe("already_claimed");
  });

  it("refuses an expired link, and derives the candidate state from it", async () => {
    const referral = await submitted(SAM, {
      candidateEmail: ALEX.email, candidateFullName: ALEX.displayName,
    });
    // Reach past the service to age the token, which is the one thing a test
    // cannot do by waiting.
    putReferral({
      ...referral,
      claim: { ...referral.claim, expiresAt: new Date(Date.now() - 1000).toISOString() },
    });

    const lookup = await services.referrals.lookUpClaim(referral.claim.token, ALEX);
    expect(lookup.status).toBe("refused");
    if (lookup.status === "refused") expect(lookup.refusal).toBe("expired");

    const claimed = await services.referrals.claim(referral.claim.token, ALEX);
    expect(claimed.status).toBe("refused");
    expect(candidateStateOf(referralById(referral.id)!)).toBe("expired");

    // The COMPANY's review is unaffected by the link running out.
    const view = await services.referrals.companyGet(reviewer(NORTHLINE), referral.id);
    expect(view?.company.state).toBe("pending_review");
    expect(view?.candidateClaim).toBe("not_yet");
  });

  it("stops working when the referrer withdraws, without touching the account", async () => {
    const referral = await submitted(SAM, {
      candidateEmail: ALEX.email, candidateFullName: ALEX.displayName,
    });
    await services.referrals.withdraw(SAM, referral.id);

    const lookup = await services.referrals.lookUpClaim(referral.claim.token, ALEX);
    expect(lookup.status).toBe("refused");
    if (lookup.status === "refused") expect(lookup.refusal).toBe("withdrawn");
    expect(accountForEmail(ALEX.email)?.id).toBe(ALEX.userId);

    // A withdrawn referral is no longer somebody's to decide.
    const decision = await services.referrals.accept(reviewer(NORTHLINE), referral.id);
    expect(decision.status).toBe("refused");
    if (decision.status === "refused") expect(decision.refusal).toBe("withdrawn");
  });
});

/* -------------------------------------------------------------------------- */
/* 14 — the five outcomes stay distinguishable                                 */
/* -------------------------------------------------------------------------- */

describe("outcomes stay distinguishable", () => {
  it("keeps withdrawal, decline, rejection, bounce and abuse report apart", async () => {
    const ctx = reviewer(NORTHLINE);
    const make = (email: string, name: string) =>
      submitted(SAM, { candidateEmail: email, candidateFullName: name });

    const withdrawn = await make("w@example.com", "W Person");
    const declined = await make("d@example.com", "D Person");
    const rejected = await make("r@example.com", "R Person");
    const bounced = await make("b@example.com", "B Person");
    const reported = await make("a@example.com", "A Person");

    await services.referrals.withdraw(SAM, withdrawn.id);
    await services.referrals.decline(declined.claim.token, null);
    await services.referrals.reject(ctx, rejected.id);
    await services.referrals.recordDelivery(
      bounced.id, bounced.emails[0].id, "bounced", "Mailbox does not exist.",
    );
    await services.referrals.reportUnwanted(reported.claim.token, "Never applied.");

    const read = (id: string) => referralById(id)!;

    // Five different records of five different things. None of them collapses
    // into another, and each one is readable as itself.
    expect(read(withdrawn.id).lifecycle).toBe("withdrawn");
    expect(read(withdrawn.id).candidateDecision).toBeUndefined();

    expect(candidateStateOf(read(declined.id))).toBe("declined");
    expect(read(declined.id).lifecycle).toBe("submitted");
    expect(read(declined.id).company.state).toBe("pending_review");

    expect(read(rejected.id).company.state).toBe("rejected");
    expect(read(rejected.id).candidateDecision).toBeUndefined();

    // ★ A BOUNCE IS NOT AN ANSWER ★
    expect(read(bounced.id).emails[0].state).toBe("bounced");
    expect(read(bounced.id).candidateDecision).toBeUndefined();
    expect(candidateStateOf(read(bounced.id))).toBe("email_pending");
    expect(read(bounced.id).company.state).toBe("pending_review");

    expect(candidateStateOf(read(reported.id))).toBe("reported_unwanted");
    expect(abuseReports().map((r) => r.referralId)).toContain(reported.id);

    // And the REFERRER cannot tell a report from a decline, which is what keeps
    // a confidential report confidential.
    const mine = await services.referrals.myReferrals(SAM);
    const declinedView = mine.find((r) => r.id === declined.id)!;
    const reportedView = mine.find((r) => r.id === reported.id)!;
    expect(reportedView.status).toBe(declinedView.status);
    expect(reportedView.status).toBe("candidate_declined");
  });

  it("never writes `delivered` without provider evidence", async () => {
    const referral = await submitted(SAM);
    // Queuing is the most a frontend may claim.
    expect(referral.emails[0].state).toBe("queued");
    expect(referral.emails[0].deliveredAt).toBeUndefined();
    expect(candidateStateOf(referral)).toBe("email_pending");

    await services.referrals.recordDelivery(referral.id, referral.emails[0].id, "delivered");
    const after = referralById(referral.id)!;
    expect(after.emails[0].deliveredAt).toBeTruthy();
    expect(candidateStateOf(after)).toBe("email_delivered");
    // Delivered is still not an answer from a person.
    expect(after.candidateDecision).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 16 — the candidate's own records stay theirs                                */
/* -------------------------------------------------------------------------- */

describe("what the company may see about the person", () => {
  it("shows no profile, no documents and no account identifiers", async () => {
    // Sam has Antcolos driver profiles at two other carriers, and Baxter has no
    // business knowing any of that from an introduction.
    const referral = await submitted(OUTSIDER, {
      candidateFullName: MOCK_USER.displayName,
      candidateEmail: MOCK_USER.email,
      organizationLookup: { kind: "mc_number", value: "MC-1098447" },
    });
    const ctx = reviewer(BAXTER);
    const view = await services.referrals.companyGet(ctx, referral.id);
    const serialized = JSON.stringify(view);

    // No driver profile, no user id, no document, no membership — not as a
    // field, and not as a value anywhere inside it.
    expect(serialized).not.toContain("drv_");
    expect(serialized).not.toContain("usr_");
    expect(serialized).not.toContain("mem_");
    expect(serialized).not.toContain("doc_");
    expect(view).not.toHaveProperty("candidateUserId");
    expect(view).not.toHaveProperty("driverProfileId");
    expect(view).not.toHaveProperty("documents");

    // Even after acceptance and a claim, the view gains exactly one bit: that
    // there is now an account to invite.
    await services.referrals.accept(ctx, referral.id);
    await services.referrals.claim(referral.claim.token, SAM);
    const after = await services.referrals.companyGet(ctx, referral.id);
    expect(after?.candidateClaim).toBe("joined");
    expect(JSON.stringify(after)).not.toContain("usr_");
    expect(JSON.stringify(after)).not.toContain("drv_");
  });

  it("hides the company's internal note from the referrer", async () => {
    const ctx = reviewer(NORTHLINE);
    const referral = await submitted(SAM);
    await services.referrals.reject(ctx, referral.id, "Owner said no, bad reference.");

    const mine = await services.referrals.myReferrals(SAM);
    const view = mine.find((r) => r.id === referral.id)!;
    expect(JSON.stringify(view)).not.toContain("bad reference");
    expect(view.status).toBe("company_passed");
  });
});
