import type { Cents, IsoDateTime } from "./common";

/**
 * Writing to a broker, in the carrier's name.
 *
 * Every message Antcolos produces comes from a TEMPLATE and a CONTEXT, and the
 * split is deliberate:
 *
 *   Template   What kind of thing is being said — an opening inquiry, a
 *              follow-up, a delay notice. It knows the shape of the message
 *              and nothing about any particular load.
 *
 *   Context    Who is writing (the carrier, never the dispatch agency), who
 *              they are writing to, and what about. Assembled from records
 *              that already exist rather than typed into a message.
 *
 * A message is therefore reproducible: the same template and the same context
 * say the same thing, which is what makes it reviewable. A dispatcher reading a
 * draft is checking facts, not prose.
 *
 * NOTHING IS SENT. There is no mailbox, no outbound server and no address that
 * receives anything. "Sent" here means a person marked it as sent after they
 * sent it themselves, or — for the one case the roadmap makes automatic, the
 * signed rate confirmation going back — that Antcolos recorded it as sent as
 * part of a confirmation a person gave. Every screen says so.
 */

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export type MessageTemplateKey =
  /** The first approach about a load on the market. */
  | "load_inquiry"
  /** Nothing came back, and the load is still open. */
  | "follow_up"
  /** Our truck went elsewhere, or their load did. Said plainly, and early. */
  | "truck_covered"
  /** Where the truck is and when it will be there. */
  | "in_transit_update"
  /** Something has gone wrong with the timing, or the truck is sitting. */
  | "delay_or_detention"
  /** Delivered, or about to be. */
  | "delivery_update"
  /** After the load is off. Short, and worth sending. */
  | "thank_you"
  /** The rate confirmation, checked and signed, going back. */
  | "signed_rate_confirmation";

export const TEMPLATE_LABEL: Record<MessageTemplateKey, string> = {
  load_inquiry: "Load inquiry",
  follow_up: "Follow-up",
  truck_covered: "Truck covered / load not booked",
  in_transit_update: "In-transit update",
  delay_or_detention: "Delay or detention notice",
  delivery_update: "Delivery update",
  thank_you: "Thank you after delivery",
  signed_rate_confirmation: "Returning a signed rate confirmation",
};

/**
 * What has to be true before a template can say anything worth reading.
 *
 * Checked before a message is offered, so a dispatcher is never handed a draft
 * with a hole in it where the delivery date should be.
 */
export type TemplateRequirement =
  | "listing"
  | "load"
  | "truck"
  | "driver"
  | "rate"
  | "signed_document"
  | "delay_reason"
  | "eta";

export interface MessageTemplate {
  key: MessageTemplateKey;
  label: string;
  /** What this message is for, in the dispatcher's language. */
  purpose: string;
  requires: TemplateRequirement[];
  /**
   * When Antcolos prepares one by itself.
   *
   * `undefined` means it never does: the template exists and a person picks it.
   * Saying so on the screen matters — a dispatcher who believes delay notices
   * go out automatically will not send one.
   */
  autoDraftsWhen?: string;
}

/* -------------------------------------------------------------------------- */
/* What a message is written from                                              */
/* -------------------------------------------------------------------------- */

/** The carrier's own identity. Never the dispatch agency's. */
export interface WriterIdentity {
  carrierOrganizationId: string;
  legalName: string;
  displayName: string;
  mcNumber?: string;
  dotNumber?: string;
  /** The person the broker will reply to, at the carrier. */
  contactName?: string;
  email?: string;
  phone?: string;
  /** The block that closes every message from this carrier. */
  signatureBlock: string[];
  /** False when this carrier may not legally haul, so nothing may go out. */
  canHaul: boolean;
}

export interface BrokerRecipient {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  mcNumber?: string;
}

/** Everything about the load a template might need to name. */
export interface MessageSubjectMatter {
  lane: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickupAt?: IsoDateTime;
  deliverBy?: IsoDateTime;
  equipmentLabel?: string;
  /** The broker's own reference, where there is one. */
  sourceReference?: string;
  /** Antcolos's load reference, once a load exists. */
  loadReference?: string;
  rateCents?: Cents;
  truckUnits: string[];
  deadheadMilesByUnit?: Record<string, number>;
  driverName?: string;
}

/** The odds and ends one template each needs, and nothing else does. */
export interface MessageExtras {
  /** in_transit_update, delay_or_detention */
  currentLocation?: string;
  etaAt?: IsoDateTime;
  /** delay_or_detention */
  delayReason?: string;
  detentionStartedAt?: IsoDateTime;
  detentionHours?: number;
  /** delivery_update */
  deliveredAt?: IsoDateTime;
  receiverName?: string;
  shortOrDamaged?: string;
  /** signed_rate_confirmation */
  signedDocumentName?: string;
  correctionsMade?: string[];
  /** truck_covered */
  whatHappened?: string;
}

export interface MessageContext {
  writer: WriterIdentity;
  broker: BrokerRecipient;
  subject: MessageSubjectMatter;
  extras?: MessageExtras;
}

export interface RenderedMessage {
  subject: string;
  body: string;
  /** Requirements the context could not satisfy. Empty when it is complete. */
  missing: TemplateRequirement[];
}

/* -------------------------------------------------------------------------- */
/* Messages and threads                                                        */
/* -------------------------------------------------------------------------- */

export type MessageStatus =
  /** Prepared by Antcolos or by a person. Nobody has read it yet. */
  | "draft"
  /** A dispatcher has read it and said it may go. Still not sent. */
  | "approved"
  /** Recorded as having gone. Antcolos did not send it; a person did. */
  | "sent"
  /** Thrown away. */
  | "cancelled"
  /** The reason for writing it disappeared before it went. */
  | "superseded";

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  draft: "Waiting for you",
  approved: "Read and approved",
  sent: "Marked as sent",
  cancelled: "Thrown away",
  superseded: "No longer needed",
};

/**
 * How a message left Antcolos — which, today, is never by Antcolos sending it.
 *
 * `recorded_by_hand` is the honest default: a dispatcher copied the text, sent
 * it from their own mail, and marked it. `auto_on_confirmation` exists for the
 * single case the roadmap makes automatic — the signed rate confirmation going
 * back to the broker the moment a person confirms it — and even that is a mock
 * with nothing on the wire.
 */
export type SendMethod = "recorded_by_hand" | "auto_on_confirmation";

export const SEND_METHOD_LABEL: Record<SendMethod, string> = {
  recorded_by_hand: "Marked as sent by a person",
  auto_on_confirmation: "Recorded automatically on confirmation",
};

export interface MessageAttachment {
  /** The document this points at, in the workspace's own records. */
  documentId: string;
  fileName: string;
  /** What it is, for a person scanning the thread. */
  label: string;
}

export interface OutreachMessage {
  messageId: string;
  threadId: string;
  organizationId: string;
  carrierOrganizationId: string;
  templateKey: MessageTemplateKey;

  fromName: string;
  fromEmail?: string;
  toName?: string;
  toEmail?: string;
  subject: string;
  body: string;
  attachments: MessageAttachment[];

  status: MessageStatus;
  /** Why it cannot go out even once somebody approves it. */
  blockedReason?: string;
  /** Why Antcolos prepared it by itself, when it did. */
  preparedBecause?: string;
  /** Requirements the context could not fill. A draft with holes is not sent. */
  missing: TemplateRequirement[];

  createdAt: IsoDateTime;
  reviewedAt?: IsoDateTime;
  reviewedByName?: string;
  sentAt?: IsoDateTime;
  sentByName?: string;
  sendMethod?: SendMethod;
  supersededReason?: string;
}

/**
 * One conversation: this carrier, this broker, this piece of work.
 *
 * Keyed to the dispatch cycle rather than to a load, because the conversation
 * starts before there is a load — the first inquiry is about a listing nobody
 * has booked — and must not be split in two when the booking happens.
 */
export interface CommunicationThread {
  threadId: string;
  organizationId: string;
  carrierOrganizationId: string;
  carrierName: string;
  dispatchCycleId: string;
  /** Set once the cycle has a load on it. */
  loadId?: string;
  loadReference?: string;
  listingId?: string;
  brokerName: string;
  brokerEmail?: string;
  lane: string;
  createdAt: IsoDateTime;
  messages: OutreachMessage[];
}

/** A thread with the counts a list needs without walking every message. */
export interface ThreadSummary {
  thread: CommunicationThread;
  waitingForYou: number;
  sent: number;
  lastActivityAt: IsoDateTime;
}
