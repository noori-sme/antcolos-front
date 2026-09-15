import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey, WorkspaceKind } from "@/types";
import {
  NotFoundError, OrganizationScopeError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import { mockDocumentsService, resetDocumentCenter } from "./documents";
import { resetDocumentStore, allDocuments, lineageVersions, eventsForLineage } from "./document-store";
import {
  TRUCK_IDS, addTruckDocument, endCarrierRelationship, getTruckProfile, resetTruckRegistry,
} from "./truck-registry";
import { resetDocumentNeedsYou, documentNeedsYouItems } from "./document-needs-you";

/* -------------------------------------------------------------------------- */
/* Contexts                                                                    */
/* -------------------------------------------------------------------------- */

const ALL_DOCUMENT_KEYS: PermissionKey[] = [
  "documents:view", "documents:upload", "documents:download",
  "documents:approve", "documents:delete", "trucks:view", "trucks:documents:manage",
];

function ctxFor(
  organizationId: string,
  organizationName: string,
  workspaceKind: WorkspaceKind,
  options: {
    permissions?: PermissionKey[];
    driverProfileId?: string;
  } = {},
): ServiceContext {
  const driver = Boolean(options.driverProfileId);
  return {
    organizationId,
    organizationName,
    workspaceKind,
    membershipId: `mem_${organizationId}`,
    permissions: new Set(options.permissions ?? ALL_DOCUMENT_KEYS),
    actor: {
      userId: "usr_test",
      membershipId: `mem_${organizationId}`,
      displayNameSnapshot: "Test Person",
      source: "web",
    },
    scope: driver
      ? { loads: "assigned", financials: "own" }
      : { loads: "all", financials: "all" },
    driverProfileId: options.driverProfileId,
  };
}

const northline = () => ctxFor("org_northline", "Northline Freight", "carrier_organization");
const baxter = () => ctxFor("org_baxter", "Baxter Transit", "carrier_organization");
const meridian = () => ctxFor("org_meridian", "Meridian Dispatch", "dispatch_organization");
const solo = () => ctxFor("org_solo", "Sam Murtaza Dispatch", "individual_dispatcher");

const file = (name: string) => ({ name, type: "application/pdf", size: 123_456 });

beforeEach(() => {
  resetDocumentStore();
  resetDocumentNeedsYou();
  resetDocumentCenter();
  resetTruckRegistry();
});

/* -------------------------------------------------------------------------- */

describe("one document system", () => {
  it("serves truck documents and organization documents from the same store", async () => {
    const ctx = northline();
    const documents = await mockDocumentsService.list(ctx, {});
    const kinds = new Set(documents.map((d) => d.subject.kind));
    expect(kinds.has("organization")).toBe(true);
    expect(kinds.has("truck")).toBe(true);
  });

  it("shows a document added through the truck registry in the Document Center", async () => {
    const ctx = northline();
    const truckCtx = {
      organizationId: "org_northline",
      membershipId: "mem_org_northline",
      actorName: "Test Person",
      permissions: new Set(ALL_DOCUMENT_KEYS),
    };
    const before = (await mockDocumentsService.list(ctx, {})).length;
    await addTruckDocument(
      TRUCK_IDS.nl104,
      "cab_card",
      { name: "cab-card.pdf", type: "application/pdf", size: 1000 },
      truckCtx,
    );
    const after = await mockDocumentsService.list(ctx, {});
    expect(after.length).toBe(before + 1);
    expect(after.some((d) => d.document.file?.fileName === "cab-card.pdf")).toBe(true);
  });

  it("gives every document an immutable UUID", async () => {
    const ctx = northline();
    await mockDocumentsService.list(ctx, {});
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const record of allDocuments()) {
      expect(record.documentId, record.typeKey).toMatch(uuid);
      expect(record.lineageId, record.typeKey).toMatch(uuid);
    }
  });

  it("gives every document a typed relationship to a real entity", async () => {
    const ctx = northline();
    for (const view of await mockDocumentsService.list(ctx, {})) {
      expect(view.document.links.length).toBeGreaterThan(0);
      expect(view.document.links.filter((l) => l.primary).length).toBe(1);
      expect(["organization", "driver", "truck", "trailer", "load"]).toContain(view.subject.kind);
    }
  });
});

describe("versioning", () => {
  it("creates a new version and keeps the old one, with its own id", async () => {
    const ctx = northline();
    const first = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("safety-v1.pdf"),
    });

    const second = await mockDocumentsService.replaceDocument(ctx, first.document.documentId, {
      file: file("safety-v2.pdf"),
    });

    expect(second.document.documentId).not.toBe(first.document.documentId);
    expect(second.document.lineageId).toBe(first.document.lineageId);
    expect(second.document.version).toBe(2);
    expect(second.document.supersedesDocumentId).toBe(first.document.documentId);

    // The old version is still there, still readable, still itself.
    const old = await mockDocumentsService.get(ctx, first.document.documentId);
    expect(old.document.status).toBe("superseded");
    expect(old.document.file?.fileName).toBe("safety-v1.pdf");
    expect(old.document.supersededByDocumentId).toBe(second.document.documentId);
  });

  it("keeps the whole history on the lineage, not just the latest version", async () => {
    const ctx = northline();
    const first = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("v1.pdf"),
    });
    await mockDocumentsService.replaceDocument(ctx, first.document.documentId, { file: file("v2.pdf") });
    await mockDocumentsService.replaceDocument(
      ctx,
      (await mockDocumentsService.get(ctx, first.document.lineageId).catch(() => null))
        ? first.document.documentId
        : lineageVersions(first.document.lineageId)[0].documentId,
      { file: file("v3.pdf") },
    );

    const versions = lineageVersions(first.document.lineageId);
    expect(versions.length).toBe(3);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    // History is append-only and covers every version.
    const kinds = eventsForLineage(first.document.lineageId).map((e) => e.kind);
    expect(kinds).toContain("created");
    expect(kinds).toContain("replaced");
    expect(kinds).toContain("superseded");
  });

  it("does not inherit the previous version's approval", async () => {
    const ctx = northline();
    const first = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("v1.pdf"),
    });
    await mockDocumentsService.submitForReview(ctx, first.document.documentId);
    await mockDocumentsService.approve(ctx, first.document.documentId);

    const second = await mockDocumentsService.replaceDocument(ctx, first.document.documentId, {
      file: file("v2.pdf"),
    });
    // An approval was of the earlier file and cannot carry over to a new one.
    expect(second.status).toBe("selected_local");
  });

  it("keeps superseded versions out of the working list but reachable on request", async () => {
    const ctx = northline();
    const first = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("v1.pdf"),
    });
    await mockDocumentsService.replaceDocument(ctx, first.document.documentId, { file: file("v2.pdf") });

    const working = await mockDocumentsService.list(ctx, {});
    expect(working.some((d) => d.document.documentId === first.document.documentId)).toBe(false);

    const withHistory = await mockDocumentsService.list(ctx, { includeSuperseded: true });
    expect(withHistory.some((d) => d.document.documentId === first.document.documentId)).toBe(true);
  });

  it("refuses to replace a version that has already been replaced", async () => {
    const ctx = northline();
    const first = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("v1.pdf"),
    });
    await mockDocumentsService.replaceDocument(ctx, first.document.documentId, { file: file("v2.pdf") });
    await expect(
      mockDocumentsService.replaceDocument(ctx, first.document.documentId, { file: file("v3.pdf") }),
    ).rejects.toThrow(/already been replaced/);
  });
});

describe("cross-organization isolation", () => {
  it("does not serve one carrier's documents to another", async () => {
    const mine = await mockDocumentsService.list(northline(), {});
    const theirs = await mockDocumentsService.list(baxter(), {});
    const mineIds = new Set(mine.map((d) => d.document.documentId));
    const overlap = theirs.filter((d) => mineIds.has(d.document.documentId));
    // The only documents in common would be ones explicitly shared, and these
    // two carriers share nothing with each other.
    expect(overlap).toEqual([]);
  });

  it("answers an unknown id and a forbidden id the same way", async () => {
    const first = (await mockDocumentsService.list(northline(), {}))[0];
    await expect(mockDocumentsService.get(baxter(), first.document.documentId))
      .rejects.toBeInstanceOf(NotFoundError);
    await expect(mockDocumentsService.get(baxter(), "no-such-document"))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a dispatch organization see only what a carrier explicitly shared", async () => {
    const seen = await mockDocumentsService.list(meridian(), {});
    const fromOthers = seen.filter((d) => d.document.organizationId !== "org_meridian");
    expect(fromOthers.length).toBeGreaterThan(0);
    // Every one of them arrived through a live share, not through a relationship.
    for (const view of fromOthers) {
      expect(view.shared).toBe(true);
      expect(view.share).toBeDefined();
    }
    // And the carrier's other paperwork is not among them.
    expect(fromOthers.some((d) => d.document.typeKey === "w9")).toBe(false);
    expect(fromOthers.some((d) => d.document.typeKey === "ifta_license")).toBe(false);
  });

  it("does not let a recipient review, edit or re-share what it received", async () => {
    const ctx = meridian();
    const shared = (await mockDocumentsService.list(ctx, {})).find((d) => d.shared);
    expect(shared).toBeDefined();
    expect(shared!.canReview).toBe(false);

    await expect(mockDocumentsService.approve(ctx, shared!.document.documentId))
      .rejects.toBeInstanceOf(OrganizationScopeError);
    await expect(
      mockDocumentsService.replaceDocument(ctx, shared!.document.documentId, { file: file("x.pdf") }),
    ).rejects.toBeInstanceOf(OrganizationScopeError);
  });

  it("hides the granter's own review decision from the recipient", async () => {
    const shared = (await mockDocumentsService.list(meridian(), {})).find((d) => d.shared)!;
    for (const link of shared.document.links) {
      expect(link.review.state).toBe("not_required");
      expect(link.review.rejectionReason).toBeUndefined();
    }
  });

  it("honours view-only grants separately from download grants", async () => {
    const ctx = meridian();
    const shared = (await mockDocumentsService.list(ctx, {})).filter((d) => d.shared);
    expect(shared.some((d) => d.canDownload)).toBe(true);
    expect(shared.some((d) => !d.canDownload)).toBe(true);
  });

  it("refuses to create a document about another organization", async () => {
    await expect(
      mockDocumentsService.addDocument(northline(), {
        typeKey: "w9",
        subject: { kind: "organization", id: "org_baxter", label: "Baxter Transit" },
        file: file("sneaky.pdf"),
      }),
    ).rejects.toBeInstanceOf(OrganizationScopeError);
  });

  it("only lets the granting organization revoke a share", async () => {
    const shares = await mockDocumentsService.listShares(baxter());
    expect(shares.length).toBeGreaterThan(0);
    await expect(mockDocumentsService.revokeShare(meridian(), shares[0].id, "nope"))
      .rejects.toBeInstanceOf(NotFoundError);
    const revoked = await mockDocumentsService.revokeShare(baxter(), shares[0].id, "Contract ended.");
    expect(revoked.revokedAt).toBeDefined();
  });

  it("stops serving a shared document once the share is revoked, without deleting it", async () => {
    const shares = await mockDocumentsService.listShares(baxter());
    const before = (await mockDocumentsService.list(meridian(), {})).filter((d) => d.shared).length;
    await mockDocumentsService.revokeShare(baxter(), shares[0].id, "Contract ended.");
    const after = (await mockDocumentsService.list(meridian(), {})).filter((d) => d.shared).length;
    expect(after).toBe(before - 1);
    // The carrier still holds it in full.
    const stillThere = await mockDocumentsService.list(baxter(), {});
    expect(stillThere.some((d) => d.document.lineageId === shares[0].lineageId)).toBe(true);
  });
});

describe("permissions", () => {
  it("refuses to list without documents:view", async () => {
    const ctx = ctxFor("org_northline", "Northline Freight", "carrier_organization", { permissions: [] });
    await expect(mockDocumentsService.list(ctx, {})).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses to add without documents:upload", async () => {
    const ctx = ctxFor("org_northline", "Northline Freight", "carrier_organization", {
      permissions: ["documents:view"],
    });
    await expect(
      mockDocumentsService.addDocument(ctx, {
        typeKey: "safety_policy",
        subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
        file: file("x.pdf"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses to approve or reject without documents:approve", async () => {
    const viewer = ctxFor("org_northline", "Northline Freight", "carrier_organization", {
      permissions: ["documents:view", "documents:upload"],
    });
    const added = await mockDocumentsService.addDocument(viewer, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("x.pdf"),
    });
    await expect(mockDocumentsService.approve(viewer, added.document.documentId))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockDocumentsService.reject(viewer, added.document.documentId, "because"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a rejection with no reason", async () => {
    const ctx = northline();
    const added = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("x.pdf"),
    });
    await expect(mockDocumentsService.reject(ctx, added.document.documentId, "   "))
      .rejects.toThrow(/needs a reason/);
  });

  it("records a rejection reason a person can act on", async () => {
    const ctx = northline();
    const added = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("x.pdf"),
    });
    const rejected = await mockDocumentsService.reject(ctx, added.document.documentId, "Page 2 is blank.");
    expect(rejected.status).toBe("rejected");
    expect(rejected.document.links[0].review.rejectionReason).toBe("Page 2 is blank.");
  });
});

describe("workspace scope", () => {
  it("measures each workspace against its own checklist, chosen by its kind", async () => {
    const carrier = await mockDocumentsService.workspaceChecklist(northline());
    const dispatch = await mockDocumentsService.workspaceChecklist(meridian());
    const individual = await mockDocumentsService.workspaceChecklist(solo());

    expect(carrier.set.id).toBe("carrier_organization");
    expect(dispatch.set.id).toBe("dispatch_organization");
    expect(individual.set.id).toBe("individual_dispatcher");

    const dispatchTypes = dispatch.items.map((i) => i.requirement.typeKey);
    expect(dispatchTypes).not.toContain("operating_authority");
    const individualTypes = individual.items.map((i) => i.requirement.typeKey);
    expect(individualTypes).toContain("government_id");
    expect(individualTypes).not.toContain("operating_authority");
  });

  it("reports a requirement with nothing against it as missing, with no record behind it", async () => {
    const checklist = await mockDocumentsService.workspaceChecklist(northline());
    const voided = checklist.items.find((i) => i.requirement.typeKey === "voided_check");
    expect(voided?.status).toBe("missing");
    expect(voided?.document).toBeUndefined();
  });

  it("derives expiring and expired from the date rather than storing them", async () => {
    const checklist = await mockDocumentsService.workspaceChecklist(northline());
    const coi = checklist.items.find((i) => i.requirement.typeKey === "certificate_of_insurance");
    const consortium = checklist.items.find((i) => i.requirement.typeKey === "drug_alcohol_policy");
    expect(coi?.status).toBe("expiring_soon");
    expect(coi?.document?.status).toBe("approved");
    expect(consortium?.status).toBe("expired");
    expect(consortium?.document?.status).toBe("approved");
  });

  it("does not count optional requirements against completion", async () => {
    const individual = await mockDocumentsService.workspaceChecklist(solo());
    const optional = individual.items.filter((i) => i.requirement.applicability === "optional");
    expect(optional.length).toBeGreaterThan(0);
    expect(individual.required).toBe(
      individual.items.filter((i) => i.requirement.applicability === "required").length,
    );
  });

  it("keeps a driver membership out of the carrier's own paperwork", async () => {
    const driver = ctxFor("org_cascade", "Cascade Haul", "carrier_organization", {
      driverProfileId: "dp_sam",
    });
    const seen = await mockDocumentsService.list(driver, {});
    expect(seen.every((d) => d.subject.kind === "driver")).toBe(true);
    expect(seen.every((d) => d.subject.id === "dp_sam")).toBe(true);
  });
});

describe("linking instead of duplicating", () => {
  it("attaches one document to a second context rather than copying it", async () => {
    const ctx = northline();
    const added = await mockDocumentsService.addDocument(ctx, {
      typeKey: "certificate_of_insurance",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      requirementKey: "carrier_org:certificate_of_insurance",
      file: file("coi.pdf"),
    });
    const countBefore = allDocuments().length;

    const linked = await mockDocumentsService.link(ctx, {
      documentId: added.document.documentId,
      subject: { kind: "truck", id: "truck-1", label: "Unit 104" },
      requirementKey: "truck:insurance",
    });

    expect(allDocuments().length).toBe(countBefore);
    expect(linked.document.links.length).toBe(2);
    expect(linked.document.links.filter((l) => l.primary).length).toBe(1);
  });

  it("gives the second context its own review state", async () => {
    const ctx = northline();
    const added = await mockDocumentsService.addDocument(ctx, {
      typeKey: "certificate_of_insurance",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      requirementKey: "carrier_org:certificate_of_insurance",
      file: file("coi.pdf"),
    });
    await mockDocumentsService.submitForReview(ctx, added.document.documentId);
    await mockDocumentsService.approve(ctx, added.document.documentId);

    const linked = await mockDocumentsService.link(ctx, {
      documentId: added.document.documentId,
      subject: { kind: "trailer", id: "trailer-1", label: "V-220" },
      requirementKey: "trailer:insurance",
    });
    const secondary = linked.document.links.find((l) => !l.primary)!;
    // One context accepting it does not decide for another.
    expect(secondary.review.state).toBe("pending");
    expect(linked.document.links.find((l) => l.primary)!.review.state).toBe("approved");
  });
});

describe("load documents are modelled, not built", () => {
  it("refuses to create load paperwork", async () => {
    await expect(
      mockDocumentsService.addDocument(northline(), {
        typeKey: "rate_confirmation",
        subject: { kind: "load", id: "load-1", label: "NL-24817" },
        file: file("ratecon.pdf"),
      }),
    ).rejects.toThrow(/not built yet/);
  });
});

describe("the upgrade path", () => {
  it("carries applicable documents forward and asks only for the rest", async () => {
    const plan = await mockDocumentsService.upgradePlan(solo(), "dispatch_organization");
    const carried = plan.carriedForward.map((i) => i.requirement.typeKey);
    const newly = plan.newlyRequired.map((r) => r.typeKey);

    // Already held and still asked for: not requested a second time.
    expect(carried).toContain("w9");
    expect(newly).not.toContain("w9");

    // A company is asked for things one person is not.
    expect(newly).toContain("errors_omissions_insurance");

    // Nothing appears in both lists.
    expect(carried.filter((t) => newly.includes(t))).toEqual([]);
  });

  it("keeps documents that stop being asked for rather than deleting them", async () => {
    const ctx = solo();
    const plan = await mockDocumentsService.upgradePlan(ctx, "dispatch_organization");
    // A government ID is a personal-workspace requirement and not a company one.
    expect(plan.noLongerRequired.map((i) => i.requirement.typeKey)).toContain("government_id");
    // And it is still in the workspace's documents, untouched.
    const held = await mockDocumentsService.list(ctx, {});
    expect(held.some((d) => d.document.typeKey === "government_id")).toBe(true);
  });

  it("refuses any other upgrade", async () => {
    await expect(mockDocumentsService.upgradePlan(meridian(), "dispatch_organization"))
      .rejects.toThrow(/only upgrade path/);
    await expect(mockDocumentsService.upgradePlan(northline(), "dispatch_organization"))
      .rejects.toThrow(/only upgrade path/);
  });
});

describe("search and filters", () => {
  it("searches labels, file names and subjects", async () => {
    const ctx = northline();
    const byFile = await mockDocumentsService.list(ctx, { search: "northline-coi" });
    expect(byFile.length).toBe(1);
    const byLabel = await mockDocumentsService.list(ctx, { search: "operating authority" });
    expect(byLabel.length).toBeGreaterThan(0);
    const nothing = await mockDocumentsService.list(ctx, { search: "zzzzz" });
    expect(nothing).toEqual([]);
  });

  it("filters by state and by what the document is about", async () => {
    const ctx = northline();
    const expired = await mockDocumentsService.list(ctx, { status: ["expired"] });
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((d) => d.status === "expired")).toBe(true);

    const trucks = await mockDocumentsService.list(ctx, { subjectKind: ["truck"] });
    expect(trucks.length).toBeGreaterThan(0);
    expect(trucks.every((d) => d.subject.kind === "truck")).toBe(true);
  });

  it("can exclude documents other organizations shared", async () => {
    const withShared = await mockDocumentsService.list(meridian(), {});
    const ownOnly = await mockDocumentsService.list(meridian(), { includeShared: false });
    expect(ownOnly.length).toBeLessThan(withShared.length);
    expect(ownOnly.every((d) => !d.shared)).toBe(true);
  });
});

describe("real Needs You items", () => {
  it("raises items for missing, rejected, expiring and expired documents", async () => {
    const ctx = northline();
    await mockDocumentsService.list(ctx, {});
    const items = documentNeedsYouItems(ctx);
    const titles = items.map((i) => i.title);

    expect(titles.some((t) => /missing/i.test(t))).toBe(true);
    expect(titles.some((t) => /expired/i.test(t))).toBe(true);
    expect(titles.some((t) => /expires soon/i.test(t))).toBe(true);
    expect(documentNeedsYouItems(ctxFor("org_summit", "Summit Dispatch", "dispatch_organization"))
      .some((i) => /rejected/i.test(i.title))).toBe(true);
  });

  it("stops raising an item once the document is genuinely fixed", async () => {
    const ctx = northline();
    const before = documentNeedsYouItems(ctx);
    const missing = before.find((i) => /voided check/i.test(i.title));
    expect(missing).toBeDefined();

    await mockDocumentsService.addDocument(ctx, {
      typeKey: "voided_check",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      requirementKey: "carrier_org:voided_check",
      file: file("ach.pdf"),
    });

    const after = documentNeedsYouItems(ctx);
    expect(after.find((i) => i.id === missing!.id)).toBeUndefined();
  });

  it("gives a derived item a stable id so it can be acted on", async () => {
    const ctx = northline();
    const first = documentNeedsYouItems(ctx).map((i) => i.id);
    const second = documentNeedsYouItems(ctx).map((i) => i.id);
    expect(second).toEqual(first);
  });

  it("never asks a dispatch organization about carrier-only requirements", async () => {
    const items = documentNeedsYouItems(meridian());
    for (const item of items) {
      expect(item.title).not.toMatch(/operating authority|IFTA|drug and alcohol/i);
    }
  });

  it("does not raise items for optional requirements nobody has filled", async () => {
    const items = documentNeedsYouItems(solo());
    // Business registration is optional for one person working as themselves.
    expect(items.some((i) => /business registration/i.test(i.title))).toBe(false);
  });
});

describe("ending a relationship", () => {
  const truckCtx = () => ({
    organizationId: "org_northline",
    membershipId: "mem_org_northline",
    actorName: "Test Person",
    permissions: new Set<PermissionKey>([
      ...ALL_DOCUMENT_KEYS, "trucks:relationships:manage", "trucks:edit",
    ]),
  });

  it("deletes no document and no history when a carrier relationship ends", async () => {
    const before = allDocuments().length;
    const profile = await getTruckProfile(TRUCK_IDS.nl104, truckCtx());
    expect(profile.documents.length).toBeGreaterThan(0);
    const lineages = profile.documents
      .map((d) => allDocuments().find((r) => r.documentId === d.id)!.lineageId);
    const historyBefore = lineages.map((l) => eventsForLineage(l).length);

    const relationship = profile.relationships.find((r) => r.organizationId === "org_northline")!;
    await endCarrierRelationship(relationship.id, "Moved to another carrier.", truckCtx());

    // Not one record is gone, and the history only ever grew.
    expect(allDocuments().length).toBe(before);
    lineages.forEach((lineage, i) => {
      expect(eventsForLineage(lineage).length).toBeGreaterThanOrEqual(historyBefore[i]);
    });
  });

  it("ends the departing organization's links instead of removing them", async () => {
    const profile = await getTruckProfile(TRUCK_IDS.nl104, truckCtx());
    const relationship = profile.relationships.find((r) => r.organizationId === "org_northline")!;
    const documentIds = profile.documents.map((d) => d.id);

    await endCarrierRelationship(relationship.id, "Moved to another carrier.", truckCtx());

    for (const id of documentIds) {
      const record = allDocuments().find((r) => r.documentId === id)!;
      const link = record.links.find((l) => l.contextOrganizationId === "org_northline")!;
      expect(link).toBeDefined();
      expect(link.unlinkedAt).toBeDefined();
      expect(link.unlinkReason).toBe("Moved to another carrier.");
    }
  });
});

describe("fixture ids survive a reload", () => {
  it("gives a seeded document the same id every time the module is seeded", async () => {
    const ctx = northline();
    const first = (await mockDocumentsService.list(ctx, {})).map((d) => d.document.documentId).sort();

    // Exactly what a page refresh does: throw the store away and seed again.
    resetDocumentStore();
    resetDocumentCenter();
    resetTruckRegistry();

    const second = (await mockDocumentsService.list(ctx, {})).map((d) => d.document.documentId).sort();
    expect(second).toEqual(first);
  });

  it("still gives a runtime document a random id", async () => {
    const ctx = northline();
    const a = await mockDocumentsService.addDocument(ctx, {
      typeKey: "safety_policy",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("policy.pdf"),
    });
    const b = await mockDocumentsService.addDocument(ctx, {
      typeKey: "carrier_packet",
      subject: { kind: "organization", id: "org_northline", label: "Northline Freight" },
      file: file("packet.pdf"),
    });
    expect(a.document.documentId).not.toBe(b.document.documentId);
  });
});
