import {
  QUALIFICATION_CATEGORY_LABEL, RESTRICTED_CATEGORY_REASON,
  RETENTION_MAPPING_UNVERIFIED, isRestrictedQualificationCategory,
  type AuditAction, type DocumentRecord, type DocumentTypeKey,
  type DriverVisibleAdoption, type PermissionKey,
  type QualificationEvidenceRef, type QualificationFilters,
  type QualificationRecord, type QualificationRecordCategory,
  type QualificationRecordView, type QualificationReviewSnapshot,
  type QualificationSourceKind, type RetentionPolicy,
} from "@/types";
import { documentTypeLabel } from "@/lib/documents/catalog";
import { effectiveStatus } from "@/lib/documents/status";
import {
  RETENTION_POLICIES, effectiveRetentionState, initialRetention, isUnderRetention,
  retentionExplanation, retentionOnRelationshipEnd, retentionOnSuperseded,
} from "@/lib/qualification/retention";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AdoptDocumentInput, AdoptionPreview, DisposalInput, QualificationService,
  RecordCarrierEvidenceInput,
} from "../contracts/qualification";
import {
  adoptionOfVersion, adoptionsOfLineage, amendRecord, nextRecordId, putRecord,
  recordById, recordsForDriver, recordsForOrganization,
} from "./qualification-store";
import {
  createDocument, currentVersion, documentById, sharesForLineage,
} from "./document-store";
import { appendAuditEvent, recordCrossOrganizationAttempt } from "./audit";
import { organizationRecordFor } from "./membership-directory";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE driver qualification file service.
 *
 * Four separate facts stay separate here, and the whole module exists to keep
 * them apart:
 *
 *   A. the driver-owned source document and its lineage  → the document store
 *   B. whether this carrier may currently VIEW it        → DocumentShare
 *   C. this carrier's REVIEW of it                       → its own DocumentLink
 *   D. which exact version it RECEIVED AND RELIED ON     → here
 *
 * D is not derivable from any of the others, which is why it is a record. B is
 * revocable by the driver; C is carried forward onto the next version when the
 * driver replaces a file; A is the driver's to change. Only D is frozen, and
 * only D survives revocation — exactly the asymmetry a carrier's record-keeping
 * obligation assumes.
 *
 * ── ISOLATION, PER A6 ──────────────────────────────────────────────────────
 * Reads go through `record.organizationId` and nothing else. No record is ever
 * readable because it NAMES the reader: `driverProfileId` identifies a person
 * the way a `FactScope` carrier field identifies a carrier, and A6 settled that
 * such a field is attribution, never a grant. The single cross-organization
 * read — a driver seeing who adopted their document — rests on the existing
 * self-access basis (`ctx.driverProfileId`), is refused for anybody else, and
 * returns a projection built field by field.
 *
 * ███ WHAT THIS BUILD CANNOT DO ███
 * No file exists, so no file is hashed, stored, deduplicated or held. Retention
 * is expressed as a BASIS and never as a date this build invented. Nothing here
 * is legal advice and nothing here makes Antcolos a compliant DQ-file system:
 * durable encrypted object storage, content hashing, immutable version storage,
 * retention locks, legal holds, record-specific schedules, disposal jobs,
 * server-side authorization and official MVR, Clearinghouse, testing-provider
 * and medical-source verification are all the backend's.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 160;
const wait = () =>
  LATENCY_MS ? new Promise<void>((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve();

function required(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/**
 * ★ THE BACKEND GATE ON DISPOSAL ★
 *
 * Disposal cannot be enabled by supplying a retention date alone. Three things
 * have to exist first, and none of them does here:
 *
 *   1. A VERIFIED mapping from record category to retention rule.
 *   2. A backend policy supplying the applicable period.
 *   3. ENFORCED legal holds — a real hold that blocks disposal while a claim,
 *      an investigation or litigation is open.
 *
 * (3) is the one most easily forgotten, because the field already exists:
 * `QualificationRetention.legalHold` is typed, is read by `isUnderRetention`,
 * and is `false` on every record because nothing in this build can ever set it.
 * A backend that shipped retention dates without hold enforcement would turn a
 * correct refusal into a disposal of evidence somebody was obliged to keep.
 *
 * So the gate is stated here, next to the refusal it explains, and the refusal
 * itself is unconditional in this build.
 */
export const DISPOSAL_BACKEND_GATE =
  "Disposal stays refused until the backend supplies a verified retention mapping, "
  + "an applicable period, AND enforced legal holds. The hold field in this build is "
  + "inert — nothing can set it — so a retention date alone would allow the disposal "
  + "of a record a claim or an investigation required to be kept.";

/** Refusing to discharge an obligation that has not ended. */
export class RetentionActiveError extends Error {
  constructor(readonly until?: string) {
    super(
      until
        ? `This record is under a retention obligation until ${until.slice(0, 10)} and cannot be disposed of.`
        : "This record is still under a retention obligation and cannot be disposed of. "
          + RETENTION_MAPPING_UNVERIFIED + " " + DISPOSAL_BACKEND_GATE,
    );
    this.name = "RetentionActiveError";
  }
}

/** Refusing to pin evidence nobody looked at. */
export class ReviewRequiredError extends Error {
  constructor() {
    super(
      "This carrier has not recorded a review of this exact version. Review it "
      + "first: adopting evidence nobody looked at is the one thing a "
      + "qualification file must never be able to say.",
    );
    this.name = "ReviewRequiredError";
  }
}

/**
 * Refusing a category whose access rules nobody has designed yet.
 *
 * Not a permission error, and deliberately not phrased as one: no permission
 * grants this, and holding every key — as an active Owner does — does not
 * either. The category itself is out of scope for this foundation.
 */
export class RestrictedQualificationCategoryError extends Error {
  constructor(readonly category: QualificationRecordCategory) {
    super(
      `Antcolos will not hold a ${QUALIFICATION_CATEGORY_LABEL[category].toLowerCase()} in this build. `
      + (RESTRICTED_CATEGORY_REASON[category] ?? "")
      + " No permission changes this: the restriction is on the record category, not on the reader.",
    );
    this.name = "RestrictedQualificationCategoryError";
  }
}

/** Refusing to claim a verification nobody performed. */
export class UnsupportedVerificationClaimError extends Error {
  constructor(readonly source: QualificationSourceKind) {
    super(
      `Antcolos cannot record "${source}" without naming the source it came from. `
      + "No integration in this build pulls a record from a licensing authority, "
      + "a testing provider or a background-check provider.",
    );
    this.name = "UnsupportedVerificationClaimError";
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the neighbouring facts                                              */
/* -------------------------------------------------------------------------- */

/**
 * This carrier's own review of this exact version, read from its own link.
 *
 * Read, never written: the review stays the Document Center's, and a copy of it
 * is frozen onto the adoption so the file can show what was relied on even
 * after the live link has moved on to a newer version.
 */
function carrierReviewOf(
  record: DocumentRecord,
  organizationId: string,
): { linkId: string; outcome: "accepted" | "rejected"; at: string; byName: string } | undefined {
  // EVERY live link this organization holds, not the first one.
  //
  // One organization can legitimately hold more than one live link on a
  // version: `replaceDocument` carries its existing links forward with the
  // review reset, and a review recorded through the share inbox adds its own.
  // Asking only the first would answer "nobody reviewed this" while the
  // carrier's actual decision sat on the next link along — so the question is
  // asked of all of them, and the most recent decision is the one relied on.
  const decided = record.links
    .filter((l) => !l.unlinkedAt
      && l.contextOrganizationId === organizationId
      && (l.review.state === "approved" || l.review.state === "rejected"))
    .sort((a, b) => (b.review.reviewedAt ?? "").localeCompare(a.review.reviewedAt ?? ""));

  const link = decided[0];
  if (!link) return undefined;
  return {
    linkId: link.id,
    outcome: link.review.state === "approved" ? "accepted" : "rejected",
    at: link.review.reviewedAt ?? record.updatedAt,
    byName: link.review.reviewedByName ?? "A reviewer",
  };
}

/** True when this carrier may currently see the lineage through a live share. */
function hasLiveShare(lineageId: string, organizationId: string): boolean {
  return sharesForLineage(lineageId).some(
    (s) => !s.revokedAt && s.sharedWithOrganizationId === organizationId,
  );
}

/**
 * The live version of the pinned lineage, when it is newer.
 *
 * Used only to SAY that a newer version exists — never to move an adoption onto
 * it. Moving is always a second, explicit adoption.
 */
function newerVersionThan(evidence: QualificationEvidenceRef): DocumentRecord | undefined {
  const live = currentVersion(evidence.lineageId);
  if (!live) return undefined;
  return live.version > evidence.documentVersion ? live : undefined;
}

function pinEvidence(record: DocumentRecord): QualificationEvidenceRef {
  return {
    documentId: record.documentId,
    lineageId: record.lineageId,
    documentVersion: record.version,
    typeKey: record.typeKey,
    label: documentTypeLabel(record.typeKey),
    fileName: record.file?.fileName,
    // A frontend cannot read a file, so it cannot hash one. Saying so beats an
    // empty field somebody eventually reads as "verified".
    integrityBasis: "not_available_in_mock",
    statusAtAdoption: effectiveStatus(record),
    expiresAt: record.expiresAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Projection and scope                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Why this membership may not dispose of this record, or `undefined` when it
 * may. Computed once, so the screen's button and the service's refusal can
 * never disagree.
 *
 * There is deliberately NO rule here that the adopter may not dispose. A solo
 * Carrier Owner is one person, and a mandatory second pair of hands would leave
 * them permanently unable to discharge an obligation that has ended. A
 * configurable two-person policy is a later, larger-organization feature; the
 * foundation's rule is the one that matters: an obligation that still stands
 * always refuses.
 */
function disposalRefusalFor(
  ctx: ServiceContext,
  record: QualificationRecord,
): string | undefined {
  if (record.retention.state === "disposed") return "This record has already been disposed of.";
  if (!ctx.permissions.has("qualification:dispose")) {
    return "You do not have the authority to decide about disposal.";
  }
  if (isUnderRetention(record.retention)) {
    return record.retention.retainUntil
      ? `Retention runs to ${record.retention.retainUntil.slice(0, 10)}.`
      : RETENTION_MAPPING_UNVERIFIED;
  }
  // Reached only if a backend supplied a date. Legal holds are not enforced in
  // this build, so a date alone is not enough to let a record go.
  if (!record.retention.legalHold) return DISPOSAL_BACKEND_GATE;
  return undefined;
}

function project(ctx: ServiceContext, record: QualificationRecord): QualificationRecordView {
  const newer = record.origin === "driver_provided"
    ? newerVersionThan(record.evidence)
    : undefined;
  const blocked = disposalRefusalFor(ctx, record);
  return {
    record,
    retentionState: effectiveRetentionState(record.retention),
    retentionExplanation: retentionExplanation(record),
    newerVersionAvailable: newer !== undefined,
    newerDocumentId: newer?.documentId,
    shareEnded: record.origin === "driver_provided"
      && !hasLiveShare(record.evidence.lineageId, record.organizationId),
    canAuthorizeDisposal: blocked === undefined,
    disposalBlockedReason: blocked,
  };
}

/**
 * ★ THE ONE READ GATE ★
 *
 * Every path that returns a qualification record to anybody goes through this.
 * It is checked BEFORE permissions and independently of them, because the
 * restriction is a property of the record category rather than of the reader —
 * an Owner holds every permission and still does not get past it.
 *
 * A write path may legitimately touch a restricted record: moving one into
 * retention when a relationship ends keeps the record correct and discloses
 * nothing. Those paths say so at the call site.
 */
function readable(record: QualificationRecord): boolean {
  return !isRestrictedQualificationCategory(record.category);
}

/**
 * One record, or the same answer an invented id gets.
 *
 * Another carrier's adoption is not "forbidden" — a carrier may not learn that
 * another carrier's qualification record exists at all, which is the rule the
 * share inbox and the Document Center already keep. The attempt is recorded in
 * the one ledger, which this service can do honestly because it holds a
 * `ServiceContext`.
 */
function own(ctx: ServiceContext, recordId: string): QualificationRecord {
  const record = recordById(recordId);
  if (!record) throw new NotFoundError(`Qualification record ${recordId}`);
  // A restricted category answers exactly as an unknown id does. Telling the
  // caller "it exists but you may not see it" is itself a disclosure about a
  // record whose access rules nobody has settled.
  if (!readable(record)) throw new NotFoundError(`Qualification record ${recordId}`);
  if (record.organizationId !== ctx.organizationId) {
    recordCrossOrganizationAttempt(ctx, {
      entity: { kind: "qualification_record", id: recordId, label: "Qualification record" },
      summary: "Attempted to read a qualification record belonging to another organization.",
    });
    throw new NotFoundError(`Qualification record ${recordId}`);
  }
  return record;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

function audit(
  ctx: ServiceContext,
  action: AuditAction,
  record: QualificationRecord,
  summary: string,
  sourceAction: string,
): void {
  // The same and only write path into the one ledger, called directly so the
  // line exists by the time the command returns. An adoption whose audit entry
  // lands a tick later is an adoption an auditor can catch unrecorded.
  try {
    appendAuditEvent(ctx, {
      module: "compliance",
      action,
      sourceAction,
      entity: {
        kind: "qualification_record",
        id: record.id,
        label: `${QUALIFICATION_CATEGORY_LABEL[record.category]} · ${record.driverName}`,
        href: `/workforce/qualification/${record.id}`,
      },
      relatedEntities: [
        {
          kind: "document",
          id: record.evidence.documentId,
          label: `${record.evidence.label} v${record.evidence.documentVersion}`,
          href: `/documents/${record.evidence.documentId}`,
        },
        { kind: "driver", id: record.driverProfileId, label: record.driverName },
      ],
      summary,
    });
  } catch {
    // A ledger that cannot be written is not a reason to refuse somebody a
    // qualification decision — the same rule the responsibility engine keeps.
  }
}

/* -------------------------------------------------------------------------- */
/* Adoption                                                                    */
/* -------------------------------------------------------------------------- */

/** Sources a caller may state without naming an outside party. */
const SELF_EVIDENT_SOURCES: QualificationSourceKind[] = [
  "driver_self_provided", "carrier_generated",
];

export function adoptSync(ctx: ServiceContext, input: AdoptDocumentInput): QualificationRecord {
  required(ctx, "qualification:view", "compliance:manage");

  // Refused before anything is created. A record nobody may read is worse than
  // no record: it would exist, be invisible, and still be undisposable.
  if (isRestrictedQualificationCategory(input.category)) {
    throw new RestrictedQualificationCategoryError(input.category);
  }

  const document = documentById(input.documentId);
  if (!document) throw new NotFoundError(`Document ${input.documentId}`);

  // A source that claims an authority must name it, and no integration in this
  // build can. Refused rather than quietly downgraded: a silent downgrade is
  // how a file ends up saying something nobody chose.
  const source = input.source ?? "driver_self_provided";
  if (!SELF_EVIDENT_SOURCES.includes(source) && !input.sourceDetail?.trim()) {
    throw new UnsupportedVerificationClaimError(source);
  }

  // Idempotent by exact version: a double click, a retried command or a second
  // reviewer pressing the same button produces ONE adoption and one history
  // entry. The pinned version is the identity — the same rule A6 gives the bus,
  // where a republished event is the same event.
  const already = adoptionOfVersion(ctx.organizationId, document.documentId);
  if (already) return already;

  const review = carrierReviewOf(document, ctx.organizationId);
  if (!review) throw new ReviewRequiredError();

  const at = nowIso();
  const previous = adoptionsOfLineage(ctx.organizationId, document.lineageId)
    .find((r) => !r.supersededByRecordId && r.retention.state !== "disposed");

  const frozenReview: QualificationReviewSnapshot = {
    outcome: review.outcome,
    reviewedAt: review.at,
    reviewedByMembershipId: ctx.membershipId,
    reviewedByName: review.byName,
    note: input.note,
    documentLinkId: review.linkId,
  };

  const record: QualificationRecord = {
    id: nextRecordId(),
    organizationId: ctx.organizationId,
    driverProfileId: input.driverProfileId,
    driverName: document.owner.name,
    engagementId: input.engagementId,
    category: input.category,
    origin: document.organizationId === ctx.organizationId
      ? "carrier_originated"
      : "driver_provided",
    purpose: input.purpose,
    evidence: pinEvidence(document),
    source,
    sourceDetail: input.sourceDetail,
    // Reviewing is not verifying, and this line is what keeps the two apart
    // everywhere the record is rendered.
    verification: "carrier_reviewed",
    review: frozenReview,
    receivedAt: at,
    adoptedAt: at,
    adoptedByMembershipId: ctx.membershipId,
    adoptedByName: ctx.actor.displayNameSnapshot,
    sourceSharePackageId: input.sharePackageId,
    retention: initialRetention(input.category, at),
    supersedesRecordId: previous?.id,
    history: [{
      id: `${at}_adopted`,
      at,
      kind: "adopted",
      summary: `Adopted ${documentTypeLabel(document.typeKey)} version ${document.version} into the qualification file`,
      detail: previous
        ? `Supersedes the record for version ${previous.evidence.documentVersion}, which is kept.`
        : undefined,
      actorMembershipId: ctx.membershipId,
      actorName: ctx.actor.displayNameSnapshot,
    }],
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
  putRecord(record);

  // The previous decision is NOT rewritten. It is marked superseded, keeps its
  // own pinned version and its own frozen review, and stays readable forever.
  if (previous) {
    amendRecord(previous.id, {
      supersededByRecordId: record.id,
      retention: retentionOnSuperseded(previous.retention, at),
    }, {
      kind: "superseded_by_adoption",
      summary: `Superseded by the adoption of version ${document.version}`,
      detail: "This record still shows exactly what was relied on at the time.",
      actorMembershipId: ctx.membershipId,
      actorName: ctx.actor.displayNameSnapshot,
    });
    audit(ctx, "compliance.qualification_superseded", recordById(previous.id)!,
      `Qualification record for ${previous.evidence.label} v${previous.evidence.documentVersion} superseded`,
      "qualification.superseded");
  }

  audit(ctx, "compliance.qualification_adopted", record,
    `Adopted ${record.evidence.label} version ${record.evidence.documentVersion} into the qualification file`,
    "qualification.adopted");
  return record;
}

/**
 * Starts the retention clock when a working relationship ends.
 *
 * Called by workforce offboarding. It DELETES NOTHING: every record stays, its
 * pinned evidence stays, and what changes is that an obligation which could not
 * start while the person was working here now has a start date. Idempotent — a
 * record already in `relationship_ended_retained` is left alone, so re-running
 * a half-finished offboarding does not append a second line.
 */
export function applyRelationshipEndToQualificationFile(
  ctx: ServiceContext,
  driverProfileId: string,
  at: string = nowIso(),
): number {
  let changed = 0;
  // Deliberately NOT filtered by `readable`: this is a write, and it discloses
  // nothing. A restricted record still has to move into retention when the
  // relationship ends, or it would sit reading "active evidence" forever.
  for (const record of recordsForDriver(driverProfileId)) {
    // Narrowed to the acting organization on the line after the cross-
    // organization read, exactly as that store's comment requires.
    if (record.organizationId !== ctx.organizationId) continue;
    if (record.retention.state === "disposed") continue;
    if (record.retention.state === "relationship_ended_retained") continue;
    amendRecord(record.id, {
      retention: retentionOnRelationshipEnd(record.retention, at),
    }, {
      kind: "relationship_ended",
      summary: "The working relationship ended; the retention obligation runs from this date.",
      detail: "The record is kept. Ordinary operational access to it has ended.",
      actorMembershipId: ctx.membershipId,
      actorName: ctx.actor.displayNameSnapshot,
    });
    audit(ctx, "compliance.qualification_retention_changed", recordById(record.id)!,
      `Retention started for ${record.evidence.label} after the relationship ended`,
      "qualification.relationship_ended");
    changed += 1;
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Needs You input                                                             */
/* -------------------------------------------------------------------------- */

/** Records whose pinned version the driver has since replaced. */
export function recordsWithNewerVersion(organizationId: string): QualificationRecord[] {
  return recordsForOrganization(organizationId).filter((r) => {
    // Never raise work about a record nobody may open.
    if (!readable(r)) return false;
    if (r.supersededByRecordId) return false;
    if (r.retention.state === "disposed") return false;
    if (r.origin !== "driver_provided") return false;
    return newerVersionThan(r.evidence) !== undefined;
  });
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

/** The Document Center type a carrier-originated record is filed under. */
function typeKeyFor(category: QualificationRecordCategory): DocumentTypeKey {
  switch (category) {
    case "employment_application": return "employment_application";
    case "motor_vehicle_record":
    case "annual_mvr_review": return "mvr";
    case "commercial_licence": return "cdl";
    case "medical_certificate": return "medical_card";
    case "handbook_acknowledgement": return "signed_handbook";
    default: return "other";
  }
}

function toDriverVisible(record: QualificationRecord): DriverVisibleAdoption {
  // ★ BUILT FIELD BY FIELD ★
  // Product decision 5: the driver sees the version, the general purpose, the
  // date and the retention status. Constructing this by PICKING fields rather
  // than by deleting them from the record means a field added next year is
  // private by default instead of leaking on the day it lands. Nothing from
  // `review`, `sourceDetail` or `retention.stateReason` is reachable from here.
  return {
    organizationId: record.organizationId,
    organizationName:
      organizationRecordFor(record.organizationId)?.displayName ?? record.organizationId,
    category: record.category,
    purpose: record.purpose,
    lineageId: record.evidence.lineageId,
    documentId: record.evidence.documentId,
    documentVersion: record.evidence.documentVersion,
    adoptedAt: record.adoptedAt,
    retentionState: effectiveRetentionState(record.retention),
    retentionExplanation:
      "This carrier kept a record of the exact version it received. Withdrawing the "
      + "share stops future access; it does not erase a record the carrier is "
      + "obliged to keep.",
  };
}

export const mockQualificationService: QualificationService = {
  async list(ctx, filters: QualificationFilters = {}) {
    await wait();
    required(ctx, "qualification:view");
    return recordsForOrganization(ctx.organizationId)
      .filter((r) => {
        if (!readable(r)) return false;
        if (!filters.includeDisposed && r.retention.state === "disposed") return false;
        if (filters.driverProfileId && r.driverProfileId !== filters.driverProfileId) return false;
        if (filters.engagementId && r.engagementId !== filters.engagementId) return false;
        if (filters.category?.length && !filters.category.includes(r.category)) return false;
        if (filters.retentionState?.length
          && !filters.retentionState.includes(effectiveRetentionState(r.retention))) return false;
        return true;
      })
      .map((r) => project(ctx, r));
  },

  async get(ctx, recordId) {
    await wait();
    required(ctx, "qualification:view");
    return project(ctx, own(ctx, recordId));
  },

  async previewAdoption(ctx, documentId): Promise<AdoptionPreview> {
    await wait();
    required(ctx, "qualification:view");
    const document = documentById(documentId);
    if (!document) throw new NotFoundError(`Document ${documentId}`);
    const already = adoptionOfVersion(ctx.organizationId, documentId);
    const previous = adoptionsOfLineage(ctx.organizationId, document.lineageId)
      .filter(readable)
      .find((r) => !r.supersededByRecordId && r.retention.state !== "disposed");

    return {
      documentId,
      lineageId: document.lineageId,
      documentVersion: document.version,
      label: documentTypeLabel(document.typeKey),
      alreadyAdopted: already !== undefined,
      supersedesRecordId: previous?.id,
      supersedesVersion: previous?.evidence.documentVersion,
      retentionSummary: RETENTION_MAPPING_UNVERIFIED,
      consequences: [
        "This creates a record belonging to THIS carrier, pinned to this exact version. No copy of the file is made and the driver keeps their document.",
        // Said plainly, because "adopt into the qualification file" sounds
        // exactly like taking a copy, and this build does not take one.
        "What is kept is a record of WHICH version you relied on — its identity, its version number, its file name, its state and your review. Antcolos does not store any file in this build, so this is not evidence custody: retaining the document itself needs the backend's durable storage.",
        "If the driver later withdraws the share, or the relationship ends, this record is kept: a carrier's qualification history is not the driver's to erase.",
        "The record stays under a retention obligation. Antcolos has not verified which retention rule applies to this record category, so it states no period and refuses disposal until a backend policy supplies a verified one.",
        "Adopting is not verifying. It records that this carrier reviewed this version — not that any authority confirmed it.",
      ],
    };
  },

  async adopt(ctx, input) {
    await wait();
    return project(ctx, adoptSync(ctx, input));
  },

  async recordCarrierEvidence(ctx, input: RecordCarrierEvidenceInput) {
    await wait();
    required(ctx, "qualification:view", "compliance:manage", "documents:upload");

    if (isRestrictedQualificationCategory(input.category)) {
      throw new RestrictedQualificationCategoryError(input.category);
    }

    // Carrier-originated evidence is by definition not the driver's upload.
    if (input.source === "driver_self_provided") {
      throw new UnsupportedVerificationClaimError(input.source);
    }
    if (input.source !== "carrier_generated" && !input.sourceDetail?.trim()) {
      throw new UnsupportedVerificationClaimError(input.source);
    }

    const at = nowIso();
    // ONE Document Center. Carrier-originated evidence is a document like any
    // other — owned by the organization, linked in its own context, and never
    // placed in the driver's editable wallet.
    const document = createDocument({
      owner: { kind: "organization", id: ctx.organizationId, name: ctx.organizationName },
      organizationId: ctx.organizationId,
      typeKey: typeKeyFor(input.category),
      subject: {
        kind: "driver",
        id: input.driverProfileId,
        label: input.driverProfileId,
        href: `/people/drivers/${input.driverProfileId}`,
      },
      contextOrganizationId: ctx.organizationId,
      contextOrganizationName: ctx.organizationName,
      status: "approved",
      file: {
        fileName: input.file.name,
        fileType: input.file.type,
        sizeBytes: input.file.size,
        selectedAt: at,
      },
      addedByName: ctx.actor.displayNameSnapshot,
      addedByMembershipId: ctx.membershipId,
      reviewedAt: at,
      reviewedByName: ctx.actor.displayNameSnapshot,
    });

    return project(ctx, adoptSync(ctx, {
      documentId: document.documentId,
      driverProfileId: input.driverProfileId,
      category: input.category,
      purpose: input.purpose,
      engagementId: input.engagementId,
      source: input.source,
      sourceDetail: input.sourceDetail,
      note: input.note,
    }));
  },

  async retentionPolicies(ctx): Promise<readonly RetentionPolicy[]> {
    await wait();
    required(ctx, "qualification:view");
    return RETENTION_POLICIES;
  },

  async authorizeDisposal(ctx, recordId, _input: DisposalInput) {
    await wait();
    // `_input` is unused on purpose: the reason a person gives is recorded only
    // when a disposal actually happens, and none can in this build.
    void _input;
    required(ctx, "qualification:view", "qualification:dispose");
    const record = own(ctx, recordId);

    // Already gone. Idempotent rather than an error: a retry after a disposal
    // that went through is not a second disposal.
    if (record.retention.state === "disposed") return project(ctx, record);

    // ★ DISPOSAL IS REFUSED IN THIS BUILD, UNCONDITIONALLY ★
    //
    // Two independent reasons, and BOTH have to be answered by the backend
    // before this command can ever succeed:
    //
    //   • No verified mapping and no policy, so nothing can establish that an
    //     obligation has ended. `isUnderRetention` is true for every record.
    //   • No enforced legal holds. `legalHold` is inert here, so even a record
    //     past a supplied date might be one a claim or an investigation
    //     requires to be kept, and nothing in this build could tell.
    //
    // There is deliberately NO rule about who adopted the record: a mandatory
    // second pair of hands would leave a solo Carrier Owner permanently unable
    // to discharge an obligation that had genuinely ended. What refuses here is
    // the missing policy and the missing hold, never the identity of the caller.
    //
    // The write path below is kept, and kept correct, so that enabling disposal
    // is a matter of the backend answering both — not of writing it then.
    // The write path is NOT kept here. Dead code waiting for a policy is code
    // nobody maintains and everybody trusts; when the backend answers both
    // questions, disposal is written against what it actually supplies.
    throw new RetentionActiveError(record.retention.retainUntil);
  },

  async adoptionsForDriver(ctx, driverProfileId): Promise<DriverVisibleAdoption[]> {
    await wait();
    // The ONE cross-organization read, and it rests on the existing self-access
    // basis rather than on a record naming the caller: this membership IS that
    // driver. Anybody else gets their own organization's records only, gated on
    // `qualification:view` like every other carrier-side read.
    if (ctx.driverProfileId === driverProfileId) {
      return recordsForDriver(driverProfileId).filter(readable).map(toDriverVisible);
    }
    required(ctx, "qualification:view");
    return recordsForDriver(driverProfileId)
      .filter((r) => r.organizationId === ctx.organizationId)
      .filter(readable)
      .map(toDriverVisible);
  },
};
