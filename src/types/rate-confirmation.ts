import type { IsoDateTime } from "./common";

/**
 * The broker's rate confirmation, read against what we actually booked.
 *
 * This is the one document in dispatch that is worth arguing with. It is the
 * broker's account of the deal, written by the broker, and the differences
 * between it and what was agreed are where money is lost: a rate $50 light, a
 * pickup time an hour earlier than the one on the phone, detention that starts
 * after three hours instead of two. A dispatcher who signs it unread has agreed
 * to all of that.
 *
 * So the review here is FIELD BY FIELD and SIDE BY SIDE. Every extracted value
 * knows exactly where on the page it came from, and every one of them carries
 * what Antcolos believes instead, from the booking. The dispatcher's job is to
 * look at both and say which is right — not to retype a document.
 *
 * NOTHING HERE IS REAL. The email did not arrive, the OCR is a mock over a
 * document Antcolos generated itself, the signature is a drawn block rather
 * than a credential, and the signed copy goes nowhere. Every screen says so.
 * What IS real is the shape: an original that is never altered, a separate
 * signed version, a field-by-field record of what a person checked and
 * corrected, and one final confirmation before the carrier's name goes on it.
 */

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where something sits on the page, as percentages of the page box.
 *
 * Percentages rather than pixels so the highlight lands in the right place at
 * any width — this has to work on a phone next to a scaled-down page.
 */
export interface DocumentRegion {
  page: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export type DocumentBlockStyle =
  | "title" | "heading" | "label" | "value" | "body" | "small" | "rule" | "signature";

/** One positioned piece of the generated document. */
export interface DocumentBlock {
  id: string;
  text: string;
  style: DocumentBlockStyle;
  region: DocumentRegion;
  /** Right-aligned within its box. Used for money columns. */
  alignRight?: boolean;
}

export type RateConDocumentKind = "original" | "signed";

/**
 * A rate confirmation as Antcolos holds it.
 *
 * The original is never modified — not to add a signature, not to fix a typo.
 * Signing produces a SEPARATE document with its own id that carries the same
 * blocks plus the signature. Both are kept, and the screens can show either.
 */
export interface RateConDocument {
  documentId: string;
  kind: RateConDocumentKind;
  fileName: string;
  /** Source of the original: the mock inbound email it was attached to. */
  receivedFrom?: string;
  pages: number;
  blocks: DocumentBlock[];
  createdAt: IsoDateTime;
  /** Signed documents only. */
  signature?: AppliedSignature;
  /** Plain statement that this is generated, carried with the document. */
  mockNotice: string;
}

/* -------------------------------------------------------------------------- */
/* The signature                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The carrier's authorised signature, as applied to one document.
 *
 * It is the carrier's, not the dispatch agency's, and it may never be applied
 * without a person confirming that specific document at that moment. The
 * record therefore names who confirmed it, what they confirmed, and when — a
 * signature with no answer to "who authorised this" is worthless.
 */
export interface AppliedSignature {
  carrierOrganizationId: string;
  carrierName: string;
  /** The name that appears on the line. */
  signedName: string;
  title?: string;
  mcNumber?: string;
  signedAt: IsoDateTime;
  /** The person who gave the final confirmation. Never Antcolos. */
  authorisedByName: string;
  authorisedByMembershipId: string;
  /** What they were shown and agreed to, in one sentence. */
  statement: string;
}

/* -------------------------------------------------------------------------- */
/* Extracted fields                                                            */
/* -------------------------------------------------------------------------- */

export type RateConFieldKey =
  | "broker_name"
  | "broker_mc"
  | "broker_contact"
  | "load_reference"
  | "carrier_name"
  | "carrier_mc"
  | "equipment"
  | "commodity"
  | "weight"
  | "pickup_facility"
  | "pickup_address"
  | "pickup_at"
  | "delivery_facility"
  | "delivery_address"
  | "deliver_by"
  | "rate_total"
  | "payment_terms"
  /** Kept apart from layover on purpose. They are different money. */
  | "detention_terms"
  | "layover_terms";

export const RATECON_FIELD_LABEL: Record<RateConFieldKey, string> = {
  broker_name: "Broker",
  broker_mc: "Broker MC",
  broker_contact: "Broker contact",
  load_reference: "Their load number",
  carrier_name: "Carrier",
  carrier_mc: "Carrier MC",
  equipment: "Equipment",
  commodity: "Commodity",
  weight: "Weight",
  pickup_facility: "Shipper",
  pickup_address: "Pickup address",
  pickup_at: "Pickup appointment",
  delivery_facility: "Receiver",
  delivery_address: "Delivery address",
  deliver_by: "Delivery appointment",
  rate_total: "Total rate",
  payment_terms: "Payment terms",
  detention_terms: "Detention",
  layover_terms: "Layover",
};

export type FieldReviewStatus =
  /** Nobody has looked at it. */
  | "unreviewed"
  /** A person read it against the booking and said the document is right. */
  | "verified"
  /** A person read it and changed it. The original still says what it said. */
  | "corrected";

export interface ExtractedField {
  key: RateConFieldKey;
  label: string;
  /** Exactly the text the mock OCR read off the page. Never edited. */
  rawText: string;
  /** The value in use: the raw text until somebody corrects it. */
  value: string;
  /** 0-1. Low confidence is a reason to look, not a reason to reject. */
  confidence: number;
  /** Where on the page this came from. */
  region: DocumentRegion;
  /** The block it was read from, so the screen can point at it exactly. */
  blockId: string;
  /** A load cannot be confirmed until every required field is reviewed. */
  required: boolean;

  /** What Antcolos believes, from the booking. Absent where it has no view. */
  expected?: string;
  /** True when the document and the booking disagree. */
  disagrees: boolean;

  status: FieldReviewStatus;
  correctedValue?: string;
  correctionNote?: string;
  reviewedByName?: string;
  reviewedAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* The inbound email                                                           */
/* -------------------------------------------------------------------------- */

/** A mock inbound email carrying a rate confirmation. Nothing received it. */
export interface InboundRateConEmail {
  emailId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  receivedAt: IsoDateTime;
  attachmentName: string;
  bodyPreview: string;
  /** Always true here, and said out loud wherever this is shown. */
  isSample: true;
}

export type MatchConfidence = "certain" | "likely" | "uncertain";

/**
 * How an email was tied to a booking, and on what evidence.
 *
 * Shown rather than assumed. Attaching a rate confirmation to the wrong load is
 * a mistake that survives all the way to invoicing, so the screen says which
 * facts lined up and a match that is merely "likely" waits for a person.
 */
export interface RateConMatchEvidence {
  confidence: MatchConfidence;
  bookingId?: string;
  dispatchCycleId?: string;
  loadReference?: string;
  /** The things that agreed: broker, lane, rate, truck. */
  agreedOn: string[];
  /** The things that did not. */
  disagreedOn: string[];
  /** Set when nothing could be matched. */
  unmatchedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* The workflow                                                                */
/* -------------------------------------------------------------------------- */

export type RateConStatus =
  /** Arrived and tied to a booking. Fields are extracted and waiting. */
  | "reviewing"
  /** Every required field has been looked at. One confirmation left. */
  | "ready_to_confirm"
  /** Confirmed, signed, and the signed copy recorded as returned. */
  | "returned"
  /** A person stopped it. The original is kept. */
  | "rejected";

export const RATECON_STATUS_LABEL: Record<RateConStatus, string> = {
  reviewing: "Checking it",
  ready_to_confirm: "Ready for your confirmation",
  returned: "Signed and returned",
  rejected: "Stopped",
};

export type RateConAuditAction =
  | "received"
  | "matched"
  | "extracted"
  | "field_verified"
  | "field_corrected"
  | "confirmed"
  | "signed"
  | "returned"
  | "distributed"
  | "rejected";

export interface RateConAuditEntry {
  id: string;
  at: IsoDateTime;
  action: RateConAuditAction;
  actorName: string;
  actorMembershipId?: string;
  detail: string;
}

/**
 * Where the confirmed information went — and where it could not go yet.
 *
 * Every destination is listed either way. A dispatcher who cannot see that
 * accounting has not received anything will assume it has.
 */
export type DistributionTargetKey =
  | "load_record"
  | "accounting"
  | "driver_notification"
  | "detention_rules"
  | "layover_rules"
  | "broker_profile"
  | "shipper_profile"
  | "receiver_profile"
  | "trip";

export type DistributionState =
  /** Actually written, now, to a module that exists. */
  | "written"
  /** Held, with the milestone that will receive it named. */
  | "queued";

export interface DistributionOutcome {
  key: DistributionTargetKey;
  label: string;
  state: DistributionState;
  /** What was written, or what is waiting and for whom. */
  detail: string;
  /** Set on everything queued. */
  waitingForMilestone?: number;
}

export interface RateConWorkflow {
  rateConId: string;
  organizationId: string;
  carrierOrganizationId: string;
  carrierName: string;
  bookingId: string;
  dispatchCycleId: string;
  loadId: string;
  loadReference: string;
  brokerName: string;

  email: InboundRateConEmail;
  evidence: RateConMatchEvidence;

  original: RateConDocument;
  signed?: RateConDocument;

  fields: ExtractedField[];
  status: RateConStatus;

  confirmedAt?: IsoDateTime;
  confirmedByName?: string;
  confirmedByMembershipId?: string;
  rejectedReason?: string;

  /** The message that carried the signed copy back. */
  returnMessageId?: string;
  distribution: DistributionOutcome[];
  audit: RateConAuditEntry[];
  createdAt: IsoDateTime;
}

/** What is left before this can be confirmed. */
export interface RateConProgress {
  total: number;
  required: number;
  reviewed: number;
  corrected: number;
  disagreements: number;
  /** The next required field nobody has looked at. */
  nextFieldKey?: RateConFieldKey;
  canConfirm: boolean;
  blockedReasons: string[];
}
