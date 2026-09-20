import { CATEGORY_LABEL, type NeedsYouCategory } from "@/types";

/**
 * Work types, grouped by the module that raises them.
 *
 * Seventy-eight categories is not a list a person reads. It is, however, a list
 * a person can NAVIGATE, because every one of them is raised by a module that
 * already exists in the nav — Compliance raises the compliance ones, the
 * maintenance registry raises the maintenance ones, and so on. Grouping them
 * that way turns "find the chip" into "open the module you were thinking of".
 *
 * ★ EXHAUSTIVE ON PURPOSE ★
 * `CATEGORY_MODULE` is a `Record<NeedsYouCategory, …>` rather than a partial
 * map with a fallback bucket. Adding a category to `NeedsYouCategory` and
 * forgetting it here is a type error, not a work type that silently disappears
 * from the only surface that can filter for it.
 */

export type NeedsYouModule =
  | "dispatch"
  | "tracking"
  | "mt_loop"
  | "fleet"
  | "maintenance"
  | "compliance"
  | "insurance"
  | "fuel"
  | "eld"
  | "documents"
  | "accounting"
  | "contracts"
  | "workforce"
  | "access"
  | "audit";

/**
 * Fixed order, and it is the nav's order rather than the alphabet's.
 *
 * Somebody looking for "the compliance ones" is looking in the place the app
 * has already taught them compliance lives.
 */
export const NEEDS_YOU_MODULE_ORDER: readonly NeedsYouModule[] = [
  "mt_loop",
  "dispatch",
  "tracking",
  "compliance",
  "maintenance",
  "insurance",
  "documents",
  "accounting",
  "contracts",
  "workforce",
  "access",
  "fleet",
  "eld",
  "fuel",
  "audit",
];

export const MODULE_LABEL: Record<NeedsYouModule, string> = {
  dispatch: "Dispatch & loads",
  tracking: "Tracking",
  mt_loop: "MT Loop",
  fleet: "Fleet",
  maintenance: "Maintenance",
  compliance: "Safety & Compliance",
  insurance: "Insurance & claims",
  fuel: "Fuel & IFTA",
  eld: "ELD & Telematics",
  documents: "Documents",
  accounting: "Accounting",
  contracts: "Contracts",
  workforce: "Workforce & HR",
  access: "Access and invitations",
  audit: "Audit & risk",
};

export const CATEGORY_MODULE: Record<NeedsYouCategory, NeedsYouModule> = {
  invitation_acceptance_incomplete: "access",

  /* Import. Routed to WORKFORCE rather than a module of its own: the question
     is who somebody on this carrier's roster is, and the people who can answer
     it are the people who run the roster. */
  import_claim_unresolved: "workforce",

  /* Dispatch & loads */
  rate_con_verification: "dispatch",
  unassigned_load: "dispatch",
  missing_equipment: "dispatch",
  customer_response: "dispatch",

  /* Tracking */
  status_confirmation: "tracking",
  eta_risk: "tracking",
  detention: "tracking",
  stale_location: "tracking",

  /* Documents */
  missing_document: "documents",
  expiring_document: "documents",

  /* Accounting */
  settlement_review: "accounting",
  settlement_missing_data: "accounting",
  settlement_dispute: "accounting",
  settlement_payment_overdue: "accounting",
  invoice_review: "accounting",
  invoice_dispute: "accounting",
  invoice_overdue: "accounting",

  /* Fuel & IFTA */
  missing_fuel_receipt: "fuel",
  invalid_mileage: "fuel",
  duplicate_fuel_purchase: "fuel",
  suspicious_fuel_transaction: "fuel",
  incomplete_ifta_period: "fuel",

  /* ELD & Telematics */
  telemetry_stale: "eld",
  telemetry_binding_broken: "eld",
  telemetry_device_disconnected: "eld",
  telemetry_odometer_conflict: "eld",
  telematics_diagnostic: "eld",

  /* Safety & Compliance */
  compliance_missing: "compliance",
  compliance_rejected: "compliance",
  compliance_expiring: "compliance",
  compliance_expired: "compliance",
  compliance_critical: "compliance",

  /* Workforce & HR. The qualification-file items sit here rather than under
     Documents: they are about a carrier's custody of evidence about a person,
     and somebody looking for them is thinking about the person. */
  workforce_applicant_review: "workforce",
  workforce_onboarding_blocked: "workforce",
  workforce_start_approval: "workforce",
  workforce_offboarding_incomplete: "workforce",
  qualification_review_required: "workforce",
  qualification_replacement_available: "workforce",

  /* Fleet */
  invalid_assignment: "fleet",
  equipment_unavailable: "fleet",
  operational_blocker: "fleet",

  /* Maintenance */
  overdue_service: "maintenance",
  critical_defect: "maintenance",
  unresolved_repair: "maintenance",
  equipment_out_of_service: "maintenance",

  /* Insurance & claims */
  missing_coverage: "insurance",
  expiring_policy: "insurance",
  expired_policy: "insurance",
  unresolved_claim: "insurance",
  missing_claim_evidence: "insurance",
  critical_insurance_gap: "insurance",

  /* MT Loop */
  truck_going_empty: "mt_loop",
  unassigned_loop: "mt_loop",
  missing_availability: "mt_loop",
  operating_authority: "mt_loop",
  blocked_loop: "mt_loop",
  assignment_conflict: "mt_loop",
  dispatch_escalation: "mt_loop",
  sla_deadline: "mt_loop",
  no_search: "mt_loop",
  draft_waiting: "mt_loop",
  expiring_opportunity: "mt_loop",
  broker_replied: "mt_loop",
  offer_expiring: "mt_loop",
  agreed_not_booked: "mt_loop",
  driver_consent: "mt_loop",
  broker_profile_unlinked: "mt_loop",
  message_waiting: "mt_loop",
  ratecon_waiting: "mt_loop",
  ratecon_disagrees: "mt_loop",
  ratecon_missing: "mt_loop",
  driver_review_waiting: "mt_loop",
  driver_blocked: "mt_loop",
  driver_countered: "mt_loop",

  /* Contracts */
  contract_signature_missing: "contracts",
  contract_expiring: "contracts",
  contract_expired: "contracts",
  contract_requirement_unmet: "contracts",
  contract_termination_unresolved: "contracts",
  contract_review_waiting: "contracts",

  /* Audit & risk */
  risk_case_assigned: "audit",
  risk_case_critical: "audit",
  risk_case_overdue: "audit",
  // A projection that could not finish, or that needs a person to decide
  // something a rule must not: both are data-integrity work, and Audit & risk
  // is where this workspace looks at data it cannot trust.
  projection_failed: "audit",
  projection_needs_review: "audit",
};

export interface WorkTypeGroup {
  module: NeedsYouModule;
  label: string;
  categories: NeedsYouCategory[];
  /** How many items on screen carry a work type in this group. */
  count: number;
}

/**
 * Turn the work types actually present into groups worth rendering.
 *
 * Two rules keep it honest:
 *   • Only work types the current view actually contains are offered, so the
 *     panel never suggests a filter that would empty the list.
 *   • A work type that is SELECTED stays offered even if nothing on screen
 *     carries it, because a selection you cannot see is a selection you cannot
 *     clear.
 */
export function groupWorkTypes({
  counts, selected, query,
}: {
  counts: Map<NeedsYouCategory, number>;
  selected: readonly NeedsYouCategory[];
  /** Free text typed into the Work type search box. */
  query?: string;
}): WorkTypeGroup[] {
  const present = new Set<NeedsYouCategory>([...counts.keys(), ...selected]);
  const q = query?.trim().toLowerCase();

  return NEEDS_YOU_MODULE_ORDER.map<WorkTypeGroup>((module) => {
    const categories = [...present]
      .filter((c) => CATEGORY_MODULE[c] === module)
      .filter(
        (c) =>
          !q ||
          CATEGORY_LABEL[c].toLowerCase().includes(q) ||
          MODULE_LABEL[module].toLowerCase().includes(q),
      )
      .sort((a, b) => CATEGORY_LABEL[a].localeCompare(CATEGORY_LABEL[b]));

    return {
      module,
      label: MODULE_LABEL[module],
      categories,
      count: categories.reduce((n, c) => n + (counts.get(c) ?? 0), 0),
    };
  }).filter((g) => g.categories.length > 0);
}
