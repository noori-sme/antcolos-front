import type { DocumentLifecycleStatus } from "./asset";

/**
 * THE document model.
 *
 * Antcolos has one document system, not five. A driver's medical card, a
 * carrier organization's certificate of insurance, a truck's registration, a
 * trailer's annual inspection and — later — a load's rate confirmation are the
 * same kind of record: a file reference with an immutable identity, a typed
 * relationship to something permanent, a review state, an expiry, and a version
 * history that is never overwritten.
 *
 * Three identifiers, three jobs, and they are not interchangeable:
 *
 *   documentId    Antcolos's permanent identity for ONE VERSION. An immutable
 *                 UUID, assigned once and never reused, rewritten or
 *                 regenerated — not by a replacement, not by a review, not by a
 *                 relationship ending.
 *   lineageId     An immutable UUID shared by every version of the same
 *                 document. "The certificate of insurance on unit 104" is a
 *                 lineage; the three files that have filled it are versions.
 *   requirementKey  What the document is being supplied FOR. It belongs to the
 *                 checklist, not to the file, and a document can satisfy a
 *                 requirement in one context and none in another.
 *
 * Nothing here is uploaded, stored, transmitted, read, extracted or verified.
 * `selected_local` is the honest state this build reaches: the browser told us
 * a name, a type and a size, and the file was let go.
 */

/* -------------------------------------------------------------------------- */
/* Document types — reusable across every context                              */
/* -------------------------------------------------------------------------- */

/**
 * What a document IS, independent of who is asking for it.
 *
 * A W-9 is a W-9 whether a carrier organization, a dispatch organization or an
 * individual dispatcher supplies it. Whether it is required, optional or not
 * applicable is a question about the CONTEXT, and is answered by a requirement
 * set — never by this list.
 */
export type DocumentTypeKey =
  // Business identity and tax
  | "w9"
  | "business_registration"
  | "government_id"
  | "voided_check"
  // Authority and compliance
  | "operating_authority"
  | "mc_authority_letter"
  | "ifta_license"
  | "safety_policy"
  | "drug_alcohol_policy"
  // Insurance
  | "certificate_of_insurance"
  | "errors_omissions_insurance"
  | "workers_compensation"
  // Agreements
  | "dispatch_service_agreement"
  | "carrier_packet"
  | "lease_agreement"
  | "signed_handbook"
  // Driver
  | "cdl"
  | "medical_card"
  | "mvr"
  | "employment_application"
  // Equipment
  | "vehicle_registration"
  | "vehicle_title"
  | "vehicle_insurance"
  | "annual_inspection"
  | "cab_card"
  | "reefer_service_record"
  | "tarp_securement_inventory"
  // Load paperwork. The model carries these so the Load document workflow can
  // attach to it later without a redesign. No load workflow is built yet.
  | "rate_confirmation"
  | "bill_of_lading"
  | "proof_of_delivery"
  | "lumper_receipt"
  | "scale_ticket"
  | "detention_evidence"
  | "damage_document"
  | "other";

export interface DocumentTypeMeta {
  key: DocumentTypeKey;
  label: string;
  /** Plain language, written for the person who has to supply it. */
  description: string;
  /** Carries an expiry date the holder must supply. */
  expires: boolean;
  /** The entity kinds this type can ever be about. */
  subjects: DocumentSubjectKind[];
  /**
   * Modelled, not built. Load paperwork is here so the relationship exists;
   * every surface that shows one of these must say it is not built yet.
   */
  future?: boolean;
  /**
   * ★ NEVER HANDED OVER BECAUSE SOMEBODY JOINED ★
   *
   * A restricted type carries a government identifier, bank details, or a
   * medical or substance-testing record. Access to one is its own decision,
   * made per document, for a stated reason, by somebody who holds the
   * permission for it — never a side effect of accepting an invitation,
   * joining an organization or being handed a role.
   *
   * This flag does not by itself stop a document being shared. It stops the
   * BULK paths — onboarding, acceptance, checklist defaults — from including
   * one silently, which is where blanket access actually comes from.
   */
  restricted?: true;
  /** Why it is restricted, in the words the person is shown. */
  restrictedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Who owns a document, and what it is about                                   */
/* -------------------------------------------------------------------------- */

/**
 * A document belongs either to an organization or to a person.
 *
 * The distinction is not cosmetic. A driver's CDL belongs to the driver and
 * follows them between carriers; a carrier's operating authority belongs to the
 * carrier. A carrier that can see a driver's licence sees it because the driver
 * shared it, and stops seeing later versions when that ends.
 */
export type DocumentOwnerKind = "organization" | "person";

export interface DocumentOwnerRef {
  kind: DocumentOwnerKind;
  id: string;
  /** Snapshot of the name at the time. Survives a later rename. */
  name: string;
}

/** What a document is about. "load" is modelled and deliberately not built. */
export type DocumentSubjectKind =
  | "organization"
  | "driver"
  | "truck"
  | "trailer"
  | "load";

export interface DocumentSubjectRef {
  kind: DocumentSubjectKind;
  /** The entity's own permanent id — a truckId, trailerId, driver profile id. */
  id: string;
  /** Snapshot of the label when the link was made. Never re-derived. */
  label: string;
  /** Route back to the entity, when the module exists. */
  href?: string;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The eight states a document can be in. Shared with the asset registries,
 * which have used exactly these since the truck milestone.
 */
export type DocumentStatus = DocumentLifecycleStatus;

export type DocumentReviewState = "not_required" | "pending" | "approved" | "rejected";

/**
 * A review decision. Held per relationship rather than per file, because the
 * same valid document can be accepted in one context and still be outstanding
 * in another — one carrier has looked at it, another has not.
 */
export interface DocumentReview {
  state: DocumentReviewState;
  reviewedAt?: string;
  reviewedByName?: string;
  /** Required when the state is "rejected". Written for the person who must fix it. */
  rejectionReason?: string;
}

/**
 * A file reference. NOT a file.
 *
 * These are the three properties the browser hands over for free. Nothing was
 * read, uploaded, stored or transmitted, and there is no URL because there is
 * nothing to point at.
 */
export interface DocumentFileRef {
  fileName: string;
  fileType: string;
  sizeBytes: number;
  /** When the browser handed us the name. Not an upload time — there is no upload. */
  selectedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Relationships                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One typed relationship between a document and an entity.
 *
 * A document has at least one link — the primary one, made when the document
 * was created. Extra links are how the same valid document serves several
 * contexts WITHOUT a duplicate copy being uploaded: each link carries its own
 * review state and its own governing organization, so access, acceptance and
 * scope stay separate even though the file is one record.
 */
export interface DocumentLink {
  id: string;
  subject: DocumentSubjectRef;
  /** The checklist entry this link satisfies, when it satisfies one. */
  requirementKey?: string;
  /** The relationship the document was created for. Exactly one per document. */
  primary: boolean;
  /**
   * The organization that governs this context and reviews in it — ABSENT when
   * no organization does.
   *
   * A driver's licence uploaded before any carrier has invited them is the
   * case: the document belongs to the driver, nobody is reviewing it, and there
   * is no organization to name. Inventing one would be a lie about who holds
   * the record and who approved it, so the field is simply not there, exactly
   * as `DocumentRecord.organizationId` is absent for person-owned documents.
   *
   * A link with no context organization is never ended by a relationship
   * ending, and never appears in an organization's own document lists. When a
   * carrier is later given the document, that is a SECOND link carrying the
   * carrier's own review — the driver-owned one is untouched.
   */
  contextOrganizationId?: string;
  contextOrganizationName?: string;
  /**
   * True when the link exists for ONE organization's onboarding rather than for
   * the entity itself — a carrier's own insurance evidence on a trailer several
   * carriers are approved on. Only that organization sees it.
   */
  contextPrivate?: boolean;
  review: DocumentReview;
  linkedAt: string;
  /** Links are ended, never deleted. History survives. */
  unlinkedAt?: string;
  unlinkReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Sharing across organizations                                                */
/* -------------------------------------------------------------------------- */

/**
 * Why one organization may see another's document.
 *
 * A dispatch organization sees a carrier's paperwork because the carrier shared
 * it for work the dispatcher actually does — never because it asked. The basis
 * is recorded so the grant can be read back, and so it can be ended when the
 * relationship behind it ends.
 */
export type DocumentShareBasisKind =
  | "dispatch_access"
  | "carrier_relationship"
  | "driver_relationship"
  | "load"
  | "workspace_upgrade"
  /**
   * A driver handing documents to a carrier BEFORE any relationship exists.
   *
   * Every other basis rests on a relationship record. This one rests on a share
   * package the driver created, which is the whole point: a driver may show a
   * carrier their licence without being that carrier's driver, and the grant
   * has to be able to say so rather than implying an engagement that does not
   * exist.
   */
  | "driver_share";

export interface DocumentShareBasis {
  kind: DocumentShareBasisKind;
  /** The relationship record this grant rests on. */
  id: string;
  label: string;
}

export interface DocumentShare {
  id: string;
  /** Shares follow the lineage, so a replacement is covered without re-granting. */
  lineageId: string;
  sharedWithOrganizationId: string;
  sharedWithName: string;
  basis: DocumentShareBasis;
  /** What the recipient needs it for, in the granter's words. */
  purpose: string;
  /** Viewing and downloading are separate grants. */
  canDownload: boolean;
  grantedAt: string;
  grantedByName: string;
  /** Revoked, never deleted. */
  revokedAt?: string;
  revokeReason?: string;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export type DocumentEventKind =
  | "created"
  | "file_selected"
  | "submitted"
  | "approved"
  | "rejected"
  | "replaced"
  | "superseded"
  | "expiry_set"
  | "linked"
  | "unlinked"
  | "shared"
  | "share_revoked"
  | "relationship_ended"
  | "carried_forward";

/** Append-only. Events are never edited or removed, not even when a document is. */
export interface DocumentEvent {
  id: string;
  lineageId: string;
  documentId: string;
  at: string;
  kind: DocumentEventKind;
  summary: string;
  detail?: string;
  /** The organization whose action it was, when there was one. */
  organizationId?: string;
  actorName?: string;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One version of one document.
 *
 * Replacing a document never mutates this record: a new record is created with
 * a new `documentId`, the same `lineageId` and `version + 1`, and this one is
 * marked superseded and kept. That is the whole versioning rule.
 */
export interface DocumentRecord {
  /** Immutable UUID. One per version. Never reused or rewritten. */
  documentId: string;
  /** Immutable UUID shared by every version of this document. */
  lineageId: string;
  owner: DocumentOwnerRef;
  /**
   * The organization that holds the record, when one does. Absent for
   * person-owned documents, which belong to the person and are shared.
   */
  organizationId?: string;
  typeKey: DocumentTypeKey;
  /** At least one, exactly one of them primary. */
  links: DocumentLink[];
  /** 1-based. */
  version: number;
  supersedesDocumentId?: string;
  supersededByDocumentId?: string;
  /** The stored base state. Expiry is applied on read, because time moves. */
  status: DocumentStatus;
  file?: DocumentFileRef;
  /** For documents that lapse: medical cards, insurance, registrations. */
  expiresAt?: string;
  addedByName: string;
  addedByMembershipId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What survives when a document is replaced, or a relationship ends.
 *
 * A carrier that has ended its relationship with a driver still needs to show
 * what it held at the time, so a snapshot is kept rather than deleted. It is
 * deliberately thin: identity, label, file metadata and the moment it was taken.
 */
export interface DocumentSnapshot {
  documentId: string;
  lineageId: string;
  typeKey: DocumentTypeKey;
  label: string;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  status: DocumentStatus;
  expiresAt?: string;
  capturedAt: string;
  /** Why the snapshot exists. */
  reason: "replaced" | "relationship_ended" | "share_revoked";
}

/* -------------------------------------------------------------------------- */
/* Requirements — the checklist, which is NOT the documents                    */
/* -------------------------------------------------------------------------- */

/**
 * Requirements and documents are different things and are stored separately.
 *
 * A requirement is what somebody is asked for; a document is what they actually
 * supplied. A requirement with nothing against it is "missing" — which is a
 * fact about the checklist, not a record with an id. This separation is what
 * lets the same document satisfy a requirement in one workspace and no
 * requirement at all in another.
 */
export type DocumentApplicability = "required" | "optional" | "not_applicable";

/**
 * Which checklist. Workspace sets and entity sets are deliberately distinct:
 * an individual dispatcher's personal paperwork is NOT a dispatch
 * organization's paperwork, and must never be shown as if it were.
 */
export type RequirementSetId =
  | "carrier_organization"
  | "dispatch_organization"
  | "individual_dispatcher"
  | "driver"
  | "owner_operator"
  | "truck"
  | "trailer";

export interface DocumentRequirement {
  /** Stable, unique across every set. The document's slot. */
  key: string;
  setId: RequirementSetId;
  typeKey: DocumentTypeKey;
  subjectKind: DocumentSubjectKind;
  label: string;
  description: string;
  /** "not_applicable" requirements are never returned to a caller, only filtered. */
  applicability: DocumentApplicability;
  expires: boolean;
  /** Why it is asked for HERE. The answer differs between workspace types. */
  reason: string;
  /**
   * Set when one organization added this beyond the standard set, so the
   * person supplying it can see who is asking and why.
   */
  addedByOrganizationId?: string;
}

export interface RequirementSet {
  id: RequirementSetId;
  label: string;
  description: string;
  requirements: DocumentRequirement[];
}

/**
 * One line of a checklist: what is being asked for, and what is against it.
 *
 * The requirement and the document stay separate objects — this is the join,
 * computed per context, never stored.
 */
export interface DocumentChecklistItem {
  requirement: DocumentRequirement;
  /** The current version filling this slot, if any. */
  document?: DocumentRecord;
  /** Effective status, with expiry applied. "missing" when nothing is supplied. */
  status: DocumentStatus;
  /** Every version of this slot, newest first. */
  versionCount: number;
  /** Set when the document filling this slot lives elsewhere and is linked in. */
  linkedFromOtherContext?: boolean;
}
