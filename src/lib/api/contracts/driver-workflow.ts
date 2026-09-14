import type {
  CarrierDriverPolicy, DriverDecision, DriverLoadPost, DriverProposalView,
  DriverReviewStatus, DriverTripSummary, DriverWorkflowEvent, DriverWorkflowView,
  IntegrationStatus, OutgoingLoadPost, OutgoingOpportunity, OutgoingProgressUpdate,
  PendingIntegrationEvent, ProposalEvent, ProposalStatus,
} from "@/types";
import type { ProposalCommand, WorkflowCommand } from "@/lib/driver-workflow/commands";
import type { ServiceContext } from "./context";

/**
 * THE BOUNDARY BETWEEN DISPATCH AND THE DRIVER WORKFLOW.
 *
 * The Driver Workflow and the Driver Dashboard are built in their own module.
 * Dispatch does not own driver-entered events, driver documents, GPS, ELD or
 * anything else the driver's side records — and must never grow a second copy
 * of them, because two systems that both believe they know where the truck is
 * will eventually disagree in front of a customer.
 *
 * So everything between the two goes through THIS interface, and only this
 * interface. Dispatch calls it; it does not reach past it. When the Driver
 * Workflow branch is merged, one file changes — the adapter that implements
 * this — and nothing in Dispatch has to be touched.
 *
 * Three rules hold on both sides of it:
 *
 *   1. What goes out is already redacted. The port receives an
 *      `OutgoingOpportunity` that has had the visibility policy applied to it;
 *      it does not receive a load and a policy and decide for itself. A field
 *      the driver may not see is ABSENT, not null.
 *
 *   2. What comes back is a projection, never the truth. The Driver Workflow
 *      owns driver decisions and driver events. Dispatch stores what it was
 *      told, with where it came from, and says so on screen.
 *
 *   3. Nothing is delivered today. Every payload carries `isMockDelivery`, and
 *      the adapter behind this interface is a stand-in that says as much
 *      wherever its output is shown.
 */
export interface DriverWorkflowPort {
  /**
   * Send an opportunity to a driver for review, before anybody negotiates it.
   *
   * The payload is already redacted. The port's job is delivery, not policy.
   */
  sendOpportunity(
    ctx: ServiceContext,
    payload: OutgoingOpportunity,
  ): Promise<DeliveryReceipt>;

  /** Tell a waiting driver how the negotiation is going. */
  sendProgressUpdate(
    ctx: ServiceContext,
    payload: OutgoingProgressUpdate,
  ): Promise<DeliveryReceipt>;

  /** Post the finalized load once it is booked. Milestone 9 calls this. */
  postLoad(
    ctx: ServiceContext,
    payload: OutgoingLoadPost,
  ): Promise<DeliveryReceipt>;

  /** Take an opportunity back before the driver has answered. */
  withdrawOpportunity(
    ctx: ServiceContext,
    reviewId: string,
    reason: string,
  ): Promise<DeliveryReceipt>;

  /**
   * Everything the driver has said about one review, newest last.
   *
   * A read rather than a subscription on purpose: Dispatch pulls the current
   * answer when it renders, which is the same shape a real API or a websocket
   * projection would reduce to, and it cannot drift out of sync with a cache.
   */
  decisionsFor(
    ctx: ServiceContext,
    reviewId: string,
  ): Promise<DriverDecision[]>;

  /** The status the Driver Workflow believes a review is in. */
  statusFor(
    ctx: ServiceContext,
    reviewId: string,
  ): Promise<DriverReviewStatus | undefined>;

  /**
   * Whether this is the real thing.
   *
   * Every screen that shows anything from this port asks, and says so. The day
   * it returns `live`, the wording changes by itself.
   */
  describe(): PortDescription;
}

export interface DeliveryReceipt {
  ok: boolean;
  /** The port's own id for the delivery, where it has one. */
  deliveryId?: string;
  /** Why it did not go. */
  reason?: string;
  /** False for every implementation until the Driver Workflow is merged. */
  delivered: boolean;
}

export interface PortDescription {
  kind: "mock_adapter" | "driver_workflow";
  /** One sentence, shown to operators wherever this port's output appears. */
  statement: string;
  /** The branch or module that will replace it, while it is a stand-in. */
  replacedBy?: string;
}

/**
 * Registration.
 *
 * One port, set once at startup. Dispatch asks for it rather than importing an
 * implementation, so the merge is a registration change and not a search across
 * the codebase for everywhere a driver is written to.
 */
let port: DriverWorkflowPort | undefined;

export function registerDriverWorkflowPort(next: DriverWorkflowPort) {
  port = next;
}

export function driverWorkflowPort(): DriverWorkflowPort {
  if (!port) {
    throw new Error(
      "No Driver Workflow port is registered. Dispatch must not write to a driver directly.",
    );
  }
  return port;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The driver workflow's own service contract.
 *
 * Above is the port dispatch calls OUT through. Below is the service the
 * driver's own screens call IN through — proposals, finalized load posts and
 * the trip workflow.
 * ──────────────────────────────────────────────────────────────────────────── */

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
