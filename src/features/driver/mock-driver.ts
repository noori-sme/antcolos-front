"use client";

import type {
  CarrierRelationship,
  DocumentRecord,
  DocumentRequirement,
  DriverDocument,
  DriverProfile,
  EngagementType,
  RelationshipStatus,
} from "@/types";
import { driverRequirements, requirementByKey } from "@/lib/documents/requirements";
import { effectiveStatus } from "@/lib/documents/status";
import {
  clearDocumentsForSubjectKind, createDocument, documentInSlot, documentsForSubject,
  endRelationshipDocuments, recordEvent, replaceDocument, slotKey, updateDocument,
} from "@/lib/api/mock/document-store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Driver profiles and carrier relationships live here in memory for the
 * browser session. Their DOCUMENTS do not: those are rows in the shared
 * document store, the same store that holds truck, trailer and organization
 * paperwork, so a driver's medical card is one record with one identity
 * wherever it is looked at.
 *
 * Nothing is uploaded and no file ever leaves the browser. "Uploading" reads a
 * file's name, type and size — the properties the browser gives us for free —
 * and then throws the file away. There is no storage, no transfer, and nothing
 * is verified by anyone. A real adapter replaces this file; the rest of the
 * feature never learns the difference.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 600;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

let sequence = 0;
const nextId = (p: string) => `${p}_${(++sequence).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* What each carrier asks a driver for                                         */
/* -------------------------------------------------------------------------- */

/**
 * Per-carrier extras. Kept as data so a carrier can ask for something unusual
 * without any code change — the checklist simply grows a row. The standard sets
 * are not restated here: they live in the document domain, with the carrier,
 * dispatch and equipment checklists.
 */
const CARRIER_EXTRA_DOCUMENTS: Record<string, DocumentRequirement[]> = {
  org_northline: [
    {
      key: "northline_handbook",
      setId: "driver",
      typeKey: "signed_handbook",
      subjectKind: "driver",
      label: "Signed driver handbook",
      description: "Northline asks every driver to sign their handbook before the first load.",
      applicability: "required",
      expires: false,
      reason: "Northline asks every driver to sign their handbook before the first load.",
      addedByOrganizationId: "org_northline",
    },
  ],
  org_cascade: [],
};

/** The full checklist for one engagement with one carrier. */
export function documentRequirements(
  engagementType: EngagementType,
  carrierId: string,
): DocumentRequirement[] {
  const standard = driverRequirements(engagementType);
  const extras = CARRIER_EXTRA_DOCUMENTS[carrierId] ?? [];
  const driverPart = standard.filter((r) => r.setId === "driver");
  const ownerPart = standard.filter((r) => r.setId === "owner_operator");
  return [...driverPart, ...extras, ...ownerPart];
}

/* -------------------------------------------------------------------------- */
/* Seed state                                                                  */
/* -------------------------------------------------------------------------- */

function seedProfile(): DriverProfile {
  return {
    id: "dp_sam",
    userId: "usr_sam",
    username: "sam_murtaza",
    legalName: "Sam Murtaza",
    email: "sam@antcolos.com",
    phone: "+1 (312) 555-0148",
    cdlNumber: "K4471182993",
    cdlState: "IL",
    cdlExpiresAt: daysFromNow(210),
    medicalCardExpiresAt: daysFromNow(24),
    createdAt: daysAgo(300),
  };
}

function seedRelationships(): CarrierRelationship[] {
  return [
    {
      id: "rel_cascade",
      driverProfileId: "dp_sam",
      carrierId: "org_cascade",
      carrierName: "Cascade Haul",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      invitedAt: daysAgo(110),
      startedAt: daysAgo(108),
      status: "active",
      sharedDocumentKeys: ["cdl_front", "cdl_back", "medical_front"],
    },
    {
      id: "rel_ridgeway",
      driverProfileId: "dp_sam",
      carrierId: "org_ridgeway",
      carrierName: "Ridgeway Carriers",
      engagementType: "owner_operator",
      roleName: "Driver",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload"],
      invitedAt: daysAgo(430),
      startedAt: daysAgo(425),
      status: "ended",
      endedAt: daysAgo(150),
      endReason: "Driver moved to a different carrier.",
      sharedDocumentKeys: ["cdl_front", "cdl_back", "medical_front", "w9", "coi"],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Documents live in the shared store, keyed by the driver's profile            */
/* -------------------------------------------------------------------------- */

export const DRIVER_PROFILE_ID = "dp_sam";

/**
 * A driver's paperwork belongs to the DRIVER, not to a carrier.
 *
 * That is why the owner is a person: the record follows them between carriers,
 * survives a relationship ending, and is shown to a carrier because it was
 * shared rather than because the carrier holds it.
 */
function driverOwner(profile: DriverProfile | null) {
  return {
    kind: "person" as const,
    id: profile?.userId ?? "usr_sam",
    name: profile?.legalName ?? "Sam Murtaza",
  };
}

function driverSubject(profile: DriverProfile | null) {
  return {
    kind: "driver" as const,
    id: profile?.id ?? DRIVER_PROFILE_ID,
    label: profile?.legalName ?? "Sam Murtaza",
    href: "/driver/documents",
  };
}

interface DriverSeedRow {
  requirementKey: string;
  status: DriverDocument["status"];
  fileName: string;
  fileType: string;
  sizeBytes: number;
  expiresAt?: string;
  rejectionReason?: string;
  submittedAt: string;
  updatedAt: string;
  contextOrganizationId: string;
  contextOrganizationName: string;
}

const DRIVER_SEED_ROWS: DriverSeedRow[] = [
  { requirementKey: "cdl_front", status: "approved", fileName: "cdl-front.jpg", fileType: "image/jpeg", sizeBytes: 1_842_000, expiresAt: daysFromNow(210), submittedAt: daysAgo(107), updatedAt: daysAgo(105), contextOrganizationId: "org_cascade", contextOrganizationName: "Cascade Haul" },
  { requirementKey: "cdl_back", status: "approved", fileName: "cdl-back.jpg", fileType: "image/jpeg", sizeBytes: 1_610_000, submittedAt: daysAgo(107), updatedAt: daysAgo(105), contextOrganizationId: "org_cascade", contextOrganizationName: "Cascade Haul" },
  // Expiring soon is DERIVED from the date, never stored, so it stays true as
  // the clock moves.
  { requirementKey: "medical_front", status: "approved", fileName: "medical-card.pdf", fileType: "application/pdf", sizeBytes: 402_000, expiresAt: daysFromNow(24), submittedAt: daysAgo(107), updatedAt: daysAgo(20), contextOrganizationId: "org_cascade", contextOrganizationName: "Cascade Haul" },
  { requirementKey: "northline_handbook", status: "rejected", fileName: "handbook-scan.pdf", fileType: "application/pdf", sizeBytes: 980_000, rejectionReason: "Page 4 is missing a signature. Please sign every page marked with an X and upload again.", submittedAt: daysAgo(4), updatedAt: daysAgo(2), contextOrganizationId: "org_northline", contextOrganizationName: "Northline Freight" },
];

function seedDocuments(profile: DriverProfile | null) {
  clearDocumentsForSubjectKind("driver");
  if (!profile) return;
  for (const row of DRIVER_SEED_ROWS) {
    const requirement = requirementByKey(row.requirementKey)
      ?? CARRIER_EXTRA_DOCUMENTS.org_northline.find((r) => r.key === row.requirementKey);
    createDocument({
      owner: driverOwner(profile),
      typeKey: requirement?.typeKey ?? "other",
      subject: driverSubject(profile),
      requirementKey: row.requirementKey,
      contextOrganizationId: row.contextOrganizationId,
      contextOrganizationName: row.contextOrganizationName,
      status: row.status,
      file: {
        fileName: row.fileName, fileType: row.fileType,
        sizeBytes: row.sizeBytes, selectedAt: row.submittedAt,
      },
      expiresAt: row.expiresAt,
      addedByName: profile.legalName,
      createdAt: row.submittedAt,
      idSeed: slotKey("driver", profile.id, row.requirementKey),
      reviewedAt: row.updatedAt,
      reviewedByName: row.contextOrganizationName,
      rejectionReason: row.rejectionReason,
    });
  }
}

let PROFILE: DriverProfile | null = seedProfile();
let RELATIONSHIPS: CarrierRelationship[] = seedRelationships();
seedDocuments(PROFILE);

/** Test hook. Never called by the UI. */
export function resetDriverMock(options?: { withProfile?: boolean }) {
  PROFILE = options?.withProfile === false ? null : seedProfile();
  RELATIONSHIPS = options?.withProfile === false ? [] : seedRelationships();
  seedDocuments(PROFILE);
  sequence = 0;
}

/** Turns a stored record into the row the driver screens read. */
function projectDriverDocument(record: DocumentRecord): DriverDocument | undefined {
  const link = record.links.find((l) => l.primary) ?? record.links[0];
  if (!link?.requirementKey) return undefined;
  return {
    requirementKey: link.requirementKey,
    documentId: record.documentId,
    status: effectiveStatus(record),
    fileName: record.file?.fileName,
    fileType: record.file?.fileType,
    sizeBytes: record.file?.sizeBytes,
    expiresAt: record.expiresAt,
    rejectionReason: link.review.rejectionReason,
    submittedAt: link.review.state === "not_required" ? undefined : record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function currentDriverDocument(requirementKey: string): DocumentRecord | undefined {
  return documentInSlot("driver", PROFILE?.id ?? DRIVER_PROFILE_ID, requirementKey);
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export async function mockGetDriverProfile(): Promise<DriverProfile | null> {
  await sleep(250);
  return PROFILE ? { ...PROFILE } : null;
}

export interface QuickOnboardingInput {
  legalName: string;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
}

/**
 * Creates the permanent profile, or reuses the one the person already has.
 *
 * A driver who already has a profile and accepts a second carrier's invitation
 * must not be asked for their licence again, and must certainly not end up with
 * a second Antcolos account.
 */
export async function mockCreateOrGetDriverProfile(
  input: QuickOnboardingInput,
): Promise<DriverProfile> {
  await sleep(LATENCY_MS);
  if (PROFILE) return { ...PROFILE };
  PROFILE = {
    id: nextId("dp"),
    userId: "usr_sam",
    username: "sam_murtaza",
    legalName: input.legalName.trim(),
    email: "sam@antcolos.com",
    cdlNumber: input.cdlNumber.trim().toUpperCase(),
    cdlState: input.cdlState,
    cdlExpiresAt: input.cdlExpiresAt,
    createdAt: iso(now()),
  };
  return { ...PROFILE };
}

/* -------------------------------------------------------------------------- */
/* Relationships                                                               */
/* -------------------------------------------------------------------------- */

export async function mockListRelationships(): Promise<CarrierRelationship[]> {
  await sleep(250);
  return RELATIONSHIPS.map((r) => ({ ...r }));
}

export interface NewRelationshipInput {
  carrierId: string;
  carrierName: string;
  engagementType: EngagementType;
  roleName: string;
  permissions: CarrierRelationship["permissions"];
  sharedDocumentKeys: string[];
}

export async function mockCreateRelationship(
  profileId: string,
  input: NewRelationshipInput,
): Promise<CarrierRelationship> {
  await sleep(LATENCY_MS);
  const relationship: CarrierRelationship = {
    id: nextId("rel"),
    driverProfileId: profileId,
    ...input,
    invitedAt: iso(now()),
    startedAt: iso(now()),
    status: "onboarding",
    sharedDocumentKeys: [...input.sharedDocumentKeys],
  };
  RELATIONSHIPS = [relationship, ...RELATIONSHIPS];
  return { ...relationship };
}

/**
 * Ending a relationship ends the carrier's access and nothing else.
 *
 * The permanent profile, the Antcolos account and every other carrier
 * relationship are untouched. What the carrier was already given stays in their
 * records as a snapshot; what changes afterwards is no longer theirs to see.
 */
export async function mockEndRelationship(
  relationshipId: string,
  reason: string,
): Promise<CarrierRelationship> {
  await sleep(LATENCY_MS);
  const index = RELATIONSHIPS.findIndex((r) => r.id === relationshipId);
  if (index < 0) throw new Error(`No such relationship: ${relationshipId}`);
  const ended: CarrierRelationship = {
    ...RELATIONSHIPS[index],
    status: "ended",
    endedAt: iso(now()),
    endReason: reason.trim(),
  };
  RELATIONSHIPS = RELATIONSHIPS.map((r) => (r.id === ended.id ? ended : r));

  // The carrier's links to the driver's documents are closed and its shares
  // revoked, with a snapshot of each kept. Not one record, version or event is
  // deleted: the carrier still has to be able to show what it held at the time.
  endRelationshipDocuments({
    subjectKind: "driver",
    subjectId: PROFILE?.id ?? DRIVER_PROFILE_ID,
    organizationId: ended.carrierId,
    reason: ended.endReason || "Carrier relationship ended.",
    actorName: PROFILE?.legalName ?? "Driver",
  });

  return { ...ended };
}

export async function mockSetRelationshipStatus(
  relationshipId: string,
  status: RelationshipStatus,
): Promise<CarrierRelationship> {
  await sleep(LATENCY_MS);
  const index = RELATIONSHIPS.findIndex((r) => r.id === relationshipId);
  if (index < 0) throw new Error(`No such relationship: ${relationshipId}`);
  const updated = { ...RELATIONSHIPS[index], status };
  RELATIONSHIPS = RELATIONSHIPS.map((r) => (r.id === updated.id ? updated : r));
  return { ...updated };
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export async function mockListDocuments(): Promise<DriverDocument[]> {
  await sleep(250);
  return driverDocumentRows();
}

function driverDocumentRows(): DriverDocument[] {
  const profileId = PROFILE?.id ?? DRIVER_PROFILE_ID;
  return documentsForSubject("driver", profileId)
    .map(projectDriverDocument)
    .filter((d): d is DriverDocument => Boolean(d));
}

/**
 * The carrier whose checklist a requirement belongs to.
 *
 * The standard driver requirements are asked by whichever carrier the driver is
 * currently working for; a carrier-specific extra is asked by the carrier that
 * added it, and says so.
 */
function contextForRequirement(requirementKey: string): { id: string; name: string } {
  for (const [organizationId, extras] of Object.entries(CARRIER_EXTRA_DOCUMENTS)) {
    if (extras.some((r) => r.key === requirementKey)) {
      const relationship = RELATIONSHIPS.find((r) => r.carrierId === organizationId);
      return { id: organizationId, name: relationship?.carrierName ?? organizationId };
    }
  }
  const live = RELATIONSHIPS.find((r) => r.status !== "ended");
  return { id: live?.carrierId ?? "org_cascade", name: live?.carrierName ?? "Cascade Haul" };
}

/**
 * Records a chosen file against a requirement.
 *
 * Nothing is uploaded. The browser gives a name, a type and a size; the file
 * itself is let go. Choosing a file where one already sits creates a NEW
 * VERSION and keeps the old one — the driver's licence renewal does not erase
 * the licence the carrier approved last year.
 *
 * `onProgress` exists so the screen can show a progress bar over local work; a
 * real adapter reports genuine progress through the same callback.
 */
export async function mockUploadDocument(
  requirementKey: string,
  file: { name: string; type: string; size: number },
  onProgress: (percent: number) => void,
): Promise<DriverDocument> {
  for (let percent = 0; percent <= 100; percent += 20) {
    onProgress(percent);
    await sleep(140);
  }
  const fileRef = {
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    selectedAt: iso(now()),
  };
  const previous = currentDriverDocument(requirementKey);
  const context = contextForRequirement(requirementKey);

  const record = previous
    ? replaceDocument(previous, {
        file: fileRef,
        expiresAt: previous.expiresAt,
        status: "selected_local",
        addedByName: PROFILE?.legalName ?? "Driver",
        contextOrganizationId: context.id,
      })
    : createDocument({
        owner: driverOwner(PROFILE),
        typeKey: requirementByKey(requirementKey)?.typeKey
          ?? CARRIER_EXTRA_DOCUMENTS.org_northline.find((r) => r.key === requirementKey)?.typeKey
          ?? "other",
        subject: driverSubject(PROFILE),
        requirementKey,
        contextOrganizationId: context.id,
        contextOrganizationName: context.name,
        status: "selected_local",
        file: fileRef,
        addedByName: PROFILE?.legalName ?? "Driver",
      });

  return projectDriverDocument(record)!;
}

/**
 * Takes a file back off the checklist before it was ever submitted.
 *
 * Only a document nobody has looked at can be withdrawn, and even then the
 * record and its history stay: the link is ended rather than the row deleted,
 * so what happened is still readable afterwards.
 */
export async function mockRemoveDocument(requirementKey: string): Promise<void> {
  await sleep(250);
  const existing = currentDriverDocument(requirementKey);
  if (!existing) return;
  const link = existing.links.find((l) => l.primary) ?? existing.links[0];
  updateDocument(existing.documentId, {
    status: "superseded",
    links: existing.links.map((l) =>
      l.id === link?.id
        ? { ...l, unlinkedAt: iso(now()), unlinkReason: "Withdrawn by the driver before review." }
        : l,
    ),
  });
  recordEvent({
    lineageId: existing.lineageId, documentId: existing.documentId, kind: "unlinked",
    summary: "Withdrawn before review",
    detail: "The record is kept; only the checklist link was ended.",
    actorName: PROFILE?.legalName ?? "Driver",
  });
}

export async function mockSetDocumentExpiry(
  requirementKey: string,
  expiresAt: string,
): Promise<DriverDocument> {
  await sleep(200);
  const existing = currentDriverDocument(requirementKey);
  if (!existing) throw new Error(`Nothing selected for ${requirementKey}`);
  const updated = updateDocument(existing.documentId, { expiresAt });
  recordEvent({
    lineageId: existing.lineageId, documentId: existing.documentId, kind: "expiry_set",
    summary: `Expiry recorded: ${expiresAt.slice(0, 10)}`,
    actorName: PROFILE?.legalName ?? "Driver",
  });
  return projectDriverDocument(updated)!;
}

/** Hands the document to the carrier for review. Nobody actually reviews it. */
export async function mockSubmitDocument(requirementKey: string): Promise<DriverDocument> {
  await sleep(LATENCY_MS);
  const existing = currentDriverDocument(requirementKey);
  if (!existing) throw new Error(`Nothing selected for ${requirementKey}`);
  const updated = updateDocument(existing.documentId, {
    status: "pending_review",
    links: existing.links.map((l) =>
      l.unlinkedAt ? l : { ...l, review: { state: "pending" as const } },
    ),
  });
  recordEvent({
    lineageId: existing.lineageId, documentId: existing.documentId, kind: "submitted",
    summary: "Sent to the carrier for review",
    detail: "Nothing was uploaded or transmitted. The record is marked as waiting for a person.",
    actorName: PROFILE?.legalName ?? "Driver",
  });
  return projectDriverDocument(updated)!;
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                  */
/* -------------------------------------------------------------------------- */

export interface Completion {
  required: number;
  done: number;
  percent: number;
  outstanding: DocumentRequirement[];
}

/** Selected, pending review and approved all count as "the driver has done it". */
const DONE_STATUSES = new Set(["selected_local", "pending_review", "approved", "expiring_soon"]);

export function completion(
  requirements: readonly DocumentRequirement[],
  documents: readonly DriverDocument[],
): Completion {
  const required = requirements.filter((r) => r.applicability === "required");
  const byKey = new Map(documents.map((d) => [d.requirementKey, d]));
  const outstanding = required.filter((r) => {
    const doc = byKey.get(r.key);
    return !doc || !DONE_STATUSES.has(doc.status);
  });
  const done = required.length - outstanding.length;
  return {
    required: required.length,
    done,
    percent: required.length === 0 ? 100 : Math.round((done / required.length) * 100),
    outstanding,
  };
}
