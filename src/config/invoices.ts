import type { badgeVariants } from "@/components/ui/badge";
import type {
  BillingPartyKind, DisputeReasonCode, InvoiceLineItemKind, InvoiceLineUnit,
  InvoiceStatus, PaymentMethod, SubmissionChannel,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

/**
 * One vocabulary for invoice state. The tones are deliberate: anything the
 * carrier is waiting on somebody else for is informational, anything the
 * carrier is holding up is a warning, and only money that is late or contested
 * is red.
 */
export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone; description: string }> = {
  draft: {
    label: "Draft", tone: "neutral",
    description: "Being assembled. Nothing has been billed to anyone yet.",
  },
  needs_documents: {
    label: "Needs documents", tone: "warning",
    description: "Issued, but a required document is missing or was rejected.",
  },
  ready: {
    label: "Ready", tone: "info",
    description: "Every readiness check passed. Waiting to be sent.",
  },
  submitted: {
    label: "Submitted", tone: "progress",
    description: "Recorded as sent to the payer and inside terms.",
  },
  disputed: {
    label: "Disputed", tone: "danger",
    description: "The payer is contesting some or all of this invoice.",
  },
  partially_paid: {
    label: "Partially paid", tone: "progress",
    description: "Money arrived, but a balance is still outstanding.",
  },
  paid: {
    label: "Paid", tone: "success",
    description: "Settled in full.",
  },
  overdue: {
    label: "Overdue", tone: "danger",
    description: "Past the due date with money still outstanding.",
  },
  void: {
    label: "Void", tone: "neutral",
    description: "Withdrawn. Kept, with its number, as part of the record.",
  },
};

export const INVOICE_LINE_KIND_LABEL: Record<InvoiceLineItemKind, string> = {
  linehaul: "Linehaul",
  detention: "Detention",
  layover: "Layover",
  lumper: "Lumper",
  tonu: "TONU",
  fuel_surcharge: "Fuel surcharge",
  stop_off: "Stop-off",
  reconsignment: "Reconsignment",
  other: "Other",
};

const INVOICE_LINE_UNIT_LABEL: Record<InvoiceLineUnit, [one: string, many: string]> = {
  hours: ["hr", "hrs"],
  days: ["day", "days"],
  miles: ["mi", "mi"],
  stops: ["stop", "stops"],
  each: ["each", "each"],
};

/** "1 day", "2.5 hrs" — a metered charge reads the way a biller says it. */
export function lineUnitLabel(unit: InvoiceLineUnit, quantity: number): string {
  const [one, many] = INVOICE_LINE_UNIT_LABEL[unit];
  return quantity === 1 ? one : many;
}

/** Where a charge was authorized. Shown on every accessorial line. */
export const LINE_SOURCE_LABEL: Record<string, string> = {
  rate_confirmation: "Rate confirmation",
  accessorial: "Accessorial module",
  detention: "Detention module",
  layover: "Layover module",
  manual: "Added by hand",
};

export const BILLING_PARTY_KIND_LABEL: Record<BillingPartyKind, string> = {
  broker: "Broker",
  shipper: "Shipper",
  factoring_company: "Factoring company",
  other_payer: "Other approved payer",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  factoring: "Factoring advance",
  other: "Other",
};

export const SUBMISSION_CHANNEL_LABEL: Record<SubmissionChannel, string> = {
  email: "Email",
  portal: "Customer portal",
  factoring: "Factoring company",
  manual: "By hand",
};

export const DISPUTE_REASON_LABEL: Record<DisputeReasonCode, string> = {
  missing_documents: "Missing documents",
  rate_mismatch: "Rate does not match the agreement",
  accessorial_rejected: "Accessorial rejected",
  duplicate_invoice: "Duplicate invoice",
  load_not_recognized: "Load not recognised",
  other: "Other",
};

export const INVOICE_AUDIT_LABEL: Record<string, string> = {
  created: "Created",
  line_item_added: "Line item added",
  line_item_updated: "Line item changed",
  line_item_removed: "Line item removed",
  documents_refreshed: "Documents refreshed",
  billing_party_changed: "Billing party changed",
  status_changed: "Status changed",
  submitted: "Submitted",
  payment_recorded: "Payment recorded",
  dispute_opened: "Dispute opened",
  dispute_resolved: "Dispute resolved",
  voided: "Voided",
  note: "Note",
};
