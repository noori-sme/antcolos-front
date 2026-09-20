import type { AuditAction, AuditEventSource, AuditModule, AuditOutcome } from "@/types";

/**
 * The shared vocabulary: what each action is called on screen, which module it
 * belongs to, and whether it is permission-sensitive.
 *
 * "Permission-sensitive" is the flag the risk rules read. It marks the actions
 * where a refusal, or a success by somebody unexpected, is worth a second look
 * — not the actions that merely require a permission, which is all of them.
 */
export interface AuditActionMeta {
  readonly key: AuditAction;
  readonly label: string;
  readonly module: AuditModule;
  /** A refused attempt at this is worth raising a signal about. */
  readonly permissionSensitive?: boolean;
  /**
   * Changing this moves money, control or legal responsibility. These are the
   * ownership, Operating Authority, signer, banking and payout actions.
   */
  readonly highValue?: boolean;
}

export const AUDIT_ACTIONS: readonly AuditActionMeta[] = [
  { key: "access.signed_in", label: "Signed in", module: "access" },
  { key: "access.sign_in_failed", label: "Sign-in failed", module: "access", permissionSensitive: true },
  { key: "access.permission_granted", label: "Permission granted", module: "access", permissionSensitive: true, highValue: true },
  { key: "access.permission_revoked", label: "Permission revoked", module: "access", permissionSensitive: true },
  { key: "access.role_changed", label: "Role changed", module: "access", permissionSensitive: true },
  { key: "access.member_invited", label: "Member invited", module: "access", permissionSensitive: true },
  { key: "access.member_joined", label: "Member joined", module: "access" },
  // The RECIPIENT's refusal, which is not the sender's revoke. A carrier that
  // cannot tell the two apart re-sends the second kind forever.
  { key: "access.invitation_declined", label: "Invitation declined", module: "access" },
  { key: "access.member_suspended", label: "Member suspended", module: "access", permissionSensitive: true },
  { key: "access.member_reinstated", label: "Member reinstated", module: "access", permissionSensitive: true },
  { key: "access.scope_changed", label: "Record scope changed", module: "access", permissionSensitive: true },
  { key: "access.permission_denied", label: "Action refused", module: "access", permissionSensitive: true },
  { key: "access.cross_organization_attempt", label: "Cross-organization attempt", module: "access", permissionSensitive: true, highValue: true },
  { key: "access.export_performed", label: "Data exported", module: "access", permissionSensitive: true },

  { key: "organization.settings_changed", label: "Organization settings changed", module: "organization" },
  { key: "organization.ownership_changed", label: "Ownership changed", module: "organization", permissionSensitive: true, highValue: true },
  { key: "organization.operating_authority_changed", label: "Operating Authority changed", module: "organization", permissionSensitive: true, highValue: true },
  { key: "organization.signer_changed", label: "Authorized signer changed", module: "organization", permissionSensitive: true, highValue: true },
  { key: "organization.relationship_started", label: "Relationship started", module: "organization" },
  { key: "organization.relationship_ended", label: "Relationship ended", module: "organization", highValue: true },

  { key: "banking.details_changed", label: "Banking details changed", module: "banking", permissionSensitive: true, highValue: true },
  { key: "banking.payout_details_changed", label: "Payout details changed", module: "banking", permissionSensitive: true, highValue: true },

  { key: "documents.uploaded", label: "Document uploaded", module: "documents" },
  { key: "documents.replaced", label: "Document replaced", module: "documents" },
  { key: "documents.approved", label: "Document approved", module: "documents" },
  { key: "documents.rejected", label: "Document rejected", module: "documents" },
  { key: "documents.shared", label: "Document shared", module: "documents", permissionSensitive: true },
  { key: "documents.share_revoked", label: "Document share revoked", module: "documents" },
  { key: "documents.downloaded", label: "Document downloaded", module: "documents", permissionSensitive: true },

  { key: "loads.timeline_appended", label: "Load timeline entry", module: "loads" },
  { key: "dispatch.assignment_changed", label: "Assignment changed", module: "dispatch" },
  // Sharing a load's tracking with somebody outside the organization is a
  // disclosure, so the whole tracking history is marked permission-sensitive
  // rather than only the lines that mint a link.
  { key: "dispatch.tracking_changed", label: "Load tracking entry", module: "dispatch", permissionSensitive: true },
  { key: "fleet.record_changed", label: "Fleet record changed", module: "fleet" },
  { key: "drivers.record_changed", label: "Driver record changed", module: "drivers" },
  { key: "directory.party_changed", label: "Directory record changed", module: "directory" },
  { key: "fuel.ledger_changed", label: "Fuel ledger entry", module: "fuel" },
  { key: "compliance.requirement_changed", label: "Compliance requirement changed", module: "compliance" },
  { key: "maintenance.record_changed", label: "Maintenance record changed", module: "maintenance" },
  { key: "insurance.record_changed", label: "Insurance record changed", module: "insurance" },
  { key: "settlements.record_changed", label: "Settlement changed", module: "settlements" },
  { key: "invoices.record_changed", label: "Invoice changed", module: "invoices" },
  { key: "integrations.connection_changed", label: "Integration changed", module: "integrations", permissionSensitive: true },

  // The working relationship. None of these changes anybody's access: the two
  // that ask the access system for something record only that it was asked,
  // and the access system's own `access.*` line is what proves it happened.
  { key: "workforce.engagement_created", label: "Engagement created", module: "workforce" },
  { key: "workforce.onboarding_started", label: "Onboarding started", module: "workforce" },
  { key: "workforce.classification_changed", label: "Classification changed", module: "workforce", permissionSensitive: true },
  { key: "workforce.position_changed", label: "Position changed", module: "workforce" },
  { key: "workforce.manager_changed", label: "Manager changed", module: "workforce" },
  { key: "workforce.activated", label: "Engagement activated", module: "workforce", highValue: true },
  { key: "workforce.suspended", label: "Engagement suspended", module: "workforce", permissionSensitive: true },
  { key: "workforce.restored", label: "Engagement restored", module: "workforce" },
  { key: "workforce.ended", label: "Engagement ended", module: "workforce", permissionSensitive: true, highValue: true },
  { key: "workforce.rejected", label: "Candidate not taken forward", module: "workforce" },
  { key: "workforce.withdrawn", label: "Candidate withdrew", module: "workforce" },
  { key: "workforce.contract_linked", label: "Linked contract changed", module: "workforce" },
  { key: "workforce.onboarding_step_waived", label: "Onboarding step waived", module: "workforce", permissionSensitive: true },
  { key: "workforce.access_step_requested", label: "Access step requested", module: "workforce", permissionSensitive: true },
  { key: "workforce.offboarding_step_recorded", label: "Offboarding step recorded", module: "workforce" },
  // A function is NOT a permission, so none of these is permission-sensitive.
  // Marking them so would teach a reviewer that assigning one changed access,
  // which is exactly the confusion the module is built to prevent.
  { key: "workforce.function_assigned", label: "Function assigned", module: "workforce" },
  { key: "workforce.function_removed", label: "Function removed", module: "workforce" },
  { key: "workforce.leave_recorded", label: "Leave recorded", module: "workforce" },
  { key: "workforce.leave_ended", label: "Returned from leave", module: "workforce" },
  { key: "workforce.leave_cancelled", label: "Leave cancelled", module: "workforce" },
  // High value: the date a regulator asks about, and the one field an
  // activation must never silently rewrite.
  { key: "workforce.start_date_recorded", label: "Start date recorded", module: "workforce", highValue: true },
  // The judgement an import is not allowed to make for itself.
  { key: "workforce.import_identity_resolved", label: "Imported row resolved to a person", module: "workforce", highValue: true },

  // A carrier's custody of evidence it relied on. Adoption and disposal are
  // high-value: one creates a retention obligation, the other discharges it.
  { key: "compliance.qualification_adopted", label: "Document version adopted into the qualification file", module: "compliance", highValue: true },
  { key: "compliance.qualification_superseded", label: "Qualification record superseded", module: "compliance" },
  { key: "compliance.qualification_retention_changed", label: "Retention state changed", module: "compliance" },
  { key: "compliance.qualification_disposed", label: "Qualification record disposed", module: "compliance", permissionSensitive: true, highValue: true },

  { key: "risk.signal_raised", label: "Risk signal raised", module: "risk" },
  { key: "risk.signal_dismissed", label: "Risk signal dismissed", module: "risk" },
  { key: "risk.case_opened", label: "Risk case opened", module: "risk" },
  { key: "risk.case_assigned", label: "Risk case assigned", module: "risk" },
  { key: "risk.case_state_changed", label: "Risk case state changed", module: "risk" },
  { key: "risk.case_note_added", label: "Risk case note added", module: "risk" },
  { key: "risk.case_evidence_added", label: "Risk case evidence added", module: "risk" },
  { key: "risk.case_decision_recorded", label: "Risk case decision recorded", module: "risk" },
  { key: "audit.event_corrected", label: "Audit event corrected", module: "risk" },
  { key: "audit.export_prepared", label: "Audit export prepared", module: "risk", permissionSensitive: true },
] as const;

const BY_KEY = new Map<AuditAction, AuditActionMeta>(
  AUDIT_ACTIONS.map((a) => [a.key, a]),
);

export function auditActionMeta(key: AuditAction): AuditActionMeta {
  const meta = BY_KEY.get(key);
  if (!meta) throw new Error(`Unknown audit action: ${key}`);
  return meta;
}

export function auditActionLabel(key: AuditAction): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function isPermissionSensitive(key: AuditAction): boolean {
  return Boolean(BY_KEY.get(key)?.permissionSensitive);
}

export function isHighValueAction(key: AuditAction): boolean {
  return Boolean(BY_KEY.get(key)?.highValue);
}

export const AUDIT_MODULE_LABEL: Record<AuditModule, string> = {
  access: "Access and permissions",
  organization: "Organization",
  banking: "Banking and payouts",
  directory: "Directory",
  documents: "Documents",
  loads: "Loads",
  dispatch: "Dispatch",
  fleet: "Fleet",
  drivers: "Drivers",
  fuel: "Fuel & IFTA",
  compliance: "Compliance",
  maintenance: "Maintenance",
  insurance: "Insurance",
  settlements: "Settlements",
  invoices: "Invoices",
  integrations: "Integrations",
  workforce: "Workforce & HR",
  risk: "Audit & Risk",
};

export const AUDIT_SOURCE_LABEL: Record<AuditEventSource, string> = {
  human: "Person",
  system: "Antcolos",
  integration: "Integration",
  imported: "Imported",
  inferred: "Inferred",
};

export const AUDIT_SOURCE_DESCRIPTION: Record<AuditEventSource, string> = {
  human: "A person did this, signed in as a membership in this organization.",
  system: "Antcolos itself did this — a derivation or a scheduled sweep, with no person behind it.",
  integration: "An outside system did this through a connected integration.",
  imported: "This arrived in a batch or a file somebody handed to Antcolos.",
  inferred: "Nobody reported this. Antcolos concluded it from other events, and it may be wrong.",
};

export const AUDIT_OUTCOME_LABEL: Record<AuditOutcome, string> = {
  succeeded: "Succeeded",
  denied: "Refused",
  failed: "Failed",
};
