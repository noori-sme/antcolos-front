import type { DocumentStatus, DocumentTypeKey } from "./document-center";
import type { IsoDateTime } from "./common";

/**
 * A driver handing specific documents to a specific recipient, for a stated
 * reason, for a limited time.
 *
 * WHAT THIS IS NOT. It is not a document: every item below is a REFERENCE to a
 * `DocumentRecord` that already exists, by the ids the Document Center already
 * assigns, and nothing here stores a file, a copy or a second identity. It is
 * not a relationship: sharing a licence with a carrier makes nobody anybody's
 * driver, and no membership, engagement, assignment or onboarding application
 * follows from it. It is not a review: what a recipient decides is recorded on
 * that recipient's own `DocumentLink`, not here.
 *
 * WHY IT EXISTS ANYWAY. `DocumentShare` — the existing organization-to-
 * organization grant — answers "this organization may see that lineage, on this
 * basis". It cannot answer any of: several documents handed over as one act;
 * the exact VERSIONS the recipient was shown; a purpose; an expiry; a delivery
 * attempt; a recipient who is an email address rather than an organization; or
 * what has happened to the link since. Those are this record's job, and it does
 * them by pointing at the canonical ones rather than restating them.
 */

/** Why the driver is handing these over. Stated, never inferred. */
export type SharePurpose =
  | "driver_qualification"
  | "onboarding"
  | "insurance_verification"
  | "other";

export const SHARE_PURPOSE_LABEL: Record<SharePurpose, string> = {
  driver_qualification: "Driver qualification",
  onboarding: "Onboarding with a carrier",
  insurance_verification: "Insurance verification",
  other: "Other",
};

/**
 * Who is receiving it.
 *
 * A native recipient is an Antcolos organization and is addressed by its own
 * id, so access runs through that organization's context and permissions like
 * everything else. An external recipient is an EMAIL ADDRESS and nothing more:
 * no organization is created for them, no membership, no directory entry, and
 * the address is never promoted into one.
 */
export type ShareRecipient =
  | { kind: "organization"; organizationId: string; organizationName: string }
  | { kind: "external"; email: string };

/**
 * One document in the package, pinned to the version the recipient was offered.
 *
 * `documentId` is a VERSION and `lineageId` is the document across versions.
 * Pinning the version is what stops a recipient's record of "what I reviewed"
 * changing under them when the driver uploads a new licence: the new version is
 * a new share, explicitly issued, not a silent substitution.
 */
export interface SharePackageItem {
  lineageId: string;
  documentId: string;
  typeKey: DocumentTypeKey;
  /** Snapshot of the label at the time of sharing. Never re-derived. */
  label: string;
  /** Snapshot of the file's name at the time of sharing. There is no file. */
  fileName?: string;
  /** The status the document had when it was shared. */
  statusAtShare: DocumentStatus;
  expiresAt?: IsoDateTime;
}

/**
 * Where the package is in its life. A superset of the link states the tracking
 * module already uses, because a share can also fail to be delivered.
 */
export type SharePackageState =
  | "issued"
  | "delivery_pending"
  | "delivered"
  | "opened"
  | "expired"
  | "revoked"
  | "failed";

export const SHARE_STATE_LABEL: Record<SharePackageState, string> = {
  issued: "Issued",
  delivery_pending: "Delivery pending",
  delivered: "Delivered (mock)",
  opened: "Opened",
  expired: "Expired",
  revoked: "Revoked",
  failed: "Delivery failed",
};

/** Every state change and every access, append-only. History is never rewritten. */
export type ShareEventKind =
  | "created"
  | "delivery_queued"
  | "delivery_recorded"
  | "delivery_failed"
  | "opened"
  | "document_viewed"
  | "access_refused"
  | "revoked"
  | "expired"
  | "review_recorded"
  | "refreshed";

export interface ShareEvent {
  id: string;
  at: IsoDateTime;
  kind: ShareEventKind;
  summary: string;
  /** Present when an organization did it; absent for an external recipient. */
  organizationId?: string;
  actorName?: string;
  /** The document version this event is about, when it is about one. */
  documentId?: string;
}

/** Why a token did not resolve. Always stated; never a blank page. */
export type SharePackageRefusal =
  | "unknown_token"
  | "revoked"
  | "expired"
  | "not_in_package";

export const SHARE_REFUSAL_MESSAGE: Record<SharePackageRefusal, string> = {
  unknown_token: "This document link is not recognised.",
  revoked: "The driver withdrew this document link.",
  expired: "This document link has expired.",
  not_in_package: "That document was not shared with you.",
};

export interface DocumentSharePackage {
  id: string;
  /** The driver profile whose documents these are. Ownership never moves. */
  driverProfileId: string;
  driverName: string;
  recipient: ShareRecipient;
  purpose: SharePurpose;
  /** Free text the driver added, if any. */
  note?: string;
  items: SharePackageItem[];
  createdAt: IsoDateTime;
  createdByName: string;
  expiresAt: IsoDateTime;
  revokedAt?: IsoDateTime;
  revokedReason?: string;
  /**
   * The opaque token an external recipient opens. Absent for a native share,
   * which is reached through the recipient organization's own session instead
   * of through a secret.
   */
  token?: string;
  /** Mint of the previous package when this one replaces it after a change. */
  refreshOfPackageId?: string;
  accessCount: number;
  lastAccessedAt?: IsoDateTime;
  /** Append-only. The share's own history, and what Audit projects from. */
  events: ShareEvent[];
  /** Set when delivery to an external address failed in the mock. */
  deliveryFailureReason?: string;
}

/** A recipient's review of one shared document, recorded on their own link. */
export type ShareReviewOutcome = "accepted" | "rejected";

/**
 * The package as a recipient may see it: what was shared, by whom, for what —
 * and nothing about the driver beyond the documents they chose to hand over.
 */
export interface SharePackageView {
  id: string;
  driverName: string;
  purpose: SharePurpose;
  note?: string;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  state: SharePackageState;
  items: SharePackageItem[];
  /** Short, human-readable, and not the token. Safe to print on a page. */
  reference: string;
}
