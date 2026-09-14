import type {
  CarrierDriverPolicy, DriverLoadPost, DriverProposalView, DriverTripSummary,
  DriverWorkflowEvent, DriverWorkflowView, IntegrationStatus,
  PendingIntegrationEvent, ProposalEvent, ProposalStatus,
} from "@/types";
import type { ProposalCommand, WorkflowCommand } from "@/lib/driver-workflow/commands";
import type { ServiceContext } from "./context";

/**
 * ONE service for the Driver Load Decision and Trip Workflow, deliberately not
 * two.
 *
 * Every channel enters here: the driver dashboard today, the Telegram bot when
 * it is built, a support tool if one is ever needed. They all send the same
 * `ProposalCommand` or `WorkflowCommand`, hit the same validation, the same
 * carrier policy, the same permission checks and the same event history. There
 * is no second path in, which is what stops "the bot does it slightly
 * differently" from ever becoming true.
 *
 * Reads return VIEWS, not records: money is already reduced to what carrier
 * policy discloses to this driver, and the list of available actions is
 * computed by the same service that enforces it.
 */

export interface DriverProposalFilters {
  status?: ProposalStatus[];
  /**
   * open      — awaiting an answer or paused
   * answered  — approved or rejected, still live history
   * closed    — withdrawn, expired, unavailable or finalized
   */
  view?: "open" | "answered" | "closed" | "all";
}

export interface ProposalCommandResult {
  proposal: DriverProposalView;
  /** The events this command produced. Empty when a retry was recognised. */
  events: ProposalEvent[];
  /** True when the idempotency key had already been used: nothing new happened. */
  replayed: boolean;
  /** What was queued for Dispatch, which is on another branch. */
  handoff?: PendingIntegrationEvent;
}

export interface WorkflowCommandResult {
  workflow: DriverWorkflowView;
  events: DriverWorkflowEvent[];
  replayed: boolean;
  handoffs: PendingIntegrationEvent[];
}

export interface FinalizeLoadInput {
  /** The canonical load being finalized. */
  loadId: string;
  /** The proposal it came from, when it came from one. */
  proposalId?: string;
  idempotencyKey: string;
}

export interface DriverWorkflowService {
  /* ---- Proposals ------------------------------------------------------- */

  listProposals(
    ctx: ServiceContext,
    filters?: DriverProposalFilters,
  ): Promise<DriverProposalView[]>;

  getProposal(ctx: ServiceContext, proposalId: string): Promise<DriverProposalView>;

  /** The append-only record of the negotiation, newest first. */
  proposalEvents(ctx: ServiceContext, proposalId: string): Promise<ProposalEvent[]>;

  /**
   * The single entry point for approve, reject, pause, resume, comment and
   * counteroffer. Safe to retry: replaying an idempotency key returns the
   * original outcome and records nothing.
   */
  executeProposalCommand(
    ctx: ServiceContext,
    command: ProposalCommand,
  ): Promise<ProposalCommandResult>;

  /* ---- Finalization ---------------------------------------------------- */

  /**
   * Create the finalized Driver Load Post, and with it the load's own workflow
   * instance.
   *
   * Refused unless the rate confirmation has been reviewed and approved by
   * Dispatch, signed with the authorized carrier signature, and sent back to
   * the broker. Finalizing also makes every overlapping proposal for the same
   * driver or the same equipment Unavailable, with their history untouched.
   */
  finalize(ctx: ServiceContext, input: FinalizeLoadInput): Promise<DriverLoadPost>;

  /* ---- Trips ----------------------------------------------------------- */

  /** Every workflow instance this caller may see, active and completed. */
  listTrips(ctx: ServiceContext): Promise<DriverTripSummary[]>;

  getTrip(ctx: ServiceContext, workflowId: string): Promise<DriverWorkflowView>;

  /** The same view, reached by the canonical load id. */
  getTripByLoad(ctx: ServiceContext, loadId: string): Promise<DriverWorkflowView>;

  /**
   * Milestones, activities, document actions and corrections. Out-of-order
   * milestones are accepted and the real sequence is kept; nothing is blocked
   * because an earlier step is missing.
   */
  executeWorkflowCommand(
    ctx: ServiceContext,
    command: WorkflowCommand,
  ): Promise<WorkflowCommandResult>;

  /**
   * Pull whatever GPS, geofence, ELD or telematics signals the boundary has for
   * this trip and record what they suggest as INFERRED — with source, time and
   * confidence, never as something the driver did.
   */
  ingestSignals(ctx: ServiceContext, workflowId: string): Promise<DriverWorkflowView>;

  /* ---- The boundary ---------------------------------------------------- */

  /** The carrier policy this caller's views and actions were built from. */
  policy(ctx: ServiceContext): Promise<CarrierDriverPolicy>;

  /** What this workflow has produced for modules that do not exist yet. */
  pendingHandoffs(ctx: ServiceContext): Promise<PendingIntegrationEvent[]>;

  /** What is and is not actually connected. Rendered verbatim, never softened. */
  integrationStatus(ctx: ServiceContext): Promise<IntegrationStatus[]>;
}
