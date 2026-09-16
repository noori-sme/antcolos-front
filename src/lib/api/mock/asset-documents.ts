import {
  documentUuid, createDocument, currentVersion, documentById, documentsForSubject,
  documentInSlot, recordEvent, replaceDocument, slotKey, updateDocument,
  type CreateDocumentInput,
} from "./document-store";
import { effectiveStatus } from "@/lib/documents/status";
import type {
  DocumentRecord, DocumentStatus, DocumentSubjectKind, DocumentTypeKey,
} from "@/types";

/**
 * The bridge between the asset registries and THE document store.
 *
 * Trucks and trailers keep their own record shapes — `TruckDocument`,
 * `TrailerDocument` — because the fleet screens are built against them and a
 * rename would be churn with no user visible. What changed is where the rows
 * come from: they are now projections of the one shared record, not a second
 * copy of it. Add a truck document and the Document Center sees it; approve it
 * in the Document Center and the truck profile shows it approved.
 *
 * Everything here is unauthorized on purpose. The registries do their own
 * access checks before calling in, exactly as they did before.
 */

/** The row shape both asset registries project into. */
export interface AssetDocumentRow<K extends string> {
  id: string;
  kind: K;
  status: DocumentStatus;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  expiresAt?: string;
  rejectionReason?: string;
  supersededByDocumentId?: string;
  addedByOrganizationId: string;
  /** Set when the document belongs to one carrier's onboarding, not the asset. */
  carrierOrganizationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDocumentAdapter<K extends string> {
  subjectKind: DocumentSubjectKind;
  /** The checklist slot a kind fills. One live document per kind per asset. */
  requirementKey: (kind: K) => string;
  typeKey: (kind: K) => DocumentTypeKey;
  /** Recovers the asset's kind from a stored requirement key. */
  kindFromRequirementKey: (key: string) => K | undefined;
}

function primaryLink(record: DocumentRecord) {
  return record.links.find((l) => l.primary) ?? record.links[0];
}

export function projectAssetDocument<K extends string>(
  adapter: AssetDocumentAdapter<K>,
  record: DocumentRecord,
  now: Date = new Date(),
): AssetDocumentRow<K> | undefined {
  const link = primaryLink(record);
  if (!link) return undefined;
  const kind = link.requirementKey
    ? adapter.kindFromRequirementKey(link.requirementKey)
    : undefined;
  if (!kind) return undefined;
  return {
    id: record.documentId,
    kind,
    status: effectiveStatus(record, now),
    fileName: record.file?.fileName,
    fileType: record.file?.fileType,
    sizeBytes: record.file?.sizeBytes,
    expiresAt: record.expiresAt,
    rejectionReason: link.review.rejectionReason,
    supersededByDocumentId: record.supersededByDocumentId,
    // Asset links always name the organization that asked for them; the
    // optional field exists for person-owned documents, which never reach here.
    addedByOrganizationId: link.contextOrganizationId ?? "",
    carrierOrganizationId: link.contextPrivate ? link.contextOrganizationId : undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Every document on one asset, including superseded versions. */
export function assetDocumentRows<K extends string>(
  adapter: AssetDocumentAdapter<K>,
  assetId: string,
  now: Date = new Date(),
): AssetDocumentRow<K>[] {
  return documentsForSubject(adapter.subjectKind, assetId, { includeSuperseded: true })
    .map((r) => projectAssetDocument(adapter, r, now))
    .filter((r): r is AssetDocumentRow<K> => Boolean(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface SeedAssetDocumentInput<K extends string> {
  assetId: string;
  assetLabel: string;
  assetHref?: string;
  kind: K;
  status: DocumentStatus;
  organizationId: string;
  organizationName: string;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  expiresAt?: string;
  rejectionReason?: string;
  contextPrivate?: boolean;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Seeds a fixture document into the shared store.
 *
 * "expiring_soon" and "expired" are never STORED: they are what an approved
 * document with a near or past expiry evaluates to, and storing them would rot
 * the moment the clock moved. A fixture that asks for one is stored as approved
 * with the date that produces it.
 */
export function seedAssetDocument<K extends string>(
  adapter: AssetDocumentAdapter<K>,
  input: SeedAssetDocumentInput<K>,
): DocumentRecord {
  const stored: DocumentStatus =
    input.status === "expiring_soon" || input.status === "expired" ? "approved" : input.status;

  const payload: CreateDocumentInput = {
    owner: { kind: "organization", id: input.organizationId, name: input.organizationName },
    organizationId: input.organizationId,
    typeKey: adapter.typeKey(input.kind),
    subject: {
      kind: adapter.subjectKind,
      id: input.assetId,
      label: input.assetLabel,
      href: input.assetHref,
    },
    requirementKey: adapter.requirementKey(input.kind),
    contextOrganizationId: input.organizationId,
    contextOrganizationName: input.organizationName,
    status: stored,
    file: input.fileName
      ? {
          fileName: input.fileName,
          fileType: input.fileType ?? (input.fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
          sizeBytes: input.sizeBytes ?? 820_000,
          selectedAt: input.createdAt,
        }
      : undefined,
    expiresAt: input.expiresAt,
    addedByName: input.organizationName,
    createdAt: input.createdAt,
    // Stable across reloads, so a link to a fixture document keeps working.
    idSeed: slotKey(adapter.subjectKind, input.assetId, adapter.requirementKey(input.kind)),
    rejectionReason: input.rejectionReason,
    reviewedByName: stored === "approved" || stored === "rejected" ? input.organizationName : undefined,
    reviewedAt: input.updatedAt ?? input.createdAt,
  };

  const record = createDocument(payload);
  if (input.contextPrivate) {
    updateDocument(record.documentId, {
      links: record.links.map((l) => ({ ...l, contextPrivate: true })),
    });
  }
  if (input.updatedAt) {
    updateDocument(record.documentId, {});
    // Fixture rows carry their own updatedAt so seeded history reads as history.
    const stored2 = documentById(record.documentId);
    if (stored2) stored2.updatedAt = input.updatedAt;
  }
  return documentById(record.documentId)!;
}

export interface AddAssetDocumentInput<K extends string> {
  assetId: string;
  assetLabel: string;
  assetHref?: string;
  kind: K;
  file: { name: string; type?: string; size?: number };
  organizationId: string;
  organizationName: string;
  actorName: string;
  membershipId?: string;
  expiresAt?: string;
  contextPrivate?: boolean;
}

/**
 * Adds a document to an asset, or replaces the one already in that slot.
 *
 * Replacement creates a NEW version and keeps the old one — the registries no
 * longer implement this themselves, so truck, trailer, driver and organization
 * documents all version identically by construction.
 */
export function addAssetDocument<K extends string>(
  adapter: AssetDocumentAdapter<K>,
  input: AddAssetDocumentInput<K>,
): { record: DocumentRecord; replaced: boolean } {
  const requirementKey = adapter.requirementKey(input.kind);
  const previous = documentInSlot(adapter.subjectKind, input.assetId, requirementKey);
  const file = {
    fileName: input.file.name,
    fileType: input.file.type || "application/octet-stream",
    sizeBytes: input.file.size ?? 0,
    selectedAt: new Date().toISOString(),
  };

  if (previous) {
    const next = replaceDocument(previous, {
      file,
      expiresAt: input.expiresAt,
      status: "selected_local",
      addedByName: input.actorName,
      addedByMembershipId: input.membershipId,
      contextOrganizationId: input.organizationId,
    });
    return { record: next, replaced: true };
  }

  const record = createDocument({
    owner: { kind: "organization", id: input.organizationId, name: input.organizationName },
    organizationId: input.organizationId,
    typeKey: adapter.typeKey(input.kind),
    subject: {
      kind: adapter.subjectKind,
      id: input.assetId,
      label: input.assetLabel,
      href: input.assetHref,
    },
    requirementKey,
    contextOrganizationId: input.organizationId,
    contextOrganizationName: input.organizationName,
    status: "selected_local",
    file,
    expiresAt: input.expiresAt,
    addedByName: input.actorName,
    addedByMembershipId: input.membershipId,
  });
  if (input.contextPrivate) {
    updateDocument(record.documentId, {
      links: record.links.map((l) => ({ ...l, contextPrivate: true })),
    });
  }
  return { record: documentById(record.documentId)!, replaced: false };
}

/** Hands a document over for review. Nobody actually reviews it in this build. */
export function submitAssetDocument(documentId: string, actorName: string, organizationId: string): DocumentRecord {
  const existing = documentById(documentId);
  if (!existing) throw new Error(`No such document: ${documentId}`);
  const updated = updateDocument(documentId, {
    status: "pending_review",
    links: existing.links.map((l) =>
      l.contextOrganizationId === organizationId && !l.unlinkedAt
        ? { ...l, review: { state: "pending" as const } }
        : l,
    ),
  });
  recordEvent({
    lineageId: existing.lineageId, documentId, kind: "submitted",
    summary: "Sent for review",
    detail: "Nothing was uploaded or transmitted. The record is marked as waiting for a person.",
    organizationId, actorName,
  });
  return updated;
}

export { documentUuid, currentVersion };
