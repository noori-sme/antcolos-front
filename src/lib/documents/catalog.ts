import type { DocumentTypeKey, DocumentTypeMeta } from "@/types";

/**
 * THE document type catalog.
 *
 * A document type says what a document IS. It says nothing about who has to
 * supply it: that is a requirement, and requirements live in `requirements.ts`.
 * Keeping the two apart is what lets one W-9 type serve a carrier, a dispatch
 * organization and an individual dispatcher without three near-identical
 * copies, and what lets a type be required in one workspace and not applicable
 * in another.
 *
 * Adding a key here makes it available everywhere — the Document Center, the
 * checklists, the filters and the asset registries. There is nowhere else to
 * register one.
 */
export const DOCUMENT_TYPES: readonly DocumentTypeMeta[] = [
  // ---- Business identity and tax -----------------------------------------
  { key: "w9", label: "W-9", description: "So you can be paid and it can be reported correctly.", expires: false, subjects: ["organization", "driver"] },
  { key: "business_registration", label: "Business registration", description: "Articles of organization or incorporation for the company.", expires: false, subjects: ["organization"] },
  { key: "government_id", label: "Government photo ID", description: "A driver licence, passport or state ID for the person behind the workspace.", expires: true, subjects: ["organization", "driver"], restricted: true, restrictedReason: "Carries a government identifier and a date of birth." },
  { key: "voided_check", label: "Voided check or ACH form", description: "Where money should be sent. Bank details are never shown back once stored.", expires: false, subjects: ["organization"], restricted: true, restrictedReason: "Carries bank account and routing numbers." },

  // ---- Authority and compliance ------------------------------------------
  { key: "operating_authority", label: "Operating authority", description: "The FMCSA authority letter granting the right to haul for hire.", expires: false, subjects: ["organization"] },
  { key: "mc_authority_letter", label: "MC authority letter", description: "The MC number certificate as issued.", expires: false, subjects: ["organization"] },
  { key: "ifta_license", label: "IFTA licence", description: "Fuel tax licence for interstate operation.", expires: true, subjects: ["organization"] },
  { key: "safety_policy", label: "Written safety policy", description: "The company's safety programme as given to drivers.", expires: false, subjects: ["organization"] },
  { key: "drug_alcohol_policy", label: "Drug and alcohol programme", description: "Enrolment evidence for a DOT testing consortium.", expires: true, subjects: ["organization"], restricted: true, restrictedReason: "Relates to substance testing, which is handled apart from ordinary paperwork." },

  // ---- Insurance ---------------------------------------------------------
  { key: "certificate_of_insurance", label: "Certificate of insurance", description: "Liability and cargo coverage, with the certificate holder named.", expires: true, subjects: ["organization", "driver"] },
  { key: "errors_omissions_insurance", label: "Errors and omissions insurance", description: "Professional liability coverage for dispatch work.", expires: true, subjects: ["organization"] },
  { key: "workers_compensation", label: "Workers' compensation", description: "Coverage or an approved exemption for employees.", expires: true, subjects: ["organization"] },

  // ---- Agreements --------------------------------------------------------
  { key: "dispatch_service_agreement", label: "Dispatch service agreement", description: "The agreement between the dispatcher and the carrier they book for.", expires: false, subjects: ["organization"] },
  { key: "carrier_packet", label: "Carrier packet", description: "The completed onboarding packet a broker or shipper asks for.", expires: false, subjects: ["organization"] },
  { key: "lease_agreement", label: "Lease or operating agreement", description: "The agreement covering equipment run under somebody else's authority.", expires: false, subjects: ["organization", "driver", "truck", "trailer"] },
  { key: "signed_handbook", label: "Signed handbook", description: "The company handbook, signed by the person it applies to.", expires: false, subjects: ["driver"] },

  // ---- Driver ------------------------------------------------------------
  { key: "cdl", label: "Driver licence / CDL", description: "The licence the driver holds, front and back.", expires: true, subjects: ["driver"] },
  { key: "medical_card", label: "Medical card", description: "The current DOT medical examiner's certificate.", expires: true, subjects: ["driver"] },
  { key: "mvr", label: "Motor vehicle record", description: "The driving record pulled from the licensing state.", expires: true, subjects: ["driver"], restricted: true, restrictedReason: "A state-issued driving history, obtained for a stated purpose and not shared onward." },
  { key: "employment_application", label: "Employment application", description: "The DOT application covering the last three years of employment.", expires: false, subjects: ["driver"], restricted: true, restrictedReason: "Carries a social security number and prior-employer history." },

  // ---- Equipment ---------------------------------------------------------
  { key: "vehicle_registration", label: "Registration", description: "Current registration for the unit.", expires: true, subjects: ["truck", "trailer", "driver"] },
  { key: "vehicle_title", label: "Title", description: "Proof of legal ownership of the unit.", expires: false, subjects: ["truck", "trailer"] },
  { key: "vehicle_insurance", label: "Insurance", description: "Coverage evidence naming the unit.", expires: true, subjects: ["truck", "trailer"] },
  { key: "annual_inspection", label: "Annual inspection", description: "The last periodic DOT inspection report.", expires: true, subjects: ["truck", "trailer"] },
  { key: "cab_card", label: "Cab card", description: "The IRP cab card carried in the vehicle.", expires: true, subjects: ["truck"] },
  { key: "reefer_service_record", label: "Reefer service record", description: "The last service record for the refrigeration unit.", expires: true, subjects: ["trailer"] },
  { key: "tarp_securement_inventory", label: "Tarp and securement inventory", description: "What securement equipment travels with the trailer.", expires: false, subjects: ["trailer"] },

  // ---- Load paperwork — MODELLED, NOT BUILT -------------------------------
  // These exist so the Load document workflow can attach to this model later
  // without redesigning it. No load document workflow is built, and every
  // surface that shows one of these says so.
  { key: "rate_confirmation", label: "Rate confirmation", description: "The signed rate confirmation for a load.", expires: false, subjects: ["load"], future: true },
  { key: "bill_of_lading", label: "Bill of lading", description: "The BOL issued at pickup.", expires: false, subjects: ["load"], future: true },
  { key: "proof_of_delivery", label: "Proof of delivery", description: "The signed POD from the receiver.", expires: false, subjects: ["load"], future: true },
  { key: "lumper_receipt", label: "Lumper receipt", description: "A receipt for lumper or unloading charges.", expires: false, subjects: ["load"], future: true },
  { key: "scale_ticket", label: "Scale ticket", description: "A certified weight ticket.", expires: false, subjects: ["load"], future: true },
  { key: "detention_evidence", label: "Detention evidence", description: "Gate times, photographs or signed logs supporting a detention claim.", expires: false, subjects: ["load"], future: true },
  { key: "damage_document", label: "Damage document", description: "Photographs and notes recording damage to freight or equipment.", expires: false, subjects: ["load"], future: true },

  { key: "other", label: "Other document", description: "Anything asked for that has no category of its own.", expires: false, subjects: ["organization", "driver", "truck", "trailer", "load"] },
] as const;

const BY_KEY = new Map<DocumentTypeKey, DocumentTypeMeta>(
  DOCUMENT_TYPES.map((t) => [t.key, t]),
);

export function documentType(key: DocumentTypeKey): DocumentTypeMeta {
  const meta = BY_KEY.get(key);
  if (!meta) throw new Error(`Unknown document type: ${key}`);
  return meta;
}

export function documentTypeLabel(key: DocumentTypeKey): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Types that are modelled for a module that is not built yet. */
export function isFutureType(key: DocumentTypeKey): boolean {
  return Boolean(BY_KEY.get(key)?.future);
}

export function typesForSubject(kind: DocumentTypeMeta["subjects"][number]): DocumentTypeMeta[] {
  return DOCUMENT_TYPES.filter((t) => t.subjects.includes(kind));
}

/* -------------------------------------------------------------------------- */
/* Restricted categories                                                       */
/* -------------------------------------------------------------------------- */

/**
 * ★ WHAT JOINING AN ORGANIZATION DOES NOT HAND OVER ★
 *
 * Some paperwork is not ordinary paperwork. A social security number, a bank
 * account, a driving record pulled from the state, a substance-testing record:
 * access to one of these is its own decision, made per document, for a reason
 * somebody wrote down, by somebody holding the permission for it.
 *
 * It is never a consequence of accepting an invitation. That is the whole rule,
 * and it is enforced by `ordinaryDocumentKeys` below being the only function
 * the acceptance path may use to work out what to share — rather than by every
 * caller remembering to filter.
 *
 * This list is deliberately expressed over DOCUMENT TYPES rather than
 * requirement keys: a type is what a document IS, so a new checklist row for an
 * existing restricted type is restricted the moment it is added, with no second
 * place to remember.
 */
export function isRestrictedDocumentType(key: DocumentTypeKey): boolean {
  return documentType(key).restricted === true;
}

export function restrictedDocumentTypes(): DocumentTypeMeta[] {
  return DOCUMENT_TYPES.filter((t) => t.restricted === true);
}

/** What a restricted type is withheld FOR, in the words the person is shown. */
export function restrictedReason(key: DocumentTypeKey): string | undefined {
  return documentType(key).restrictedReason;
}
