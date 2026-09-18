import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { resetRoster } from "@/lib/session/membership-store";
import { splitByRestriction } from "@/lib/documents/requirements";
import {
  documentRequirements, driverSharingPlan, resetDriverMock,
} from "@/features/driver/mock-driver";
import { liveRelationship, profileForUser, resetDriverRegistry } from "./driver-registry";
import {
  clearDocumentsForSubjectKind, documentsForSubject, resetDocumentStore,
} from "./document-store";
import { resetAuditLedger, auditLedger } from "./audit-ledger";
import { mockAccessService } from "./access";
import { resetAccessStore } from "./access-store";
import { mockDocumentsService } from "./documents";
import { documentNeedsYouItems } from "./document-needs-you";
import { resetWorkforceStore } from "./workforce-store";
import { NotFoundError, type ServiceContext } from "../contracts/context";

/**
 * ★ ACCEPTING IS ONE DECISION, AND IT SAYS WHAT IT COVERS ★
 *
 * The recorded product decision: a driver accepting a carrier's invitation sees
 * ONE understandable decision about the ordinary, purpose-bound document access
 * that relationship needs. They may decline it. Restricted records stay behind
 * their own authorizations. It is not a row of per-document switches, and it is
 * not the driver's own selective-sharing flow, which exists separately and is
 * for before there is any employment.
 *
 * What makes one consent honest rather than a blank cheque is that its extent
 * is visible and truthful: which documents, at which version, which required
 * ones are not uploaded — and therefore NOT received by anybody — and which
 * records are not part of it at all.
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

const CARRIER = () => context(["documents:view"]);
const OWNER = () => context(["invitations:view"]);

const plan = () => driverSharingPlan("company_driver", NORTHLINE.id);
const restrictedKeys = () => splitByRestriction(
  documentRequirements("company_driver", NORTHLINE.id),
).restricted.map((r) => r.key);

/** Accept exactly as the screen does: one agreement over the whole plan. */
const acceptWithOneDecision = () => {
  const p = plan();
  return mockAccessService.accept(TOKEN, RETURNING, {
    sharedDocumentKeys: [...p.covered.map((d) => d.key), ...p.awaiting.map((d) => d.key)],
  });
};

const documentIdFor = (requirementKey: string) =>
  documentsForSubject("driver", "dp_sam")
    .find((d) => d.links.some((l) => l.requirementKey === requirementKey))?.documentId;

beforeEach(() => {
  resetAccessStore();
  resetRoster();
  resetDocumentStore();
  resetAuditLedger();
  resetDriverRegistry();
  resetDriverMock();
  resetWorkforceStore();
});

/* -------------------------------------------------------------------------- */
/* It is one decision, not a row of switches                                   */
/* -------------------------------------------------------------------------- */

describe("the shape of the decision", () => {
  it("covers the ordinary required paperwork for this relationship and nothing else", () => {
    const p = plan();
    const checklist = documentRequirements("company_driver", NORTHLINE.id);
    const decided = new Set([...p.covered, ...p.awaiting].map((d) => d.key));

    for (const requirement of checklist) {
      const restricted = restrictedKeys().includes(requirement.key);
      if (restricted) {
        // Never part of this decision at all.
        expect(decided.has(requirement.key)).toBe(false);
      } else if (requirement.applicability === "required") {
        expect(decided.has(requirement.key)).toBe(true);
      } else {
        // "Optional" means the person may choose, and a single consent that
        // swept those in would be choosing for them. That is what the driver's
        // own sharing flow is for.
        expect(decided.has(requirement.key)).toBe(false);
      }
    }
  });

  it("names the version each covered document is covered at", () => {
    for (const document of plan().covered) {
      expect(document.version).toBeGreaterThan(0);
      expect(document.uploadedAt).toBeTruthy();
      expect(document.label).not.toMatch(/^northline_/);
    }
  });

  it("names every restricted record as excluded, with a reason", () => {
    const withheld = plan().withheld;
    expect(withheld.length).toBeGreaterThan(0);
    expect(withheld.map((d) => d.key).sort()).toEqual([...restrictedKeys()].sort());
    for (const document of withheld) expect(document.reason).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* A driver who has everything                                                 */
/* -------------------------------------------------------------------------- */

describe("a driver with all their ordinary documents", () => {
  it("hands over exactly those, at the versions the plan named", async () => {
    const before = plan();
    expect(before.covered.length).toBeGreaterThan(0);

    const result = await acceptWithOneDecision();
    expect(result.status).toBe("accepted");

    const relationship = liveRelationship(profileForUser("usr_sam")!.id, NORTHLINE.id)!;
    for (const document of before.covered) {
      expect(relationship.sharedDocumentKeys).toContain(document.key);
      const id = documentIdFor(document.key)!;
      const detail = await mockDocumentsService.get(CARRIER(), id);
      expect(detail.document.documentId).toBe(id);
    }

    // And the step says what is true: documents they HOLD, not keys agreed.
    if (result.status !== "accepted") return;
    const documents = result.run.steps.find((s) => s.key === "document_access")!;
    expect(documents.detail).toContain(`can now see ${before.covered.length}`);
  });
});

/* -------------------------------------------------------------------------- */
/* A driver missing one                                                        */
/* -------------------------------------------------------------------------- */

describe("a driver who has not uploaded a required document", () => {
  beforeEach(() => {
    // Nothing on file at all: the sharpest version of the case.
    clearDocumentsForSubjectKind("driver");
  });

  it("does not pretend the carrier received a document that does not exist", async () => {
    const before = plan();
    expect(before.covered).toHaveLength(0);
    expect(before.awaiting.length).toBeGreaterThan(0);

    const result = await acceptWithOneDecision();
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    const documents = result.run.steps.find((s) => s.key === "document_access")!;
    expect(documents.state).toBe("done");
    // ★ The sentence that used to be a lie. It counted the agreement.
    expect(documents.detail).not.toMatch(/can now see \d/);
    expect(documents.detail).toMatch(/Nothing to share/);
    expect(documents.detail).toMatch(/have not uploaded/);

    // Nothing is readable, because nothing exists.
    const visible = await mockDocumentsService.list(CARRIER());
    expect(visible.filter((v) => v.subject.kind === "driver")).toHaveLength(0);
  });

  it("raises each missing one through the existing Needs You path", async () => {
    await acceptWithOneDecision();
    // Not a new queue and not the acceptance's item: the document module
    // already raises a required document that is missing, and that is where a
    // person goes to fix it.
    const items = documentNeedsYouItems(context(["documents:view", "drivers:view"]));
    const missing = items.filter((i) => i.category === "missing_document");
    expect(missing.length).toBeGreaterThan(0);
  });

  it("covers the document the moment it is uploaded, with no second decision", async () => {
    await acceptWithOneDecision();
    const relationship = liveRelationship(profileForUser("usr_sam")!.id, NORTHLINE.id)!;
    // The agreement already names it, so uploading is all that is left. It is
    // not a silent grant over unrelated or restricted future uploads — only
    // over the ordinary required rows this one decision listed.
    expect(relationship.sharedDocumentKeys.length).toBeGreaterThan(0);
    for (const key of restrictedKeys()) {
      expect(relationship.sharedDocumentKeys).not.toContain(key);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A driver with a restricted document                                         */
/* -------------------------------------------------------------------------- */

describe("a driver who holds a restricted document", () => {
  it("never hands it over, however it is asked for", async () => {
    const restricted = restrictedKeys();
    expect(restricted.length).toBeGreaterThan(0);

    // Asked for explicitly, alongside the ordinary decision.
    const p = plan();
    const result = await mockAccessService.accept(TOKEN, RETURNING, {
      sharedDocumentKeys: [
        ...p.covered.map((d) => d.key), ...p.awaiting.map((d) => d.key), ...restricted,
      ],
    });
    expect(result.status).toBe("accepted");

    const relationship = liveRelationship(profileForUser("usr_sam")!.id, NORTHLINE.id)!;
    for (const key of restricted) {
      expect(relationship.sharedDocumentKeys).not.toContain(key);
      const id = documentIdFor(key);
      if (id) {
        await expect(mockDocumentsService.get(CARRIER(), id))
          .rejects.toBeInstanceOf(NotFoundError);
      }
    }

    if (result.status !== "accepted") return;
    const withheld = result.run.steps.find((s) => s.key === "document_access")!.withheld!;
    expect(withheld.map((w) => w.key).sort()).toEqual([...restricted].sort());
    for (const document of withheld) expect(document.reason).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Declining                                                                   */
/* -------------------------------------------------------------------------- */

describe("declining", () => {
  it("creates nothing at all, and is not the same as being revoked", async () => {
    const declined = await mockAccessService.decline(TOKEN, RETURNING);
    expect(declined?.status).toBe("declined");

    // Not one record anywhere.
    expect(liveRelationship("dp_sam", NORTHLINE.id)).toBeUndefined();
    expect(documentsForSubject("driver", "dp_sam")
      .flatMap((d) => d.links)
      .filter((l) => !l.unlinkedAt && l.contextOrganizationId === NORTHLINE.id
        && l.basis === "driver_consent")).toHaveLength(0);

    // The ledger says which of the two happened: they said no, and the carrier
    // did not withdraw it. A carrier that cannot tell re-sends forever.
    const events = auditLedger.all(NORTHLINE.id);
    expect(events.filter((e) => e.action === "access.invitation_declined")).toHaveLength(1);
    expect(events.filter((e) => e.action === "access.member_joined")).toHaveLength(0);

    // And the sender sees it as declined rather than pending or revoked.
    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === TOKEN);
    expect(invitation.status).toBe("declined");
  });

  it("cannot be done by somebody the invitation does not name", async () => {
    // Addressed to Alex; this session is Sam.
    expect(await mockAccessService.decline("INV-NEWCOMER", SAM))
      .toBeNull();
    const [invitation] = (await mockAccessService.list(OWNER()))
      .filter((i) => i.token === "INV-NEWCOMER");
    expect(invitation.status).toBe("pending");
  });

  it("stops the link working afterwards", async () => {
    await mockAccessService.decline(TOKEN, RETURNING);
    const result = await mockAccessService.accept(TOKEN, RETURNING, { sharedDocumentKeys: [] });
    expect(result.status).toBe("not-acceptable");
  });
});
