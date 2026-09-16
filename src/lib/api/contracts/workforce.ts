import type {
  OffboardingPlan, OffboardingResult, OffboardingStepKey, OnboardingChecklist,
  WorkforceClassification, WorkforceEngagementView, WorkforceFilters,
  WorkforcePersonRef, WorkforceSourceRef, WorkforceSummary,
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
  managerMembershipId?: string;
  /** Create straight into onboarding rather than prospective. */
  startOnboarding?: boolean;
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
