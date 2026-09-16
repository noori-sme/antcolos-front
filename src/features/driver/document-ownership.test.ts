import { beforeEach, describe, expect, it } from "vitest";
import {
  documentInSlot,
  documentsForSubject,
  documentsOwnedBy,
  lineageVersions,
  snapshotsForLineage,
  updateDocument,
} from "@/lib/api/mock/document-store";
import { MOCK_MEMBERSHIPS } from "@/lib/session/fixtures";
import {
  mockCreateRelationship,
  mockEndRelationship,
  mockListDocuments,
  mockListRelationships,
  mockUploadDocument,
  resetDriverMock,
} from "./mock-driver";
import { completeDriverSelfOnboarding } from "./self-onboarding";

/**
 * Whose document is it?
 *
 * Two facts that used to be one. A driver's licence BELONGS TO THE DRIVER: it
 * can be supplied before any carrier exists, it is kept when carriers come and
 * go, and nobody has approved it merely because it is there. A carrier's
 * REVIEW of that licence is the carrier's: it begins when the driver shares it,
 * it is recorded against that carrier alone, and it ends when the relationship
 * does — taking nothing of the driver's with it.
 *
 * The old code could not express the first fact. Every upload was stamped with
 * "whichever carrier is around, and Cascade Haul if there is none", which meant
 * a driver with no carrier could not hold a document at all without one being
 * invented for them. These tests are that boundary, at the layer that decides it.
 */

const FUTURE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().slice(0, 10);
})();

const file = (name: string) => ({ name, type: "image/jpeg", size: 1024 });
const noProgress = () => {};

async function newDriver() {
  resetDriverMock({ withProfile: false });
  const result = await completeDriverSelfOnboarding({
    workEmail: "alex.rivera@example.com",
    emailVerified: true,
    identity: {
      legalName: "Alex Rivera",
      cdlNumber: "A1234567",
      cdlState: "TX",
      cdlExpiresAt: FUTURE,
    },
  });
  if (result.status !== "ok") throw new Error("expected onboarding to succeed");
  return result.profile;
}

const carrierLinks = (documentId: string, profileId: string) =>
  documentsForSubject("driver", profileId, { includeSuperseded: true })
    .find((r) => r.documentId === documentId)
    ?.links.filter((l) => l.contextOrganizationId) ?? [];

describe("a driver's own documents, before any carrier exists", () => {
  beforeEach(() => {
    resetDriverMock({ withProfile: false });
  });

  it("can be supplied, and belong to the driver", async () => {
    const profile = await newDriver();

    await mockUploadDocument("cdl_front", file("licence-front.jpg"), noProgress);

    const record = documentInSlot("driver", profile.id, "cdl_front");
    expect(record).toBeDefined();
    expect(record!.owner).toEqual({ kind: "person", id: profile.userId, name: profile.legalName });
    // Nobody holds it but the person.
    expect(record!.organizationId).toBeUndefined();

    const rows = await mockListDocuments();
    expect(rows.map((d) => d.requirementKey)).toEqual(["cdl_front"]);
    expect(rows[0].fileName).toBe("licence-front.jpg");
  });

  it("names no reviewing organization, and claims no approval", async () => {
    const profile = await newDriver();
    await mockUploadDocument("cdl_front", file("licence-front.jpg"), noProgress);

    const record = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(record.links).toHaveLength(1);
    const own = record.links[0];
    expect(own.primary).toBe(true);
    expect(own.contextOrganizationId).toBeUndefined();
    expect(own.contextOrganizationName).toBeUndefined();
    // Self-provided and unreviewed, in the canonical vocabulary: a file the
    // browser named, and a review nobody is required to make.
    expect(record.status).toBe("selected_local");
    expect(own.review.state).toBe("not_required");
    expect(own.review.reviewedByName).toBeUndefined();
  });

  it("creates no carrier, membership, relationship or reviewer", async () => {
    const membershipsBefore = MOCK_MEMBERSHIPS.map((m) => m.id);
    const profile = await newDriver();

    await mockUploadDocument("cdl_front", file("licence-front.jpg"), noProgress);
    await mockUploadDocument("medical_front", file("medical.pdf"), noProgress);

    expect(await mockListRelationships()).toEqual([]);
    expect(MOCK_MEMBERSHIPS.map((m) => m.id)).toEqual(membershipsBefore);
    for (const record of documentsForSubject("driver", profile.id)) {
      expect(record.links.every((l) => !l.contextOrganizationId)).toBe(true);
    }
    // And no organization holds them in its own right.
    expect(documentsOwnedBy("org_cascade")).toEqual([]);
    expect(documentsOwnedBy("org_northline")).toEqual([]);
  });

  it("is replaced through the existing lineage, keeping both versions", async () => {
    const profile = await newDriver();
    await mockUploadDocument("cdl_front", file("old-licence.jpg"), noProgress);
    const first = documentInSlot("driver", profile.id, "cdl_front")!;

    await mockUploadDocument("cdl_front", file("new-licence.jpg"), noProgress);
    const current = documentInSlot("driver", profile.id, "cdl_front")!;

    expect(current.documentId).not.toBe(first.documentId);
    expect(current.lineageId).toBe(first.lineageId);
    expect(current.version).toBe(2);
    expect(current.supersedesDocumentId).toBe(first.documentId);
    expect(lineageVersions(first.lineageId)).toHaveLength(2);
    // Still theirs, still nobody's to review.
    expect(current.links.every((l) => !l.contextOrganizationId)).toBe(true);
    // One row on the checklist, not two.
    expect(await mockListDocuments()).toHaveLength(1);
  });
});

describe("when a carrier finally arrives", () => {
  beforeEach(() => {
    resetDriverMock({ withProfile: false });
  });

  async function driverWithDocumentAndCarrier() {
    const profile = await newDriver();
    await mockUploadDocument("cdl_front", file("licence-front.jpg"), noProgress);
    const before = documentInSlot("driver", profile.id, "cdl_front")!;

    const relationship = await mockCreateRelationship(profile.id, {
      carrierId: "org_northline",
      carrierName: "Northline Freight",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      // What the driver agreed to share.
      sharedDocumentKeys: ["cdl_front"],
    });
    return { profile, relationship, before };
  }

  it("reviews the document the driver already had, without a second copy", async () => {
    const { profile, before } = await driverWithDocumentAndCarrier();

    const after = documentInSlot("driver", profile.id, "cdl_front")!;
    // The same record — not a copy, not a re-upload.
    expect(after.documentId).toBe(before.documentId);
    expect(after.lineageId).toBe(before.lineageId);
    expect(documentsForSubject("driver", profile.id)).toHaveLength(1);
    expect(await mockListDocuments()).toHaveLength(1);

    // The carrier's review is its own link, alongside the driver's.
    expect(after.links).toHaveLength(2);
    const own = after.links.find((l) => l.primary)!;
    const carrier = after.links.find((l) => l.contextOrganizationId === "org_northline")!;
    expect(own.contextOrganizationId).toBeUndefined();
    expect(carrier.contextOrganizationName).toBe("Northline Freight");
    expect(carrier.review.state).toBe("pending");
  });

  it("does not change who owns the document when it decides", async () => {
    const { profile } = await driverWithDocumentAndCarrier();
    const record = documentInSlot("driver", profile.id, "cdl_front")!;
    const carrierLink = record.links.find((l) => l.contextOrganizationId === "org_northline")!;

    // Northline approves what it was shown.
    updateDocument(record.documentId, {
      links: record.links.map((l) =>
        l.id === carrierLink.id
          ? { ...l, review: { state: "approved" as const, reviewedByName: "Northline Freight" } }
          : l,
      ),
    });

    const after = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(after.owner.kind).toBe("person");
    expect(after.organizationId).toBeUndefined();
    const own = after.links.find((l) => l.primary)!;
    expect(own.contextOrganizationId).toBeUndefined();
    expect(own.review.state).toBe("not_required");
  });

  it("leaves the driver holding everything when the relationship ends", async () => {
    const { profile, relationship, before } = await driverWithDocumentAndCarrier();

    await mockEndRelationship(relationship.id, "Moved to another carrier.");

    const after = documentInSlot("driver", profile.id, "cdl_front");
    // The document is still there, still current, still the same record.
    expect(after?.documentId).toBe(before.documentId);
    expect(after?.status).not.toBe("superseded");
    expect(await mockListDocuments()).toHaveLength(1);

    // The carrier's link is ended; the driver's is untouched.
    const carrier = carrierLinks(before.documentId, profile.id)
      .find((l) => l.contextOrganizationId === "org_northline")!;
    expect(carrier.unlinkedAt).toBeTruthy();
    expect(after!.links.find((l) => l.primary)!.unlinkedAt).toBeUndefined();
    // And the carrier keeps a snapshot of what it held.
    expect(snapshotsForLineage(before.lineageId).some((s) => s.reason === "relationship_ended")).toBe(true);

    const relationships = await mockListRelationships();
    expect(relationships.every((r) => r.status === "ended")).toBe(true);
  });

  it("hands the same document to the next carrier", async () => {
    const { profile, relationship, before } = await driverWithDocumentAndCarrier();
    await mockEndRelationship(relationship.id, "Moved on.");

    await mockCreateRelationship(profile.id, {
      carrierId: "org_baxter",
      carrierName: "Baxter Transit",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: ["cdl_front"],
    });

    const after = documentInSlot("driver", profile.id, "cdl_front")!;
    expect(after.documentId).toBe(before.documentId);
    expect(documentsForSubject("driver", profile.id)).toHaveLength(1);
    const baxter = after.links.find((l) => l.contextOrganizationId === "org_baxter")!;
    expect(baxter.review.state).toBe("pending");
    expect(baxter.unlinkedAt).toBeUndefined();
  });
});
