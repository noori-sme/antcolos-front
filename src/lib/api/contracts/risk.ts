import type {
  IsoDateTime, RiskCase, RiskCaseFilters, RiskCaseState, RiskCaseSummary,
  RiskDashboard, RiskDecisionKind, RiskExtensionPoint, RiskRule, RiskSignal,
  RiskSignalFilters,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE RISK SEAM ★
 *
 * Signals and cases. Never audit events — those belong to `AuditService`, and
 * nothing here writes one except through it.
 *
 * Every write below appends to the case's own immutable timeline AND records an
 * audit event, so working a case is itself auditable. A case can be reopened; a
 * case can never be edited into a different history.
 *
 * Separation of duties is enforced HERE, at the seam, not in the screen: a
 * membership that is a subject of a case is refused investigation, assignment,
 * decisions and closure on it whatever permissions they hold.
 */

export interface OpenCaseInput {
  title: string;
  summary: string;
  /** Signals to group. At least one: a case with no signal has no subject. */
  signalIds: string[];
  assigneeMembershipId?: string;
  dueAt?: IsoDateTime;
}

export interface AddNoteInput {
  body: string;
}

export interface AddEvidenceInput {
  kind: "audit_event" | "document" | "record" | "note";
  /** The record it points at. Evidence is referenced, never copied. */
  refId: string;
  refKind: RiskCase["evidence"][number]["ref"]["kind"];
  refLabel: string;
  description: string;
}

export interface RecordDecisionInput {
  kind: RiskDecisionKind;
  rationale: string;
  /** The state this decision moves the case to, when it moves it. */
  resultingState?: RiskCaseState;
}

export interface TransitionInput {
  to: RiskCaseState;
  /** Required for every ending and for escalation. */
  rationale?: string;
}

export interface DismissSignalInput {
  reason: string;
}

export interface RiskService {
  /** Organization-scoped counts. Requires `risk:view`. */
  dashboard(ctx: ServiceContext): Promise<RiskDashboard>;

  /** The mock rule catalogue, so a screen can show what is being looked for. */
  rules(ctx: ServiceContext): Promise<readonly RiskRule[]>;

  /** Signals, newest first. Requires `risk:view`. */
  signals(ctx: ServiceContext, filters?: RiskSignalFilters): Promise<RiskSignal[]>;
  signal(ctx: ServiceContext, signalId: string): Promise<RiskSignal>;

  /**
   * Judges a signal not a concern. Requires `risk:investigate`.
   *
   * The audit events behind it are untouched — dismissing a signal never
   * removes, hides or rewrites the record of what happened.
   */
  dismissSignal(
    ctx: ServiceContext,
    signalId: string,
    input: DismissSignalInput,
  ): Promise<RiskSignal>;

  /** Cases, most urgent first. Requires `risk:view`. */
  cases(ctx: ServiceContext, filters?: RiskCaseFilters): Promise<RiskCaseSummary[]>;
  case(ctx: ServiceContext, caseId: string): Promise<RiskCase>;

  /** Requires `risk:investigate`. */
  openCase(ctx: ServiceContext, input: OpenCaseInput): Promise<RiskCase>;

  /** Adds a signal to an existing case. Requires `risk:investigate`. */
  linkSignal(ctx: ServiceContext, caseId: string, signalId: string): Promise<RiskCase>;

  /**
   * Requires `risk:assign`, and refuses a membership that is a subject of the
   * case — the list is filtered before it is offered, and checked again here.
   */
  assign(
    ctx: ServiceContext,
    caseId: string,
    membershipId: string | null,
  ): Promise<RiskCase>;

  /** Requires `risk:investigate`. Clamped to the severity's maximum age. */
  setDueDate(ctx: ServiceContext, caseId: string, dueAt: IsoDateTime | null): Promise<RiskCase>;

  /**
   * Requires `risk:view`. A note is the ONE thing a subject of a case may add:
   * they can explain themselves; they cannot investigate, decide or close.
   */
  addNote(ctx: ServiceContext, caseId: string, input: AddNoteInput): Promise<RiskCase>;

  /** Requires `risk:investigate`. */
  addEvidence(
    ctx: ServiceContext,
    caseId: string,
    input: AddEvidenceInput,
  ): Promise<RiskCase>;

  /** Requires `risk:investigate`, plus `risk:resolve` when it closes the case. */
  recordDecision(
    ctx: ServiceContext,
    caseId: string,
    input: RecordDecisionInput,
  ): Promise<RiskCase>;

  /** Requires `risk:investigate`, plus `risk:resolve` for any ending. */
  transition(ctx: ServiceContext, caseId: string, input: TransitionInput): Promise<RiskCase>;

  /** Memberships that may be given this case, with the subjects removed. */
  eligibleAssignees(
    ctx: ServiceContext,
    caseId: string,
  ): Promise<{ membershipId: string; name: string }[]>;

  /** Every entry is `available: false`. Nothing here is built or connected. */
  extensionPoints(ctx: ServiceContext): Promise<readonly RiskExtensionPoint[]>;
}
