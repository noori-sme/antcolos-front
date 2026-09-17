import {
  buildChecklist, checklistCompletion, effectiveStatus, EXPIRING_SOON_DAYS,
  daysUntil,
} from "@/lib/documents/status";
import { documentTypeLabel, isFutureType } from "@/lib/documents/catalog";
import {
  driverRequirements, requirementByKey, trailerRequirements,
  truckRequirements, workspaceRequirementKey, workspaceRequirements,
  workspaceRequirementSet,
} from "@/lib/documents/requirements";
import type {
  DocumentLink, DocumentRecord, DocumentRequirement, DocumentShare,
  DocumentSubjectRef, EngagementType, TrailerType, TruckEquipmentType, WorkspaceKind,
} from "@/types";
import {
  NotFoundError, OrganizationScopeError, PermissionDeniedError,
  type ServiceContext,
} from "../contracts/context";
import type {
  AddDocumentInput, ChecklistView, DocumentDetail, DocumentFilters,
  DocumentView, DocumentsService, LinkDocumentInput, ShareDocumentInput,
  WorkspaceUpgradePlan,
} from "../contracts/documents";
import {
  addLink, allDocuments, allShares, createDocument,
  documentById, documentInSlot, documentsForSubject, documentsOwnedBy,
  eventsForLineage, lineageVersions, recordEvent, replaceDocument as replaceInStore,
  revokeShare as revokeInStore, shareDocument, snapshotsForLineage, updateDocument,
} from "./document-store";
import { seedOrganizationDocuments } from "./organization-documents";
import { liveRelationship } from "./driver-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE Document Center service.
 *
 * Everything below is the boundary, not a convenience. A screen that renders a
 * button it should not have still fails here, and so will the real API: every
 * method states the permission it needs, narrows to what the caller's
 * organization and relationships entitle it to, and treats an unknown id and a
 * forbidden id as the same answer.
 *
 * The three rules this file exists to hold:
 *
 *   1. PERMISSIONS.   Every method declares its keys and enforces them.
 *   2. SCOPE.         A driver sees their own documents. A membership sees what
 *                     its organization's relationships reach, and no more.
 *   3. ISOLATION.     One organization's documents are never served to another.
 *                     A dispatch organization sees a carrier's document ONLY
 *                     through an explicit, live share — never by holding a
 *                     relationship, never by knowing an id.
 *
 * Uploads are mock-only. Nothing here stores, transmits, reads, extracts,
 * OCR-processes, verifies or submits a file anywhere.
 */

const LATENCY_MS = 220;
const wait = (ms = LATENCY_MS) => new Promise<void>((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

let seeded = false;
function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  seedOrganizationDocuments();
}

/** Test hook. Never called by the UI. */
export function resetDocumentCenter() {
  seeded = false;
  ensureSeeded();
}

function require(ctx: ServiceContext, ...keys: Parameters<ServiceContext["permissions"]["has"]>[0][]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/* -------------------------------------------------------------------------- */
/* Visibility                                                                  */
/* -------------------------------------------------------------------------- */

function liveLinks(record: DocumentRecord): DocumentLink[] {
  return record.links.filter((l) => !l.unlinkedAt);
}

/**
 * ★ A CONSENT-BASED LINK IS ONLY AS GOOD AS ITS CONSENT ★
 *
 * A link marked `driver_consent` exists for exactly one reason: the driver
 * agreed to share that requirement with that organization. The agreement lives
 * on the relationship, and this checks it on every read rather than trusting
 * that the two writes finished together.
 *
 * It closes a window no write order can: links and consent are two records in
 * two modules, so between them there is always a moment where one exists
 * alone. Writing them in one commit (see `addLinks`) means nothing can observe
 * that moment in this mock; checking here means that even if something did —
 * a future path, a partial import, a backend whose transaction did not hold —
 * the link is not access.
 *
 * Only `driver_consent` links are governed. A carrier's own handbook issued TO
 * a driver stands on its own basis and is not the driver's to withdraw.
 */
function consentBacked(link: DocumentLink): boolean {
  if (link.basis !== "driver_consent") return true;
  if (link.subject.kind !== "driver" || !link.contextOrganizationId) return false;
  const relationship = liveRelationship(link.subject.id, link.contextOrganizationId);
  if (!relationship) return false;
  return link.requirementKey !== undefined
    && relationship.sharedDocumentKeys.includes(link.requirementKey);
}

/** The link through which this organization holds the document, if any. */
function ownLink(record: DocumentRecord, organizationId: string): DocumentLink | undefined {
  return liveLinks(record)
    .filter(consentBacked)
    .find((l) => l.contextOrganizationId === organizationId);
}

function activeShare(record: DocumentRecord, organizationId: string): DocumentShare | undefined {
  return allShares().find(
    (s) => s.lineageId === record.lineageId
      && s.sharedWithOrganizationId === organizationId
      && !s.revokedAt,
  );
}

/**
 * What one membership may see of one document.
 *
 * Returns null for "not visible", and the caller turns that into the same
 * NotFoundError an unknown id produces — telling the two apart would turn a
 * document id field into a way of probing other organizations' paperwork.
 */
function visibility(
  ctx: ServiceContext,
  record: DocumentRecord,
): { link?: DocumentLink; share?: DocumentShare } | null {
  const share = activeShare(record, ctx.organizationId);
  const link = ownLink(record, ctx.organizationId);
  const owned = record.organizationId === ctx.organizationId;

  // A driver membership sees their OWN documents and nothing else — not their
  // carrier's authority, not another driver's licence, not the fleet's
  // registrations. Record scope, applied before anything else.
  if (ctx.scope.loads === "assigned" && ctx.driverProfileId) {
    const aboutMe = liveLinks(record).some(
      (l) => l.subject.kind === "driver" && l.subject.id === ctx.driverProfileId,
    );
    return aboutMe ? { link, share } : null;
  }

  if (owned || link) {
    // A dispatch workspace never reaches another organization's documents by
    // holding a relationship. Only an explicit share does that, and that is
    // checked below rather than here.
    if (!owned && record.organizationId && record.organizationId !== ctx.organizationId) {
      return share ? { share } : null;
    }
    return { link, share };
  }

  return share ? { share } : null;
}

function requirementFor(link: DocumentLink | undefined): DocumentRequirement | undefined {
  return link?.requirementKey ? requirementByKey(link.requirementKey) : undefined;
}

function subjectFor(record: DocumentRecord, link?: DocumentLink): DocumentSubjectRef {
  return (link ?? liveLinks(record)[0] ?? record.links[0]).subject;
}

/**
 * Projects a record into what this membership is entitled to see of it.
 *
 * A shared document arrives stripped of the granter's internal review: whether
 * the carrier's own compliance officer accepted it is the carrier's business,
 * and a dispatcher reading "rejected" on a document it cannot fix would be
 * worse than useless.
 */
function project(
  ctx: ServiceContext,
  record: DocumentRecord,
  seen: { link?: DocumentLink; share?: DocumentShare },
): DocumentView {
  const sharedOnly = !seen.link && Boolean(seen.share);
  const link = seen.link;
  return {
    document: sharedOnly ? redactForRecipient(record) : record,
    status: effectiveStatus(record),
    requirement: requirementFor(link),
    subject: subjectFor(record, link),
    shared: sharedOnly,
    share: seen.share,
    canDownload: sharedOnly
      ? Boolean(seen.share?.canDownload) && ctx.permissions.has("documents:download")
      : ctx.permissions.has("documents:download"),
    // Receiving a document never confers the right to decide on it. Only the
    // organization whose context governs the link reviews it.
    canReview: !sharedOnly && Boolean(link) && ctx.permissions.has("documents:approve"),
    versionCount: lineageVersions(record.lineageId).length,
  };
}

function redactForRecipient(record: DocumentRecord): DocumentRecord {
  return {
    ...record,
    links: record.links.map((l) => ({
      ...l,
      review: { state: "not_required" as const },
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

function matches(view: DocumentView, f: DocumentFilters): boolean {
  const record = view.document;
  if (f.status?.length && !f.status.includes(view.status)) return false;
  if (f.typeKey?.length && !f.typeKey.includes(record.typeKey)) return false;
  if (f.subjectKind?.length && !f.subjectKind.includes(view.subject.kind)) return false;
  if (f.subjectId && view.subject.id !== f.subjectId) return false;
  if (f.includeShared === false && view.shared) return false;
  if (f.expiringWithinDays != null) {
    if (!record.expiresAt) return false;
    if (daysUntil(record.expiresAt) > f.expiringWithinDays) return false;
  }
  if (f.search) {
    const q = f.search.trim().toLowerCase();
    const hay = [
      documentTypeLabel(record.typeKey),
      view.requirement?.label ?? "",
      record.file?.fileName ?? "",
      view.subject.label,
      record.owner.name,
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Checklists                                                                  */
/* -------------------------------------------------------------------------- */

function checklistView(
  set: ReturnType<typeof workspaceRequirementSet>,
  documents: readonly DocumentRecord[],
): ChecklistView {
  const items = buildChecklist(set.requirements, documents);
  const completion = checklistCompletion(items);
  return {
    set,
    items,
    required: completion.required,
    satisfied: completion.satisfied,
    percent: completion.percent,
  };
}

/**
 * The requirement set for one entity.
 *
 * Equipment sets depend on the equipment, and a driver's on their engagement,
 * so the caller supplies those facts. Everything else is decided here.
 */
function entityRequirements(
  subject: DocumentSubjectRef,
  hint?: { equipment?: string; engagement?: string },
): { id: ChecklistView["set"]["id"]; label: string; description: string; requirements: DocumentRequirement[] } {
  switch (subject.kind) {
    case "truck":
      return {
        id: "truck", label: "Truck documents",
        description: "What this power unit has to carry.",
        requirements: truckRequirements((hint?.equipment as TruckEquipmentType) ?? "tractor"),
      };
    case "trailer":
      return {
        id: "trailer", label: "Trailer documents",
        description: "What this trailer has to carry.",
        requirements: trailerRequirements((hint?.equipment as TrailerType) ?? "dry_van"),
      };
    case "driver":
      return {
        id: "driver", label: "Driver documents",
        description: "What the carrier asks this driver for.",
        requirements: driverRequirements((hint?.engagement as EngagementType) ?? "company_driver"),
      };
    case "load":
      // Modelled, not built. An empty checklist is the honest answer.
      return {
        id: "driver", label: "Load documents",
        description: "Load paperwork is modelled but not built yet.",
        requirements: [],
      };
    default:
      return {
        id: "carrier_organization", label: "Organization documents",
        description: "The workspace's own paperwork.",
        requirements: [],
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

function findOrThrow(ctx: ServiceContext, documentId: string) {
  const record = documentById(documentId);
  if (!record) throw new NotFoundError("Document");
  const seen = visibility(ctx, record);
  // Unknown and forbidden are deliberately indistinguishable.
  if (!seen) throw new NotFoundError("Document");
  return { record, seen };
}

/** Writes require the document to be the caller's own, never merely shared. */
function findWritableOrThrow(ctx: ServiceContext, documentId: string) {
  const { record, seen } = findOrThrow(ctx, documentId);
  if (!seen.link) {
    throw new OrganizationScopeError(
      record.organizationId ?? record.owner.id,
      ctx.organizationId,
    );
  }
  return { record, link: seen.link };
}

export const mockDocumentsService: DocumentsService = {
  async list(ctx, filters = {}) {
    ensureSeeded();
    await wait();
    require(ctx, "documents:view");

    const includeSuperseded = filters.includeSuperseded ?? false;
    const views: DocumentView[] = [];
    for (const record of allDocuments()) {
      if (!includeSuperseded && record.status === "superseded") continue;
      const seen = visibility(ctx, record);
      if (!seen) continue;
      const view = project(ctx, record, seen);
      if (matches(view, filters)) views.push(view);
    }

    // Work first: what needs a person, then everything else, newest first.
    const weight: Record<string, number> = {
      rejected: 0, expired: 1, missing: 2, expiring_soon: 3,
      pending_review: 4, selected_local: 5, approved: 6, superseded: 7,
    };
    return views.sort((a, b) => {
      const byStatus = (weight[a.status] ?? 9) - (weight[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return b.document.createdAt.localeCompare(a.document.createdAt);
    });
  },

  async get(ctx, documentId): Promise<DocumentDetail> {
    ensureSeeded();
    await wait();
    require(ctx, "documents:view");
    const { record, seen } = findOrThrow(ctx, documentId);
    const base = project(ctx, record, seen);
    const sharedOnly = base.shared;
    return {
      ...base,
      // Every version, so a replacement can be read against what it replaced.
      versions: sharedOnly
        ? lineageVersions(record.lineageId).map(redactForRecipient)
        : lineageVersions(record.lineageId),
      history: eventsForLineage(record.lineageId),
      // A recipient sees that it was shared with them, never the granter's
      // other grants.
      shares: sharedOnly
        ? (seen.share ? [seen.share] : [])
        : allShares().filter((s) => s.lineageId === record.lineageId),
      snapshots: sharedOnly ? [] : snapshotsForLineage(record.lineageId),
    };
  },

  async workspaceChecklist(ctx) {
    ensureSeeded();
    await wait(120);
    require(ctx, "documents:view");
    // The kind comes from the context, so the carrier checklist is not
    // reachable from a dispatch workspace by any argument a caller can pass.
    const set = workspaceRequirementSet(ctx.workspaceKind);
    const documents = documentsOwnedBy(ctx.organizationId).filter((d) =>
      d.links.some((l) => l.subject.kind === "organization" && l.subject.id === ctx.organizationId),
    );
    return checklistView(set, documents);
  },

  async entityChecklist(ctx, subject, hint) {
    ensureSeeded();
    await wait(120);
    require(ctx, "documents:view");
    const spec = entityRequirements(subject, hint);
    const documents = documentsForSubject(subject.kind, subject.id, { includeSuperseded: true })
      .filter((d) => visibility(ctx, d) !== null);
    return checklistView(
      { id: spec.id, label: spec.label, description: spec.description, requirements: spec.requirements },
      documents,
    );
  },

  async addDocument(ctx, input: AddDocumentInput) {
    ensureSeeded();
    await wait(360);
    require(ctx, "documents:upload");

    if (isFutureType(input.typeKey)) {
      // The model carries load paperwork so the workflow can attach later.
      // Accepting one now would be claiming a workflow that does not exist.
      throw new Error(
        `${documentTypeLabel(input.typeKey)} belongs to the Load document workflow, which is not built yet.`,
      );
    }

    // A document about an entity this organization cannot see is not something
    // it may create paperwork against.
    if (input.subject.kind === "organization" && input.subject.id !== ctx.organizationId) {
      throw new OrganizationScopeError(input.subject.id, ctx.organizationId);
    }

    const requirementKey = input.requirementKey
      ?? (input.subject.kind === "organization"
        ? workspaceRequirementKey(ctx.workspaceKind, input.typeKey)
        : undefined);

    const existing = requirementKey
      ? documentInSlot(input.subject.kind, input.subject.id, requirementKey)
      : undefined;

    const file = {
      fileName: input.file.name,
      fileType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      selectedAt: nowIso(),
    };

    const record = existing
      ? replaceInStore(existing, {
          file,
          expiresAt: input.expiresAt,
          status: "selected_local",
          addedByName: ctx.actor.displayNameSnapshot,
          addedByMembershipId: ctx.membershipId,
          contextOrganizationId: ctx.organizationId,
        })
      : createDocument({
          owner: { kind: "organization", id: ctx.organizationId, name: ctx.organizationName },
          organizationId: ctx.organizationId,
          typeKey: input.typeKey,
          subject: input.subject,
          requirementKey,
          contextOrganizationId: ctx.organizationId,
          contextOrganizationName: ctx.organizationName,
          status: "selected_local",
          file,
          expiresAt: input.expiresAt,
          addedByName: ctx.actor.displayNameSnapshot,
          addedByMembershipId: ctx.membershipId,
        });

    return project(ctx, record, { link: ownLink(record, ctx.organizationId) });
  },

  async replaceDocument(ctx, documentId, input) {
    ensureSeeded();
    await wait(360);
    require(ctx, "documents:upload");
    const { record } = findWritableOrThrow(ctx, documentId);
    if (record.status === "superseded") {
      throw new Error("That version has already been replaced. Replace the current one.");
    }
    const next = replaceInStore(record, {
      file: {
        fileName: input.file.name,
        fileType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.size,
        selectedAt: nowIso(),
      },
      expiresAt: input.expiresAt,
      status: "selected_local",
      addedByName: ctx.actor.displayNameSnapshot,
      addedByMembershipId: ctx.membershipId,
      contextOrganizationId: ctx.organizationId,
    });
    return project(ctx, next, { link: ownLink(next, ctx.organizationId) });
  },

  async submitForReview(ctx, documentId) {
    ensureSeeded();
    await wait(300);
    require(ctx, "documents:upload");
    const { record, link } = findWritableOrThrow(ctx, documentId);
    const updated = updateDocument(documentId, {
      status: "pending_review",
      links: record.links.map((l) =>
        l.id === link.id ? { ...l, review: { state: "pending" as const } } : l,
      ),
    });
    recordEvent({
      lineageId: record.lineageId, documentId, kind: "submitted",
      summary: "Sent for review",
      detail: "Nothing was uploaded or transmitted. The record is marked as waiting for a person.",
      organizationId: ctx.organizationId, actorName: ctx.actor.displayNameSnapshot,
    });
    return project(ctx, updated, { link: ownLink(updated, ctx.organizationId) });
  },

  async approve(ctx, documentId) {
    ensureSeeded();
    await wait(300);
    require(ctx, "documents:approve");
    const { record, link } = findWritableOrThrow(ctx, documentId);
    const updated = updateDocument(documentId, {
      status: "approved",
      links: record.links.map((l) =>
        l.id === link.id
          ? {
              ...l,
              review: {
                state: "approved" as const,
                reviewedAt: nowIso(),
                reviewedByName: ctx.actor.displayNameSnapshot,
              },
            }
          : l,
      ),
    });
    recordEvent({
      lineageId: record.lineageId, documentId, kind: "approved",
      summary: "Approved",
      organizationId: ctx.organizationId, actorName: ctx.actor.displayNameSnapshot,
    });
    return project(ctx, updated, { link: ownLink(updated, ctx.organizationId) });
  },

  async reject(ctx, documentId, reason) {
    ensureSeeded();
    await wait(300);
    require(ctx, "documents:approve");
    const trimmed = reason.trim();
    // A rejection nobody can act on is worse than no rejection.
    if (!trimmed) throw new Error("A rejection needs a reason the person can act on.");
    const { record, link } = findWritableOrThrow(ctx, documentId);
    const updated = updateDocument(documentId, {
      status: "rejected",
      links: record.links.map((l) =>
        l.id === link.id
          ? {
              ...l,
              review: {
                state: "rejected" as const,
                reviewedAt: nowIso(),
                reviewedByName: ctx.actor.displayNameSnapshot,
                rejectionReason: trimmed,
              },
            }
          : l,
      ),
    });
    recordEvent({
      lineageId: record.lineageId, documentId, kind: "rejected",
      summary: "Rejected", detail: trimmed,
      organizationId: ctx.organizationId, actorName: ctx.actor.displayNameSnapshot,
    });
    return project(ctx, updated, { link: ownLink(updated, ctx.organizationId) });
  },

  async setExpiry(ctx, documentId, expiresAt) {
    ensureSeeded();
    await wait(200);
    require(ctx, "documents:upload");
    const { record } = findWritableOrThrow(ctx, documentId);
    const updated = updateDocument(documentId, { expiresAt });
    recordEvent({
      lineageId: record.lineageId, documentId, kind: "expiry_set",
      summary: `Expiry recorded: ${expiresAt.slice(0, 10)}`,
      organizationId: ctx.organizationId, actorName: ctx.actor.displayNameSnapshot,
    });
    return project(ctx, updated, { link: ownLink(updated, ctx.organizationId) });
  },

  async link(ctx, input: LinkDocumentInput) {
    ensureSeeded();
    await wait(280);
    require(ctx, "documents:upload");
    const { record } = findWritableOrThrow(ctx, input.documentId);
    if (record.status === "superseded") {
      throw new Error("Link the current version, not a superseded one.");
    }
    // One document, a second typed relationship — never a duplicate upload.
    const updated = addLink(input.documentId, {
      subject: input.subject,
      requirementKey: input.requirementKey,
      contextOrganizationId: ctx.organizationId,
      contextOrganizationName: ctx.organizationName,
      actorName: ctx.actor.displayNameSnapshot,
    });
    return project(ctx, updated, { link: ownLink(updated, ctx.organizationId) });
  },

  async share(ctx, input: ShareDocumentInput) {
    ensureSeeded();
    await wait(280);
    // Handing a document to another organization is an access decision, so it
    // takes the review permission, not the upload one.
    require(ctx, "documents:approve");
    const purpose = input.purpose.trim();
    if (!purpose) throw new Error("Say what the other organization needs it for.");
    if (input.withOrganizationId === ctx.organizationId) {
      throw new Error("A document is already available to the organization that holds it.");
    }
    const { record } = findWritableOrThrow(ctx, input.documentId);
    return shareDocument({
      lineageId: record.lineageId,
      sharedWithOrganizationId: input.withOrganizationId,
      sharedWithName: input.basis.label,
      basis: input.basis,
      purpose,
      canDownload: input.canDownload,
      grantedByName: ctx.actor.displayNameSnapshot,
      organizationId: ctx.organizationId,
    });
  },

  async revokeShare(ctx, shareId, reason) {
    ensureSeeded();
    await wait(240);
    require(ctx, "documents:approve");
    const share = allShares().find((s) => s.id === shareId);
    if (!share) throw new NotFoundError("Share");
    // Only the organization that granted access may take it back.
    const granter = documentsOwnedBy(ctx.organizationId).some((d) => d.lineageId === share.lineageId);
    if (!granter) throw new NotFoundError("Share");
    return revokeInStore(shareId, reason.trim() || "Access ended.", ctx.actor.displayNameSnapshot);
  },

  async listShares(ctx) {
    ensureSeeded();
    await wait(160);
    require(ctx, "documents:view");
    const mine = new Set(documentsOwnedBy(ctx.organizationId).map((d) => d.lineageId));
    return allShares().filter((s) => mine.has(s.lineageId));
  },

  async upgradePlan(ctx, to: WorkspaceKind): Promise<WorkspaceUpgradePlan> {
    ensureSeeded();
    await wait(200);
    require(ctx, "documents:view");
    // The only upgrade that exists: one person's workspace becoming a company.
    if (ctx.workspaceKind !== "individual_dispatcher" || to !== "dispatch_organization") {
      throw new Error(
        "The only upgrade path is an individual dispatch workspace becoming a dispatch organization.",
      );
    }

    const held = documentsOwnedBy(ctx.organizationId).filter((d) => d.status !== "superseded");
    const current = buildChecklist(workspaceRequirements(ctx.workspaceKind), held);
    const target = workspaceRequirements(to);

    // A document already on file for a type the new workspace also asks for is
    // carried forward. The person is not asked for their W-9 twice because
    // their business changed shape.
    const heldTypes = new Map(
      current.filter((i) => i.document).map((i) => [i.document!.typeKey, i]),
    );

    const carriedForward = target
      .filter((r) => heldTypes.has(r.typeKey))
      .map((r) => heldTypes.get(r.typeKey)!);

    const newlyRequired = target.filter((r) => !heldTypes.has(r.typeKey));

    const noLongerRequired = current.filter(
      (i) => i.document && !target.some((r) => r.typeKey === i.document!.typeKey),
    );

    return { from: ctx.workspaceKind, to, carriedForward, newlyRequired, noLongerRequired };
  },
};

/* -------------------------------------------------------------------------- */
/* Read-only window for Needs You                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every checklist line this organization is responsible for, joined to what is
 * on file. Drives the real Needs You items, which is why it is synchronous:
 * the Needs You service composes it rather than awaiting it.
 */
export interface DocumentAttentionRow {
  requirement: DocumentRequirement;
  document?: DocumentRecord;
  status: string;
  subject: DocumentSubjectRef;
}

export function documentAttentionRows(ctx: ServiceContext): DocumentAttentionRow[] {
  ensureSeeded();
  if (!ctx.permissions.has("documents:view")) return [];

  const rows: DocumentAttentionRow[] = [];
  const workspaceSubject: DocumentSubjectRef = {
    kind: "organization",
    id: ctx.organizationId,
    label: ctx.organizationName,
    href: "/documents",
  };

  // The workspace's own checklist, chosen by workspace type. A dispatch
  // organization is never measured against a carrier's requirements.
  //
  // A driver membership is skipped entirely: the carrier's authority and
  // insurance are not a driver's paperwork, and putting them in their queue
  // would be asking somebody to fix what they cannot even see.
  const driverScoped = ctx.scope.loads === "assigned" && Boolean(ctx.driverProfileId);
  if (!driverScoped) {
    const owned = documentsOwnedBy(ctx.organizationId).filter((d) =>
      d.links.some((l) => l.subject.kind === "organization" && l.subject.id === ctx.organizationId),
    );
    for (const item of buildChecklist(workspaceRequirements(ctx.workspaceKind), owned)) {
      rows.push({
        requirement: item.requirement,
        document: item.document,
        status: item.status,
        subject: workspaceSubject,
      });
    }
  }

  // Everything else this organization holds paperwork on: its trucks, its
  // trailers, its drivers. Only documents that exist — a truck the carrier has
  // never added a registration for is the fleet module's business, not a
  // Document Center row with no record behind it.
  for (const record of allDocuments()) {
    if (record.status === "superseded") continue;
    const link = ownLink(record, ctx.organizationId);
    if (!link || link.subject.kind === "organization") continue;
    if (visibility(ctx, record) === null) continue;
    const requirement = requirementFor(link);
    if (!requirement) continue;
    rows.push({
      requirement,
      document: record,
      status: effectiveStatus(record),
      subject: link.subject,
    });
  }

  return rows;
}

export { EXPIRING_SOON_DAYS };
