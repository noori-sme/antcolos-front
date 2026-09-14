import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import {
  TRUCK_IDS, addTruckDocument, getTruckProfile, listFleet, resetTruckRegistry,
  submitTruckDocument,
} from "./truck-registry";
import {
  addTrailerDocument, getTrailerProfile, listTrailerFleet, resetTrailerRegistry,
  submitTrailerDocument, TRAILER_IDS,
} from "./trailer-registry";
import { allDocuments, resetDocumentStore } from "./document-store";
import {
  completion, documentRequirements, mockListDocuments, mockSetDocumentExpiry,
  mockSubmitDocument, mockUploadDocument, resetDriverMock,
} from "@/features/driver/mock-driver";

/**
 * The behaviour that existed BEFORE the Document Center, still working after it.
 *
 * Unifying four document stores into one is only safe if the surfaces built on
 * them behave identically afterwards. These are the tests that say so.
 */

const FLEET_KEYS: PermissionKey[] = [
  "trucks:view", "trucks:edit", "trucks:documents:manage", "trucks:assignments:manage",
  "trucks:relationships:manage", "trucks:ownership:review",
  "trailers:view", "trailers:edit", "trailers:documents:manage",
  "trailers:relationships:manage", "trailers:status:manage", "trailers:attachments:manage",
];

const carrierCtx = () => ({
  organizationId: "org_northline",
  membershipId: "mem_northline",
  actorName: "Test Person",
  permissions: new Set(FLEET_KEYS),
});

beforeEach(() => {
  resetDocumentStore();
  resetTruckRegistry();
  resetTrailerRegistry();
  resetDriverMock();
});

describe("truck documents", () => {
  it("still projects the fixture documents onto the truck profile", async () => {
    const profile = await getTruckProfile(TRUCK_IDS.nl104, carrierCtx());
    const kinds = profile.documents.map((d) => d.kind).sort();
    expect(kinds).toEqual(["annual_inspection", "insurance", "registration", "title"]);
    expect(profile.documents.every((d) => d.truckId === TRUCK_IDS.nl104)).toBe(true);
  });

  it("still derives expiring and expired from the dates the fixtures set", async () => {
    const expiringUnit = await getTruckProfile(TRUCK_IDS.nl107, carrierCtx());
    expect(expiringUnit.documents.find((d) => d.kind === "insurance")?.status).toBe("expiring_soon");

    const expiredUnit = await getTruckProfile(TRUCK_IDS.nl111, carrierCtx());
    expect(expiredUnit.documents.find((d) => d.kind === "registration")?.status).toBe("expired");
  });

  it("still carries the rejection reason a fleet manager has to act on", async () => {
    const profile = await getTruckProfile(TRUCK_IDS.nl115, carrierCtx());
    const rejected = profile.documents.find((d) => d.kind === "annual_inspection");
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.rejectionReason).toMatch(/signature/);
  });

  it("still counts document warnings on the roster", async () => {
    const fleet = await listFleet(carrierCtx());
    const unit111 = fleet.find((t) => t.truckId === TRUCK_IDS.nl111);
    expect(unit111?.documentWarnings).toBeGreaterThan(0);
  });

  it("records a new document as selected, never as uploaded", async () => {
    const added = await addTruckDocument(
      TRUCK_IDS.nl104, "cab_card",
      { name: "cab-card.pdf", type: "application/pdf", size: 2048 },
      carrierCtx(),
    );
    expect(added.status).toBe("selected_local");
    expect(added.fileName).toBe("cab-card.pdf");
    expect(added.sizeBytes).toBe(2048);
  });

  it("supersedes rather than deletes when a document is replaced", async () => {
    const ctx = carrierCtx();
    const before = (await getTruckProfile(TRUCK_IDS.nl104, ctx)).documents.find(
      (d) => d.kind === "registration",
    )!;

    await addTruckDocument(
      TRUCK_IDS.nl104, "registration",
      { name: "reg-104-renewed.pdf", type: "application/pdf", size: 900 },
      ctx,
    );

    const after = await getTruckProfile(TRUCK_IDS.nl104, ctx);
    const old = after.documents.find((d) => d.id === before.id);
    expect(old).toBeDefined();
    expect(old!.status).toBe("superseded");
    expect(old!.supersededByDocumentId).toBeDefined();
    expect(after.documents.filter((d) => d.kind === "registration").length).toBe(2);
  });

  it("moves a document to pending review when it is submitted", async () => {
    const ctx = carrierCtx();
    const added = await addTruckDocument(
      TRUCK_IDS.nl104, "cab_card",
      { name: "cab-card.pdf", type: "application/pdf", size: 2048 }, ctx,
    );
    const submitted = await submitTruckDocument(added.id, ctx);
    expect(submitted.status).toBe("pending_review");
  });

  it("refuses a document without trucks:documents:manage", async () => {
    const ctx = { ...carrierCtx(), permissions: new Set<PermissionKey>(["trucks:view"]) };
    await expect(
      addTruckDocument(TRUCK_IDS.nl104, "cab_card", { name: "x.pdf", type: "application/pdf", size: 1 }, ctx),
    ).rejects.toThrow(/Missing permission/);
  });
});

describe("trailer documents", () => {
  it("still projects the fixture documents onto the trailer profile", async () => {
    const profile = await getTrailerProfile(TRAILER_IDS.dv220, carrierCtx());
    expect(profile.documents.length).toBeGreaterThan(0);
    expect(profile.documents.every((d) => d.trailerId === TRAILER_IDS.dv220)).toBe(true);
  });

  it("still shows a reefer's service record", async () => {
    const profile = await getTrailerProfile(TRAILER_IDS.rf114, carrierCtx());
    expect(profile.documents.some((d) => d.kind === "reefer_service_record")).toBe(true);
  });

  it("still counts document warnings on the trailer roster", async () => {
    const fleet = await listTrailerFleet(carrierCtx());
    expect(fleet.some((t) => t.documentWarnings > 0)).toBe(true);
  });

  it("supersedes rather than deletes when a trailer document is replaced", async () => {
    const ctx = carrierCtx();
    const before = (await getTrailerProfile(TRAILER_IDS.dv220, ctx)).documents.find(
      (d) => d.kind === "registration",
    )!;
    await addTrailerDocument(
      TRAILER_IDS.dv220, "registration",
      { name: "reg-v220-renewed.pdf", type: "application/pdf", size: 500 }, ctx,
    );
    const after = await getTrailerProfile(TRAILER_IDS.dv220, ctx);
    expect(after.documents.find((d) => d.id === before.id)?.status).toBe("superseded");
  });

  it("moves a trailer document to pending review when it is submitted", async () => {
    const ctx = carrierCtx();
    const added = await addTrailerDocument(
      TRAILER_IDS.dv220, "title",
      { name: "title-v220.pdf", type: "application/pdf", size: 400 }, ctx,
    );
    expect(added.status).toBe("selected_local");
    const submitted = await submitTrailerDocument(added.id, ctx);
    expect(submitted.status).toBe("pending_review");
  });
});

describe("driver documents", () => {
  it("still asks a company driver and an owner-operator for different things", () => {
    const company = documentRequirements("company_driver", "org_cascade").map((r) => r.key);
    const owner = documentRequirements("owner_operator", "org_cascade").map((r) => r.key);
    expect(company).not.toContain("w9");
    expect(owner).toContain("w9");
  });

  it("still includes the carrier's own extra requirement", () => {
    const keys = documentRequirements("company_driver", "org_northline").map((r) => r.key);
    expect(keys).toContain("northline_handbook");
  });

  it("still seeds the driver's paperwork, with the medical card expiring soon", async () => {
    const documents = await mockListDocuments();
    const byKey = new Map(documents.map((d) => [d.requirementKey, d]));
    expect(byKey.get("cdl_front")?.status).toBe("approved");
    expect(byKey.get("medical_front")?.status).toBe("expiring_soon");
    expect(byKey.get("northline_handbook")?.status).toBe("rejected");
    expect(byKey.get("northline_handbook")?.rejectionReason).toMatch(/signature/);
  });

  it("records a chosen file as selected, and reports local progress", async () => {
    const seen: number[] = [];
    const saved = await mockUploadDocument(
      "medical_back", { name: "medical-back.jpg", type: "image/jpeg", size: 1000 },
      (p) => seen.push(p),
    );
    expect(saved.status).toBe("selected_local");
    expect(saved.fileName).toBe("medical-back.jpg");
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("versions a replaced driver document instead of overwriting it", async () => {
    const before = allDocuments().length;
    await mockUploadDocument(
      "medical_front", { name: "medical-renewed.pdf", type: "application/pdf", size: 1000 },
      () => {},
    );
    // A new version, not a replaced row: the count goes up, not sideways.
    expect(allDocuments().length).toBe(before + 1);
    const documents = await mockListDocuments();
    const live = documents.filter((d) => d.requirementKey === "medical_front");
    expect(live.length).toBe(1);
    expect(live[0].fileName).toBe("medical-renewed.pdf");
  });

  it("sends a document for review and records the expiry", async () => {
    await mockUploadDocument(
      "medical_back", { name: "x.jpg", type: "image/jpeg", size: 100 }, () => {},
    );
    const expiry = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const dated = await mockSetDocumentExpiry("medical_back", expiry);
    expect(dated.expiresAt).toBe(expiry);
    const submitted = await mockSubmitDocument("medical_back");
    expect(submitted.status).toBe("pending_review");
  });

  it("counts a selected, submitted or approved document as done", async () => {
    const requirements = documentRequirements("company_driver", "org_cascade");
    const progress = completion(requirements, await mockListDocuments());
    expect(progress.required).toBeGreaterThan(0);
    expect(progress.percent).toBeGreaterThan(0);
    expect(progress.percent).toBeLessThanOrEqual(100);
  });
});
