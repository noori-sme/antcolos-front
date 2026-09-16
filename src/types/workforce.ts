import type { IsoDateTime } from "./common";
import type { ActorRef } from "./user";

/**
 * ★ THE WORKING RELATIONSHIP, AND ONLY THAT ★
 *
 * Antcolos already knew almost everything about a person who works for an
 * organization, and knew none of it in one place that could answer the question
 * a carrier actually asks:
 *
 *   *On what basis, in what capacity, from what date and in what status does
 *   this person work with this organization?*
 *
 * Every neighbouring record was asked and every one of them said no:
 *
 *   User                  the permanent person. Deliberately has no
 *                         organization, no role and no permissions.
 *   Membership            ACCESS to one organization. An external auditor has
 *                         one and works for nobody; a yard hand may work here
 *                         and have none.
 *   DriverProfile         the permanent professional person — licence, medical
 *                         card — which follows them between carriers.
 *   CarrierRelationship   a driver's OPERATIONAL relationship with a carrier:
 *                         which truck, which documents travel, dispatch access.
 *                         Says nothing about a non-driving employee.
 *   Contract              the TERMS, and immutable versions of them.
 *   ComplianceRequirement whether somebody is qualified to operate.
 *   Settlement            what they were paid.
 *
 * So `WorkforceEngagement` is the missing one, and it is the smallest record
 * that answers the question. It COPIES nothing: every neighbouring fact above
 * is reached by reference, and this record has no field that could hold a
 * contract term, a permission, a licence number, a document or an amount.
 *
 * ███ THE RULE THAT MATTERS MOST ███
 * A classification, a position title and a manager are NOT authorization.
 * Nothing in this module grants, widens or narrows a permission; permissions
 * live on Membership and change only through the access system. A manager named
 * here does not become responsible for any piece of work — operational
 * responsibility stays in the Responsibility Engine, which routes on the
 * permissions a piece of work requires and has never read a job title.
 */

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The basis of the working relationship. Exactly three values.
 *
 * A "temporary" or "other" classification would be a field nobody could act on
 * and a question nobody had asked. Adding one later is one line plus a
 * migration; adding one now would be a guess.
 */
export type WorkforceClassification =
  | "employee"
  | "independent_contractor"
  | "owner_operator";

export const WORKFORCE_CLASSIFICATION_LABEL: Record<WorkforceClassification, string> = {
  employee: "Employee",
  independent_contractor: "Independent contractor",
  owner_operator: "Owner-operator",
};

export const WORKFORCE_CLASSIFICATION_DESCRIPTION: Record<WorkforceClassification, string> = {
  employee: "Works for the organization on its payroll. Payroll itself is outside Antcolos.",
  independent_contractor: "Engaged under a contract for services. Paid against that contract, never through payroll.",
  owner_operator: "Brings their own equipment and is settled against loads. Settlements belong to the Settlements module, never to this record.",
};

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where the engagement has got to.
 *
 * An explicit, closed set with an explicit transition table — see
 * `src/lib/workforce/lifecycle.ts` — rather than an editable status string,
 * because "active" has to mean the same thing to Safety, to Access and to
 * whoever is answering for this person a year from now.
 *
 * `prospective` exists because a person may hand a carrier their documents
 * before anybody is anybody's anything, and that person has to be representable
 * without implying employment. `withdrawn` and `rejected` are kept apart on
 * purpose: one of them is the person's own decision.
 */
export type WorkforceEngagementState =
  | "prospective"
  | "onboarding"
  | "active"
  | "suspended"
  | "ended"
  | "rejected"
  | "withdrawn";

export const WORKFORCE_STATE_LABEL: Record<WorkforceEngagementState, string> = {
  prospective: "Prospective",
  onboarding: "Onboarding",
  active: "Active",
  suspended: "Suspended",
  ended: "Ended",
  rejected: "Not taken forward",
  withdrawn: "Withdrawn",
};

export const WORKFORCE_STATE_DESCRIPTION: Record<WorkforceEngagementState, string> = {
  prospective: "Somebody this organization is considering. Not a member, not a worker, and holds nothing.",
  onboarding: "Taken forward. The onboarding steps belong to other modules, and this reads them.",
  active: "Working with this organization today.",
  suspended: "Temporarily not working. The history is untouched and nothing was deleted.",
  ended: "The working relationship is over. Everything that happened is kept.",
  rejected: "The organization decided not to take them forward.",
  withdrawn: "The person withdrew before the relationship started.",
};

/** States in which the engagement is over. Never deleted, never actionable. */
export const WORKFORCE_TERMINAL_STATES: readonly WorkforceEngagementState[] = [
  "ended", "rejected", "withdrawn",
];

/** States in which somebody is genuinely working with the organization. */
export const WORKFORCE_WORKING_STATES: readonly WorkforceEngagementState[] = [
  "active", "suspended",
];

/* -------------------------------------------------------------------------- */
/* Who, and where they came from                                               */
/* -------------------------------------------------------------------------- */

/**
 * The person, by reference.
 *
 * `userId` is absent for somebody who has no Antcolos account, which is a real
 * and common case: a carrier may employ a yard hand who never signs in, and a
 * prospective candidate who shared documents by email has no account at all.
 * The name and email are a SNAPSHOT for display, so an engagement stays
 * readable after a rename — they are not a second identity record, and nothing
 * reads them to decide access.
 */
export interface WorkforcePersonRef {
  /** The Antcolos account, when the person has one. */
  userId?: string;
  /** Display snapshot at the time the engagement was created. */
  displayName: string;
  email?: string;
  /** The permanent professional profile, when this person is a driver. */
  driverProfileId?: string;
}

/** How this engagement came to exist. Provenance, kept because it is the first
 *  question asked about a record nobody recognises. */
export type WorkforceSourceKind =
  /** A driver's share package a carrier explicitly took forward. */
  | "document_share"
  /** An invitation sent through the existing access system. */
  | "invitation"
  /** An existing driver–carrier relationship being described in HR terms. */
  | "existing_carrier_relationship"
  /** Somebody typed it in, because nothing else could supply it. */
  | "manual_entry";

export const WORKFORCE_SOURCE_LABEL: Record<WorkforceSourceKind, string> = {
  document_share: "From documents the person shared",
  invitation: "From an invitation",
  existing_carrier_relationship: "From an existing driver relationship",
  manual_entry: "Entered by hand",
};

export interface WorkforceSourceRef {
  kind: WorkforceSourceKind;
  /** The canonical record this engagement came from, when there was one. */
  id?: string;
  label: string;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export type WorkforceEventKind =
  | "created"
  | "onboarding_started"
  | "classification_changed"
  | "position_changed"
  | "manager_changed"
  | "activated"
  | "suspended"
  | "restored"
  | "ended"
  | "rejected"
  | "withdrawn"
  | "contract_linked"
  | "membership_linked"
  | "driver_profile_linked"
  | "onboarding_step_waived"
  | "access_step_requested"
  | "offboarding_step_recorded"
  | "note";

export const WORKFORCE_EVENT_LABEL: Record<WorkforceEventKind, string> = {
  created: "Engagement created",
  onboarding_started: "Onboarding started",
  classification_changed: "Classification changed",
  position_changed: "Position changed",
  manager_changed: "Manager changed",
  activated: "Activated",
  suspended: "Suspended",
  restored: "Restored",
  ended: "Ended",
  rejected: "Not taken forward",
  withdrawn: "Withdrawn",
  contract_linked: "Linked contract changed",
  membership_linked: "Membership linked",
  driver_profile_linked: "Driver profile linked",
  onboarding_step_waived: "Onboarding step waived",
  access_step_requested: "Access step requested",
  offboarding_step_recorded: "Offboarding step recorded",
  note: "Note",
};

/** Append-only. An engagement that ended keeps every line of this. */
export interface WorkforceEngagementEvent {
  id: string;
  at: IsoDateTime;
  kind: WorkforceEventKind;
  summary: string;
  detail?: string;
  actor: ActorRef;
  fromState?: WorkforceEngagementState;
  toState?: WorkforceEngagementState;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

export interface WorkforceEngagement {
  /** Stable, immutable. Never reused and never regenerated. */
  id: string;
  /**
   * The organization this engagement is WITH, and the only one it is read
   * through.
   *
   * A6's rule holds here unchanged: naming an organization on a record is
   * attribution, never a grant. Nothing else on this record — not the manager's
   * membership, not the linked contract, not the driver profile — widens who
   * may read it by one row.
   */
  organizationId: string;
  person: WorkforcePersonRef;
  /** Convenience mirror of `person.driverProfileId`, for indexing only. */
  driverProfileId?: string;
  classification: WorkforceClassification;
  state: WorkforceEngagementState;
  /**
   * The intended organizational function, in the organization's own words.
   *
   * DISPLAY ONLY. Nothing in Antcolos branches on it, nothing grants a
   * permission from it, and the responsibility engine has never read a title.
   */
  positionTitle: string;
  /** Intended or actual start. Absent while nobody has decided one. */
  startDate?: IsoDateTime;
  endDate?: IsoDateTime;
  /**
   * The membership that supervises this person, by reference.
   *
   * A supervisor, not an owner of their work: naming somebody here changes no
   * queue, no assignment and no escalation ladder.
   */
  managerMembershipId?: string;
  managerName?: string;
  /**
   * The Membership this person holds in this organization, when they hold one.
   *
   * A REFERENCE. This module never creates, edits or ends a membership itself —
   * it asks the access system to, and records that it asked.
   */
  membershipId?: string;
  /**
   * The agreement that governs the engagement, and the version in force when it
   * was linked.
   *
   * Two ids and nothing else. Terms, clauses, signatures, compensation rules
   * and effective dates stay on the contract version, and the link is
   * deliberately ONE-DIRECTIONAL for this milestone: `RelationshipRefKind` is
   * untouched, so no contract points back at an engagement yet.
   */
  contractId?: string;
  contractVersionId?: string;
  /** The driver's operational relationship, when they are a driver. */
  carrierRelationshipId?: string;
  source: WorkforceSourceRef;
  /** Set on the matching terminal or suspended transition. */
  endReason?: string;
  suspensionReason?: string;
  rejectionReason?: string;
  history: WorkforceEngagementEvent[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Bumped on every accepted command. Lets a caller detect a lost update. */
  version: number;
}

/* -------------------------------------------------------------------------- */
/* Onboarding — derived from the domains that own it                           */
/* -------------------------------------------------------------------------- */

/** Which module owns the answer. Printed on screen, so a blocked step says
 *  whose blockage it is rather than looking like an HR failure. */
export type OnboardingStepDomain =
  | "documents"
  | "compliance"
  | "contracts"
  | "access"
  | "driver_relationship"
  | "qualification";

export const ONBOARDING_DOMAIN_LABEL: Record<OnboardingStepDomain, string> = {
  documents: "Document Center",
  compliance: "Safety & Compliance",
  contracts: "Contracts",
  access: "Access and permissions",
  driver_relationship: "Driver relationship",
  qualification: "Qualification file",
};

/**
 * Five states, and the difference between the middle three is the whole point.
 *
 * "Waiting for Safety to decide" is not "blocked", and neither of them is
 * "somebody waived it". A checklist with one tick and one cross would let an
 * activation claim things no other module agrees with.
 */
export type OnboardingStepStatus =
  | "completed"
  | "awaiting_other_domain"
  | "blocked"
  | "waived"
  | "not_applicable";

export const ONBOARDING_STEP_STATUS_LABEL: Record<OnboardingStepStatus, string> = {
  completed: "Done",
  awaiting_other_domain: "Waiting on another module",
  blocked: "Blocked",
  waived: "Waived",
  not_applicable: "Not applicable",
};

export interface OnboardingWaiver {
  authorizedByMembershipId: string;
  authorizedByName: string;
  at: IsoDateTime;
  /** Required. A waiver with no reason is a gap nobody can review. */
  reason: string;
}

/**
 * One line of the onboarding checklist.
 *
 * DERIVED on every read from the module that owns the fact. Nothing here is a
 * copy of another module's status that could drift: resolve the underlying
 * compliance requirement and this line changes on the next read, without
 * anybody ticking anything.
 */
export interface OnboardingStep {
  key: string;
  label: string;
  domain: OnboardingStepDomain;
  status: OnboardingStepStatus;
  /** Why it says what it says, in the operator's language. */
  detail: string;
  /** The canonical record the status was read from, when there is one. */
  sourceRef?: { kind: string; id: string; label: string; href?: string };
  waiver?: OnboardingWaiver;
  /** True when this step must be satisfied or waived before activation. */
  requiredForActivation: boolean;
}

export interface OnboardingChecklist {
  engagementId: string;
  steps: OnboardingStep[];
  /** Required steps that are neither completed nor waived. */
  outstanding: OnboardingStep[];
  readyToActivate: boolean;
  /** Said out loud on every checklist. See `MOCK_ACTIVATION_LIMITATION`. */
  limitation: string;
}

export const MOCK_ACTIVATION_LIMITATION =
  "Antcolos reads each step from the module that owns it at the moment you look. "
  + "This build has no cross-module transaction: activating an engagement cannot "
  + "atomically change Safety, Contracts, the Document Center and Access together, "
  + "so each of those stays that module's own explicit, audited action.";

/* -------------------------------------------------------------------------- */
/* Offboarding                                                                 */
/* -------------------------------------------------------------------------- */

export type OffboardingStepKey =
  | "end_membership_access"
  | "end_delegations"
  | "rehome_responsibility"
  | "unassign_equipment"
  | "end_carrier_relationship"
  | "end_document_access"
  | "start_qualification_retention"
  | "preserve_history";

export const OFFBOARDING_STEP_LABEL: Record<OffboardingStepKey, string> = {
  end_membership_access: "End their access to this workspace",
  end_delegations: "End delegations they hold",
  rehome_responsibility: "Re-home work they are responsible for",
  unassign_equipment: "Unassign equipment and operational work",
  end_carrier_relationship: "End the driver–carrier relationship",
  end_document_access: "End this organization's access to their documents",
  start_qualification_retention: "Move qualification records into retention",
  preserve_history: "Keep loads, settlements, safety history and audit",
};

/**
 * What one step would do. Shown BEFORE anything happens.
 *
 * `will_be_preserved` steps are not choices — they are listed because an
 * offboarding screen showing only destruction teaches people that ending a
 * relationship deletes things, and this one deliberately does not.
 */
export type OffboardingEffect = "will_end" | "will_be_preserved" | "needs_a_person";

export const OFFBOARDING_EFFECT_LABEL: Record<OffboardingEffect, string> = {
  will_end: "Will end",
  will_be_preserved: "Kept",
  needs_a_person: "Needs a person",
};

export interface OffboardingImpact {
  key: OffboardingStepKey;
  label: string;
  domain: OnboardingStepDomain;
  effect: OffboardingEffect;
  /** What will actually happen, in the operator's language. */
  description: string;
  /** Which service performs it. Never this one. */
  ownerService: string;
  /** False for the preservation rows, which nobody may turn off. */
  selectable: boolean;
  defaultSelected: boolean;
  /** How many records this step would touch, where that is knowable. */
  affectedCount?: number;
}

export interface OffboardingPlan {
  engagementId: string;
  impacts: OffboardingImpact[];
  /** Stated on the confirmation, not buried in a tooltip. */
  warning: string;
}

export type OffboardingStepOutcome =
  | "completed"
  | "failed"
  | "skipped"
  | "not_applicable";

export interface OffboardingResultStep {
  key: OffboardingStepKey;
  label: string;
  outcome: OffboardingStepOutcome;
  detail: string;
  /** Present on a failure. Never a stack trace. */
  reason?: string;
  retryable: boolean;
}

/**
 * What ending an engagement actually did.
 *
 * A failed downstream step does NOT roll the engagement back and does not
 * disappear: the engagement ends, the failure is recorded on it, and it is
 * raised through Needs You until somebody finishes it. Hiding a half-finished
 * offboarding is how a former employee keeps their access.
 */
export interface OffboardingResult {
  engagement: WorkforceEngagement;
  steps: OffboardingResultStep[];
  /** True when at least one selected step failed. */
  incomplete: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** An engagement plus the links a screen needs, none of them copied facts. */
export interface WorkforceEngagementView {
  engagement: WorkforceEngagement;
  /** Whether this person currently holds access, read from the access system. */
  hasActiveMembership: boolean;
  /** Links out to the canonical records. Never their contents. */
  links: WorkforceLink[];
  /** Outstanding offboarding steps from a previous end, if any failed. */
  incompleteOffboarding: OffboardingResultStep[];
}

export interface WorkforceLink {
  kind:
    | "user" | "membership" | "driver_profile" | "carrier_relationship"
    | "contract" | "documents" | "compliance" | "qualification_file"
    | "settlements";
  label: string;
  href?: string;
  /** Set when the module exists but this engagement has no such record. */
  absentReason?: string;
}

export interface WorkforceFilters {
  state?: WorkforceEngagementState[];
  classification?: WorkforceClassification[];
  /** Free text over name, position and email. */
  search?: string;
  /** Only engagements this membership supervises. */
  managedByMembershipId?: string;
  /** Off by default: ended engagements are history, not the roster. */
  includeEnded?: boolean;
}

export interface WorkforceSummary {
  total: number;
  byState: Record<WorkforceEngagementState, number>;
  byClassification: Record<WorkforceClassification, number>;
  /** Engagements with at least one outstanding required onboarding step. */
  onboardingOutstanding: number;
  /** Engagements whose offboarding did not finish. */
  offboardingIncomplete: number;
}
