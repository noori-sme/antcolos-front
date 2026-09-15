import type { CarrierRelationshipType } from "./asset";
import type { IsoDateTime } from "./common";
import type { EngagementType } from "./driver-profile";
import type { OrganizationType, PermissionKey } from "./permission";
import type { TrailerType } from "./trailer";
import type { TruckEquipmentType } from "./truck";
import type { ActorRef } from "./user";

/**
 * Safety & Compliance.
 *
 * The one idea this file exists to protect: **a requirement and a document are
 * not the same record.** A carrier's obligation to hold a current annual
 * inspection on unit 104 exists whether or not anybody has ever uploaded a
 * file. A document can *satisfy* that obligation, and the requirement then
 * points at it — but the requirement keeps its own id, its own status, its own
 * due date and its own history, and it survives the document being replaced,
 * rejected, superseded or deleted.
 *
 * Everything here is organization-scoped and relationship-derived. Compliance
 * does not own drivers, trucks, trailers, organizations, documents or alerts;
 * it points at the systems that do.
 */

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

/** What a requirement is *about*. Four kinds, and no others in this milestone. */
export type ComplianceSubjectKind = "carrier" | "driver" | "truck" | "trailer";

/**
 * A pointer to the entity that already exists elsewhere, plus a snapshot of how
 * it read at the time.
 *
 * The snapshot is not duplication: it is what keeps a frozen record legible
 * after the relationship that produced it has ended and the live entity is no
 * longer reachable from this organization.
 */
export interface ComplianceSubjectRef {
  kind: ComplianceSubjectKind;
  /** organizationId, driverProfileId, truckId or trailerId. Never re-keyed. */
  id: string;
  /** Display snapshot: "Unit 104", "Dmitri Kovalenko", "Northline Freight". */
  label: string;
  /** Secondary snapshot line: equipment type, engagement type, DOT number. */
  detail?: string;
  /** Route to the entity in the module that owns it, when one exists. */
  href?: string;
}

/**
 * What the organization has recorded about its own authority to operate.
 *
 * Recorded, and nothing more. Antcolos has not checked any of this against
 * FMCSA, SAFER, a state register or any other source, and nothing in this
 * build ever will — see `ComplianceVerificationBasis`.
 */
export interface OperatingAuthorityProfile {
  /** False for a dispatch organization, and for a carrier running under another's authority. */
  hasOwnAuthority: boolean;
  dotNumber?: string;
  mcNumber?: string;
  /** Drives the requirements that only exist for interstate operations. */
  interstate: boolean;
  /** When the organization last recorded these values in Antcolos. */
  recordedAt?: IsoDateTime;
}

/**
 * Every fact a requirement's applicability may branch on.
 *
 * Assembled from the existing systems — the organization record, the driver
 * relationship, the truck registry, the trailer registry — never typed into a
 * compliance form. If a fact is not on this interface, no rule may depend on it.
 */
export interface ComplianceSubjectContext {
  kind: ComplianceSubjectKind;
  /** The organization whose obligation this would be. */
  organizationId: string;
  organizationType: OrganizationType;
  operatingAuthority: OperatingAuthorityProfile;
  /** True when this subject runs across state lines for this organization. */
  interstate: boolean;

  // -- driver subjects ------------------------------------------------------
  engagementType?: EngagementType;

  // -- truck subjects -------------------------------------------------------
  truckEquipmentType?: TruckEquipmentType;
  /** Whether the organization owns the asset or runs a leased owner-operator's. */
  carrierRelationshipType?: CarrierRelationshipType;
  grossWeightPounds?: number;

  // -- trailer subjects -----------------------------------------------------
  trailerType?: TrailerType;
  hasReeferUnit?: boolean;

  /** Placarded hazardous materials. False everywhere in the fixtures. */
  hazmat?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Requirement definitions                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every requirement Antcolos knows how to track, as a closed union. A typo is a
 * compile error, and adding a key here is the only way to add a requirement.
 */
export type ComplianceRequirementKey =
  // -- carrier, running under its own authority -----------------------------
  | "carrier.operating_authority_record"
  | "carrier.mcs150_biennial_update"
  | "carrier.ucr_registration"
  | "carrier.process_agent_designation"
  | "carrier.bipd_insurance"
  | "carrier.cargo_insurance"
  | "carrier.workers_compensation"
  | "carrier.drug_alcohol_program"
  | "carrier.driver_qualification_policy"
  | "carrier.accident_register"
  // -- dispatch organization ------------------------------------------------
  | "dispatch.carrier_service_agreement"
  | "dispatch.errors_omissions_insurance"
  | "dispatch.w9_on_file"
  // -- driver ---------------------------------------------------------------
  | "driver.commercial_licence"
  | "driver.medical_certificate"
  | "driver.employment_application"
  | "driver.motor_vehicle_record_review"
  | "driver.road_test_certificate"
  | "driver.pre_employment_drug_test"
  | "driver.clearinghouse_query_record"
  | "driver.hazmat_endorsement"
  | "driver.handbook_acknowledgement"
  | "driver.owner_operator_agreement"
  | "driver.owner_operator_w9"
  | "driver.owner_operator_insurance"
  // -- truck ----------------------------------------------------------------
  | "truck.registration"
  | "truck.annual_inspection"
  | "truck.insurance_evidence"
  | "truck.lease_agreement"
  | "truck.ifta_credentials"
  | "truck.heavy_vehicle_use_tax"
  | "truck.eld_device_record"
  | "truck.periodic_maintenance_record"
  // -- trailer --------------------------------------------------------------
  | "trailer.registration"
  | "trailer.annual_inspection"
  | "trailer.insurance_evidence"
  | "trailer.lease_agreement"
  | "trailer.reefer_unit_service_record"
  | "trailer.securement_equipment_inventory";

/** How hard this bites when it lapses. Ordered, and used for sorting. */
export type ComplianceSeverity = "critical" | "high" | "medium" | "low";

/**
 * What makes a requirement come due again.
 *
 * `document_expiry` means the satisfying document's own expiry date is the due
 * date — a licence does not expire on a schedule Antcolos invents. `event_driven`
 * is reserved for cycles driven by inspections, violations and accidents, which
 * are later milestones; nothing computes a due date from it yet.
 */
export type ComplianceRenewalBasis =
  | "none"
  | "fixed_interval"
  | "document_expiry"
  | "event_driven";

export interface ComplianceRenewalCycle {
  basis: ComplianceRenewalBasis;
  /** Required when basis is "fixed_interval". */
  intervalMonths?: number;
  /** How long before the due date the requirement starts reading "expiring". */
  warnWithinDays: number;
}

/**
 * Where the evidence lives. Antcolos does not copy it here — these are pointers
 * into the systems that already hold the file and own its review state.
 */
export type ComplianceEvidenceSystem =
  | "document_center"
  | "driver_document"
  | "truck_document"
  | "trailer_document"
  /** A person recorded that something happened. No file, and it says so. */
  | "recorded_attestation";

/** The owning system's review state, read through, never re-decided here. */
export type ComplianceEvidenceState =
  | "missing"
  | "pending_review"
  | "approved"
  | "rejected"
  | "expiring_soon"
  | "expired"
  | "superseded";

export interface ComplianceEvidenceRef {
  system: ComplianceEvidenceSystem;
  /** The id inside the owning system. Never a compliance-local id. */
  id: string;
  label: string;
  /** Route into the module that owns the document, when one exists. */
  href?: string;
  state: ComplianceEvidenceState;
  fileName?: string;
  expiresAt?: IsoDateTime;
  capturedAt?: IsoDateTime;
  rejectionReason?: string;
}

/**
 * Who is expected to act. A requirement always has one, because "nobody owns
 * this" is how compliance items rot.
 */
export type ComplianceResponsibilityKind =
  | "organization"
  | "membership"
  | "driver"
  | "equipment_owner";

export interface ComplianceResponsibleParty {
  kind: ComplianceResponsibilityKind;
  /** Snapshot, so the record stays readable after the person leaves. */
  displayName: string;
  membershipId?: string;
  driverProfileId?: string;
  organizationId?: string;
  /** Route to the person or organization, when the viewer may follow it. */
  href?: string;
}

/**
 * Honest provenance. Every requirement carries one, and the UI prints it.
 *
 * There is exactly one value in this build. It exists as a union so that a real
 * integration can add its own value later without any screen pretending a
 * recorded date came from somewhere it did not.
 */
export type ComplianceVerificationBasis = "recorded_in_antcolos";

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The six states a requirement can be in.
 *
 *  compliant        satisfied, and not near its due date
 *  action_required  nothing satisfies it, or the evidence was rejected
 *  expiring         satisfied, but inside the warning window
 *  expired          the due date has passed
 *  suspended        deliberately paused — the subject is not operating
 *  not_applicable   the rule does not reach this subject, and says why
 */
export type ComplianceStatus =
  | "compliant"
  | "action_required"
  | "expiring"
  | "expired"
  | "suspended"
  | "not_applicable";

/** Statuses that mean somebody has to do something. */
export const OPEN_COMPLIANCE_STATUSES: readonly ComplianceStatus[] = [
  "action_required",
  "expiring",
  "expired",
];

export const COMPLIANCE_SEVERITY_ORDER: Record<ComplianceSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const COMPLIANCE_STATUS_ORDER: Record<ComplianceStatus, number> = {
  expired: 0,
  action_required: 1,
  expiring: 2,
  suspended: 3,
  compliant: 4,
  not_applicable: 5,
};

/* -------------------------------------------------------------------------- */
/* Audit history                                                               */
/* -------------------------------------------------------------------------- */

export type ComplianceHistoryAction =
  | "requirement_created"
  | "became_applicable"
  | "became_not_applicable"
  | "status_changed"
  | "evidence_linked"
  | "evidence_cleared"
  | "due_date_set"
  | "renewed"
  | "responsibility_assigned"
  | "note_added"
  | "waived"
  | "waiver_revoked"
  | "suspended"
  | "reinstated"
  | "access_ended"
  | "snapshot_taken";

/**
 * Append-only. Entries are never edited and never removed — a mistake is
 * corrected by appending a correcting entry, exactly like the load timeline.
 */
export interface ComplianceHistoryEntry {
  id: string;
  at: IsoDateTime;
  /** Attribution snapshot: readable after the person leaves the organization. */
  actor: ActorRef;
  action: ComplianceHistoryAction;
  fromStatus?: ComplianceStatus;
  toStatus?: ComplianceStatus;
  note?: string;
  /** The evidence this entry is about, as it read at the time. */
  evidence?: ComplianceEvidenceRef;
  /** Whose action it was, so a shared record stays attributable. */
  organizationId?: string;
}

/** How a requirement stopped needing action. Kept separately from the timeline
 *  because "what was done about it" is the question an auditor asks first. */
export type ComplianceResolutionMethod =
  | "evidence_accepted"
  | "renewed"
  | "corrected"
  | "waived"
  | "no_longer_applicable";

export interface ComplianceResolution {
  id: string;
  at: IsoDateTime;
  actor: ActorRef;
  method: ComplianceResolutionMethod;
  /** The status the requirement was in immediately before. */
  fromStatus: ComplianceStatus;
  note: string;
  /** The due date this resolution answered, when there was one. */
  satisfiedDueAt?: IsoDateTime;
  evidence?: ComplianceEvidenceRef;
}

/* -------------------------------------------------------------------------- */
/* The requirement itself                                                      */
/* -------------------------------------------------------------------------- */

export interface ComplianceRequirementDefinition {
  key: ComplianceRequirementKey;
  subjectKind: ComplianceSubjectKind;
  label: string;
  /** Plain language, written for a carrier owner rather than an engineer. */
  description: string;
  /**
   * Where the obligation comes from, in the operator's words. Never a citation
   * Antcolos cannot stand behind, and never a claim that anybody checked it.
   */
  authority: string;
  severity: ComplianceSeverity;
  renewal: ComplianceRenewalCycle;
  /** The systems whose documents can satisfy it. Empty means attestation only. */
  satisfiedBy: ComplianceEvidenceSystem[];
  applicability: ComplianceApplicability;
  defaultResponsibility: ComplianceResponsibilityKind;
  /** Permissions a membership must hold to see requirements of this kind. */
  requires: PermissionKey[];
  /**
   * Later milestones that will attach to this requirement. Typed so the seam is
   * visible; nothing in this build reads or writes them.
   */
  extensionPoints?: ComplianceExtensionKind[];
}

/**
 * A declarative filter over `ComplianceSubjectContext`. Every field is optional
 * and every field present must match, so an empty object means "always".
 *
 * Declarative rather than a predicate function on purpose: the rules have to be
 * inspectable, testable and eventually editable by a safety manager, and a
 * closure is none of those things.
 */
export interface ComplianceApplicability {
  organizationTypes?: OrganizationType[];
  /** Only for an organization that runs under its own operating authority. */
  requiresOwnOperatingAuthority?: boolean;
  /** Only when the subject operates across state lines. */
  interstateOnly?: boolean;
  engagementTypes?: EngagementType[];
  carrierRelationshipTypes?: CarrierRelationshipType[];
  truckEquipmentTypes?: TruckEquipmentType[];
  trailerTypes?: TrailerType[];
  requiresReeferUnit?: boolean;
  requiresHazmat?: boolean;
  minGrossWeightPounds?: number;
}

/**
 * One organization's obligation about one subject.
 *
 * The definition is snapshotted onto the record (label, description, authority,
 * severity, renewal) so that editing the catalog tomorrow cannot rewrite what a
 * requirement said when somebody resolved it last year.
 */
export interface ComplianceRequirement {
  id: string;
  /** Whose obligation this is. A share never changes this value. */
  organizationId: string;
  definitionKey: ComplianceRequirementKey;
  subject: ComplianceSubjectRef;

  // -- snapshotted from the definition --------------------------------------
  label: string;
  description: string;
  authority: string;
  severity: ComplianceSeverity;
  renewal: ComplianceRenewalCycle;
  verificationBasis: ComplianceVerificationBasis;

  // -- live state -----------------------------------------------------------
  status: ComplianceStatus;
  /** Present whenever status is "not_applicable" or "suspended". */
  statusReason?: string;
  dueAt?: IsoDateTime;
  /** When the current evidence was accepted. */
  satisfiedAt?: IsoDateTime;
  /** A document in another system. The requirement is not that document. */
  evidence?: ComplianceEvidenceRef;
  responsible: ComplianceResponsibleParty;

  // -- history --------------------------------------------------------------
  resolutions: ComplianceResolution[];
  history: ComplianceHistoryEntry[];

  /**
   * Set when the relationship that produced this record ended. The record stops
   * being actionable and stops appearing in live queues, and is kept forever.
   */
  frozenAt?: IsoDateTime;
  frozenReason?: string;

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Permissions needed to see this requirement at all. */
  requires: PermissionKey[];
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What an organization keeps after a relationship ends.
 *
 * Ending a driver, truck, trailer, carrier or dispatch relationship stops
 * access to the live subject. It does not delete anything: the requirements are
 * frozen, and this immutable snapshot records how they stood at the moment
 * access ended, so the organization can still answer for the period it ran.
 */
export interface ComplianceSnapshot {
  id: string;
  organizationId: string;
  subject: ComplianceSubjectRef;
  takenAt: IsoDateTime;
  reason: string;
  takenBy: ActorRef;
  /** Frozen copies. Never re-read from the live requirement. */
  entries: ComplianceSnapshotEntry[];
}

export interface ComplianceSnapshotEntry {
  requirementId: string;
  definitionKey: ComplianceRequirementKey;
  label: string;
  status: ComplianceStatus;
  severity: ComplianceSeverity;
  dueAt?: IsoDateTime;
  satisfiedAt?: IsoDateTime;
  evidenceLabel?: string;
  responsibleName: string;
}

/* -------------------------------------------------------------------------- */
/* Sharing with dispatch                                                       */
/* -------------------------------------------------------------------------- */

export type ComplianceShareStatus = "active" | "revoked";

/**
 * A dispatch organization or an individual dispatcher sees compliance only
 * through one of these, and only the requirement keys it names.
 *
 * There is deliberately no "share everything" form. A dispatcher needs to know
 * that the truck they are about to book is legal to run; they are not entitled
 * to the carrier's insurance file, its drug and alcohol programme or its
 * drivers' medical history.
 */
export interface ComplianceShare {
  id: string;
  /** The carrier that owns the records. */
  ownerOrganizationId: string;
  /** The dispatch organization the view was granted to. */
  viewerOrganizationId: string;
  viewerOrganizationName: string;
  subject: ComplianceSubjectRef;
  /** Exactly which requirements travel. Never a wildcard. */
  requirementKeys: ComplianceRequirementKey[];
  /** The work this share exists for, in the carrier's words. */
  purpose: string;
  status: ComplianceShareStatus;
  grantedAt: IsoDateTime;
  grantedByMembershipId: string;
  grantedByName: string;
  revokedAt?: IsoDateTime;
  revokedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Why this membership can see a requirement at all. */
export type ComplianceAccessReason =
  | "own_organization"
  | "subject_relationship"
  | "responsible_party"
  | "own_driver_record"
  | "shared_with_dispatch";

export interface ComplianceFilters {
  subjectKind?: ComplianceSubjectKind[];
  status?: ComplianceStatus[];
  severity?: ComplianceSeverity[];
  /** "me" resolves to the caller's membership or driver profile. */
  responsibility?: "all" | "me" | "unassigned";
  subjectId?: string;
  /** Not-applicable requirements are hidden unless explicitly asked for. */
  includeNotApplicable?: boolean;
  /** Frozen records are history; they never appear in the live queue. */
  includeFrozen?: boolean;
  /** Only requirements due within this many days. */
  dueWithinDays?: number;
  search?: string;
}

export interface ComplianceSubjectGroup {
  subject: ComplianceSubjectRef;
  requirements: ComplianceRequirement[];
  /** The worst live status across the group. */
  worstStatus: ComplianceStatus;
  openCount: number;
}

export interface ComplianceSummary {
  counts: Record<ComplianceStatus, number>;
  /** Open items at critical severity — the number an owner reads first. */
  criticalOpen: number;
  dueWithin30Days: number;
  /** Subjects with at least one open requirement, per kind. */
  subjectsNeedingAction: Record<ComplianceSubjectKind, number>;
  /** Frozen history the organization still holds. Never actionable. */
  frozenRecords: number;
}

/* -------------------------------------------------------------------------- */
/* Extension points for later milestones                                       */
/* -------------------------------------------------------------------------- */

/**
 * Roadside inspections, violations, accidents, claims, hours-of-service and
 * CSA/SMS monitoring are NOT built.
 *
 * They are declared here as typed seams so that the later milestones extend
 * this module rather than growing a second one beside it: each names the
 * requirements it will attach to, and `available` is `false` everywhere. No
 * screen may render a value from an extension point as though it held data.
 */
export type ComplianceExtensionKind =
  | "roadside_inspection"
  | "violation"
  | "accident"
  | "insurance_claim"
  | "hours_of_service"
  | "csa_sms_monitoring"
  | "audit_preparation";

export interface ComplianceExtensionPoint {
  kind: ComplianceExtensionKind;
  label: string;
  description: string;
  /** Always false in this milestone. */
  available: false;
  /** The requirements this extension will feed once it is built. */
  attachesTo: ComplianceRequirementKey[];
  /** Which subject kinds it will produce records about. */
  subjectKinds: ComplianceSubjectKind[];
}

/**
 * The shape a later milestone's records will take.
 *
 * Reserved: nothing constructs one of these, no service returns them, and no
 * fixture contains one. It is here so the extension lands as a fill-in rather
 * than a redesign.
 */
export interface ComplianceExtensionRecord<
  K extends ComplianceExtensionKind = ComplianceExtensionKind,
> {
  id: string;
  kind: K;
  organizationId: string;
  subject: ComplianceSubjectRef;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  recordedBy: ActorRef;
  summary: string;
  severity: ComplianceSeverity;
  /** Requirements this record affects, when the milestone wires them up. */
  affectsRequirementKeys: ComplianceRequirementKey[];
  history: ComplianceHistoryEntry[];
}
