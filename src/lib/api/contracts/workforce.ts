import type {
  OffboardingPlan, OffboardingResult, OffboardingStepKey, OnboardingChecklist,
  ResponsibilityFunction, WorkforceClassification, WorkforceEngagementView,
  WorkforceFilters, WorkforceLeaveReason, WorkforcePersonRef,
  WorkforceSourceRef, WorkforceStartDateBasis, WorkforceSummary,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE WORKFORCE SEAM ★
 *
 * Who works with this organization, on what basis, from when, and in what
 * status. That is the whole responsibility.
 *
 * Notice what this service cannot do, structurally rather than by convention.
 * There is no method that grants a permission, creates a membership, writes a
 * document, changes a contract term, records a payment or decides a
 * qualification. `requestAccessStep` asks the access system for something and
 * records that it asked; `offboard` calls other modules' own commands and
 * reports honestly when one of them fails. No input on this interface carries a
 * `PermissionKey`, and none ever will.
 *
 * Onboarding status is DERIVED from the modules that own it on every read, so
 * this module cannot drift from Safety, Contracts, the Document Center or
 * Access — it has nothing of theirs to drift.
 *
 * ── HOW READS ARE SCOPED (A6) ─────────────────────────────────────────────
 * Every method takes a `ServiceContext` and none takes an organization id. An
 * engagement is read through `engagement.organizationId` and nothing else:
 * being named on one as the manager, the linked contract's party or the driver
 * does not make it readable, for the same reason A6 gives about `FactScope` —
 * a field that says who a record is ABOUT is attribution, never a grant.
 *
 * ███ FRONTEND ONLY ███
 * There is no cross-module transaction here. Activating an engagement reads
 * every other module and refuses when they disagree; it cannot atomically
 * change them together, and `OnboardingChecklist.limitation` says so on every
 * checklist. Durable persistence, unique constraints, real authorization,
 * durable audit and job queues are the backend's.
 */

export interface CreateEngagementInput {
  person: WorkforcePersonRef;
  classification: WorkforceClassification;
  positionTitle: string;
  source: WorkforceSourceRef;
  /** Intended start. Optional: a prospective person has no start date yet. */
  startDate?: string;
  /**
   * What kind of fact `startDate` is.
   *
   * Required whenever `startDate` is given, and there is no default, because
   * the default a caller would get wrong is the dangerous one: a migrated
   * carrier's 2019 date silently recorded as something Antcolos observed. A
   * date with no basis is refused rather than guessed.
   */
  startDateBasis?: WorkforceStartDateBasis;
  /** The organization's own words about where the date came from. */
  startDateNote?: string;
  managerMembershipId?: string;
  /** Create straight into onboarding rather than prospective. */
  startOnboarding?: boolean;
  /**
   * Functions to record at creation. Zero or many.
   *
   * Recorded, never granted. There is no permission key on this input and no
   * path from it to one — see `WorkforceFunctionAssignment`.
   */
  functions?: ResponsibilityFunction[];
  /**
   * Engagements a person has LOOKED AT and decided are somebody else.
   *
   * ★ WHY A CREATE COMMAND ASKS THIS ★
   * A name, an email and a phone number are evidence, not identity. When the
   * roster already holds somebody who plausibly IS this person — same name,
   * different address; same address, different name — Antcolos refuses to
   * decide it either way, exactly as the roster import refuses. Linking the
   * wrong record and creating a second one are both permanent, and only
   * somebody who knows these people can tell them apart.
   *
   * So the command is refused with the candidates named, and passing their ids
   * back here is a person saying "I looked, and these are different people".
   * It is an acknowledgement, never a merge: nothing is linked by it.
   */
  confirmedDistinctFrom?: string[];
}

/**
 * Recording, or correcting, when the relationship began and on what basis.
 *
 * Separate from every other command because it is the one field a regulator may
 * ask about and the one an activation must never quietly rewrite.
 */
export interface RecordStartDateInput {
  startDate: string;
  basis: WorkforceStartDateBasis;
  note?: string;
  /** The `ImportedAssertion` this came from, when an import supplied it. */
  assertionRef?: { importRunId: string; rowId: string };
}

/**
 * Saying that somebody performs a kind of work here.
 *
 * ███ THERE IS NO PERMISSION ON THIS INPUT ███
 * Nor on any other on this interface. Assigning `dispatch` records a fact about
 * the person and changes nobody's access by one key; when their seat cannot
 * actually do it, `WorkforceEngagementView.functionGaps` says so and points at
 * Access, which is the only place a permission is granted.
 */
export interface AssignFunctionInput {
  functionKey: ResponsibilityFunction;
  /** The organization's own words — "runs the west desk". */
  note?: string;
}

export interface RemoveFunctionInput {
  functionKey: ResponsibilityFunction;
  /** Required. Taking a responsibility off somebody is not a typo fix. */
  reason: string;
}

/**
 * Somebody is away, or will be.
 *
 * ★ NOT A SUSPENSION AND NOT A LIFECYCLE CHANGE ★
 * The engagement stays `active`. Recording leave asks the membership directory
 * to mark the seat unavailable through its OWN command, exactly as offboarding
 * asks it to end a seat — Workforce keeps no routing flag of its own.
 */
export interface RecordLeaveInput {
  reason: WorkforceLeaveReason;
  startDate: string;
  /** When they are expected back. Absent when genuinely nobody knows. */
  expectedReturnDate?: string;
  /** Who approved it, where the organization approves leave at all. */
  approvedByMembershipId?: string;
  /**
   * Operational note. Refused if it looks like medical detail is being typed
   * into an availability record? No — this build cannot tell, and pretending to
   * would be worse. The screen prints `WORKFORCE_LEAVE_NOTICE`; the backend
   * owes this field real handling. See the docs.
   */
  note?: string;
}

export interface EndLeaveInput {
  leaveId: string;
  /** When they actually came back. Never inferred from the expected date. */
  actualReturnDate?: string;
  note?: string;
}

export interface CancelLeaveInput {
  leaveId: string;
  reason: string;
}

/**
 * Taking a person who shared documents forward into a decision.
 *
 * Deliberately a separate command with its own input: a share is not an
 * application, opening one is not interest, and the ONLY way a share becomes a
 * prospective engagement is somebody authorized choosing this explicitly.
 */
export interface TakeShareForwardInput {
  sharePackageId: string;
  classification: WorkforceClassification;
  positionTitle: string;
}

export interface ClassificationChangeInput {
  classification: WorkforceClassification;
  /** Required. Reclassifying somebody is not a typo fix. */
  reason: string;
}

export interface ManagerChangeInput {
  /** Omitted removes the supervisor. Never implies anybody else takes over. */
  managerMembershipId?: string;
  note?: string;
}

/**
 * Which agreement governs this engagement.
 *
 * Two ids and nothing else, and the link is one-directional for this milestone:
 * the engagement points at the contract, no contract points back, and
 * `RelationshipRefKind` is untouched.
 */
export interface LinkContractInput {
  contractId: string;
  contractVersionId?: string;
}

export interface WaiveStepInput {
  stepKey: string;
  /** Required, and shown on the checklist beside the waiver's author. */
  reason: string;
}

export interface SuspendInput {
  reason: string;
}

export interface EndEngagementInput {
  reason: string;
  endDate?: string;
  /**
   * The steps the person CONFIRMED after seeing the impact preview.
   *
   * Nothing outside this list is performed. An offboarding that ended an access
   * seat nobody asked it to end would be exactly the silent cross-domain write
   * this module exists not to do.
   */
  confirmedSteps: OffboardingStepKey[];
}

/** What activation would ask the access system for. Never performed here. */
export interface AccessStepRequestInput {
  kind: "create_membership" | "suspend_membership" | "end_membership";
  note: string;
}

export interface WorkforceService {
  /** Engagements in this organization. Never another organization's. */
  list(ctx: ServiceContext, filters?: WorkforceFilters): Promise<WorkforceEngagementView[]>;
  get(ctx: ServiceContext, engagementId: string): Promise<WorkforceEngagementView>;
  summary(ctx: ServiceContext): Promise<WorkforceSummary>;

  create(ctx: ServiceContext, input: CreateEngagementInput): Promise<WorkforceEngagementView>;
  /** The explicit, authorized bridge from a document share to a candidate. */
  takeShareForward(
    ctx: ServiceContext, input: TakeShareForwardInput,
  ): Promise<WorkforceEngagementView>;

  /** The checklist, derived from the modules that own each line. */
  onboardingChecklist(ctx: ServiceContext, engagementId: string): Promise<OnboardingChecklist>;
  startOnboarding(ctx: ServiceContext, engagementId: string): Promise<WorkforceEngagementView>;
  waiveStep(
    ctx: ServiceContext, engagementId: string, input: WaiveStepInput,
  ): Promise<OnboardingChecklist>;

  /**
   * Starts somebody. Refused while a required step is outstanding in the module
   * that owns it, and refused when the caller is the subject.
   */
  activate(ctx: ServiceContext, engagementId: string): Promise<WorkforceEngagementView>;
  suspend(
    ctx: ServiceContext, engagementId: string, input: SuspendInput,
  ): Promise<WorkforceEngagementView>;
  restore(ctx: ServiceContext, engagementId: string): Promise<WorkforceEngagementView>;
  reject(
    ctx: ServiceContext, engagementId: string, reason: string,
  ): Promise<WorkforceEngagementView>;
  withdraw(
    ctx: ServiceContext, engagementId: string, reason: string,
  ): Promise<WorkforceEngagementView>;

  changeClassification(
    ctx: ServiceContext, engagementId: string, input: ClassificationChangeInput,
  ): Promise<WorkforceEngagementView>;
  changeManager(
    ctx: ServiceContext, engagementId: string, input: ManagerChangeInput,
  ): Promise<WorkforceEngagementView>;
  linkContract(
    ctx: ServiceContext, engagementId: string, input: LinkContractInput,
  ): Promise<WorkforceEngagementView>;

  /**
   * Records when the relationship began and what kind of fact that is.
   *
   * The one command that may change a start date. `activate` cannot: it fills
   * an EMPTY date with an observed one and leaves an asserted one exactly as it
   * found it, basis included.
   */
  recordStartDate(
    ctx: ServiceContext, engagementId: string, input: RecordStartDateInput,
  ): Promise<WorkforceEngagementView>;

  /** Records that somebody performs a kind of work here. Grants nothing. */
  assignFunction(
    ctx: ServiceContext, engagementId: string, input: AssignFunctionInput,
  ): Promise<WorkforceEngagementView>;
  /** Stops recording it. Revokes nothing either — there was nothing to revoke. */
  removeFunction(
    ctx: ServiceContext, engagementId: string, input: RemoveFunctionInput,
  ): Promise<WorkforceEngagementView>;

  /**
   * Records leave. The engagement stays active; the seat is marked unavailable
   * through the access boundary's own command.
   */
  recordLeave(
    ctx: ServiceContext, engagementId: string, input: RecordLeaveInput,
  ): Promise<WorkforceEngagementView>;
  /** Records that they came back. Restores eligibility for EVALUATION only. */
  endLeave(
    ctx: ServiceContext, engagementId: string, input: EndLeaveInput,
  ): Promise<WorkforceEngagementView>;
  cancelLeave(
    ctx: ServiceContext, engagementId: string, input: CancelLeaveInput,
  ): Promise<WorkforceEngagementView>;

  /**
   * Put the work-routing signal back in step with the recorded leave.
   *
   * ★ THE RESUMABLE HALF OF A NON-TRANSACTIONAL WRITE ★
   * Recording leave writes an HR record and then asks the access system to
   * change the seat. There is no transaction around those two, and three
   * things routinely separate them afterwards: a future leave becoming
   * effective with no scheduler to notice, somebody changing availability
   * independently, and the second write simply failing. Each leaves the HR
   * fact and the routing signal disagreeing.
   *
   * `WorkforceEngagementView.availability.projection` reports the
   * disagreement, Needs You raises it, and this applies it. IDEMPOTENT: it
   * computes the desired value from leave and writes only if the seat differs,
   * so running it twice is running it once and running it when nothing is
   * wrong does nothing at all.
   *
   * It writes exactly one field through the membership directory's own
   * command, and only when leave has an opinion — it never speaks for an
   * engagement that is not active, and never invents `available`.
   */
  reconcileAvailability(
    ctx: ServiceContext, engagementId: string,
  ): Promise<WorkforceEngagementView>;

  /** Asks the access system for something, and records only that it asked. */
  requestAccessStep(
    ctx: ServiceContext, engagementId: string, input: AccessStepRequestInput,
  ): Promise<WorkforceEngagementView>;

  /** What ending this engagement would do, computed. Shown before confirming. */
  offboardingPlan(ctx: ServiceContext, engagementId: string): Promise<OffboardingPlan>;
  /** Ends it, performs only the confirmed steps, and hides no failure. */
  offboard(
    ctx: ServiceContext, engagementId: string, input: EndEngagementInput,
  ): Promise<OffboardingResult>;
}
