import type { IsoDateTime, EventSource } from "./common";
import type { ActorRef } from "./user";

/**
 * A document is a first-class, organization-owned record with lineage: what it
 * is, what it relates to, who put it there, how it was read, and whether a
 * human has accepted it. Documents are versioned rather than overwritten.
 */

export type DocumentKind =
  | "rate_confirmation"
  | "bill_of_lading"
  | "proof_of_delivery"
  | "scale_ticket"
  | "lumper_receipt"
  | "invoice"
  | "settlement_statement"
  | "carrier_packet"
  | "certificate_of_insurance"
  | "w9"
  | "driver_license"
  | "medical_card"
  | "equipment_registration"
  | "other";

/** State of machine extraction. "not_applicable" for documents never parsed. */
export type OcrState =
  | "not_applicable" | "pending" | "processing" | "succeeded" | "failed";

/** State of human acceptance. High-risk documents require a person. */
export type VerificationState =
  | "not_required" | "pending" | "verified" | "rejected" | "superseded";

/** What a document is attached to. A document may link to several entities. */
export interface DocumentLink {
  entityKind: "load" | "stop" | "driver" | "truck" | "trailer" | "customer" | "settlement" | "invoice";
  entityId: string;
}

export interface Document {
  id: string;
  organizationId: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Everything this document is attached to. Always at least one link. */
  links: DocumentLink[];
  uploadedAt: IsoDateTime;
  uploadedBy: ActorRef;
  source: EventSource;
  ocr: {
    state: OcrState;
    /** 0–1. Present only when state is "succeeded". */
    confidence?: number;
    completedAt?: IsoDateTime;
  };
  verification: {
    state: VerificationState;
    verifiedBy?: ActorRef;
    verifiedAt?: IsoDateTime;
    rejectionReason?: string;
  };
  /** 1-based. A replacement increments it and points back with supersedes. */
  version: number;
  supersedesDocumentId?: string;
  /** For documents that lapse: medical cards, COIs, registrations. */
  expiresAt?: IsoDateTime;
}

/**
 * What a load needs before it can be invoiced. Requirements are per load
 * because they come from the customer's agreement, not from a global rule.
 */
export interface DocumentRequirement {
  kind: DocumentKind;
  /** Blocks invoicing when missing. */
  required: boolean;
  /** Satisfied by a document that is present and not rejected. */
  satisfiedByDocumentId?: string;
}
