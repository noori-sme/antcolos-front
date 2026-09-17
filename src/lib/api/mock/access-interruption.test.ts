import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AcceptanceStepKey, PermissionKey } from "@/types";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import {
  liveMembershipFor, resetRoster, rosterSnapshot, setMembershipStatus,
} from "@/lib/session/membership-store";
import {
  driverProfileSync, driverRelationshipsSync, resetDriverMock,
} from "@/features/driver/mock-driver";
import {
  failConsentWriteForTests, liveRelationship, profileForUser, resetDriverRegistry,
  setSharedDocumentKeysForTests,
} from "./driver-registry";
import {
  addLinks, documentsForSubject, eventsForLineage, failLinkWriteForTests, resetDocumentStore,
} from "./document-store";
import { auditLedger, resetAuditLedger } from "./audit-ledger";
import {
  failAcceptanceStepForTests, failJoinedAuditForTests, mockAccessService,
} from "./access";
import { joinedAuditWritten, resetAccessStore } from "./access-store";
import { mockDocumentsService } from "./documents";
import { resetWorkforceStore } from "./workforce-store";
import { accessNeedsYouItems } from "./access-needs-you";
import { NotFoundError, type ServiceContext } from "../contracts/context";

/**
 * ★ INTERRUPTED HALFWAY, AND PICKED BACK UP ★
 *
 * Acceptance asks five modules for five things and there is no transaction
 * around them. Any one can fail. So the property that has to hold is not "it
 * works" — it is:
 *
 *   1. NOTHING BECOMES USABLE EARLY. Whatever failed, the person must not end
 *      up holding access to something that was never created. A portal seat
 *      without a relationship behind it is the sharpest version: they could
 *      sign in to a workspace they are not connected to.
 *   2. RETRY COMPLETES, ONCE. Accepting again finishes what is missing and
 *      repeats nothing — no second profile, relationship, seat, document link
 *      or audit line.
 *
 * Every step is interrupted in turn, through the module's own test seam,
 * because "the relationship succeeded and the seat did not" is not a state any
 * amount of arranging fixtures can reach on demand.
 */

const NORTHLINE = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
const TOKEN = "INV-DRIVER-ACCT";
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

const LICENCE = {
  legalName: "Sam Murtaza",
  cdlNumber: "K4471182993",
  cdlState: "IL",
  cdlExpiresAt: "2030-04-01T00:00:00.000Z",
};

function context(permissions: PermissionKey[], organizationId = NORTHLINE.id): ServiceContext {
  return {
    organizationId,
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

const OWNER = () => context([
  "invitations:view", "invitations:create", "invitations:revoke", "invitations:resend",
]);

/**
 * Someone with no profile and no seat in this carrier, so every step has real
 * work to do.
 *
 * The demo account owns Northline in the fixtures, and a person who already
 * holds a seat makes the seat step a no-op — which is correct behaviour and a
 * useless test. Ending that seat puts them where a real invitee is: known to
 * Antcolos, unknown to this carrier.
 */
function asNewPerson() {
  resetDriverRegistry({ omitUserIds: ["usr_sam"] });
  resetDriverMock({ withProfile: false });
  setMembershipStatus("demo", "mem_northline_owner", "left");
}

const accept = () =>
  mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });

const joinedEvents = () =>
  auditLedger.all(NORTHLINE.id).filter((e) => e.action === "access.member_joined");

/** Seats they can actually work from. A seat they left is history, not access. */
const seats = () => rosterSnapshot("demo").memberships
  .filter((m) => m.userId === "usr_sam"
    && m.organizationId === NORTHLINE.id
    && m.status === "active");

const relationships = () => driverRelationshipsSync()
  .filter((r) => r.carrierId === NORTHLINE.id && r.status !== "ended");

beforeEach(() => {
  failAcceptanceStepForTests(null);
  failJoinedAuditForTests(false);
  failLinkWriteForTests(null);
  failConsentWriteForTests(false);
  resetAccessStore();
  resetRoster();
  resetDocumentStore();
  resetAuditLedger();
  resetDriverRegistry();
  resetDriverMock();
  // The engagement one test links must be unlinked again for the next, or the
  // interruption case starts from a state a previous test left behind.
  resetWorkforceStore();
});

/* -------------------------------------------------------------------------- */
/* One failure at a time                                                       */
/* -------------------------------------------------------------------------- */

const STEPS: AcceptanceStepKey[] = [
  "driver_profile", "carrier_relationship", "workspace_membership",
];

/**
 * The migration token, which names an engagement this carrier already holds.
 *
 * `INV-DRIVER-ACCT` names none, so its `engagement_link` step is correctly
 * `not_applicable` and cannot be interrupted. Asserting a failure there would
 * be asserting against a step that never runs.
 */
const MIGRATED = "INV-MIGRATED";
const acceptMigrated = () =>
  mockAccessService.accept(MIGRATED, RETURNING, { sharedDocumentKeys: [], licence: LICENCE });

describe("interrupted at each step, nothing is granted early", () => {
  for (const failing of STEPS) {
    it(`leaves nothing usable beyond the step before ${failing}`, async () => {
      asNewPerson();
      failAcceptanceStepForTests(failing);

      const result = await accept();
      expect(result.status).toBe("incomplete");
      if (result.status !== "incomplete") return;

      const state = new Map(result.run.steps.map((s) => [s.key, s.state]));
      expect(state.get(failing)).toBe("failed");

      // The invitation stays open. If it read "accepted" here, the person
      // would be told somebody had already accepted when they came back.
      const [invitation] = (await mockAccessService.list(OWNER()))
        .filter((i) => i.token === TOKEN);
      expect(invitation.status).toBe("pending");

      // Nothing after the failure was attempted, so nothing after it exists.
      if (failing === "driver_profile") {
        expect(profileForUser("usr_sam")).toBeUndefined();
        expect(relationships()).toHaveLength(0);
        expect(state.get("carrier_relationship")).toBe("pending");
        expect(state.get("workspace_membership")).toBe("pending");
      }

      if (failing === "carrier_relationship") {
        // The profile is theirs and survives — it is not this carrier's.
        expect(profileForUser("usr_sam")).toBeDefined();
        expect(relationships()).toHaveLength(0);
        // ★ The seat must NOT exist. Access cannot arrive before the thing it
        // is access to: signing in to a workspace you are not connected to.
        expect(state.get("workspace_membership")).toBe("pending");
        expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)).toBeUndefined();
        // And no document may have travelled, because none was ever linked.
        expect(state.get("document_access")).toBe("pending");
      }

      if (failing === "workspace_membership") {
        // Connected, and correctly unable to sign in. Recoverable, and honest.
        expect(relationships()).toHaveLength(1);
        expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)).toBeUndefined();
      }

      // An unfinished acceptance is never silent: it reaches whoever runs
      // access, because the person believes they have joined.
      expect(accessNeedsYouItems(OWNER())).toHaveLength(1);

      // Nobody has joined, so nothing says they did.
      expect(joinedEvents()).toHaveLength(0);
    });
  }
});

describe("retrying finishes the job exactly once", () => {
  for (const failing of STEPS) {
    it(`completes after a failure at ${failing}, with no duplicates`, async () => {
      asNewPerson();
      failAcceptanceStepForTests(failing);
      const first = await accept();
      expect(first.status).toBe("incomplete");

      // Whatever refused has stopped refusing. The person accepts again.
      failAcceptanceStepForTests(null);
      const second = await accept();
      expect(second.status).toBe("accepted");

      // One of everything.
      expect(relationships()).toHaveLength(1);
      expect(seats()).toHaveLength(1);
      expect(driverProfileSync()).toBeDefined();
      expect(profileForUser("usr_sam")!.id).toBe(driverProfileSync()!.id);

      // One audit line for joining, not one per attempt.
      expect(joinedEvents()).toHaveLength(1);

      // The queue goes quiet on its own — the item is derived, not resolved.
      expect(accessNeedsYouItems(OWNER())).toHaveLength(0);

      // And the relationship still carries no start date: finishing an
      // interrupted acceptance is not being cleared to work either.
      expect(relationships()[0].startedAt).toBeUndefined();
      expect(relationships()[0].acceptedAt).toBeTruthy();
    });
  }

  it("keeps the acceptance moment from the first attempt, not the retry", async () => {
    asNewPerson();
    failAcceptanceStepForTests("workspace_membership");
    const first = await accept();
    expect(first.status).toBe("incomplete");
    const acceptedAt = first.status === "incomplete" ? first.run.acceptedAt : "";

    failAcceptanceStepForTests(null);
    const second = await accept();
    expect(second.status).toBe("accepted");
    // They said yes once. The retry finished the plumbing; it is not a second
    // consent and must not read as a later one.
    if (second.status === "accepted") expect(second.run.acceptedAt).toBe(acceptedAt);
  });

  it("does not re-link a document that was already linked", async () => {
    asNewPerson();
    failAcceptanceStepForTests("workspace_membership");
    await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: ["cdl_front"], licence: LICENCE,
    });
    const profileId = profileForUser("usr_sam")!.id;
    const linksAfterFirst = documentsForSubject("driver", profileId)
      .flatMap((d) => d.links).filter((l) => !l.unlinkedAt).length;

    failAcceptanceStepForTests(null);
    await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: ["cdl_front"], licence: LICENCE,
    });

    expect(documentsForSubject("driver", profileId)
      .flatMap((d) => d.links).filter((l) => !l.unlinkedAt)).toHaveLength(linksAfterFirst);
  });
});

/* -------------------------------------------------------------------------- */
/* The cases that must refuse                                                  */
/* -------------------------------------------------------------------------- */

describe("a link that is not theirs to use", () => {
  it("refuses the wrong recipient, and creates nothing", async () => {
    // `INV-NEWCOMER` is addressed to alex.rivera@example.com, who has an
    // account. This session is signed in as somebody else, and no amount of
    // pressing changes that.
    //
    // It used to point at karin.vogel@example.com, who has no account at all.
    // That invitation now resolves to `needs-account` first — correctly, since
    // there is nobody to compare against until she makes one — because
    // `recipientHasAccount` is derived from the directory rather than typed
    // into the fixture. A seed can no longer claim an account that does not
    // exist, and the case below covers it.
    const lookup = await mockAccessService.lookUp("INV-NEWCOMER", SAM);
    expect(lookup.status).toBe("wrong-recipient");

    const result = await mockAccessService.accept(
      "INV-NEWCOMER", SAM, { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("not-acceptable");
    // Exactly what they had before: the Owner seat, untouched. Nothing was
    // added for an invitation addressed to somebody else.
    expect(seats()).toHaveLength(1);
    expect(seats()[0].id).toBe("mem_northline_owner");
    expect(joinedEvents()).toHaveLength(0);
  });

  it("sends somebody with no account to sign up before it can say whose it is", async () => {
    // karin.vogel@example.com is nobody in particular until she makes an
    // account, so the address is all the invitation can name and there is
    // nothing to compare a signed-in session against.
    const lookup = await mockAccessService.lookUp("INV-WRONGUSER", SAM);
    expect(lookup.status).toBe("needs-account");
    if (lookup.status === "needs-account") {
      expect(lookup.invitation.recipientHasAccount).toBe(false);
      expect(lookup.invitation.recipientUserId).toBeUndefined();
    }

    const result = await mockAccessService.accept(
      "INV-WRONGUSER", SAM, { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("not-acceptable");
    expect(joinedEvents()).toHaveLength(0);
  });

  it("refuses a revoked invitation even mid-run, and grants nothing further", async () => {
    asNewPerson();
    failAcceptanceStepForTests("workspace_membership");
    const first = await accept();
    expect(first.status).toBe("incomplete");

    // The carrier changes its mind while the person is part-connected.
    const [invitation] = (await mockAccessService.list(OWNER())).filter((i) => i.token === TOKEN);
    await mockAccessService.revoke(OWNER(), invitation.id);

    failAcceptanceStepForTests(null);
    const second = await accept();

    // A revoked invitation is not resumable. The seat is never granted.
    expect(second.status).toBe("not-acceptable");
    expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)).toBeUndefined();
    expect(joinedEvents()).toHaveLength(0);
  });
});

describe("accepting twice at once", () => {
  it("produces one of everything when both calls are in flight together", async () => {
    asNewPerson();

    // Two clicks, two tabs, a double-submitted form. They overlap: both read
    // before either writes, which is the shape that makes duplicates.
    const [a, b] = await Promise.all([accept(), accept()]);

    expect([a.status, b.status]).toEqual(["accepted", "accepted"]);
    expect(relationships()).toHaveLength(1);
    expect(seats()).toHaveLength(1);

    // One profile, whichever call got there first.
    const profiles = new Set([profileForUser("usr_sam")!.id, driverProfileSync()!.id]);
    expect(profiles.size).toBe(1);
  });

  it("writes one joined event however many callers raced", async () => {
    asNewPerson();
    await Promise.all([accept(), accept(), accept()]);
    // ███ THE HONEST LIMIT ███
    // This holds because every step's check and write sit in one synchronous
    // block within a single tab. It proves nothing about two browsers or two
    // servers: the backend still owes the unique constraints named in the PR.
    expect(joinedEvents()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Connecting an existing worker                                               */
/* -------------------------------------------------------------------------- */

describe("an existing worker connecting their account", () => {
  it("writes their profile onto the engagement and changes no date", async () => {
    asNewPerson();
    const { engagementById } = await import("./workforce-store");
    const { mockWorkforceService } = await import("./workforce");
    // Force the seed, then read the carrier's assertion as it stands.
    await mockWorkforceService.list(context(["workforce:view"]));
    const before = engagementById("weng_nl_migrated_driver")!;
    expect(before.driverProfileId).toBeUndefined();

    const result = await acceptMigrated();
    expect(result.status).toBe("accepted");

    const after = engagementById("weng_nl_migrated_driver")!;
    expect(after.driverProfileId).toBe(profileForUser("usr_sam")!.id);
    // ★ The assertion the whole date decision was about.
    expect(after.startDate).toBe(before.startDate);
    expect(after.state).toBe(before.state);
    expect(after.classification).toBe(before.classification);
  });

  it("is interrupted and resumed at the link step without a second history line",
    async () => {
      asNewPerson();
      const { engagementById } = await import("./workforce-store");
      const { mockWorkforceService } = await import("./workforce");
      await mockWorkforceService.list(context(["workforce:view"]));

      failAcceptanceStepForTests("engagement_link");
      const first = await acceptMigrated();
      expect(first.status).toBe("incomplete");
      // Not linked, and the carrier's record is untouched.
      expect(engagementById("weng_nl_migrated_driver")!.driverProfileId).toBeUndefined();

      failAcceptanceStepForTests(null);
      const second = await acceptMigrated();
      expect(second.status).toBe("accepted");

      const after = engagementById("weng_nl_migrated_driver")!;
      expect(after.driverProfileId).toBe(profileForUser("usr_sam")!.id);
      // Appended once, not once per attempt.
      expect(after.history.filter((h) => h.kind === "driver_profile_linked")).toHaveLength(1);
    });

  it("accepting again after completion links nothing a second time", async () => {
    asNewPerson();
    const { engagementById } = await import("./workforce-store");
    const { mockWorkforceService } = await import("./workforce");
    await mockWorkforceService.list(context(["workforce:view"]));

    await acceptMigrated();
    const linkedOnce = engagementById("weng_nl_migrated_driver")!.history
      .filter((h) => h.kind === "driver_profile_linked").length;

    // The link is finished, so the invitation reads used and refuses.
    const again = await acceptMigrated();
    expect(again.status).toBe("not-acceptable");
    expect(engagementById("weng_nl_migrated_driver")!.history
      .filter((h) => h.kind === "driver_profile_linked")).toHaveLength(linkedOnce);
  });
});

/* -------------------------------------------------------------------------- */
/* The step that grants document access                                        */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE PERSON WHO ALREADY HAS PAPERWORK ★
 *
 * `asNewPerson` deletes the demo profile, and with it every document that
 * hangs off it — so a sharing test run that way links nothing and passes
 * whatever the code does. This one keeps the profile and its documents and only
 * takes away the Northline seat, which is the real shape of the case: somebody
 * Antcolos already knows, with a file of their own, joining a new carrier.
 */
function asDriverWithPaperwork() {
  setMembershipStatus("demo", "mem_northline_owner", "left");
}

/** Northline reading its own Document Center. */
const CARRIER = () => context(["documents:view"]);

const SHARED = ["cdl_front", "medical_front"];

const carrierCanList = async (documentId: string) =>
  (await mockDocumentsService.list(CARRIER())).some((v) => v.document.documentId === documentId);

const driverDocumentId = (requirementKey: string) =>
  documentsForSubject("driver", "dp_sam")
    .find((d) => d.links.some((l) => l.requirementKey === requirementKey))!.documentId;

const documentEventsFor = (documentId: string) =>
  eventsForLineage(documentsForSubject("driver", "dp_sam")
    .find((d) => d.documentId === documentId)!.lineageId);

const northlineLinks = (documentId: string) =>
  documentsForSubject("driver", "dp_sam")
    .find((d) => d.documentId === documentId)!.links
    .filter((l) => !l.unlinkedAt && l.contextOrganizationId === NORTHLINE.id);

describe("interrupted while granting document access", () => {
  it("leaves the relationship standing and not one document readable", async () => {
    asDriverWithPaperwork();
    failAcceptanceStepForTests("document_access");

    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: SHARED, licence: LICENCE,
    });
    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;

    const state = new Map(result.run.steps.map((s) => [s.key, s.state]));

    // Its prerequisites DID succeed. This is the interesting middle of the
    // sequence, not a failure cascading from the top.
    expect(state.get("driver_profile")).toBe("done");
    expect(state.get("carrier_relationship")).toBe("done");
    expect(state.get("document_access")).toBe("failed");
    // And everything after it was never attempted.
    expect(state.get("engagement_link")).not.toBe("done");
    expect(state.get("workspace_membership")).toBe("pending");

    /* ---- the actual partial records ---------------------------------- */

    // The relationship exists — and carries NO consent, because recording the
    // consent is the step that failed. A relationship listing documents it
    // never shared would be the paper version of the same lie.
    const [relationship] = relationships();
    expect(relationship).toBeDefined();
    expect(relationship.sharedDocumentKeys).toEqual([]);
    expect(relationship.status).toBe("onboarding");
    expect(relationship.startedAt).toBeUndefined();

    /* ---- what the carrier can read, both ways ------------------------ */

    for (const key of SHARED) {
      const documentId = driverDocumentId(key);
      // No link was written, so there is no basis.
      expect(northlineLinks(documentId)).toHaveLength(0);
      // Not in the list.
      expect(await carrierCanList(documentId)).toBe(false);
      // And not by id either. A document id is not a way round the list: an
      // invisible document answers exactly as an unknown one does, so the
      // field cannot be used to probe another organization's paperwork.
      await expect(mockDocumentsService.get(CARRIER(), documentId))
        .rejects.toBeInstanceOf(NotFoundError);
    }

    // The driver still owns them. Nothing was taken away by the failure.
    expect(documentsForSubject("driver", "dp_sam").length).toBeGreaterThan(0);

    // What Northline already held on its own basis is untouched — the handbook
    // it issued this driver. The failure withholds what acceptance would have
    // granted; it does not revoke what was already theirs.
    const handbook = driverDocumentId("northline_handbook");
    expect(await carrierCanList(handbook)).toBe(true);

    expect(joinedEvents()).toHaveLength(0);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(1);
  });

  it("grants exactly the agreed documents on retry, once, and nothing else", async () => {
    asDriverWithPaperwork();
    failAcceptanceStepForTests("document_access");
    await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: SHARED, licence: LICENCE,
    });

    failAcceptanceStepForTests(null);
    const second = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: SHARED, licence: LICENCE,
    });
    expect(second.status).toBe("accepted");

    for (const key of SHARED) {
      const documentId = driverDocumentId(key);
      // ONE link, not one per attempt.
      expect(northlineLinks(documentId)).toHaveLength(1);
      expect(await carrierCanList(documentId)).toBe(true);
      const detail = await mockDocumentsService.get(CARRIER(), documentId);
      expect(detail.document.documentId).toBe(documentId);
    }

    // A document they did NOT agree to share stays unreadable. The retry
    // finishes what was agreed, and does not widen it.
    const notAgreed = driverDocumentId("cdl_back");
    expect(northlineLinks(notAgreed)).toHaveLength(0);
    expect(await carrierCanList(notAgreed)).toBe(false);

    // One relationship, carrying the consent exactly once each.
    expect(relationships()).toHaveLength(1);
    expect([...relationships()[0].sharedDocumentKeys].sort()).toEqual([...SHARED].sort());

    expect(joinedEvents()).toHaveLength(1);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(0);

    // A third acceptance is refused outright, so nothing can accumulate.
    const third = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: SHARED, licence: LICENCE,
    });
    expect(third.status).toBe("not-acceptable");
    for (const key of SHARED) expect(northlineLinks(driverDocumentId(key))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The seat is last, and the order is the code's, not the comment's            */
/* -------------------------------------------------------------------------- */

describe("the order acceptance actually runs in", () => {
  it("ends with the seat, after every record it is access to", async () => {
    asNewPerson();
    const result = await acceptMigrated();
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    // Read off the run itself rather than the file. The seat used to run
    // fourth while a comment two lines above it said it ran last.
    expect(result.run.steps.map((s) => s.key)).toEqual([
      "driver_profile",
      "carrier_relationship",
      "document_access",
      "engagement_link",
      "workspace_membership",
    ]);
  });
});

describe("interrupted while linking the carrier's existing record", () => {
  it("does not hand out a seat behind an unfinished acceptance", async () => {
    asNewPerson();
    const { engagementById } = await import("./workforce-store");
    const { mockWorkforceService } = await import("./workforce");
    await mockWorkforceService.list(context(["workforce:view"]));

    failAcceptanceStepForTests("engagement_link");
    const result = await acceptMigrated();
    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;

    const state = new Map(result.run.steps.map((s) => [s.key, s.state]));
    expect(state.get("engagement_link")).toBe("failed");

    // ★ THE ASSERTION THIS WHOLE REORDER EXISTS FOR ★
    // The seat was not attempted, so there is no Membership of any kind — not
    // an inactive one, not a pending one, none.
    expect(state.get("workspace_membership")).toBe("pending");
    expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)).toBeUndefined();
    expect(seats()).toHaveLength(0);

    // No seat was ADDED either. The only Northline row this account has is the
    // Owner seat it already left, and a seat somebody left is history, not
    // access — `SessionProvider` filters to `active` before it offers a
    // workspace, so there is nothing here to sign in with and no context to
    // read carrier data through.
    const rows = rosterSnapshot("demo").memberships
      .filter((m) => m.userId === "usr_sam" && m.organizationId === NORTHLINE.id);
    expect(rows.map((m) => m.id)).toEqual(["mem_northline_owner"]);
    expect(rows.every((m) => m.status !== "active")).toBe(true);

    // The steps BEFORE it did their work and are visibly theirs.
    expect(state.get("carrier_relationship")).toBe("done");
    expect(relationships()).toHaveLength(1);

    // The carrier's own record is untouched, and the acceptance is not silent.
    expect(engagementById("weng_nl_migrated_driver")!.driverProfileId).toBeUndefined();
    expect(joinedEvents()).toHaveLength(0);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(1);
  });

  it("completes the link, the seat, the status and the ledger exactly once", async () => {
    asNewPerson();
    const { engagementById } = await import("./workforce-store");
    const { mockWorkforceService } = await import("./workforce");
    await mockWorkforceService.list(context(["workforce:view"]));

    failAcceptanceStepForTests("engagement_link");
    await acceptMigrated();
    failAcceptanceStepForTests(null);
    const second = await acceptMigrated();
    expect(second.status).toBe("accepted");

    const engagement = engagementById("weng_nl_migrated_driver")!;
    expect(engagement.driverProfileId).toBe(profileForUser("usr_sam")!.id);
    expect(engagement.history.filter((h) => h.kind === "driver_profile_linked")).toHaveLength(1);

    expect(seats()).toHaveLength(1);
    expect(relationships()).toHaveLength(1);
    expect(joinedEvents()).toHaveLength(1);

    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === MIGRATED);
    expect(invitation.status).toBe("accepted");
    expect(accessNeedsYouItems(OWNER())).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The ledger line, which is what makes a run complete                         */
/* -------------------------------------------------------------------------- */

describe("the ledger refuses after every record is made", () => {
  it("does not let the acceptance read as finished with nothing to say it happened",
    async () => {
      asNewPerson();
      failJoinedAuditForTests(true);

      // The throw is deliberate and uncaught. Swallowing it is what produced a
      // completed acceptance with no ledger line and no way back.
      await expect(accept()).rejects.toThrow(/ledger/i);

      // Every record was made — the five steps all ran.
      expect(relationships()).toHaveLength(1);
      expect(seats()).toHaveLength(1);
      expect(profileForUser("usr_sam")).toBeDefined();

      // And the acceptance is NOT finished, because nothing recorded it.
      expect(joinedEvents()).toHaveLength(0);
      expect(joinedAuditWritten("inv_driver_acct", "usr_sam")).toBe(false);

      const [invitation] = (await mockAccessService.list(OWNER()))
        .filter((i) => i.token === TOKEN);
      expect(invitation.status).toBe("pending");

      // So the same person can still pick it up, rather than being told
      // somebody has already accepted this.
      const lookup = await mockAccessService.lookUp(TOKEN, RETURNING);
      expect(lookup.status).toBe("resume");

      // An unfinished run with no failed step is the one nobody would go
      // looking for. It is raised, and it says what is actually missing.
      const items = accessNeedsYouItems(OWNER());
      expect(items).toHaveLength(1);
      expect(items[0].title).toMatch(/without a record of joining/);
    });

  it("writes the line once on retry, and adds no second record of anything",
    async () => {
      asNewPerson();
      failJoinedAuditForTests(true);
      await expect(accept()).rejects.toThrow();

      failJoinedAuditForTests(false);
      const retry = await accept();
      expect(retry.status).toBe("accepted");

      // The missing line is now written — exactly one — and nothing the first
      // attempt already made was made again.
      expect(joinedEvents()).toHaveLength(1);
      expect(relationships()).toHaveLength(1);
      expect(seats()).toHaveLength(1);
      expect(accessNeedsYouItems(OWNER())).toHaveLength(0);

      // And the consent moment is still the first attempt's.
      expect(retry.status === "accepted" && retry.run.completedAt).toBeTruthy();
    });

  it("cannot be made to write a second line by failing the ledger afterwards",
    async () => {
      asNewPerson();
      const first = await accept();
      expect(first.status).toBe("accepted");
      expect(joinedEvents()).toHaveLength(1);

      // Arm the fault and accept again. The latch is spent, so the write is
      // never attempted — a completed acceptance cannot be audited twice, and
      // cannot be made to throw on a path it no longer takes.
      failJoinedAuditForTests(true);
      const again = await accept();
      expect(again.status).toBe("not-acceptable");
      expect(joinedEvents()).toHaveLength(1);
    });
});

/* -------------------------------------------------------------------------- */
/* The seam itself                                                             */
/* -------------------------------------------------------------------------- */

describe("the fault seam is reachable from tests and nowhere else", () => {
  const SEAMS = ["failAcceptanceStepForTests", "failJoinedAuditForTests"];

  it("is not offered by the AccessService contract", () => {
    const contract = readFileSync(
      join(process.cwd(), "src/lib/api/contracts/access.ts"), "utf8",
    );
    for (const seam of SEAMS) expect(contract).not.toContain(seam);
  });

  it("is imported by no module a page can reach", () => {
    // Every source file except the tests. A screen, a route, a hook or a
    // registry entry that imported either seam would show up here — which is
    // the only way the product could arm one, since nothing attaches them to
    // `window` and no request carries a step name.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
        const text = readFileSync(full, "utf8");
        if (full.endsWith("mock/access.ts")) continue;
        if (SEAMS.some((seam) => text.includes(seam))) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("is declared inert wherever a window exists", () => {
    // Belt to the braces above: even called, it does nothing in a browser.
    // Not a security property — the whole mock runs in the browser, so anybody
    // able to call this could call the stores directly. It stops the seam being
    // armed by accident in the one place a real person's session runs.
    const source = readFileSync(join(process.cwd(), "src/lib/api/mock/access.ts"), "utf8");
    expect(source).toContain('const SEAM_AVAILABLE = typeof window === "undefined"');
    for (const seam of SEAMS) {
      const body = source.slice(source.indexOf(`export function ${seam}`));
      expect(body.slice(0, 200)).toContain("if (!SEAM_AVAILABLE) return;");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A failure INSIDE the document step, between one link and the next           */
/* -------------------------------------------------------------------------- */

/**
 * ★ HALF A GRANT IS A GRANT ★
 *
 * The step-level seam fails `document_access` before it writes anything, which
 * proves the step boundary and nothing about what happens INSIDE it. A carrier
 * reads a driver's document through a link, so every link is access the instant
 * it lands: linking the first of two agreed documents and then refusing the
 * second would leave real access granted by a grant that failed, and a consent
 * record that disagrees with what is actually shared.
 *
 * The store's seam refuses one named requirement, so the grant breaks in the
 * middle rather than at the start.
 */
describe("interrupted between the first document and the second", () => {
  const FIRST = "cdl_front";
  const SECOND = "medical_front";

  it("grants neither, while leaving what the carrier already held alone", async () => {
    asDriverWithPaperwork();

    // Refuse the SECOND. The first is already resolved and would be written.
    failLinkWriteForTests(SECOND);
    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: [FIRST, SECOND], licence: LICENCE,
    });
    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;

    const steps = new Map(result.run.steps.map((s) => [s.key, s]));
    expect(steps.get("carrier_relationship")!.state).toBe("done");
    expect(steps.get("document_access")!.state).toBe("failed");
    // The reason names the real refusal rather than a tidy generic one.
    expect(steps.get("document_access")!.failureReason).toMatch(/medical_front/);
    expect(steps.get("document_access")!.detail).toMatch(/None of them was shared/);

    /* ---- neither document, not just the one that refused -------------- */

    for (const key of [FIRST, SECOND]) {
      const documentId = driverDocumentId(key);
      expect(northlineLinks(documentId)).toHaveLength(0);
      expect(await carrierCanList(documentId)).toBe(false);
      await expect(mockDocumentsService.get(CARRIER(), documentId))
        .rejects.toBeInstanceOf(NotFoundError);
    }

    // No consent recorded for documents that were not shared. The relationship
    // stands, because it is not this step's to undo, and it promises nothing.
    expect(relationships()).toHaveLength(1);
    expect(relationships()[0].sharedDocumentKeys).toEqual([]);

    // And no "linked" event for either, so the history does not record a share
    // that did not happen.
    const events = documentEventsFor(driverDocumentId(FIRST))
      .filter((e) => e.kind === "linked" && e.organizationId === NORTHLINE.id);
    expect(events).toHaveLength(0);

    /* ---- what was already theirs, on an independent basis ------------- */

    // Northline issued this driver a handbook. That link predates the
    // invitation and rests on nothing acceptance did, so a failure here must
    // not touch it — withholding what was not granted is the rule, not
    // revoking what was.
    const handbook = driverDocumentId("northline_handbook");
    expect(northlineLinks(handbook)).toHaveLength(1);
    expect(await carrierCanList(handbook)).toBe(true);
    const detail = await mockDocumentsService.get(CARRIER(), handbook);
    expect(detail.document.documentId).toBe(handbook);

    // The driver still owns their whole file.
    expect(documentsForSubject("driver", "dp_sam").length).toBeGreaterThan(0);

    // Nothing after the failure ran: no seat, no ledger line, and it is raised.
    expect(steps.get("workspace_membership")!.state).toBe("pending");
    expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)).toBeUndefined();
    expect(joinedEvents()).toHaveLength(0);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(1);

    // The invitation is still open, so the retry below is theirs to make.
    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === TOKEN);
    expect(invitation.status).toBe("pending");
  });

  it("finishes with exactly the intended links, and one of every record", async () => {
    asDriverWithPaperwork();
    failLinkWriteForTests(SECOND);
    await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: [FIRST, SECOND], licence: LICENCE,
    });

    failLinkWriteForTests(null);
    const retry = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: [FIRST, SECOND], licence: LICENCE,
    });
    expect(retry.status).toBe("accepted");

    for (const key of [FIRST, SECOND]) {
      const documentId = driverDocumentId(key);
      // One link each — the first attempt left nothing to double up on.
      expect(northlineLinks(documentId)).toHaveLength(1);
      expect(await carrierCanList(documentId)).toBe(true);
      expect(documentEventsFor(documentId)
        .filter((e) => e.kind === "linked" && e.organizationId === NORTHLINE.id))
        .toHaveLength(1);
    }

    // Nothing wider than what was agreed.
    const notAgreed = driverDocumentId("cdl_back");
    expect(northlineLinks(notAgreed)).toHaveLength(0);
    expect(await carrierCanList(notAgreed)).toBe(false);

    // One of every record, and one acceptance rather than two.
    expect(relationships()).toHaveLength(1);
    expect([...relationships()[0].sharedDocumentKeys].sort()).toEqual([FIRST, SECOND].sort());
    expect(seats()).toHaveLength(1);
    expect(joinedEvents()).toHaveLength(1);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(0);

    // Still one run, still the first attempt's consent moment.
    if (retry.status === "accepted") {
      expect(retry.run.invitationId).toBe(
        (await mockAccessService.list(OWNER())).find((i) => i.token === TOKEN)!.id,
      );
    }
  });

  it("is refused by the store as a batch, so no caller can half-apply it", () => {
    // The guarantee lives at the OWNING boundary, not in the caller's loop.
    // Called directly, with one entry poisoned, the store writes neither.
    asDriverWithPaperwork();
    const first = documentsForSubject("driver", "dp_sam")[0];
    const second = documentsForSubject("driver", "dp_sam")[1];
    const before = (id: string) => documentsForSubject("driver", "dp_sam")
      .find((d) => d.documentId === id)!.links.length;
    const counts = [before(first.documentId), before(second.documentId)];

    failLinkWriteForTests("__poison__");
    expect(() => addLinks([
      {
        documentId: first.documentId,
        input: {
          subject: { kind: "driver", id: "dp_sam", label: "Sam Murtaza" },
          requirementKey: "cdl_front",
          contextOrganizationId: NORTHLINE.id,
          contextOrganizationName: NORTHLINE.displayName,
          actorName: "Sam Murtaza",
        },
      },
      {
        documentId: second.documentId,
        input: {
          subject: { kind: "driver", id: "dp_sam", label: "Sam Murtaza" },
          requirementKey: "__poison__",
          contextOrganizationId: NORTHLINE.id,
          contextOrganizationName: NORTHLINE.displayName,
          actorName: "Sam Murtaza",
        },
      },
    ])).toThrow();

    expect(before(first.documentId)).toBe(counts[0]);
    expect(before(second.documentId)).toBe(counts[1]);
  });
});

/* -------------------------------------------------------------------------- */
/* Links committed, consent not                                                */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE SHARPEST WINDOW IN THE WHOLE FLOW ★
 *
 * Links are what a carrier reads through; the consent record on the
 * relationship is what says they may. They are two records in two modules, so
 * written apart there is always a moment where the links exist and the
 * agreement does not — and a failure landing THERE leaves real, readable access
 * behind a sharing decision that was never completed, with the invitation still
 * pending and the run still unfinished.
 *
 * The seam refuses the consent write with every link already committed, which
 * is that moment exactly.
 */
describe("interrupted after the links commit and before the consent is recorded", () => {
  const AGREED = ["cdl_front", "medical_front"];

  it("leaves no document readable, and no link behind", async () => {
    asDriverWithPaperwork();
    failConsentWriteForTests(true);

    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: AGREED, licence: LICENCE,
    });
    expect(result.status).toBe("incomplete");
    if (result.status !== "incomplete") return;

    const steps = new Map(result.run.steps.map((s) => [s.key, s]));
    // The prerequisites really did succeed — this is the middle of the grant.
    expect(steps.get("carrier_relationship")!.state).toBe("done");
    expect(steps.get("document_access")!.state).toBe("failed");
    expect(steps.get("document_access")!.failureReason).toMatch(/consent/i);

    for (const key of AGREED) {
      const documentId = driverDocumentId(key);
      // Rolled back inside the same commit: the link is not there at all.
      expect(northlineLinks(documentId)).toHaveLength(0);

      /* ---- EVERY read path, not just the two the screen uses ---------- */
      // The list.
      expect(await carrierCanList(documentId)).toBe(false);
      // By id. An invisible document answers exactly as an unknown one does,
      // so the field cannot be used to probe another organization's paperwork.
      await expect(mockDocumentsService.get(CARRIER(), documentId))
        .rejects.toBeInstanceOf(NotFoundError);
      // The checklist a carrier reads a driver against — the one surface that
      // asks for documents BY SUBJECT rather than by what it can already see.
      const checklist = await mockDocumentsService.entityChecklist(
        CARRIER(), { kind: "driver", id: "dp_sam", label: "Sam Murtaza" },
        { engagement: "company_driver" },
      );
      expect(checklist.items.map((item) => item.document?.documentId).filter(Boolean))
        .not.toContain(documentId);
      // The row for it reads "missing", which is the truth: this carrier has
      // nothing for that requirement.
      expect(checklist.items.find((item) => item.requirement.key === key)?.status)
        .toBe("missing");
      // And no share: a consent-based link is not a share, and the failure
      // created neither.
      expect((await mockDocumentsService.listShares(CARRIER()))
        .map((share) => share.lineageId)).not.toContain(documentId);
      // No history saying a share happened, because none did.
      expect(documentEventsFor(documentId)
        .filter((e) => e.kind === "linked" && e.organizationId === NORTHLINE.id))
        .toHaveLength(0);
    }

    // The relationship stands and promises nothing.
    expect(relationships()).toHaveLength(1);
    expect(relationships()[0].sharedDocumentKeys).toEqual([]);

    // What Northline already held on its OWN basis is untouched. The handbook
    // it issued this driver is not the driver's consent to withdraw, and a
    // failure in their sharing decision must not reach it.
    const handbook = driverDocumentId("northline_handbook");
    expect(northlineLinks(handbook)).toHaveLength(1);
    expect(await carrierCanList(handbook)).toBe(true);
    expect((await mockDocumentsService.get(CARRIER(), handbook)).document.documentId)
      .toBe(handbook);

    // Nothing after it ran, and the invitation is still theirs to finish.
    expect(liveMembershipFor("demo", "usr_sam", NORTHLINE.id)).toBeUndefined();
    expect(joinedEvents()).toHaveLength(0);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(1);
    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === TOKEN);
    expect(invitation.status).toBe("pending");
  });

  it("finishes once on retry, with no duplicate link, history or ledger line", async () => {
    asDriverWithPaperwork();
    failConsentWriteForTests(true);
    await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: AGREED, licence: LICENCE,
    });

    failConsentWriteForTests(false);
    const retry = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: AGREED, licence: LICENCE,
    });
    expect(retry.status).toBe("accepted");

    for (const key of AGREED) {
      const documentId = driverDocumentId(key);
      expect(northlineLinks(documentId)).toHaveLength(1);
      expect(documentEventsFor(documentId)
        .filter((e) => e.kind === "linked" && e.organizationId === NORTHLINE.id))
        .toHaveLength(1);
      expect(await carrierCanList(documentId)).toBe(true);
    }
    expect(relationships()).toHaveLength(1);
    expect([...relationships()[0].sharedDocumentKeys].sort()).toEqual([...AGREED].sort());
    expect(seats()).toHaveLength(1);
    expect(joinedEvents()).toHaveLength(1);
    expect(accessNeedsYouItems(OWNER())).toHaveLength(0);
  });

  it("refuses to read a consent-based link whose consent is not on the relationship",
    async () => {
      // Belt to the braces above. Even if a link survived — a future path, a
      // partial import, a backend whose transaction did not hold — it is not
      // access: the consent record is the authority and the read checks it.
      asDriverWithPaperwork();
      await mockAccessService.accept(TOKEN, RETURNING, {
        sharedDocumentKeys: AGREED, licence: LICENCE,
      });
      const documentId = driverDocumentId("cdl_front");
      expect(await carrierCanList(documentId)).toBe(true);

      // Take the consent away underneath the link, leaving the link in place.
      const profileId = profileForUser("usr_sam")!.id;
      const relationship = liveRelationship(profileId, NORTHLINE.id)!;
      setSharedDocumentKeysForTests(profileId, NORTHLINE.id, []);
      expect(northlineLinks(documentId)).toHaveLength(1);

      expect(await carrierCanList(documentId)).toBe(false);
      await expect(mockDocumentsService.get(CARRIER(), documentId))
        .rejects.toBeInstanceOf(NotFoundError);

      // And the carrier's own handbook, which rests on no consent, is untouched.
      expect(await carrierCanList(driverDocumentId("northline_handbook"))).toBe(true);
      expect(relationship.sharedDocumentKeys.length).toBeGreaterThan(0);
    });
});
