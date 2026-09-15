import type {
  BillingPartyKind, Cents, DisputeReasonCode, DocumentKind, EquipmentType,
  Invoice, InvoiceLineItemKind, InvoiceLineUnit, InvoiceReadiness,
  InvoiceStatus, Page, PageRequest, PaymentMethod, SubmissionChannel,
  VerificationState,
} from "@/types";
import type { ServiceContext } from "./context";

/* ========================================================================== */
/* INBOUND SEAM — what other modules hand to Invoices                          */
/* ========================================================================== */

/**
 * Loads, Rate Confirmations, PODs, Documents, Broker/Shipper profiles,
 * Detention, Layover and the other accessorials are separate modules. Invoices
 * does not read their tables and does not rebuild their records: it receives
 * the types below, keeps the permanent id, and copies a snapshot.
 *
 * Everything here is CONFIRMED data. A load that has not delivered, an
 * accessorial nobody approved and an unverified rate confirmation are the
 * upstream module's problem to resolve before it hands anything over — this
 * seam has no shape in which to express "probably".
 */

/** From the Loads module: a load that is finished and may be billed. */
export interface ConfirmedLoadInput {
  loadId: string;
  organizationId: string;
  reference: string;
  customerReference?: string;
  /** The broker, shipper or other payer the load was booked for. */
  billingPartyId: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickedUpAt?: string;
  /** Absent means not delivered, which the readiness check will block on. */
  deliveredAt?: string;
  equipment: EquipmentType;
  loadedMiles: number;
  driverNameSnapshot?: string;
}

/** From the Rate Confirmation module: the agreement the invoice rests on. */
export interface ConfirmedRateConfirmationInput {
  rateConfirmationId: string;
  loadId: string;
  documentId?: string;
  agreedLinehaulCents: Cents;
  /** Accessorial kinds this rate con authorizes without separate approval. */
  preApprovedAccessorialCodes?: string[];
  receivedAt: string;
  /** Set once a person has checked the extraction against the document. */
  verifiedAt?: string;
}

/**
 * From Detention, Layover, Lumper, TONU and the other accessorial modules.
 * An accessorial reaches Invoices only after it is approved THERE; the
 * approver and the evidence travel with it, which is what makes the line
 * defensible when the payer pushes back.
 */
export interface ApprovedAccessorialInput {
  accessorialId: string;
  loadId: string;
  kind: InvoiceLineItemKind;
  label: string;
  quantity?: number;
  unit?: InvoiceLineUnit;
  unitAmountCents?: Cents;
  amountCents: Cents;
  approvedByMembershipId: string;
  approvedByDisplayName: string;
  approvedAt: string;
  evidenceDocumentId?: string;
  notes?: string;
}

/** From the Broker/Shipper module: who pays and on what terms. */
export interface BillingPartyInput {
  partyId: string;
  kind: BillingPartyKind;
  name: string;
  mcNumber?: string;
  billingContactName?: string;
  billingEmail?: string;
  billingPhone?: string;
  billingAddressLine1?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  paymentTermsDays: number;
  requiresOriginalDocuments?: boolean;
  submissionPortal?: string;
}

/** From the Documents module: what the payer requires, and what exists. */
export interface DocumentRequirementInput {
  kind: DocumentKind;
  required: boolean;
  documentId?: string;
  fileName?: string;
  version?: number;
  verificationState?: VerificationState;
}

/**
 * One load's worth of confirmed upstream data. This is the whole inbound
 * surface: if a field is not on this packet, Invoices does not know it.
 */
export interface InvoiceSourcePacket {
  load: ConfirmedLoadInput;
  billingParty: BillingPartyInput;
  rateConfirmation?: ConfirmedRateConfirmationInput;
  approvedAccessorials: ApprovedAccessorialInput[];
  documents: DocumentRequirementInput[];
}

/**
 * A load the Loads module says is billable, as offered to the biller. Carries
 * just enough to choose one; the full packet is fetched when it is picked.
 */
export interface InvoiceableLoad {
  loadId: string;
  reference: string;
  billingPartyName: string;
  lane: string;
  deliveredAt?: string;
  totalRateCents: Cents;
  missingDocumentKinds: DocumentKind[];
  /** Set when this load already has a non-void invoice. */
  existingInvoiceId?: string;
}

/* ========================================================================== */
/* QUERIES                                                                     */
/* ========================================================================== */

export interface InvoiceFilters {
  /** Matches invoice number, load reference, customer reference, payer name. */
  search?: string;
  status?: InvoiceStatus[];
  /** Named groupings the UI offers as tabs. */
  view?:
    | "all" | "draft" | "needs_documents" | "ready" | "outstanding"
    | "overdue" | "disputed" | "paid" | "void";
  billingPartyId?: string;
  loadId?: string;
  /** Issue date range, inclusive. */
  issuedFrom?: string;
  issuedTo?: string;
  /** Only invoices past their due date with a balance. */
  overdueOnly?: boolean;
  /** Only invoices missing at least one required document. */
  missingDocuments?: boolean;
  minTotalCents?: Cents;
}

export type InvoiceSortField =
  | "number" | "issueDate" | "dueDate" | "total" | "balance"
  | "billingParty" | "status" | "age";

export interface InvoiceSort {
  field: InvoiceSortField;
  direction: "asc" | "desc";
}

/** Aggregates for the list header. Computed over the caller's visible set. */
export interface InvoiceSummary {
  currency: "USD";
  draftCount: number;
  needsDocumentsCount: number;
  readyCount: number;
  outstandingCount: number;
  outstandingCents: Cents;
  overdueCount: number;
  overdueCents: Cents;
  disputedCount: number;
  disputedCents: Cents;
  paidLast30DaysCents: Cents;
}

/* ========================================================================== */
/* MUTATION INPUTS                                                             */
/* ========================================================================== */

export interface CreateInvoiceInput {
  /** The load being billed. Its packet is read from the upstream modules. */
  loadId: string;
  /**
   * Override the payer when the load's customer is not who pays — a shipper
   * billing through a broker, or an approved third-party payer. Must be a
   * party the Broker/Shipper module has approved for this organization.
   */
  billingPartyId?: string;
  /** Defaults to the billing party's terms. */
  paymentTermsDays?: number;
  note?: string;
}

export interface AddLineItemInput {
  kind: InvoiceLineItemKind;
  label: string;
  quantity?: number;
  unit?: InvoiceLineUnit;
  unitAmountCents?: Cents;
  amountCents: Cents;
  /** The approved accessorial this line bills. Absent makes it a manual line. */
  accessorialId?: string;
  evidenceDocumentId?: string;
  notes?: string;
}

export interface RecordPaymentInput {
  amountCents: Cents;
  method: PaymentMethod;
  receivedAt: string;
  reference?: string;
  note?: string;
}

export interface SubmitInvoiceInput {
  channel: SubmissionChannel;
  destination?: string;
  reference?: string;
  note?: string;
}

export interface OpenDisputeInput {
  reasonCode: DisputeReasonCode;
  detail: string;
  disputedAmountCents?: Cents;
}

export interface VoidInvoiceInput {
  reason: string;
}

/* ========================================================================== */
/* SERVICE                                                                     */
/* ========================================================================== */

/**
 * The invoice seam.
 *
 * Every method takes a ServiceContext and enforces BOTH halves of access
 * itself: the permission the action needs, and carrier data isolation — an
 * invoice belonging to another carrier is NOT FOUND, never "forbidden", since
 * a 403 would confirm that another carrier has an invoice for that load.
 *
 * Deliberately absent, because the backend has not defined them: settlements,
 * reporting, real payment processing, real email or portal delivery, factoring
 * submission and accounting export. `submit` records that a person sent the
 * invoice; it sends nothing.
 */
export interface InvoicesService {
  list(
    ctx: ServiceContext,
    filters?: InvoiceFilters,
    sort?: InvoiceSort,
    page?: PageRequest,
  ): Promise<Page<Invoice>>;

  get(ctx: ServiceContext, invoiceId: string): Promise<Invoice>;

  /** Aggregates over everything the caller may see, after the same narrowing. */
  summary(ctx: ServiceContext): Promise<InvoiceSummary>;

  /** The readiness checks for one invoice, evaluated from its own snapshot. */
  readiness(ctx: ServiceContext, invoiceId: string): Promise<InvoiceReadiness>;

  /** Delivered loads the Loads module says may be billed. */
  invoiceableLoads(ctx: ServiceContext): Promise<InvoiceableLoad[]>;

  /** Builds a draft from the upstream packet. Copies snapshots; links by id. */
  create(ctx: ServiceContext, input: CreateInvoiceInput): Promise<Invoice>;

  addLineItem(
    ctx: ServiceContext, invoiceId: string, input: AddLineItemInput,
  ): Promise<Invoice>;

  removeLineItem(
    ctx: ServiceContext, invoiceId: string, lineItemId: string,
  ): Promise<Invoice>;

  /** Re-reads the Documents module and refreshes the attachment snapshots. */
  refreshDocuments(ctx: ServiceContext, invoiceId: string): Promise<Invoice>;

  /** Leaves draft: stamps the issue and due dates, then runs readiness. */
  issue(ctx: ServiceContext, invoiceId: string): Promise<Invoice>;

  /** Re-runs readiness on an issued invoice. Moves needs_documents ↔ ready. */
  recheck(ctx: ServiceContext, invoiceId: string): Promise<Invoice>;

  /** Records that a PERSON sent the invoice. Antcolos sends nothing. */
  submit(
    ctx: ServiceContext, invoiceId: string, input: SubmitInvoiceInput,
  ): Promise<Invoice>;

  /** Records money that arrived. No payment processor is connected. */
  recordPayment(
    ctx: ServiceContext, invoiceId: string, input: RecordPaymentInput,
  ): Promise<Invoice>;

  openDispute(
    ctx: ServiceContext, invoiceId: string, input: OpenDisputeInput,
  ): Promise<Invoice>;

  resolveDispute(
    ctx: ServiceContext, invoiceId: string, resolution: string,
  ): Promise<Invoice>;

  void(
    ctx: ServiceContext, invoiceId: string, input: VoidInvoiceInput,
  ): Promise<Invoice>;
}
