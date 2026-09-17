import { beforeEach, describe, expect, it } from "vitest";
import type { AcceptanceStepKey, PermissionKey } from "@/types";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import {
  liveMembershipFor, resetRoster, rosterSnapshot, setMembershipStatus,
} from "@/lib/session/membership-store";
import {
  driverProfileSync, driverRelationshipsSync, resetDriverMock,
} from "@/features/driver/mock-driver";
import { profileForUser, resetDriverRegistry } from "./driver-registry";
import { documentsForSubject, resetDocumentStore } from "./document-store";
import { auditLedger, resetAuditLedger } from "./audit-ledger";
import { failAcceptanceStepForTests, mockAccessService } from "./access";
import { resetAccessStore } from "./access-store";
import { resetWorkforceStore } from "./workforce-store";
import { accessNeedsYouItems } from "./access-needs-you";
import type { ServiceContext } from "../contracts/context";

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
const RETURNING = { returningFromAuth: true };

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
    // `INV-WRONGUSER` is addressed to karin.vogel@example.com; this session is
    // signed in as somebody else, and no amount of pressing changes that.
    const lookup = await mockAccessService.lookUp("INV-WRONGUSER", { returningFromAuth: false });
    expect(lookup.status).toBe("wrong-recipient");

    const result = await mockAccessService.accept(
      "INV-WRONGUSER", { returningFromAuth: false }, { sharedDocumentKeys: [] },
    );
    expect(result.status).toBe("not-acceptable");
    // Exactly what they had before: the Owner seat, untouched. Nothing was
    // added for an invitation addressed to somebody else.
    expect(seats()).toHaveLength(1);
    expect(seats()[0].id).toBe("mem_northline_owner");
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
