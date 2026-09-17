import test from "node:test";
import assert from "node:assert/strict";
import { contextFor } from "@/test/context";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import {
  liveMembershipFor, resetRoster, rosterSnapshot,
} from "@/lib/session/membership-store";
import { resetDriverMock } from "@/features/driver/mock-driver";
import {
  acceptInvitation, endSeat, issueInvitation, leaveOrganization,
  resolveInvitation, rosterOf,
} from "@/lib/api/mock/access-service";
import { resetAccessStore } from "@/lib/api/mock/access-store";
import { auditLedger, resetAuditLedger } from "@/lib/api/mock/audit-ledger";
import {
  profileForUser, relationshipsForProfile, resetDriverRegistry,
} from "@/lib/api/mock/driver-registry";
import type { AcceptingIdentity } from "@/lib/api/contracts/access";

/**
 * The whole arc, on the node runner: issue, accept, refuse, repeat, remove.
 *
 * The vitest suite pins each boundary on its own. This one walks the sequence a
 * person actually performs, because the failures that matter in an access flow
 * are the ones that only appear when steps run in order — a seat granted before
 * the profile it points at, an invitation stamped before the thing it created,
 * a retry that lands halfway through and leaves two of something.
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

const LICENCE = {
  legalName: "Alex Rivera",
  cdlNumber: "R9920184471",
  cdlState: "IL",
  cdlExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(),
};

function reset() {
  resetAccessStore();
  resetRoster();
  resetDriverRegistry();
  resetDriverMock();
  resetAuditLedger();
}

test("a carrier invites somebody, they accept, and they are in", async () => {
  reset();

  /* 1 · The owner issues, through the authorized path. */
  const issued = await issueInvitation(contextFor("org_northline"), {
    kind: "driver", roleName: "Driver", engagementType: "company_driver",
    recipientName: NEWCOMER_USER.displayName, recipientEmail: NEWCOMER_USER.email,
    permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload"],
  });
  assert.equal(issued.status, "issued");
  if (issued.status !== "issued") return;

  const token = issued.invitation.token;
  assert.equal(issued.invitation.organizationId, "org_northline");
  assert.equal(issued.invitation.recipientUserId, NEWCOMER_USER.id);

  /* 2 · The wrong person cannot use it. */
  const wrong = await resolveInvitation(token, SAM);
  assert.equal(wrong.status, "refused");
  assert.equal(wrong.status === "refused" && wrong.refusal, "wrong_recipient");

  /* 3 · The right person can, and it creates everything at once. */
  const accepted = await acceptInvitation(token, NEWCOMER, { driverIdentity: LICENCE });
  assert.equal(accepted.status, "accepted");
  if (accepted.status !== "accepted") return;

  const seat = liveMembershipFor("newcomer", NEWCOMER_USER.id, "org_northline");
  assert.ok(seat, "the seat is in the session's roster");
  assert.equal(seat!.id, accepted.outcome.membership.id);

  const profile = profileForUser(NEWCOMER_USER.id);
  assert.ok(profile, "the person has a permanent profile");
  assert.equal(accepted.outcome.driverProfileResumed, false);

  const engagement = relationshipsForProfile(profile!.id)
    .find((r) => r.carrierId === "org_northline");
  assert.ok(engagement, "the carrier has an engagement with them");

  /* 4 · Accepted, NOT started. */
  assert.ok(engagement!.acceptedAt, "the acceptance date is recorded");
  assert.equal(engagement!.startedAt, undefined, "no start date was invented");
  assert.equal(engagement!.startedAtBasis, undefined);
  assert.equal(engagement!.status, "onboarding");

  /* 5 · Both halves are in the ledger. */
  const actions = auditLedger.all("org_northline").map((e) => e.action);
  assert.ok(actions.includes("access.member_invited"));
  assert.ok(actions.includes("access.member_joined"));
  assert.ok(actions.includes("workforce.engagement_created"));
});

test("accepting twice leaves one of everything", async () => {
  reset();

  const first = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
  assert.equal(first.status, "accepted");
  if (first.status !== "accepted") return;

  const joinsBefore = auditLedger.all("org_northline")
    .filter((e) => e.action === "access.member_joined").length;

  const second = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
  assert.equal(second.status, "already_accepted");

  assert.equal(
    rosterSnapshot("newcomer").memberships
      .filter((m) => m.organizationId === "org_northline").length,
    1,
    "one seat",
  );
  assert.equal(
    relationshipsForProfile(first.outcome.driverProfileId!)
      .filter((r) => r.carrierId === "org_northline").length,
    1,
    "one engagement",
  );
  assert.equal(
    auditLedger.all("org_northline").filter((e) => e.action === "access.member_joined").length,
    joinsBefore,
    "one audit entry",
  );
});

test("a person who already has a profile is never asked for their licence again", async () => {
  reset();
  const before = profileForUser(MOCK_USER.id);
  assert.ok(before);

  const accepted = await acceptInvitation("INV-DRIVER-ACCT", SAM);
  assert.equal(accepted.status, "accepted");
  if (accepted.status !== "accepted") return;

  assert.equal(accepted.outcome.driverProfileResumed, true);
  const after = profileForUser(MOCK_USER.id)!;
  assert.equal(after.id, before!.id);
  assert.equal(after.cdlNumber, before!.cdlNumber, "the licence on file was not overwritten");
  assert.equal(after.createdAt, before!.createdAt);
});

test("accepting never hands over restricted paperwork", async () => {
  reset();
  const accepted = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
  assert.equal(accepted.status, "accepted");
  if (accepted.status !== "accepted") return;

  const { sharedDocuments, withheldDocuments, relationship } = accepted.outcome;
  assert.ok(sharedDocuments.some((d) => d.key === "cdl_front"));
  for (const doc of sharedDocuments) assert.notEqual(doc.label, doc.key);
  assert.deepEqual(
    withheldDocuments.map((d) => d.key).sort(),
    ["northline_employment_application", "northline_mvr"],
  );
  for (const doc of withheldDocuments) {
    assert.ok(
      !relationship!.sharedDocumentKeys.includes(doc.key),
      `${doc.key} must not be shared by accepting`,
    );
    // Shown by name, with a reason. An internal key is not something to put in
    // front of a person.
    assert.notEqual(doc.label, doc.key);
    assert.ok(doc.reason, `${doc.key} says why it is withheld`);
  }
});

test("removing access removes access, and nothing else", async () => {
  reset();
  const accepted = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
  assert.equal(accepted.status, "accepted");
  if (accepted.status !== "accepted") return;

  const profileId = accepted.outcome.driverProfileId!;
  const ended = await endSeat(
    contextFor("org_northline"), accepted.outcome.membership.id, "No longer with us.",
  );
  assert.equal(ended.status, "ended");

  assert.equal(
    rosterOf("org_northline").some((m) => m.userId === NEWCOMER_USER.id), false,
    "the seat is gone from the roster",
  );
  assert.ok(profileForUser(NEWCOMER_USER.id), "the person still exists");
  assert.equal(
    relationshipsForProfile(profileId).find((r) => r.carrierId === "org_northline")!.status,
    "onboarding",
    "the working relationship is untouched — ending access is not ending it",
  );

  // Idempotent.
  const again = await endSeat(
    contextFor("org_northline"), accepted.outcome.membership.id, "No longer with us.",
  );
  assert.equal(again.status, "already_ended");
});

test("a solo owner keeps their own workspace", async () => {
  reset();
  assert.equal(rosterOf("org_solo").length, 1);

  const removed = await endSeat(contextFor("org_solo"), "mem_solo_dispatcher", "Cleaning up.");
  assert.equal(removed.status, "refused");
  assert.equal(removed.status === "refused" && removed.refusal, "last_owner");

  // And they cannot walk out of it either — the same refusal, because a
  // workspace nobody can administer cannot be recovered from inside.
  const left = await leaveOrganization(contextFor("org_solo"));
  assert.equal(left.status, "refused");
  assert.equal(left.status === "refused" && left.refusal, "last_owner");
  assert.equal(rosterOf("org_solo").length, 1);
});

test("somebody who already belongs somewhere gains a seat rather than swapping one", async () => {
  reset();

  const first = await acceptInvitation("INV-NEWDRIVER", NEWCOMER, { driverIdentity: LICENCE });
  assert.equal(first.status, "accepted");

  const issued = await issueInvitation(contextFor("org_summit"), {
    kind: "dispatcher", roleName: "Dispatcher",
    recipientName: NEWCOMER_USER.displayName, recipientEmail: NEWCOMER_USER.email,
    permissions: ["loads:view", "dispatch:view"],
  });
  assert.equal(issued.status, "issued");
  if (issued.status !== "issued") return;

  const second = await acceptInvitation(issued.invitation.token, NEWCOMER);
  assert.equal(second.status, "accepted");

  const held = rosterSnapshot("newcomer").memberships
    .filter((m) => m.status === "active")
    .map((m) => m.organizationId).sort();
  assert.deepEqual(held, ["org_northline", "org_summit"]);

  // One person, one profile, two organizations.
  assert.equal(
    relationshipsForProfile(profileForUser(NEWCOMER_USER.id)!.id)
      .filter((r) => r.status !== "ended").length,
    1,
    "the dispatch seat created no driver engagement",
  );
});

test("a whole-organization invitation is refused rather than quietly granting reach", async () => {
  reset();
  const result = await resolveInvitation("INV-DISPATCHORG", SAM);
  assert.equal(result.status, "refused");
  assert.equal(
    result.status === "refused" && result.refusal,
    "organization_invitation_unsupported",
    "dispatch reach is per truck, from the truck — never a seat in a workspace",
  );
});
