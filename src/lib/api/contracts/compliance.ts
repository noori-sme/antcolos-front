import type {
  ComplianceExtensionPoint, ComplianceFilters, ComplianceRequirement,
  ComplianceShare, ComplianceSnapshot, ComplianceSubjectGroup, ComplianceSummary,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * Safety & Compliance, as the UI sees it.
 *
 * Every method takes a ServiceContext, so a request is always made *as a
 * membership, inside an organization*. The adapter — mock today, HTTP later —
 * is what enforces permissions, responsibility scope, relationship scope and
 * cross-organization isolation. A screen that renders a button it should not
 * have still fails here.
 */

export interface RecordResolutionInput {
  /** Why it is now satisfied, in the operator's words. Required. */
  note: string;
  /**
   * How it was resolved. "waived" needs `compliance:manage` and is recorded as
   * a waiver rather than as evidence, because they are not the same claim.
   */
  method: "evidence_accepted" | "renewed" | "corrected" | "waived";
}

export interface AssignResponsibilityInput {
  membershipId: string;
  displayName: string;
  note?: string;
}

export interface SuspendRequirementInput {
  reason: string;
}

export interface ComplianceService {
  /** Requirements this membership may see, worst first. */
  list(ctx: ServiceContext, filters?: ComplianceFilters): Promise<ComplianceRequirement[]>;
  get(ctx: ServiceContext, requirementId: string): Promise<ComplianceRequirement>;
  /** The same requirements, grouped by the entity they are about. */
  bySubject(ctx: ServiceContext, filters?: ComplianceFilters): Promise<ComplianceSubjectGroup[]>;
  summary(ctx: ServiceContext): Promise<ComplianceSummary>;
  /** Open items only. Drives the dashboard heading and the Home tile. */
  openCount(ctx: ServiceContext): Promise<number>;

  /** Frozen history kept after a relationship ended. Never actionable. */
  snapshots(ctx: ServiceContext, subjectId?: string): Promise<ComplianceSnapshot[]>;
  /** What this organization shares with dispatch, or has been shared with it. */
  shares(ctx: ServiceContext): Promise<ComplianceShare[]>;

  recordResolution(
    ctx: ServiceContext, requirementId: string, input: RecordResolutionInput,
  ): Promise<ComplianceRequirement>;
  assignResponsibility(
    ctx: ServiceContext, requirementId: string, input: AssignResponsibilityInput,
  ): Promise<ComplianceRequirement>;
  suspend(
    ctx: ServiceContext, requirementId: string, input: SuspendRequirementInput,
  ): Promise<ComplianceRequirement>;
  reinstate(ctx: ServiceContext, requirementId: string): Promise<ComplianceRequirement>;
  addNote(
    ctx: ServiceContext, requirementId: string, note: string,
  ): Promise<ComplianceRequirement>;

  /**
   * The later milestones — inspections, violations, accidents, claims,
   * hours-of-service, CSA/SMS and full audit preparation. Every entry reports
   * `available: false`; the screens say "not built yet" rather than showing
   * empty data as though it were a clean record.
   */
  extensionPoints(ctx: ServiceContext): Promise<ComplianceExtensionPoint[]>;
}
