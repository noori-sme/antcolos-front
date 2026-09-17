import type { IsoDateTime } from "./common";
import type { DocumentStatus, DocumentTypeKey } from "./document-center";

/**
 * ★ CARRIER CUSTODY OF A DOCUMENT IT RELIED ON ★
 *
 * The one fact the Document Center could not hold.
 *
 * Antcolos already answers three questions about a driver's licence, and
 * answers them well:
 *
 *   DocumentRecord   whose document it is, and every version of it. The driver
 *                    owns the lineage and may add a newer version at any time.
 *   DocumentShare    whether a carrier may CURRENTLY view that lineage. Scoped,
 *                    revocable, and it proves nothing about qualification.
 *   DocumentLink     one organization's review of the document, in its own
 *                    context, separate from every other organization's.
 *
 * None of them answers the fourth question, which is the one a motor carrier is
 * asked in an audit: *which exact version did we receive, look at and rely on
 * when we decided this person was qualified, and are we still obliged to keep
 * it?*
 *
 * A `DocumentLink` cannot answer it. Links are carried FORWARD onto the next
 * version when the driver replaces a document — see `replaceDocument` in the
 * document store — which is right for access and wrong for evidence: a carrier
 * that had reviewed version 2 would silently read as holding version 3. A
 * `DocumentShare` cannot answer it either: it is revocable by the driver, and a
 * record the subject can make disappear is not a record. `ComplianceSnapshot`
 * is per-requirement and only taken when a relationship ends, so it cannot pin
 * what was relied on at the moment of the decision. `DocumentSnapshot` is
 * deliberately thin: no carrier, no review, no retention.
 *
 * So this record exists, and it is deliberately small. It stores NO file, NO
 * second document identity and NO second review system: the evidence below is a
 * pinned REFERENCE to one `DocumentRecord` version that already exists, and the
 * review is an immutable copy of what the carrier's own `DocumentLink` said at
 * the moment of adoption. One binary object, many custodians.
 *
 * ███ FRONTEND ONLY — WHAT THIS IS NOT ███
 * This is not a compliant Driver Qualification File system and nothing here is
 * legal advice. Durable storage, content hashing, retention locks, legal holds,
 * disposal jobs, server-side authorization and any official MVR, Clearinghouse,
 * testing-provider or medical-source verification are the backend's, and every
 * surface that shows one of these records says so.
 */

/* -------------------------------------------------------------------------- */
/* What kind of record it is                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The record category.
 *
 * It exists because retention is record-specific: the applicable schedule for a
 * medical certification record is not the schedule for a drug and alcohol
 * testing record, and a product with one clock gets the easy case right and the
 * expensive case wrong. This build stores the category and the BASIS and
 * computes no period at all — see `QualificationRetention`.
 */
export type QualificationRecordCategory =
  | "commercial_licence"
  | "medical_certificate"
  | "motor_vehicle_record"
  | "annual_mvr_review"
  | "employment_application"
  | "road_test_certificate"
  | "drug_alcohol_test_result"
  | "clearinghouse_query"
  | "background_check"
  | "handbook_acknowledgement"
  | "carrier_qualification_decision"
  | "other";

export const QUALIFICATION_CATEGORY_LABEL: Record<QualificationRecordCategory, string> = {
  commercial_licence: "Commercial driving licence",
  medical_certificate: "Medical examiner's certificate",
  motor_vehicle_record: "Motor vehicle record",
  annual_mvr_review: "Annual driving record review",
  employment_application: "Employment application",
  road_test_certificate: "Road test certificate",
  drug_alcohol_test_result: "Drug and alcohol test result",
  clearinghouse_query: "Clearinghouse query record",
  background_check: "Background check",
  handbook_acknowledgement: "Handbook acknowledgement",
  carrier_qualification_decision: "Carrier qualification decision",
  other: "Other qualification record",
};

/**
 * Who the evidence came from, which is not the same as who reviewed it.
 *
 * A driver-provided document stays the driver's: they own the lineage, they may
 * replace it, and the carrier holds a pinned record of the version it relied
 * on. Carrier-originated evidence — an application the carrier had filled in,
 * an MVR the carrier ordered, a road test its own examiner signed — belongs to
 * the carrier's file from the moment it exists and never enters the driver's
 * editable wallet.
 */
export type QualificationEvidenceOrigin = "driver_provided" | "carrier_originated";

/**
 * ★ CATEGORIES THIS FOUNDATION WILL NOT HANDLE ★
 *
 * Some qualification records carry access rules of their own — who may see a
 * drug and alcohol testing record, or a driving record obtained for an
 * investigation, is governed by rules separate from ordinary document access.
 * **Antcolos has not verified any of those rules**, and this milestone does not
 * build the purpose- and category-specific access model they would need.
 *
 * So these categories FAIL CLOSED: they cannot be adopted, they are not
 * returned by any read, and they are not shown to the driver or raised in Needs
 * You. That is deliberately not a permission — a permission would be granted to
 * Owners automatically, and "nobody may read this yet" is not something an
 * Owner should be able to hold. It is a property of the category, checked on
 * every path regardless of who is asking.
 *
 * Lifting a category out of this set is a product decision that needs the
 * access rule designed and the regulatory mapping verified first.
 */
export const RESTRICTED_QUALIFICATION_CATEGORIES: readonly QualificationRecordCategory[] = [
  "drug_alcohol_test_result",
  "clearinghouse_query",
  "background_check",
  "motor_vehicle_record",
  "annual_mvr_review",
];

/** Why each restricted category is held back, for the message a person sees. */
export const RESTRICTED_CATEGORY_REASON: Partial<Record<QualificationRecordCategory, string>> = {
  drug_alcohol_test_result:
    "Testing records carry their own confidentiality and disclosure rules. Antcolos has not verified them and does not yet model purpose-specific access, so it will not hold one.",
  clearinghouse_query:
    "A query record is part of a testing programme and carries the same unverified access rules.",
  background_check:
    "A background check is governed by rules outside transport regulation as well as within it, and neither has been verified here.",
  motor_vehicle_record:
    "A driving record obtained for an investigation may carry access restrictions separate from ordinary document access. Antcolos has not verified which apply.",
  annual_mvr_review:
    "The annual review is built on a driving record and inherits the same unverified access restrictions.",
};

export function isRestrictedQualificationCategory(
  category: QualificationRecordCategory,
): boolean {
  return RESTRICTED_QUALIFICATION_CATEGORIES.includes(category);
}

export const QUALIFICATION_ORIGIN_LABEL: Record<QualificationEvidenceOrigin, string> = {
  driver_provided: "Provided by the driver",
  carrier_originated: "Obtained by the carrier",
};

/**
 * Where the bytes actually came from. Never collapsed with verification.
 *
 * "The driver uploaded an MVR" and "the state sent us an MVR" are different
 * facts with different weight, and a product that prints one label for both is
 * telling a carrier something it has not earned.
 */
export type QualificationSourceKind =
  | "driver_self_provided"
  | "carrier_generated"
  | "received_from_licensing_authority"
  | "received_from_testing_provider"
  | "received_from_background_check_provider";

export const QUALIFICATION_SOURCE_LABEL: Record<QualificationSourceKind, string> = {
  driver_self_provided: "Uploaded by the driver (self-provided)",
  carrier_generated: "Created by this carrier",
  received_from_licensing_authority: "Received from a licensing authority",
  received_from_testing_provider: "Received from a testing provider",
  received_from_background_check_provider: "Received from a background check provider",
};

/**
 * How far verification actually got. Three states, and not a ladder anybody may
 * climb by clicking.
 *
 * `carrier_reviewed` means a person at the carrier looked at it. That is a real
 * and useful fact, and it is NOT source verification: reviewing a photograph of
 * a licence does not check it with the state. `source_verified` may only be set
 * when a `verificationSource` names who verified it — and no integration in
 * this build can, which is why the service refuses the claim rather than
 * quietly downgrading it.
 */
export type QualificationVerificationStatus =
  | "not_verified"
  | "carrier_reviewed"
  | "source_verified";

export const QUALIFICATION_VERIFICATION_LABEL: Record<QualificationVerificationStatus, string> = {
  not_verified: "Not verified",
  carrier_reviewed: "Reviewed by this carrier",
  source_verified: "Verified against the issuing source",
};

/** What the carrier is relying on the record FOR. Stated, never inferred. */
export type QualificationPurpose =
  | "driver_qualification_file"
  | "employment_decision"
  | "insurance_verification"
  | "other";

export const QUALIFICATION_PURPOSE_LABEL: Record<QualificationPurpose, string> = {
  driver_qualification_file: "Driver qualification file",
  employment_decision: "Employment decision",
  insurance_verification: "Insurance verification",
  other: "Other",
};

/* -------------------------------------------------------------------------- */
/* The pinned evidence                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A pointer at ONE document version, frozen.
 *
 * `documentId` is a version and `lineageId` is the document across versions —
 * the same distinction the Document Center has always drawn. Pinning the
 * version is the entire point of this type: a qualification record never moves
 * from version N to version N+1, not when the driver replaces the file, not
 * when a share is refreshed, not when the relationship ends.
 *
 * ★ THIS IS A RECORD OF WHICH VERSION, NOT THE VERSION ITSELF ★
 * Everything below is METADATA: an identity, a version number, a file name, a
 * status. Antcolos stores no file anywhere — `DocumentFileRef` is a name, a
 * type and a size, and there is no URL because there is nothing to point at. So
 * an adoption is proof of WHAT WAS RELIED ON and is NOT evidence custody:
 * retaining the document itself, surviving the driver deleting their copy, and
 * proving the bytes years later all need the backend's durable storage and a
 * content hash taken over the stored object. `integrityBasis` carries that gap
 * in the DATA rather than only in a comment, so no screen can render this as
 * though the file were held.
 */
export interface QualificationEvidenceRef {
  documentId: string;
  lineageId: string;
  /** 1-based version number, as it stood when it was adopted. */
  documentVersion: number;
  typeKey: DocumentTypeKey;
  /** Snapshot of the label at adoption. Never re-derived. */
  label: string;
  /** Snapshot of the file name at adoption. There is no file in this build. */
  fileName?: string;
  /** Set only by a backend that actually hashed the stored object. */
  contentHash?: string;
  integrityBasis: "content_hash" | "not_available_in_mock";
  /** The document's effective status at the moment it was adopted. */
  statusAtAdoption: DocumentStatus;
  expiresAt?: IsoDateTime;
}

/**
 * The carrier's own review, copied at adoption and never rewritten after.
 *
 * ★ ORGANIZATION-PRIVATE ★
 * Everything on this type belongs to the carrier. The driver's view of an
 * adoption carries none of it — see `DriverVisibleAdoption`, which is built
 * field by field rather than by deleting from this one.
 */
export interface QualificationReviewSnapshot {
  outcome: "accepted" | "rejected";
  reviewedAt: IsoDateTime;
  reviewedByMembershipId: string;
  reviewedByName: string;
  /** The reviewer's own words. Never leaves the carrier. */
  note?: string;
  /**
   * The `DocumentLink` the review was read from.
   *
   * A reference, not a dependency: the link stays the Document Center's and
   * keeps changing with the live document. This record keeps what it said at
   * the moment the carrier relied on it, which is the only version an audit can
   * use.
   */
  documentLinkId?: string;
}

/* -------------------------------------------------------------------------- */
/* Retention — BASIS FIRST                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The SHAPE a retention obligation can take. A vocabulary, not a claim.
 *
 * ★ NOTHING IN THIS BUILD ASSIGNS ONE TO A RECORD CATEGORY ★
 * Which shape applies to a driving licence, a medical certificate or a drug and
 * alcohol test result is a question about the applicable regulation, the record
 * category and the jurisdiction. This build has not verified any of those
 * mappings against the official regulatory text, so it asserts none of them:
 * `QualificationRetention.basis` is absent on every record, and the policy
 * table carries `mappingVerified: false` for every category.
 *
 * Deleting a citation while leaving "kept for a period from receipt" on screen
 * would be the same claim with the footnote removed. So the claim is gone too,
 * and what is shown instead is that the mapping is not configured.
 */
export type QualificationRetentionBasis =
  /** Kept while the person works here, then for a period the policy sets. */
  | "engagement_plus_period"
  /** Kept for a period running from the date the carrier received it. */
  | "fixed_period_from_receipt"
  /** Kept for a period after a newer record replaced it. */
  | "superseded_plus_period";

export const RETENTION_BASIS_LABEL: Record<QualificationRetentionBasis, string> = {
  engagement_plus_period: "While the person works here, then for a further period",
  fixed_period_from_receipt: "For a period from the date it was received",
  superseded_plus_period: "For a period after a newer record replaced it",
};

/**
 * Shown wherever a retention basis or date would otherwise go.
 *
 * Not a placeholder to be styled away: it is the honest answer, and it is what
 * makes the rest of this module safe to show. Antcolos has not verified which
 * regulation governs which record category, so it says so rather than guessing
 * and leaves both the mapping and the period to a backend policy.
 */
export const RETENTION_MAPPING_UNVERIFIED =
  "Retention policy not configured. Antcolos has not verified which regulation and "
  + "retention schedule apply to this record category, so it states neither a basis "
  + "nor an end date. A backend compliance policy supplies both.";

/**
/**
 * Where a retained record is in its life.
 *
 * `eligible_for_disposal` is unreachable in this build. It requires a verified
 * category mapping AND a backend-supplied `retainUntil` AND enforced legal
 * holds, and none of the three exists here — so a record stays in one of the
 * three retained states and disposal is refused. That is the safe direction.
 */
export type QualificationRetentionState =
  | "active"
  | "superseded_retained"
  | "relationship_ended_retained"
  | "eligible_for_disposal"
  | "disposed";

export const RETENTION_STATE_LABEL: Record<QualificationRetentionState, string> = {
  active: "Active qualification evidence",
  superseded_retained: "Superseded, still retained",
  relationship_ended_retained: "Relationship ended, retention active",
  eligible_for_disposal: "Eligible for disposal",
  disposed: "Disposed",
};

/** The states in which a record must not be disposed of, whoever asks. */
export const RETENTION_PROTECTED_STATES: readonly QualificationRetentionState[] = [
  "active", "superseded_retained", "relationship_ended_retained",
];

/**
 * One row of the retention schedule: a category, and what is known about it.
 *
 * Notice there is no period AND no asserted basis. `mappingVerified` is false
 * on every row in this build, and `basis` is absent — the row exists so that a
 * backend policy has a key to attach a verified mapping to, not so that this
 * build can imply one.
 */
export interface RetentionPolicy {
  key: string;
  category: QualificationRecordCategory;
  /** Absent until the category → regulation mapping has been verified. */
  basis?: QualificationRetentionBasis;
  /**
   * False everywhere in this build. True only when a verified mapping supplies
   * the basis above, at which point a period may also be supplied.
   */
  mappingVerified: boolean;
}

export interface QualificationRetention {
  /** The policy row this maps to. Its basis is unverified in this build. */
  policyKey: string;
  /**
   * ABSENT in this build, on every record. See `QualificationRetentionBasis`:
   * which shape applies to which category is not a question this build has
   * answered, so it asserts nothing.
   */
  basis?: QualificationRetentionBasis;
  /**
   * When the working relationship ended, where it has.
   *
   * An OBSERVED FACT, not a clock: it records something that happened, and
   * says nothing about when any obligation starts or ends. A backend with a
   * verified mapping is what turns it into a date.
   */
  relationshipEndedAt?: IsoDateTime;
  /**
   * The end of the obligation. ONLY ever set by a backend policy.
   *
   * This build never computes one. Absent means "not configured", which is why
   * `RETENTION_MAPPING_UNVERIFIED` is shown in its place and why disposal is
   * refused rather than allowed by default.
   */
  retainUntil?: IsoDateTime;
  /** The stored base state. The effective state is computed on read. */
  state: QualificationRetentionState;
  stateReason?: string;
  /**
   * Always false in this build, and the type does not hide it: a frontend
   * cannot hold anything. Real legal holds are the backend's.
   */
  legalHold: boolean;
  disposedAt?: IsoDateTime;
  disposedByMembershipId?: string;
  disposedByName?: string;
  /** Why it was disposed. Never the content — a disposal record is not a copy. */
  disposalNote?: string;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export type QualificationEventKind =
  | "adopted"
  | "superseded_by_adoption"
  | "relationship_ended"
  | "retention_state_changed"
  | "disposed"
  | "note";

/** Append-only. Never edited, never removed — not even on disposal. */
export interface QualificationEvent {
  id: string;
  at: IsoDateTime;
  kind: QualificationEventKind;
  summary: string;
  detail?: string;
  actorMembershipId?: string;
  actorName?: string;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One carrier's custody of one document version, for one qualification purpose.
 *
 * It belongs to the CARRIER even when the document belongs to the driver. The
 * driver may see that it exists and what it means for them; they can neither
 * edit the carrier's review nor discharge the carrier's obligation, which is
 * exactly the asymmetry the record-keeping duty assumes.
 */
export interface QualificationRecord {
  id: string;
  /**
   * The carrier that holds the file, and the ONLY organization this record is
   * read through.
   *
   * A6's rule applies here without modification: a scope field is not a grant.
   * `driverProfileId` below names a person and grants nobody anything, exactly
   * as `FactScope.carrierOrganizationId` names a carrier and grants nobody
   * anything. The one read that crosses an organization is the driver's view of
   * their own adoptions, and it rests on the existing self-access basis — the
   * membership's own `driverProfileId` — not on this record mentioning them.
   */
  organizationId: string;
  /** The person the file is about. Their profile is not owned by this record. */
  driverProfileId: string;
  driverName: string;
  /** The workforce engagement it was adopted under, when there was one. */
  engagementId?: string;
  category: QualificationRecordCategory;
  origin: QualificationEvidenceOrigin;
  purpose: QualificationPurpose;
  evidence: QualificationEvidenceRef;
  source: QualificationSourceKind;
  /** Who exactly, where the source names somebody. Free text, shown verbatim. */
  sourceDetail?: string;
  verification: QualificationVerificationStatus;
  /** Required before `verification` may be "source_verified". */
  verificationSource?: string;
  review: QualificationReviewSnapshot;
  /** When the carrier received this exact version. */
  receivedAt: IsoDateTime;
  adoptedAt: IsoDateTime;
  adoptedByMembershipId: string;
  adoptedByName: string;
  /** The driver's share package it arrived through, when it arrived that way. */
  sourceSharePackageId?: string;
  retention: QualificationRetention;
  /** Set when the carrier explicitly adopted a newer version of the lineage. */
  supersededByRecordId?: string;
  supersedesRecordId?: string;
  history: QualificationEvent[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** A record as one membership of the OWNING carrier is entitled to see it. */
export interface QualificationRecordView {
  record: QualificationRecord;
  /** Retention state with whatever clock exists applied. */
  retentionState: QualificationRetentionState;
  /** Why it is kept, and the honest answer about until when. */
  retentionExplanation: string;
  /** True when the driver's lineage has a newer version than the pinned one. */
  newerVersionAvailable: boolean;
  newerDocumentId?: string;
  /** True when the share that carried this document is revoked or expired. */
  shareEnded: boolean;
  /** Whether this membership may authorize disposal of this record. */
  canAuthorizeDisposal: boolean;
  /** Why not, when it may not. Written for the person reading it. */
  disposalBlockedReason?: string;
}

export interface QualificationFilters {
  driverProfileId?: string;
  engagementId?: string;
  category?: QualificationRecordCategory[];
  /** Off by default: disposed records are history, not the working file. */
  includeDisposed?: boolean;
  retentionState?: QualificationRetentionState[];
}

/**
 * What a DRIVER is told about a carrier holding a version of their document.
 *
 * ★ BUILT FIELD BY FIELD, NEVER BY REDACTING THE RECORD ★
 * Product decision 5: the driver sees the version, the general purpose, the
 * adoption date and the retention status. They do not see the carrier's review,
 * its reviewer, its notes, any risk assessment or any other
 * organization-private content. Constructing this by picking fields rather than
 * by deleting them from `QualificationRecord` means a field added to the record
 * next year is private by default instead of leaking on the day it lands.
 */
export interface DriverVisibleAdoption {
  /** Which carrier. The driver is entitled to know who holds their document. */
  organizationId: string;
  organizationName: string;
  category: QualificationRecordCategory;
  /** The GENERAL purpose. Never the reviewer's reasoning. */
  purpose: QualificationPurpose;
  lineageId: string;
  documentId: string;
  documentVersion: number;
  adoptedAt: IsoDateTime;
  /** The state only — not the carrier's internal retention reasoning. */
  retentionState: QualificationRetentionState;
  /** The consequence, in the driver's language. */
  retentionExplanation: string;
}
