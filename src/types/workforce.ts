import type { IsoDateTime } from "./common";
import type { PermissionKey } from "./permission";
import type { ResponsibilityFunction } from "./responsibility";
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
 * The basis of the working relationship, as the ORGANIZATION states it.
 *
 * ███ NOT A LEGAL DETERMINATION ███
 * Every value below is a fact the organization supplied about its own
 * arrangement. Antcolos does not apply the IRS common-law test, the FLSA
 * economic-reality test, any state ABC test or any other classification
 * standard, and nothing in this product should be read as agreeing that a
 * person so labelled is correctly classified. `WORKFORCE_CLASSIFICATION_NOTICE`
 * says exactly that, and every screen that offers this choice prints it.
 *
 * ★ WHAT IS DELIBERATELY NOT HERE ★
 * `company_driver` is NOT a value, and adding it would be the mistake this
 * module exists to avoid. A company driver is already representable twice over:
 * `EngagementType` in `./driver-profile` is the driver registry's own
 * company_driver/owner_operator distinction, which decides a driver's paperwork
 * and their pay, and `driver_action` is the function they perform here. Putting
 * a third copy on this record would create exactly the second classification
 * system the boundaries forbid, and the three copies would disagree.
 */
export type WorkforceClassification =
  | "employee"
  | "independent_contractor"
  | "owner_operator"
  /**
   * A principal of the business — the person whose organization this is.
   *
   * Distinct from `employee` because the question "who is answerable for this
   * carrier" has an answer that is not a payroll fact, and distinct from the
   * Owner membership role because holding every permission is access, not a
   * working relationship. A solo owner-operator is usually BOTH: the
   * classification says what their relationship with the business is, and it
   * still grants nothing.
   */
  | "organization_owner"
  /**
   * Somebody an outside organization supplies — an outsourced dispatcher, a
   * contracted safety consultant, an agency yard hand.
   *
   * Kept apart from `independent_contractor` because the counterparty is a
   * different kind of thing: the agreement is with their provider, not with
   * them, and when that provider's authority ends so does theirs. The provider
   * itself lives in the directory and the agreement in Contracts; this value
   * only records that the person reaches this organization through one.
   */
  | "external_worker";

export const WORKFORCE_CLASSIFICATION_LABEL: Record<WorkforceClassification, string> = {
  employee: "Employee",
  independent_contractor: "Independent contractor",
  owner_operator: "Owner-operator",
  organization_owner: "Organization owner",
  external_worker: "External / outsourced worker",
};

export const WORKFORCE_CLASSIFICATION_DESCRIPTION: Record<WorkforceClassification, string> = {
  employee: "Works for the organization on its payroll. Payroll itself is outside Antcolos.",
  independent_contractor: "Engaged under a contract for services. Paid against that contract, never through payroll.",
  owner_operator: "Brings their own equipment and is settled against loads. Settlements belong to the Settlements module, never to this record.",
  organization_owner: "A principal of this business. Says nothing about their permissions, which are granted only through Access.",
  external_worker: "Reaches this organization through an outside provider. Their authority here ends when the provider's does.",
};

/**
 * Printed wherever a classification is chosen or shown. Not a tooltip.
 *
 * A dropdown that offers "Employee" and "Independent contractor" without this
 * sentence teaches an operator that Antcolos checked. It did not, it cannot,
 * and the difference between those two labels is the one a regulator audits.
 */
export const WORKFORCE_CLASSIFICATION_NOTICE =
  "Classification is a fact this organization supplies, not a determination Antcolos makes. "
  + "Antcolos applies no worker-classification test and offers no opinion on whether a label "
  + "is correct. Employment law, tax treatment and benefits eligibility are outside this product.";

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
  /**
   * A roster file the carrier supplied, describing people it already employs.
   *
   * Distinct from `manual_entry` because the honest answer to "where did this
   * record come from" is a file nobody has checked, and because everything it
   * asserts — a start date most of all — stays the carrier's claim rather than
   * something Antcolos observed. The claim itself keeps its own provenance; see
   * `ImportedAssertion`.
   */
  | "roster_import"
  /** Somebody typed it in, because nothing else could supply it. */
  | "manual_entry";

export const WORKFORCE_SOURCE_LABEL: Record<WorkforceSourceKind, string> = {
  document_share: "From documents the person shared",
  invitation: "From an invitation",
  existing_carrier_relationship: "From an existing driver relationship",
  roster_import: "Imported from a roster file",
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
  | "function_assigned"
  | "function_removed"
  | "leave_recorded"
  | "leave_ended"
  | "leave_cancelled"
  | "start_date_recorded"
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
  function_assigned: "Function assigned",
  function_removed: "Function removed",
  leave_recorded: "Leave recorded",
  leave_ended: "Returned from leave",
  leave_cancelled: "Leave cancelled",
  start_date_recorded: "Start date recorded",
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
/* When it began, and who says so                                              */
/* -------------------------------------------------------------------------- */

/**
 * WHERE A START DATE CAME FROM. Two values, and the whole point is the gap.
 *
 * A carrier migrating onto Antcolos says "Sam has driven for us since March
 * 2024". Antcolos did not see that happen, has no evidence of it, and the
 * honest record of it is a CLAIM. What Antcolos did see is the day somebody
 * authorised pressed Start, and that is a different kind of fact.
 *
 * Collapsing the two is how a twenty-year carrier arrives on a new system
 * looking as though it hired everybody the afternoon somebody uploaded a
 * spreadsheet — and, worse, how a date a regulator may ask about silently
 * acquires an authority nobody gave it.
 *
 * ★ WHY NOT `ImportedAssertion<T>` ★
 * Because that type is already right and already used, and this is the SAME
 * distinction at a smaller scale. `ImportedAssertion` carries `occurredAt` vs
 * `receivedAt`, a `FactVerification` and a full `Provenance` chain, and a
 * roster import produces one for `startedWithCarrier`. This record does not
 * replace it: when an engagement came from an import, `assertionRef` points at
 * the assertion the import module owns, and the fields here are the small
 * projection a screen needs. When somebody typed the date in by hand there is
 * no assertion to point at, and inventing an empty one would claim a
 * provenance chain that does not exist.
 */
export type WorkforceStartDateBasis =
  /**
   * The organization states it. Antcolos observed nothing.
   *
   * Typed in during migration, imported from a roster, or recorded when an
   * engagement was created for somebody who has worked here for years.
   */
  | "asserted_by_organization"
  /**
   * Antcolos watched it happen: somebody authorised activated the engagement
   * on this date, in this product, and the audit ledger has the line.
   */
  | "observed_by_antcolos";

export const WORKFORCE_START_BASIS_LABEL: Record<WorkforceStartDateBasis, string> = {
  asserted_by_organization: "Stated by this organization",
  observed_by_antcolos: "Recorded in Antcolos",
};

export const WORKFORCE_START_BASIS_DESCRIPTION: Record<WorkforceStartDateBasis, string> = {
  asserted_by_organization:
    "This organization says the relationship began on this date. Antcolos did not see it happen and holds no evidence of it.",
  observed_by_antcolos:
    "Somebody authorised started this engagement in Antcolos on this date, and the audit ledger records who.",
};

/**
 * The start date, and what kind of fact it is.
 *
 * `value` deliberately duplicates `WorkforceEngagement.startDate` rather than
 * replacing it: every existing reader of `startDate` keeps working unchanged,
 * and a record migrated from before this field existed has a date with no
 * provenance — which is the truth about it, and better said than guessed.
 */
export interface WorkforceStartDate {
  value: IsoDateTime;
  basis: WorkforceStartDateBasis;
  /** When this provenance was recorded. Never the same as `value`. */
  recordedAt: IsoDateTime;
  recordedBy: ActorRef;
  /** The organization's own words about where the date came from. */
  note?: string;
  /** The `ImportedAssertion` this came from, when an import supplied it. */
  assertionRef?: { importRunId: string; rowId: string };
}

/* -------------------------------------------------------------------------- */
/* Functions — what somebody DOES here, which is not what they may do          */
/* -------------------------------------------------------------------------- */

/**
 * One organizational function this person performs, and who said so.
 *
 * ███ A FUNCTION IS NOT A PERMISSION ███
 * Assigning `dispatch` here grants nothing. It does not create a membership, it
 * does not add a key, and `WorkforceService` has no method that could. What it
 * does is let the product NOTICE a mismatch — somebody the organization says
 * dispatches, whose seat cannot open the dispatch board — and offer the
 * authorized route to fix it through Access. Showing the gap is the feature;
 * closing it silently would be the second authorization system this module
 * exists not to build.
 *
 * ★ WHY `ResponsibilityFunction` AND NOT A NEW VOCABULARY ★
 * Because Antcolos already names kinds of work, in `./responsibility`, and the
 * routing engine already reads that vocabulary. A second list — "dispatcher",
 * "accounting support", "safety support" — would be eight words meaning almost
 * the same eight things, and the day they drifted apart nobody would know which
 * screen was right. `MembershipProfile.functions` declares what a SEAT may be
 * routed work for; this declares what a PERSON does for the organization, which
 * is a different subject and is representable for somebody with no seat at all.
 */
export interface WorkforceFunctionAssignment {
  functionKey: ResponsibilityFunction;
  /** Who assigned it. Required: an assignment nobody owns cannot be reviewed. */
  assignedByMembershipId: string;
  assignedByName: string;
  assignedAt: IsoDateTime;
  /** The organization's own words — "runs the west desk", "backs up payroll". */
  note?: string;
}

/**
 * A function this person performs that their access does not support.
 *
 * DERIVED on every read from the permission catalog and the membership's
 * effective permissions. Never stored, because a stored gap is a gap that stays
 * on screen after somebody fixed it.
 */
export interface WorkforceFunctionGap {
  functionKey: ResponsibilityFunction;
  label: string;
  /** Catalog keys this function ordinarily needs and this seat does not hold. */
  missing: PermissionKey[];
  /** Why the gap exists, in the operator's language. */
  reason: string;
  /**
   * What a person may do about it — always a route into Access, never a button
   * that grants anything here.
   */
  remedy: "grant_through_access" | "invite_to_workspace" | "no_seat_needed";
}

export const WORKFORCE_FUNCTION_REMEDY_LABEL: Record<
  WorkforceFunctionGap["remedy"], string
> = {
  grant_through_access: "Change their permissions in Access",
  invite_to_workspace: "Invite them to this workspace",
  no_seat_needed: "No Antcolos access is needed for this",
};

/* -------------------------------------------------------------------------- */
/* Leave and temporary unavailability                                          */
/* -------------------------------------------------------------------------- */

/**
 * WHY somebody is away, in the coarsest terms that are still useful.
 *
 * ★ DELIBERATELY COARSE ★
 * `medical` and nothing more. There is no diagnosis field, no condition, no
 * accommodation, no certification and no place to type one, because an
 * operational availability record is not a medical record and a text box on an
 * HR screen is where one accidentally becomes the other. What dispatch needs to
 * know is that this person is away until the 14th.
 *
 * ███ NOT AN FMCSA DUTY STATUS AND NOT A LEAVE ENTITLEMENT ███
 * None of these values is an ELD duty status, an hours-of-service record, or a
 * determination that any statutory leave applies. FMLA, ADA, USERRA, state
 * leave laws and paid-time-off accrual are outside this product entirely.
 */
export type WorkforceLeaveReason =
  | "planned_time_off"
  | "medical"
  | "family"
  | "personal"
  | "military"
  | "training"
  /** Away at the organization's instruction, short of a suspension. */
  | "administrative"
  | "other";

export const WORKFORCE_LEAVE_REASON_LABEL: Record<WorkforceLeaveReason, string> = {
  planned_time_off: "Planned time off",
  medical: "Medical",
  family: "Family",
  personal: "Personal",
  military: "Military",
  training: "Training",
  administrative: "Administrative",
  other: "Other",
};

export const WORKFORCE_LEAVE_NOTICE =
  "This records that somebody is away and roughly why, so work is not routed to them. "
  + "It is not a medical record, not an FMCSA duty status, and not a determination that "
  + "any statutory leave applies. Do not enter diagnoses or other sensitive detail.";

export type WorkforceLeaveStatus =
  /** Recorded, and the start date has not arrived. */
  | "planned"
  /** Under way today. */
  | "current"
  /** They came back, or it was recorded as finished. */
  | "ended"
  /** It was called off before it started or before it finished. */
  | "cancelled";

export const WORKFORCE_LEAVE_STATUS_LABEL: Record<WorkforceLeaveStatus, string> = {
  planned: "Planned",
  current: "Away now",
  ended: "Returned",
  cancelled: "Cancelled",
};

/**
 * One period of temporary unavailability.
 *
 * ★ NOT A LIFECYCLE STATE ★
 * Somebody on leave is still `active`. Leave is a fact ABOUT an active
 * engagement, which is why it is a record beside the state rather than a value
 * inside it: a carrier that turned "on holiday" into an engagement state would
 * have to decide what ending the holiday means for somebody who was suspended
 * the week before, and there is no good answer.
 *
 * It is also not `suspended`, which is the organization withdrawing somebody
 * from work, usually indefinitely, usually for cause. The two are kept apart
 * because "away until the 14th" and "we have stood them down" must never be
 * indistinguishable to whoever reads this a year later.
 */
export interface WorkforceLeaveRecord {
  id: string;
  reason: WorkforceLeaveReason;
  status: WorkforceLeaveStatus;
  startDate: IsoDateTime;
  /** When they are expected back. Absent when genuinely nobody knows. */
  expectedReturnDate?: IsoDateTime;
  /** Set when they actually returned. Never guessed from the expected date. */
  actualReturnDate?: IsoDateTime;
  recordedByMembershipId: string;
  recordedByName: string;
  recordedAt: IsoDateTime;
  /**
   * Who approved it, when the organization approves leave at all.
   *
   * Optional on purpose: plenty of small carriers do not approve anything, and
   * a required field they cannot fill would be filled with the recorder's own
   * name — which would make "approved" mean nothing.
   */
  approvedByMembershipId?: string;
  approvedByName?: string;
  /** Operational note only. Never sensitive detail; see the notice above. */
  note?: string;
  endedByMembershipId?: string;
  endedByName?: string;
  endedAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Availability — the one typed signal, and its exact limits                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether this person is working right now, as far as HR knows.
 *
 * ███ WHAT THIS IS NOT ███
 * It is not a statement that a truck may be dispatched. It is not an
 * hours-of-service determination. It is not a qualification. A driver who is
 * `working` by this signal may still be out of service for four other reasons
 * that four other modules own, and this one has never read any of them.
 *
 * The honest scope is narrow and worth stating on screen: a person who is away
 * should not be routed work, and this is the field that says so.
 */
export type WorkforceAvailabilityState =
  | "working"
  | "on_leave"
  /** Leave is recorded but has not started yet. They are working today. */
  | "leave_planned"
  /** The organization has stood them down. Not leave. */
  | "suspended"
  /** Prospective, onboarding, or ended: not somebody to route work to. */
  | "not_engaged";

export const WORKFORCE_AVAILABILITY_LABEL: Record<WorkforceAvailabilityState, string> = {
  working: "Working",
  on_leave: "Away",
  leave_planned: "Leave planned",
  suspended: "Stood down",
  not_engaged: "Not working here",
};

export interface WorkforceAvailability {
  state: WorkforceAvailabilityState;
  /** The leave that produced it, when leave did. */
  leave?: WorkforceLeaveRecord;
  /** One line, in the operator's language. Printed, not inferred by a screen. */
  summary: string;
  /**
   * Whether the responsibility engine should consider routing work here.
   *
   * ★ NOT A DISPATCH DECISION ★
   * False means "do not hand this person work". True means only "HR knows of no
   * reason not to" — never that a load may be assigned, a truck is roadworthy,
   * or a driver is qualified and has hours. Those four answers belong to
   * Dispatch, Maintenance, Safety and the ELD, and none of them reads this.
   */
  availableForWork: boolean;
  /** Said out loud wherever this is shown. */
  limitation: string;
}

export const WORKFORCE_AVAILABILITY_LIMITATION =
  "This says whether HR knows of a reason not to route work to this person. It never "
  + "declares a truck dispatch-ready, a driver qualified, or hours available — Dispatch, "
  + "Maintenance, Safety and the ELD own those, and none of them reads this field.";

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
  /**
   * WHAT KIND OF FACT `startDate` is, when anybody recorded that.
   *
   * Absent on a record made before this field existed, and absent is not
   * `observed_by_antcolos`: "nobody said" and "Antcolos watched it happen" are
   * different, and defaulting one to the other would manufacture a provenance
   * the ledger cannot support. Activation NEVER overwrites an asserted date or
   * relabels its basis — see `WorkforceService.activate`.
   */
  startDateProvenance?: WorkforceStartDate;
  endDate?: IsoDateTime;
  /**
   * Organizational functions this person performs. Zero or many.
   *
   * MANY on purpose: at a five-truck carrier one person dispatches, does the
   * safety filing and chases invoices, and a single-valued field would force
   * whoever entered them to pick the lie that fits. Not one of these grants a
   * permission; see `WorkforceFunctionAssignment`.
   */
  functions: WorkforceFunctionAssignment[];
  /**
   * Periods of temporary unavailability, newest last. Append-mostly.
   *
   * Kept on the engagement because leave is a fact about THIS organizational
   * relationship — a driver on holiday at one carrier is not on holiday at
   * another — and a person-level leave store would say otherwise.
   */
  leave: WorkforceLeaveRecord[];
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
  /** Derived on read from the leave records and the engagement state. */
  availability: WorkforceAvailability;
  /**
   * Functions whose permissions this person's seat does not hold.
   *
   * Derived from the permission catalog and the membership's EFFECTIVE
   * permissions on every read, so granting the key makes the gap disappear
   * without anybody touching this module.
   */
  functionGaps: WorkforceFunctionGap[];
  /**
   * How many Needs You items this engagement is currently producing.
   *
   * A COUNT of the existing derived projection, never a second queue: the items
   * themselves stay in Needs You, and this number exists so a directory row can
   * say "two things are waiting" without unfolding them.
   */
  openNeedsYouCount: number;
  /**
   * The single next HR action, or absent when there is none.
   *
   * Derived. A row with nothing waiting says nothing, which is the difference
   * between a queue and a wall of badges.
   */
  nextAction?: WorkforceNextAction;
}

/**
 * What the product would have somebody do next about this engagement.
 *
 * Never a command: it names the action and the permission it needs, and the
 * screen decides whether to offer a button. A `requires` the reader does not
 * hold still shows the line — knowing somebody else must act is useful, and
 * hiding it is how work sits for a month.
 */
export interface WorkforceNextAction {
  kind:
    | "decide_on_candidate"
    | "finish_onboarding"
    | "activate"
    | "finish_offboarding"
    | "record_return_from_leave"
    | "close_function_gap"
    | "record_start_date_basis";
  label: string;
  detail: string;
  requires: PermissionKey[];
  href?: string;
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
  /** Only engagements performing this organizational function. */
  functionKey?: ResponsibilityFunction;
  /** Only people who are away right now. */
  onLeaveOnly?: boolean;
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
  /** Working engagements whose person is away today. */
  onLeave: number;
  /** Assigned functions this organization's seats cannot actually perform. */
  functionGaps: number;
}
