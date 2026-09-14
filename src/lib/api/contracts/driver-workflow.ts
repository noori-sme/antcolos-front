import type {
  DriverDecision, DriverReviewStatus, OutgoingLoadPost, OutgoingOpportunity,
  OutgoingProgressUpdate,
} from "@/types";
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
