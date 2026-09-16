import { describe, expect, it } from "vitest";
import {
  allDocuments, documentInSlot, documentsForSubject, sharesForLineage,
} from "@/lib/api/mock/document-store";
import {
  createSharePackage, isShareUsable, openNativePackage, openSharedPackage,
  packagesForOrganization, packagesNeedingRefresh, readSharedDocument,
  packagesForDriver as packagesForDriverId, recordDelivery, recordShareReview,
  resetShareSequence, revokeSharePackage, shareState,
} from "@/lib/api/mock/document-shares";
import { resetDocumentStore } from "@/lib/api/mock/document-store";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { WATERMARK_BRAND, watermarkFor, watermarkLine } from "@/lib/documents/watermark";
import {
  mockCreateRelationship, mockEndRelationship, mockListDocuments, mockListRelationships,
  mockUploadDocument, resetDriverMock,
} from "./mock-driver";
import { completeDriverSelfOnboarding } from "./self-onboarding";

/**
 * A driver showing somebody their licence — and everything that must NOT follow
 * from it.
 *
 * Sharing is the most dangerous thing a document system does: it is where a
 * copy gets made, where an employer gets invented, where a recipient's opinion
 * becomes a verdict, and where a link outlives the reason it existed. Every
 * test here is one of those failures, written down so it cannot happen quietly.
 */

const FUTURE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().slice(0, 10);
})();

const file = (name: string) => ({ name, type: "image/jpeg", size: 2048 });
const noProgress = () => {};

const NORTHLINE = { kind: "organization" as const, organizationId: "org_northline", organizationName: "Northline Freight" };
const BAXTER = { kind: "organization" as const, organizationId: "org_baxter", organizationName: "Baxter Transit" };

async function driverWithTwoDocuments() {
  resetDocumentStore();
  resetDriverMock({ withProfile: false });
  resetShareSequence();
  const result = await completeDriverSelfOnboarding({
    workEmail: "alex.rivera@example.com",
    emailVerified: true,
    identity: { legalName: "Alex Rivera", cdlNumber: "A1234567", cdlState: "TX", cdlExpiresAt: FUTURE },
  });
  if (result.status !== "ok") throw new Error("expected onboarding to succeed");
  await mockUploadDocument("cdl_front", file("licence-front.jpg"), noProgress);
  await mockUploadDocument("medical_front", file("medical-card.pdf"), noProgress);
  const profile = result.profile;
  const cdl = documentInSlot("driver", profile.id, "cdl_front")!;
  const medical = documentInSlot("driver", profile.id, "medical_front")!;
  return { profile, cdl, medical };
}

const share = (
  profile: { id: string; legalName: string },
  documentIds: string[],
  recipient: Parameters<typeof createSharePackage>[0]["recipient"],
  over: Partial<Parameters<typeof createSharePackage>[0]> = {},
) =>
  createSharePackage({
    driverProfileId: profile.id,
    driverName: profile.legalName,
    documentIds,
    recipient,
    purpose: "driver_qualification",
    ...over,
  });

describe("ownership survives sharing", () => {
  it("references the canonical document instead of copying it", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const before = allDocuments().length;

    const result = share(profile, [cdl.documentId], NORTHLINE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // Not one new document row, and the package points at the record that
    // already existed — the same version id, the same lineage.
    expect(allDocuments()).toHaveLength(before);
    expect(result.pkg.items).toHaveLength(1);
    expect(result.pkg.items[0].documentId).toBe(cdl.documentId);
    expect(result.pkg.items[0].lineageId).toBe(cdl.lineageId);
    expect(documentsForSubject("driver", profile.id)).toHaveLength(2);
  });

  it("leaves the driver's own record untouched", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const ownBefore = JSON.stringify(cdl.links.find((l) => l.primary));

    share(profile, [cdl.documentId], NORTHLINE);

    const after = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(after.documentId).toBe(cdl.documentId);
    expect(after.owner).toEqual(cdl.owner);
    expect(after.organizationId).toBeUndefined();
    expect(after.status).toBe(cdl.status);
    expect(JSON.stringify(after.links.find((l) => l.primary))).toBe(ownBefore);
  });

  it("marks the shared presentation, never the record", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");

    const mark = watermarkFor(result.pkg);
    expect(mark.brand).toBe(WATERMARK_BRAND);
    expect(watermarkLine(mark)).toContain("Powered by Antcolos");
    expect(watermarkLine(mark)).toContain("Northline Freight");

    // The record carries no mark of any kind: no field, no new version.
    const record = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(JSON.stringify(record)).not.toContain("Powered by Antcolos");
    expect(record.version).toBe(1);
  });

  it("puts no token or internal identifier in the watermark", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], { kind: "external", email: "hr@bigrig.example.com" });
    if (result.status !== "ok") throw new Error("expected a share");

    const line = watermarkLine(watermarkFor(result.pkg));
    expect(line).not.toContain(result.pkg.token!);
    expect(line).not.toContain(result.pkg.id);
    expect(line).not.toContain(cdl.documentId);
    expect(line).not.toContain(profile.id);
  });

  it("does not rewrite what a recipient already reviewed when the driver replaces a document", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");

    await mockUploadDocument("cdl_front", file("new-licence.jpg"), noProgress);
    const current = documentInSlot("driver", profile.id, "cdl_front")!;

    // One lineage, two versions — and the share still names the version the
    // carrier was actually shown.
    expect(current.lineageId).toBe(cdl.lineageId);
    expect(current.documentId).not.toBe(cdl.documentId);
    expect(packagesForOrganization("org_northline")[0].items[0].documentId).toBe(cdl.documentId);

    // The driver is told, rather than the carrier being silently updated.
    expect(packagesNeedingRefresh(profile.id).map((p) => p.id)).toContain(result.pkg.id);
  });

  it("keeps the driver's document when a carrier relationship ends", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    share(profile, [cdl.documentId], NORTHLINE);
    const relationship = await mockCreateRelationship(profile.id, {
      carrierId: "org_northline",
      carrierName: "Northline Freight",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: ["cdl_front"],
    });

    await mockEndRelationship(relationship.id, "Moved on.");

    const after = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(after.documentId).toBe(cdl.documentId);
    expect(after.links.find((l) => l.primary)!.unlinkedAt).toBeUndefined();
    expect(await mockListDocuments()).toHaveLength(2);
  });
});

describe("sharing with a carrier on Antcolos", () => {
  it("grants that carrier access, through the existing grant record", async () => {
    const { profile, cdl, medical } = await driverWithTwoDocuments();

    const result = share(profile, [cdl.documentId, medical.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");

    const grants = sharesForLineage(cdl.lineageId);
    expect(grants).toHaveLength(1);
    expect(grants[0].sharedWithOrganizationId).toBe("org_northline");
    expect(grants[0].basis.kind).toBe("driver_share");
    expect(grants[0].canDownload).toBe(false);
    expect(packagesForOrganization("org_northline").map((p) => p.id)).toContain(result.pkg.id);
  });

  it("is invisible to every other carrier", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");

    expect(packagesForOrganization("org_baxter")).toEqual([]);
    // Asking by id as another carrier is refused the way an invented id is:
    // Baxter may not learn that Northline was shown anything.
    expect(openNativePackage("org_baxter", result.pkg.id)).toEqual({
      status: "refused",
      reason: "unknown_token",
    });
  });

  it("creates no membership, relationship, assignment or employment", async () => {
    const membershipsBefore = MOCK_MEMBERSHIPS.map((m) => m.id);
    const organizationsBefore = MOCK_ORGANIZATIONS.length;
    const { profile, cdl } = await driverWithTwoDocuments();

    share(profile, [cdl.documentId], NORTHLINE);

    expect(await mockListRelationships()).toEqual([]);
    expect(MOCK_MEMBERSHIPS.map((m) => m.id)).toEqual(membershipsBefore);
    expect(MOCK_ORGANIZATIONS).toHaveLength(organizationsBefore);
  });

  it("records the carrier's review on the carrier's own link", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");

    const review = recordShareReview(
      "org_northline", "Northline Freight", result.pkg.id, cdl.documentId,
      "accepted", "Dana Ruiz",
    );
    expect(review.status).toBe("ok");

    const record = documentInSlot("driver", profile.id, "cdl_front")!;
    const own = record.links.find((l) => l.primary)!;
    const carrier = record.links.find((l) => l.contextOrganizationId === "org_northline")!;
    expect(carrier.review.state).toBe("approved");
    expect(carrier.review.reviewedByName).toBe("Dana Ruiz");
    // The driver's own link is not a review queue and did not become one.
    expect(own.review.state).toBe("not_required");
    expect(own.contextOrganizationId).toBeUndefined();
    // And no other carrier inherited the verdict.
    expect(record.links.some((l) => l.contextOrganizationId === "org_baxter")).toBe(false);
  });

  it("lets a later relationship use the same document rather than a new upload", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    share(profile, [cdl.documentId], NORTHLINE);

    await mockCreateRelationship(profile.id, {
      carrierId: "org_northline",
      carrierName: "Northline Freight",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: ["cdl_front"],
    });

    const record = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(record.documentId).toBe(cdl.documentId);
    expect(documentsForSubject("driver", profile.id)).toHaveLength(2);
  });

  it("refuses a second carrier the first carrier's package", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    share(profile, [cdl.documentId], NORTHLINE);
    const second = share(profile, [cdl.documentId], BAXTER);
    if (second.status !== "ok") throw new Error("expected a share");

    expect(packagesForOrganization("org_baxter").map((p) => p.id)).toEqual([second.pkg.id]);
    expect(packagesForOrganization("org_northline").map((p) => p.id)).not.toContain(second.pkg.id);
  });
});

describe("sharing with a carrier that is not on Antcolos", () => {
  const external = { kind: "external" as const, email: "hiring@roadwayexample.com" };

  it("records a mock delivery and never claims an attachment was sent", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], external);
    if (result.status !== "ok") throw new Error("expected a share");

    const delivery = recordDelivery(result.pkg.id);
    expect(delivery.status).toBe("recorded");

    const pkg = packagesForDriverId(profile.id)[0];
    const kinds = pkg.events.map((e) => e.kind);
    expect(kinds).toContain("delivery_queued");
    expect(kinds).toContain("delivery_recorded");
    expect(pkg.events.some((e) => /mock/i.test(e.summary))).toBe(true);
    // A link, not a file: nothing in the record even mentions an attachment.
    expect(JSON.stringify(pkg)).not.toMatch(/attachment/i);
    expect(pkg.token).toBeTruthy();
  });

  it("records one delivery however many times it is confirmed", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], external);
    if (result.status !== "ok") throw new Error("expected a share");

    recordDelivery(result.pkg.id);
    recordDelivery(result.pkg.id);
    recordDelivery(result.pkg.id);

    const pkg = packagesForDriverId(profile.id)[0];
    expect(pkg.events.filter((e) => e.kind === "delivery_recorded")).toHaveLength(1);
  });

  it("creates nothing at all for an address that is not an address", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], { kind: "external", email: "not-an-address" });

    expect(result.status).toBe("invalid-email");
    expect(packagesForDriverId(profile.id)).toEqual([]);
  });

  it("records a failure the driver can act on, and refuses to call it delivered", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], { kind: "external", email: "hr@nowhere.invalid" });
    if (result.status !== "ok") throw new Error("expected a share");

    const delivery = recordDelivery(result.pkg.id);
    expect(delivery.status).toBe("failed");
    const pkg = packagesForDriverId(profile.id)[0];
    expect(shareState(pkg)).toBe("failed");
    expect(pkg.events.map((e) => e.kind)).toContain("delivery_failed");
  });

  it("opens only what was shared, and records that it was opened", async () => {
    const { profile, cdl, medical } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], external);
    if (result.status !== "ok") throw new Error("expected a share");
    const token = result.pkg.token!;

    const opened = openSharedPackage(token);
    expect(opened.status).toBe("ok");
    if (opened.status !== "ok") return;
    expect(opened.pkg.accessCount).toBe(1);
    expect(opened.view.items).toHaveLength(1);

    // The document that WAS shared resolves; the one that was not is refused,
    // even though the same driver owns it and the recipient knows its id.
    expect(readSharedDocument(opened.pkg, cdl.documentId).status).toBe("ok");
    const refused = readSharedDocument(opened.pkg, medical.documentId);
    expect(refused).toEqual({ status: "refused", reason: "not_in_package" });
  });

  it("refuses an unknown, revoked or expired link, and says which", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();

    expect(openSharedPackage("DSNOTATOKEN")).toEqual({ status: "refused", reason: "unknown_token" });

    const revoked = share(profile, [cdl.documentId], external);
    if (revoked.status !== "ok") throw new Error("expected a share");
    revokeSharePackage(revoked.pkg.id, "Wrong company.", profile.legalName);
    expect(openSharedPackage(revoked.pkg.token!)).toEqual({ status: "refused", reason: "revoked" });

    const expired = share(profile, [cdl.documentId], { kind: "external", email: "late@example.com" }, { ttlDays: -1 });
    if (expired.status !== "ok") throw new Error("expected a share");
    expect(openSharedPackage(expired.pkg.token!)).toEqual({ status: "refused", reason: "expired" });
  });

  it("invents no organization, membership or relationship for an email address", async () => {
    const organizationsBefore = MOCK_ORGANIZATIONS.map((o) => o.id);
    const { profile, cdl } = await driverWithTwoDocuments();

    const result = share(profile, [cdl.documentId], external);
    if (result.status !== "ok") throw new Error("expected a share");
    recordDelivery(result.pkg.id);
    openSharedPackage(result.pkg.token!);

    expect(MOCK_ORGANIZATIONS.map((o) => o.id)).toEqual(organizationsBefore);
    expect(await mockListRelationships()).toEqual([]);
    expect(sharesForLineage(cdl.lineageId)).toEqual([]);
  });
});

describe("revocation and expiry", () => {
  it("keeps the whole history and only stops access", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");
    openNativePackage("org_northline", result.pkg.id);

    const revoked = revokeSharePackage(result.pkg.id, "Job went elsewhere.", profile.legalName)!;

    expect(shareState(revoked)).toBe("revoked");
    expect(isShareUsable(revoked)).toBe(false);
    // Nothing deleted: the items, the access and the reason all survive.
    expect(revoked.items).toHaveLength(1);
    expect(revoked.accessCount).toBe(1);
    expect(revoked.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["created", "opened", "revoked"]),
    );
    // The underlying grant is revoked with it.
    expect(sharesForLineage(cdl.lineageId).every((s) => s.revokedAt)).toBe(true);
    expect(openNativePackage("org_northline", result.pkg.id).status).toBe("refused");
  });

  it("is idempotent: revoking twice does not rewrite the first answer", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE);
    if (result.status !== "ok") throw new Error("expected a share");

    const first = revokeSharePackage(result.pkg.id, "Wrong carrier.", profile.legalName)!;
    const second = revokeSharePackage(result.pkg.id, "Again.", profile.legalName)!;

    expect(second.revokedAt).toBe(first.revokedAt);
    expect(second.revokedReason).toBe(first.revokedReason);
    expect(second.events.filter((e) => e.kind === "revoked")).toHaveLength(1);
  });

  it("refuses an expired share without deleting it", async () => {
    const { profile, cdl } = await driverWithTwoDocuments();
    const result = share(profile, [cdl.documentId], NORTHLINE, { ttlDays: -1 });
    if (result.status !== "ok") throw new Error("expected a share");

    expect(shareState(result.pkg)).toBe("expired");
    expect(openNativePackage("org_northline", result.pkg.id)).toEqual({
      status: "refused", reason: "expired",
    });
    expect(packagesForOrganization("org_northline")[0].items).toHaveLength(1);
  });
});


