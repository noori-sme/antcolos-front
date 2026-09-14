import type { IsoDateTime, EventSource } from "./common";
import type { ActorRef } from "./user";

/**
 * LOAD ATTACHMENTS — the older, load-only document record.
 *
 * This is NOT a second document system. It is the load module's existing
 * attachment record, kept exactly as it is because the Load document workflow
 * has not been designed yet and nothing about loads changes in this milestone.
 *
 * The unified record in `document-center.ts` is the one every Driver, Carrier,
 * Truck and Trailer document now uses, and it already carries `load` as a
 * subject kind and the load paperwork types (rate confirmation, BOL, POD,
 * receipts, detention evidence, damage documents). When the Load document
 * workflow is built, these records fold into it; until then the two are kept
 * apart rather than pretending a migration happened.
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
export interface LoadDocumentLink {
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
  links: LoadDocumentLink[];
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
export interface LoadDocumentRequirement {
  kind: DocumentKind;
  /** Blocks invoicing when missing. */
  required: boolean;
  /** Satisfied by a document that is present and not rejected. */
  satisfiedByDocumentId?: string;
}
