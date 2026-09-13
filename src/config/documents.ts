import type { DocumentKind, OcrState, VerificationState } from "@/types";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  rate_confirmation: "Rate confirmation",
  bill_of_lading: "Bill of lading",
  proof_of_delivery: "Proof of delivery",
  scale_ticket: "Scale ticket",
  lumper_receipt: "Lumper receipt",
  invoice: "Invoice",
  settlement_statement: "Settlement statement",
  carrier_packet: "Carrier packet",
  certificate_of_insurance: "Certificate of insurance",
  w9: "W-9",
  driver_license: "Driver licence",
  medical_card: "Medical card",
  equipment_registration: "Equipment registration",
  other: "Other",
};

export const OCR_STATE_LABEL: Record<OcrState, string> = {
  not_applicable: "Not parsed",
  pending: "Queued",
  processing: "Reading",
  succeeded: "Extracted",
  failed: "Extraction failed",
};

export const VERIFICATION_STATE_LABEL: Record<VerificationState, string> = {
  not_required: "No review needed",
  pending: "Awaiting review",
  verified: "Verified",
  rejected: "Rejected",
  superseded: "Superseded",
};

export const EVENT_SOURCE_LABEL: Record<string, string> = {
  web: "Web",
  telegram: "Telegram",
  eld: "ELD",
  ocr: "Document extraction",
  email: "Email",
  api: "API",
  system: "Antcolos",
};
