import type {
  Address, Cents, Contact, CurrencyCode, IsoDateTime,
} from "./common";
import type { DocumentKind, VerificationState } from "./document";
import type { EquipmentType } from "./load";
import type { ActorRef } from "./user";

/**
 * THE invoice.
 *
 * An invoice is a financial claim a carrier makes against a payer for one
 * load. It is the only place in Antcolos where money is asserted to somebody
 * outside the organization, so it obeys two rules the rest of the product does
 * not need:
 *
 *  1. IT IS IMMUTABLE ONCE ISSUED IN SPIRIT. Line items, totals and snapshots
 *     may only change while the invoice is still a draft. After that, change
 *     happens by appending — a payment, a dispute, a void — never by editing
 *     history. `version` and `audit` record every step.
 *
 *  2. IT NEVER RE-READS UPSTREAM PROFILES. The load, the rate confirmation,
 *     the billing party and the carrier all live in their own modules and are
 *     referenced by permanent id. What is COPIED here is a snapshot taken at
 *     invoice time. When a broker renames itself or moves its remit-to address
 *     next year, last year's invoices still say what was actually billed.
 *
 * Loads, Rate Confirmations, PODs, Documents, Broker/Shipper profiles,
 * Detention, Layover and the other accessorials are OWNED ELSEWHERE. Nothing
 * in this module creates, edits or replaces one of those records. The typed
 * inputs in `lib/api/contracts/invoices.ts` are the only way data enters.
 */

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where the claim stands. `needs_documents` and `overdue` are DERIVED
 * conditions that are stored denormalized so a list does not have to compute
 * them per row — the readiness check and the due date remain authoritative.
 */
export type InvoiceStatus =
  /** Being assembled. The only status in which amounts may still change. */
  | "draft"
  /** Assembled, but a required document is missing or rejected. */
  | "needs_documents"
  /** Every readiness check passes. Waiting for somebody to send it. */
  | "ready"
  /** Sent to the payer. Antcolos does not send it — a person records that. */
  | "submitted"
  /** The payer has contested some or all of it. */
  | "disputed"
  /** Money arrived, but less than the balance. */
  | "partially_paid"
  /** Balance is zero. Terminal. */
  | "paid"
  /** Past the due date with a balance outstanding. */
  | "overdue"
  /** Withdrawn. Terminal, and never deleted — a void is part of the record. */
  | "void";

export const INVOICE_TERMINAL_STATUSES: readonly InvoiceStatus[] = ["paid", "void"];

/** Statuses in which the invoice is a live receivable. */
export const INVOICE_OPEN_STATUSES: readonly InvoiceStatus[] = [
  "submitted", "disputed", "partially_paid", "overdue",
];

/* -------------------------------------------------------------------------- */
/* Line items                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The charge vocabulary. Detention, layover, lumper and TONU are named kinds
 * rather than free text because each one is approved by a different module and
 * each one needs different evidence.
 */
export type InvoiceLineItemKind =
  | "linehaul"
  | "detention"
  | "layover"
  | "lumper"
  | "tonu"
  | "fuel_surcharge"
  | "stop_off"
  | "reconsignment"
  | "other";

/** How a metered charge was measured. Detention is hours; layover is days. */
export type InvoiceLineUnit = "hours" | "days" | "miles" | "stops" | "each";

/**
 * Which module confirmed a charge. An invoice never invents money: every line
 * points back at the record that authorized it, and an accessorial with no
 * approval is not billable.
 */
export type InvoiceLineSourceModule =
  | "rate_confirmation"
  | "accessorial"
  | "detention"
  | "layover"
  | "manual";

export interface InvoiceLineSource {
  module: InvoiceLineSourceModule;
  /** Permanent id in the owning module. Absent only for a manual line. */
  referenceId?: string;
  /**
   * Who approved the charge, in the module that owns it — not in Invoices.
   * Required for every kind except linehaul, which the rate confirmation
   * already authorizes.
   */
  approvedBy?: ActorRef;
  approvedAt?: IsoDateTime;
  /** The document that proves the charge: lumper receipt, detention log, POD. */
  evidenceDocumentId?: string;
}

export interface InvoiceLineItem {
  id: string;
  kind: InvoiceLineItemKind;
  /** What the payer will read on the invoice. */
  label: string;
  /** Present for metered charges. 2.5 hours of detention at $65.00/hr. */
  quantity?: number;
  unit?: InvoiceLineUnit;
  unitAmountCents?: Cents;
  /** Always authoritative, even when quantity and unit amount are present. */
  amountCents: Cents;
  source: InvoiceLineSource;
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/* Snapshots — copies, not links                                               */
/* -------------------------------------------------------------------------- */

/** The carrier being paid. Copied so a later rebrand cannot rewrite history. */
export interface CarrierSnapshot {
  /** The permanent organization. Also the data-isolation key on the invoice. */
  organizationId: string;
  legalName: string;
  displayName: string;
  dotNumber?: string;
  mcNumber?: string;
  remitToAddress?: Address;
  billingEmail?: string;
}

/**
 * Who pays. A broker or a shipper in nearly every case, but a factoring
 * company or another approved payer is legitimate and is not a customer
 * record, so the kind is explicit.
 */
export type BillingPartyKind = "broker" | "shipper" | "factoring_company" | "other_payer";

export interface BillingPartySnapshot {
  /** Permanent id in the Broker/Shipper module. Never re-read for display. */
  partyId: string;
  kind: BillingPartyKind;
  name: string;
  mcNumber?: string;
  billingContact?: Contact;
  billingAddress?: Address;
  /** Net terms as agreed at invoice time. Drives the due date. */
  paymentTermsDays: number;
  /** Some payers will not pay against scans. Blocks readiness when true. */
  requiresOriginalDocuments?: boolean;
  /** Where the invoice has to be submitted, when it is not email. */
  submissionPortal?: string;
}

/** The load being billed. The permanent load stays in the Loads module. */
export interface LoadSnapshot {
  loadId: string;
  reference: string;
  /** The payer's own load or order number, as printed on the rate con. */
  customerReference?: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickedUpAt?: IsoDateTime;
  deliveredAt?: IsoDateTime;
  equipment: EquipmentType;
  loadedMiles: number;
  /** Attribution only. The driver record lives in the Drivers module. */
  driverNameSnapshot?: string;
}

/** The agreement the invoice is built on. Owned by the Rate Confirmation module. */
export interface RateConfirmationSnapshot {
  rateConfirmationId: string;
  /** The stored rate con document, when one has been filed. */
  documentId?: string;
  /** What the rate con says the linehaul is. A mismatch fails readiness. */
  agreedLinehaulCents: Cents;
  /** Accessorial codes the rate con pre-authorizes without further approval. */
  preApprovedAccessorialCodes?: string[];
  receivedAt: IsoDateTime;
  verifiedAt?: IsoDateTime;
}

/**
 * A document the payer requires. The document itself belongs to the Documents
 * module; this is the reference plus enough of a snapshot to render the row
 * and to prove what was attached at the time.
 */
export interface InvoiceDocumentRef {
  kind: DocumentKind;
  /** Blocks readiness when missing. Some documents are merely useful. */
  required: boolean;
  /** Permanent document id. Absent when the requirement is unmet. */
  documentId?: string;
  fileNameSnapshot?: string;
  /** Document version at attach time. A later version does not rewrite this. */
  versionSnapshot?: number;
  verificationStateSnapshot?: VerificationState;
  attachedAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Payment, dispute, submission                                                */
/* -------------------------------------------------------------------------- */

export type PaymentMethod = "ach" | "check" | "wire" | "factoring" | "other";

/**
 * A payment RECORDED by a person. Antcolos moves no money and is connected to
 * no bank or accounting system; every entry here is somebody saying what
 * arrived, and the audit trail says who.
 */
export interface InvoicePayment {
  id: string;
  amountCents: Cents;
  currency: CurrencyCode;
  method: PaymentMethod;
  receivedAt: IsoDateTime;
  /** Check number, ACH trace, factoring advice number. */
  reference?: string;
  note?: string;
  recordedBy: ActorRef;
  recordedAt: IsoDateTime;
}

export type DisputeReasonCode =
  | "missing_documents"
  | "rate_mismatch"
  | "accessorial_rejected"
  | "duplicate_invoice"
  | "load_not_recognized"
  | "other";

export interface InvoiceDispute {
  openedAt: IsoDateTime;
  openedBy: ActorRef;
  reasonCode: DisputeReasonCode;
  detail: string;
  /** What the payer is contesting. Absent means the whole invoice. */
  disputedAmountCents?: Cents;
  resolvedAt?: IsoDateTime;
  resolvedBy?: ActorRef;
  resolution?: string;
}

export type SubmissionChannel = "email" | "portal" | "factoring" | "manual";

/**
 * The record that an invoice was sent. Antcolos does NOT send it: no email is
 * dispatched, no portal is called, nothing is submitted to a factor. A person
 * sends it and records that here, which is why `deliveryConfirmed` is always
 * false for now and the field exists rather than being implied.
 */
export interface InvoiceSubmission {
  submittedAt: IsoDateTime;
  submittedBy: ActorRef;
  channel: SubmissionChannel;
  /** Where it went: an address, a portal name, a factoring batch. */
  destination?: string;
  reference?: string;
  note?: string;
  /** Always false until real sending exists. Never inferred from submittedAt. */
  deliveryConfirmed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export type InvoiceAuditAction =
  | "created"
  | "line_item_added"
  | "line_item_updated"
  | "line_item_removed"
  | "documents_refreshed"
  | "billing_party_changed"
  | "status_changed"
  | "submitted"
  | "payment_recorded"
  | "dispute_opened"
  | "dispute_resolved"
  | "voided"
  | "note";

export interface InvoiceAuditEntry {
  id: string;
  /** The version this entry produced. Version 1 is creation. */
  version: number;
  at: IsoDateTime;
  actor: ActorRef;
  action: InvoiceAuditAction;
  /** For status changes. Both sides are recorded, never just the new one. */
  fromStatus?: InvoiceStatus;
  toStatus?: InvoiceStatus;
  /** Field paths this entry touched, for a diff-style reading of history. */
  changedFields?: string[];
  note?: string;
  /** Money the entry moved, when it moved any. */
  amountCents?: Cents;
}

/* -------------------------------------------------------------------------- */
/* The entity                                                                  */
/* -------------------------------------------------------------------------- */

export interface Invoice {
  /**
   * Immutable UUID. Assigned once, never reused, never reissued, never parsed.
   * A voided invoice keeps its id; a replacement gets a new one and points
   * back with `replacesInvoiceId`.
   */
  id: string;
  /**
   * The carrier organization that owns this invoice. Every service call is
   * partitioned by it — this is the carrier data-isolation key.
   */
  organizationId: string;
  /**
   * Human-facing number, unique WITHIN the organization and nowhere else. Two
   * carriers may both have INV-2026-0001; they are different invoices.
   */
  number: string;
  status: InvoiceStatus;
  currency: CurrencyCode;

  /** Who is owed. Snapshot of the carrier organization at invoice time. */
  carrier: CarrierSnapshot;
  /** Who owes. Snapshot of the broker, shipper or other approved payer. */
  billingParty: BillingPartySnapshot;

  /** Permanent load reference. The Loads module owns the record. */
  loadId: string;
  /** Snapshot of the load as billed. */
  load: LoadSnapshot;
  /** Permanent rate confirmation reference plus its agreed terms. */
  rateConfirmation?: RateConfirmationSnapshot;

  /** The base freight charge, mirrored from the linehaul line item. */
  linehaulCents: Cents;
  /** Linehaul first, then approved accessorials in the order they were added. */
  lineItems: InvoiceLineItem[];
  /** Sum of every line item. */
  subtotalCents: Cents;
  /** What the payer owes. Equals the subtotal until taxes or fees exist. */
  totalCents: Cents;
  /** Sum of recorded payments. */
  amountPaidCents: Cents;
  /** totalCents − amountPaidCents. Never negative in the UI's reading. */
  balanceCents: Cents;

  /** Set when the invoice leaves draft. A draft has no issue date. */
  issueDate?: IsoDateTime;
  /** issueDate + the billing party's net terms. */
  dueDate?: IsoDateTime;
  paymentTermsDays: number;

  /** What the payer requires, and what is actually attached. */
  documents: InvoiceDocumentRef[];
  payments: InvoicePayment[];
  dispute?: InvoiceDispute;
  submission?: InvoiceSubmission;

  /** Incremented by every recorded change. Creation is version 1. */
  version: number;
  /** Append-only. Never edited, never trimmed. */
  audit: InvoiceAuditEntry[];

  createdAt: IsoDateTime;
  createdBy: ActorRef;
  updatedAt: IsoDateTime;
  voidedAt?: IsoDateTime;
  voidedBy?: ActorRef;
  voidReason?: string;
  /** Set on the replacement when a voided invoice is reissued. */
  replacesInvoiceId?: string;
}

/* -------------------------------------------------------------------------- */
/* Readiness                                                                   */
/* -------------------------------------------------------------------------- */

export type ReadinessCheckState = "pass" | "fail" | "warn";

export type ReadinessCheckId =
  | "load_delivered"
  | "rate_confirmation"
  | "linehaul_matches_rate_con"
  | "required_documents"
  | "documents_verified"
  | "accessorials_approved"
  | "billing_party_billable"
  | "total_positive";

export interface InvoiceReadinessCheck {
  id: ReadinessCheckId;
  label: string;
  state: ReadinessCheckState;
  /** Why it is in this state, in the biller's language. */
  detail: string;
  /** A warning never blocks; a failure always does. */
  blocking: boolean;
}

export interface InvoiceReadiness {
  /** True when no check is failing. Warnings do not block. */
  ready: boolean;
  checks: InvoiceReadinessCheck[];
  /** Document kinds that are required and not satisfied. */
  missingDocumentKinds: DocumentKind[];
}

/* -------------------------------------------------------------------------- */
/* Derived helpers — pure functions over the entity, no service calls          */
/* -------------------------------------------------------------------------- */

export function invoiceSubtotalCents(lineItems: readonly InvoiceLineItem[]): Cents {
  return lineItems.reduce((sum, item) => sum + item.amountCents, 0);
}

export function invoiceAmountPaidCents(payments: readonly InvoicePayment[]): Cents {
  return payments.reduce((sum, p) => sum + p.amountCents, 0);
}

export function invoiceBalanceCents(invoice: Invoice): Cents {
  return invoice.totalCents - invoice.amountPaidCents;
}

/** Accessorials only — the lines that needed an approval to exist. */
export function accessorialLineItems(invoice: Invoice): InvoiceLineItem[] {
  return invoice.lineItems.filter((l) => l.kind !== "linehaul");
}

export function missingInvoiceDocuments(invoice: Invoice): InvoiceDocumentRef[] {
  return invoice.documents.filter((d) => d.required && !d.documentId);
}

/**
 * A document that is attached but was rejected does not satisfy anything. The
 * snapshot is what counts here, not whatever the Documents module says today.
 */
export function rejectedInvoiceDocuments(invoice: Invoice): InvoiceDocumentRef[] {
  return invoice.documents.filter(
    (d) => d.documentId && d.verificationStateSnapshot === "rejected",
  );
}

export function isInvoiceTerminal(invoice: Invoice): boolean {
  return INVOICE_TERMINAL_STATUSES.includes(invoice.status);
}

/** Only a draft may have its money changed. Everything later is append-only. */
export function isInvoiceEditable(invoice: Invoice): boolean {
  return invoice.status === "draft" || invoice.status === "needs_documents";
}

/** Past due with a balance. A draft is never overdue, however old it is. */
export function isInvoiceOverdue(invoice: Invoice, now = Date.now()): boolean {
  if (!invoice.dueDate) return false;
  if (isInvoiceTerminal(invoice)) return false;
  if (invoice.status === "draft" || invoice.status === "needs_documents") return false;
  if (invoice.balanceCents <= 0) return false;
  return new Date(invoice.dueDate).getTime() < now;
}

/** Negative while the invoice is still inside terms. */
export function invoiceDaysPastDue(invoice: Invoice, now = Date.now()): number | null {
  if (!invoice.dueDate) return null;
  return Math.floor((now - new Date(invoice.dueDate).getTime()) / 86_400_000);
}

export function invoiceAgeDays(invoice: Invoice, now = Date.now()): number {
  const from = invoice.issueDate ?? invoice.createdAt;
  return Math.floor((now - new Date(from).getTime()) / 86_400_000);
}
