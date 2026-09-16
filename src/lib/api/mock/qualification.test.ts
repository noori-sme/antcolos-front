import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import { RETENTION_POLICY_NOT_CONFIGURED } from "@/types";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import { resetAllMocks } from "./registry";
import {
  RetentionActiveError, ReviewRequiredError, UnsupportedVerificationClaimError,
  applyRelationshipEndToQualificationFile, mockQualificationService as qualification,
  recordsWithNewerVersion,
} from "./qualification";
import { allQualificationRecords } from "./qualification-store";
import {
  addLink, allDocuments, createDocument, currentVersion, documentById,
  lineageVersions, replaceDocument, revokeShare, shareDocument, sharesForLineage,
  updateDocument,
} from "./document-store";
import { auditLedger } from "./audit-ledger";
import { workforceNeedsYouItems } from "./workforce-needs-you";
import { mockWorkforceService as workforce } from "./workforce";

/* -------------------------------------------------------------------------- */
/* Contexts                                                                    */
/* -------------------------------------------------------------------------- */

const SAFETY: PermissionKey[] = [
  "qualification:view", "compliance:manage", "compliance:view",
  "documents:view", "documents:upload", "documents:approve",
];

function ctxFor(
  organizationId: string,
  options: {
    permissions?: PermissionKey[];
    membershipId?: string;
    name?: string;
    driverProfileId?: string;
  } = {},
): ServiceContext {
  const membershipId = options.membershipId ?? `mem_${organizationId}_safety`;
  return {
    organizationId,
    organizationName: `Org ${organizationId}`,
    workspaceKind: "carrier_organization",
    membershipId,
    permissions: new Set(options.permissions ?? SAFETY),
    actor: {
      userId: `usr_${membershipId}`,
      membershipId,
      displayNameSnapshot: options.name ?? "Tess Ferraro",
      source: "web",
    },
    scope: options.driverProfileId
      ? { loads: "assigned", financials: "own" }
      : { loads: "all", financials: "all" },
    driverProfileId: options.driverProfileId,
  };
}

const northline = () => ctxFor("org_northline");
const cascade = () => ctxFor("org_cascade", { name: "Marisol Vega" });

const DRIVER = "dp_testdriver";

/**
 * A driver-owned licence, shared with one or two carriers and reviewed by them.
 *
 * Built through the canonical document store rather than a fixture file,
 * because what these tests are about is exactly how that store behaves when
 * two organizations rely on one lineage.
 */
function seedDriverLicence(sharedWith: string[] = ["org_northline"]) {
  const record = createDocument({
    owner: { kind: "person", id: "usr_testdriver", name: "Robin Vasquez" },
    typeKey: "cdl",
    subject: { kind: "driver", id: DRIVER, label: "Robin Vasquez" },
    requirementKey: "cdl_front",
    status: "approved",
    file: { fileName: "cdl.jpg", fileType: "image/jpeg", sizeBytes: 1000, selectedAt: new Date().toISOString() },
    addedByName: "Robin Vasquez",
  });
  for (const organizationId of sharedWith) {
    shareDocument({
      lineageId: record.lineageId,
      sharedWithOrganizationId: organizationId,
      sharedWithName: organizationId,
      basis: { kind: "driver_share", id: "pkg_test", label: "Shared by Robin Vasquez" },
      purpose: "driver_qualification",
      canDownload: false,
      grantedByName: "Robin Vasquez",
    });
  }
  return record;
}

/**
 * Records one carrier's own review on its own link, exactly as
 * `recordShareReview` does: reuse the organization's live link if it has one,
 * and add a link only when it has none. Faithful to the real path, because a
 * helper that took a different one would be testing a flow nobody uses.
 */
function reviewAs(documentId: string, organizationId: string, reviewerName: string) {
  const record = documentById(documentId)!;
  const existing = record.links.find(
    (l) => !l.unlinkedAt && l.contextOrganizationId === organizationId,
  );
  const linked = existing
    ? record
    : addLink(documentId, {
      subject: record.links[0].subject,
      requirementKey: record.links[0].requirementKey,
      contextOrganizationId: organizationId,
      contextOrganizationName: organizationId,
      actorName: reviewerName,
    });
  const link = existing ?? linked.links[linked.links.length - 1];
  updateDocument(documentId, {
    links: linked.links.map((l) => (l.id === link.id
      ? {
        ...l,
        review: {
          state: "approved" as const,
          reviewedAt: new Date().toISOString(),
          reviewedByName: reviewerName,
        },
      }
      : l)),
  });
}

beforeEach(() => {
  resetAllMocks();
});

/* -------------------------------------------------------------------------- */
/* No unnecessary duplication                                                  */
/* -------------------------------------------------------------------------- */

describe("adopting creates custody, not a copy", () => {
  it("creates no second DocumentRecord and no second lineage", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const documentsBefore = allDocuments().length;

    await qualification.adopt(northline(), {
      documentId: licence.documentId,
      driverProfileId: DRIVER,
      category: "commercial_licence",
      purpose: "driver_qualification_file",
    });

    expect(allDocuments().length).toBe(documentsBefore);
    expect(lineageVersions(licence.lineageId)).toHaveLength(1);
  });

  it("pins the exact version, not the lineage", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const view = await qualification.adopt(northline(), {
      documentId: licence.documentId,
      driverProfileId: DRIVER,
      category: "commercial_licence",
      purpose: "driver_qualification_file",
    });
    expect(view.record.evidence.documentId).toBe(licence.documentId);
    expect(view.record.evidence.documentVersion).toBe(1);
    expect(view.record.evidence.lineageId).toBe(licence.lineageId);
  });

  it("says out loud that it cannot prove the bytes", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const view = await qualification.adopt(northline(), {
      documentId: licence.documentId,
      driverProfileId: DRIVER,
      category: "commercial_licence",
      purpose: "driver_qualification_file",
    });
    expect(view.record.evidence.integrityBasis).toBe("not_available_in_mock");
    expect(view.record.evidence.contentHash).toBeUndefined();
  });

  it("lets two carriers reference the same version without sharing anything", async () => {
    const licence = seedDriverLicence(["org_northline", "org_cascade"]);
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    reviewAs(licence.documentId, "org_cascade", "Marisol Vega");

    await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    await qualification.adopt(cascade(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });

    const nl = await qualification.list(northline(), {});
    const cs = await qualification.list(cascade(), {});
    expect(nl).toHaveLength(1);
    expect(cs).toHaveLength(1);
    // One document version, two independent custody records with their own
    // reviewers — and neither can see the other.
    expect(nl[0].record.evidence.documentId).toBe(cs[0].record.evidence.documentId);
    expect(nl[0].record.review.reviewedByName).toBe("Tess Ferraro");
    expect(cs[0].record.review.reviewedByName).toBe("Marisol Vega");
    expect(nl[0].record.id).not.toBe(cs[0].record.id);
    // And still exactly one document.
    expect(lineageVersions(licence.lineageId)).toHaveLength(1);
  });

  it("is idempotent: adopting the same version twice yields one record", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const input = {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence" as const, purpose: "driver_qualification_file" as const,
    };
    const first = await qualification.adopt(northline(), input);
    const second = await qualification.adopt(northline(), input);
    expect(second.record.id).toBe(first.record.id);
    expect(allQualificationRecords()).toHaveLength(1);
    expect(second.record.history).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Sharing, opening and reviewing are not adopting                             */
/* -------------------------------------------------------------------------- */

describe("each step is explicit and none implies the next", () => {
  it("refuses to adopt a version this carrier has not reviewed", async () => {
    const licence = seedDriverLicence();
    await expect(qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    })).rejects.toThrow(ReviewRequiredError);
    expect(allQualificationRecords()).toHaveLength(0);
  });

  it("creates no adoption merely because a document was shared", () => {
    seedDriverLicence(["org_northline"]);
    expect(allQualificationRecords()).toHaveLength(0);
  });

  it("creates no engagement, membership or relationship when adopting", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    const engagements = await workforce.list(
      ctxFor("org_northline", { permissions: ["workforce:view"] }), { includeEnded: true },
    );
    expect(engagements.some((e) => e.engagement.driverProfileId === DRIVER)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Replacement and immutability                                                */
/* -------------------------------------------------------------------------- */

describe("replacing a document never rewrites a carrier's decision", () => {
  async function adoptThenReplace() {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const adopted = await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    const replaced = replaceDocument(documentById(licence.documentId)!, {
      status: "approved",
      addedByName: "Robin Vasquez",
      file: { fileName: "cdl-new.jpg", fileType: "image/jpeg", sizeBytes: 1100, selectedAt: new Date().toISOString() },
    });
    return { licence, adopted, replaced };
  }

  it("leaves the adoption pinned to the version that was relied on", async () => {
    const { licence, adopted, replaced } = await adoptThenReplace();
    const reread = await qualification.get(northline(), adopted.record.id);
    expect(reread.record.evidence.documentId).toBe(licence.documentId);
    expect(reread.record.evidence.documentVersion).toBe(1);
    expect(replaced.version).toBe(2);
    // The live document moved; the record did not follow it.
    expect(currentVersion(licence.lineageId)!.documentId).toBe(replaced.documentId);
  });

  it("says a newer version exists rather than substituting it", async () => {
    const { adopted } = await adoptThenReplace();
    const reread = await qualification.get(northline(), adopted.record.id);
    expect(reread.newerVersionAvailable).toBe(true);
    expect(reread.record.evidence.documentVersion).toBe(1);
  });

  it("keeps both decisions when the carrier adopts the new version too", async () => {
    const { adopted, replaced } = await adoptThenReplace();
    reviewAs(replaced.documentId, "org_northline", "Tess Ferraro");
    const second = await qualification.adopt(northline(), {
      documentId: replaced.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });

    const all = await qualification.list(northline(), {});
    expect(all).toHaveLength(2);
    const older = all.find((v) => v.record.id === adopted.record.id)!;
    expect(older.record.supersededByRecordId).toBe(second.record.id);
    expect(older.retentionState).toBe("superseded_retained");
    // The old record still shows exactly what was relied on at the time.
    expect(older.record.evidence.documentVersion).toBe(1);
    expect(second.record.evidence.documentVersion).toBe(2);
    expect(second.record.supersedesRecordId).toBe(adopted.record.id);
  });

  it("raises work for the reviewer, and only for the reviewer", async () => {
    await adoptThenReplace();
    const items = workforceNeedsYouItems(northline());
    const replacement = items.filter((i) => i.category === "qualification_replacement_available");
    expect(replacement).toHaveLength(1);
    // Gated on the qualification key, not on `documents:view` which every
    // dispatcher holds.
    expect(replacement[0].requires).toContain("qualification:view");
    expect(replacement[0].assigneeMembershipId).toBeUndefined();

    // A membership without the key sees nothing of it.
    const dispatcher = ctxFor("org_northline", { permissions: ["documents:view", "workforce:view"] });
    expect(workforceNeedsYouItems(dispatcher)
      .some((i) => i.category === "qualification_replacement_available")).toBe(false);
  });

  it("stops asking once the newer version is adopted", async () => {
    const { replaced } = await adoptThenReplace();
    expect(recordsWithNewerVersion("org_northline")).toHaveLength(1);
    reviewAs(replaced.documentId, "org_northline", "Tess Ferraro");
    await qualification.adopt(northline(), {
      documentId: replaced.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    expect(recordsWithNewerVersion("org_northline")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Revocation and offboarding                                                  */
/* -------------------------------------------------------------------------- */

describe("revocation stops access and erases nothing", () => {
  it("keeps the adoption after the driver withdraws the share", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const adopted = await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });

    for (const share of sharesForLineage(licence.lineageId)) {
      revokeShare(share.id, "The driver withdrew it.", "Robin Vasquez");
    }

    const reread = await qualification.get(northline(), adopted.record.id);
    expect(reread.record.evidence.documentId).toBe(licence.documentId);
    expect(reread.shareEnded).toBe(true);
    expect(reread.retentionState).not.toBe("disposed");
  });

  it("moves records into retention when a relationship ends, deleting nothing", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const adopted = await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });

    const moved = applyRelationshipEndToQualificationFile(northline(), DRIVER);
    expect(moved).toBe(1);
    const reread = await qualification.get(northline(), adopted.record.id);
    expect(reread.retentionState).toBe("relationship_ended_retained");
    expect(reread.record.retention.clockStartedAt).toBeTruthy();
    // The document itself is untouched.
    expect(documentById(licence.documentId)).toBeDefined();
  });

  it("is idempotent about starting the retention clock", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    expect(applyRelationshipEndToQualificationFile(northline(), DRIVER)).toBe(1);
    expect(applyRelationshipEndToQualificationFile(northline(), DRIVER)).toBe(0);
    const records = await qualification.list(northline(), {});
    expect(records[0].record.history.filter((h) => h.kind === "relationship_ended")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Retention is basis-first                                                    */
/* -------------------------------------------------------------------------- */

describe("retention states a basis and never invents a date", () => {
  async function adopted() {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    return qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
  }

  it("records the basis and no period", async () => {
    const view = await adopted();
    expect(view.record.retention.basis).toBe("engagement_plus_period");
    expect(view.record.retention.retainUntil).toBeUndefined();
    expect(view.record.retention.policyKey).toBe("ret_commercial_licence");
  });

  it("says the policy is not configured rather than showing a date", async () => {
    const view = await adopted();
    expect(view.retentionExplanation).toContain(RETENTION_POLICY_NOT_CONFIGURED);
    const preview = await qualification.previewAdoption(northline(), view.record.evidence.documentId);
    expect(preview.retentionSummary).toBe(RETENTION_POLICY_NOT_CONFIGURED);
  });

  it("publishes the policy rows as bases, with no periods on them", async () => {
    const policies = await qualification.retentionPolicies(northline());
    expect(policies.length).toBeGreaterThan(5);
    for (const policy of policies) {
      expect(policy.basis).toBeTruthy();
      expect(Object.keys(policy)).not.toContain("periodMonths");
    }
    // Record-specific, not one clock for everything.
    const bases = new Set(policies.map((p) => p.basis));
    expect(bases.size).toBeGreaterThan(1);
  });

  it("refuses disposal while the obligation stands, which with no policy is always", async () => {
    const view = await adopted();
    const disposer = ctxFor("org_northline", {
      permissions: [...SAFETY, "qualification:dispose"],
      membershipId: "mem_northline_owner",
      name: "Dana Whitfield",
    });
    await expect(qualification.authorizeDisposal(disposer, view.record.id, { reason: "Tidying." }))
      .rejects.toThrow(RetentionActiveError);
    expect((await qualification.get(northline(), view.record.id)).retentionState)
      .not.toBe("disposed");
  });

  it("refuses disposal outright without the narrow key", async () => {
    const view = await adopted();
    await expect(qualification.authorizeDisposal(northline(), view.record.id, { reason: "x" }))
      .rejects.toThrow(PermissionDeniedError);
  });

  it("lets the adopter dispose once an obligation has actually ended", async () => {
    const view = await adopted();
    // A backend policy is what supplies an end date. Simulating one here is the
    // point: the rule is "an obligation that stands refuses", NOT "whoever
    // adopted it can never dispose of it" — a solo owner has nobody else.
    const record = allQualificationRecords().find((r) => r.id === view.record.id)!;
    record.retention.retainUntil = new Date(Date.now() - 86_400_000).toISOString();

    const soloOwner = ctxFor("org_northline", {
      permissions: [...SAFETY, "qualification:dispose"],
      // The SAME membership that adopted it.
      membershipId: "mem_northline_safety",
    });
    const disposed = await qualification.authorizeDisposal(soloOwner, view.record.id, {
      reason: "Retention period ended.",
    });
    expect(disposed.retentionState).toBe("disposed");
    expect(disposed.record.retention.disposedByName).toBe("Tess Ferraro");
    // Audit records it.
    expect(auditLedger.all("org_northline")
      .some((e) => e.action === "compliance.qualification_disposed")).toBe(true);
    // And the history survives the disposal — the record is not deleted.
    expect(disposed.record.history.some((h) => h.kind === "adopted")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Source honesty                                                              */
/* -------------------------------------------------------------------------- */

describe("source and verification are never collapsed", () => {
  it("keeps a driver-uploaded document self-provided after a carrier review", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const view = await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "motor_vehicle_record", purpose: "driver_qualification_file",
    });
    expect(view.record.source).toBe("driver_self_provided");
    // Reviewed, not verified. The two are different fields and stay different.
    expect(view.record.verification).toBe("carrier_reviewed");
    expect(view.record.verification).not.toBe("source_verified");
    expect(view.record.verificationSource).toBeUndefined();
  });

  it("refuses to claim an authority source with nothing naming it", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    await expect(qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "motor_vehicle_record", purpose: "driver_qualification_file",
      source: "received_from_licensing_authority",
    })).rejects.toThrow(UnsupportedVerificationClaimError);
  });

  it("refuses to record carrier evidence as the driver's own upload", async () => {
    await expect(qualification.recordCarrierEvidence(northline(), {
      driverProfileId: DRIVER,
      category: "employment_application",
      purpose: "driver_qualification_file",
      file: { name: "application.pdf", type: "application/pdf", size: 1000 },
      source: "driver_self_provided",
    })).rejects.toThrow(UnsupportedVerificationClaimError);
  });

  it("files carrier-originated evidence in the one Document Center, owned by the carrier", async () => {
    const view = await qualification.recordCarrierEvidence(northline(), {
      driverProfileId: DRIVER,
      category: "employment_application",
      purpose: "driver_qualification_file",
      file: { name: "application.pdf", type: "application/pdf", size: 1000 },
      source: "carrier_generated",
    });
    expect(view.record.origin).toBe("carrier_originated");
    const document = documentById(view.record.evidence.documentId)!;
    expect(document.owner.kind).toBe("organization");
    expect(document.organizationId).toBe("org_northline");
    // It never enters the driver's wallet: no person-owned link exists on it.
    expect(document.links.every((l) => l.contextOrganizationId === "org_northline")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Isolation and permissions                                                   */
/* -------------------------------------------------------------------------- */

describe("one carrier never reaches another's qualification file", () => {
  async function bothAdopt() {
    const licence = seedDriverLicence(["org_northline", "org_cascade"]);
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    reviewAs(licence.documentId, "org_cascade", "Marisol Vega");
    const nl = await qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    const cs = await qualification.adopt(cascade(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    });
    return { nl, cs };
  }

  it("answers another carrier's record id exactly as an invented one", async () => {
    const { nl } = await bothAdopt();
    await expect(qualification.get(cascade(), nl.record.id)).rejects.toThrow(NotFoundError);
    await expect(qualification.get(cascade(), "qual_invented")).rejects.toThrow(NotFoundError);
  });

  it("records the cross-organization attempt in the one ledger", async () => {
    const { nl } = await bothAdopt();
    await expect(qualification.get(cascade(), nl.record.id)).rejects.toThrow(NotFoundError);
    expect(auditLedger.all("org_cascade")
      .some((e) => e.action === "access.cross_organization_attempt")).toBe(true);
  });

  it("refuses a caller without qualification:view", async () => {
    const dispatcher = ctxFor("org_northline", { permissions: ["documents:view", "compliance:view"] });
    await expect(qualification.list(dispatcher, {})).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses to adopt without compliance:manage", async () => {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    const viewer = ctxFor("org_northline", { permissions: ["qualification:view", "documents:view"] });
    await expect(qualification.adopt(viewer, {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
    })).rejects.toThrow(PermissionDeniedError);
  });

  it("does not make a record readable because it names a driver", async () => {
    const { nl } = await bothAdopt();
    // Cascade can see the DRIVER and holds the qualification key. It still
    // cannot read Northline's record — being named on it is not a grant.
    const list = await qualification.list(cascade(), { driverProfileId: DRIVER });
    expect(list.map((v) => v.record.id)).not.toContain(nl.record.id);
    expect(list.every((v) => v.record.organizationId === "org_cascade")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* What the driver sees                                                        */
/* -------------------------------------------------------------------------- */

describe("the driver sees the fact, never the carrier's private content", () => {
  async function adoptedWithNote() {
    const licence = seedDriverLicence();
    reviewAs(licence.documentId, "org_northline", "Tess Ferraro");
    return qualification.adopt(northline(), {
      documentId: licence.documentId, driverProfileId: DRIVER,
      category: "commercial_licence", purpose: "driver_qualification_file",
      note: "Photo is dark but legible; accepted on balance. Watch this one.",
    });
  }

  it("shows the driver the version, purpose, date and retention status", async () => {
    await adoptedWithNote();
    const asDriver = ctxFor("org_cascade", {
      permissions: [],
      membershipId: "mem_driver",
      driverProfileId: DRIVER,
    });
    const seen = await qualification.adoptionsForDriver(asDriver, DRIVER);
    expect(seen).toHaveLength(1);
    expect(seen[0].documentVersion).toBe(1);
    expect(seen[0].purpose).toBe("driver_qualification_file");
    expect(seen[0].adoptedAt).toBeTruthy();
    expect(seen[0].retentionState).toBe("active");
  });

  it("shows the driver nothing of the carrier's review, reviewer or notes", async () => {
    await adoptedWithNote();
    const asDriver = ctxFor("org_cascade", {
      permissions: [], membershipId: "mem_driver", driverProfileId: DRIVER,
    });
    const seen = await qualification.adoptionsForDriver(asDriver, DRIVER);
    const json = JSON.stringify(seen);
    expect(json).not.toContain("Watch this one");
    expect(json).not.toContain("Tess Ferraro");
    expect(json).not.toContain("review");
    expect(json).not.toContain("sourceDetail");
  });

  it("refuses another person's adoptions to a driver who is not them", async () => {
    await adoptedWithNote();
    const otherDriver = ctxFor("org_cascade", {
      permissions: [], membershipId: "mem_other", driverProfileId: "dp_someone_else",
    });
    // Not their own record, and they hold no qualification key: refused.
    await expect(qualification.adoptionsForDriver(otherDriver, DRIVER))
      .rejects.toThrow(PermissionDeniedError);
  });
});
