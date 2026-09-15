import type {
  DriverDecision, DriverDecisionKind, DriverReviewStatus, OutgoingLoadPost,
  OutgoingOpportunity, OutgoingProgressUpdate,
} from "@/types";
import type {
  DeliveryReceipt, DriverWorkflowPort, PortDescription,
} from "../contracts/driver-workflow";
import { registerDriverWorkflowPort } from "../contracts/driver-workflow";
import type { ServiceContext } from "../contracts/context";

/**
 * ███ MOCK ONLY — STAND-IN FOR THE DRIVER WORKFLOW ███
 *
 * The one implementation of `DriverWorkflowPort` that exists today.
 *
 * It delivers nothing. There is no driver app on the other end of it, no push
 * notification and no inbox: it holds what Dispatch handed over, and it holds
 * whatever a person typed in on the driver's behalf, and it reports both with
 * `source: "mock_adapter"` so that no screen can show a mock answer as a real
 * driver's decision.
 *
 * When the Driver Workflow branch is merged, this file is replaced by one that
 * talks to it. Nothing else in Dispatch changes: every call site goes through
 * the port, every payload is already redacted, and every answer already carries
 * its source.
 *
 * The driver's answers are recorded BY A DISPATCHER on the driver's behalf,
 * exactly as a phone call would be. That is the honest shape of it until the
 * driver's own screen exists, and it is what the UI says.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 200;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* What the stand-in is holding                                                */
/* -------------------------------------------------------------------------- */

interface Held {
  opportunity: OutgoingOpportunity;
  updates: OutgoingProgressUpdate[];
  decisions: DriverDecision[];
  status: DriverReviewStatus;
  withdrawnReason?: string;
}

const held = new Map<string, Held>();
const loadPosts: OutgoingLoadPost[] = [];

export function resetDriverWorkflowAdapter() {
  held.clear();
  loadPosts.length = 0;
  seq = 0;
}

const DESCRIPTION: PortDescription = {
  kind: "mock_adapter",
  statement: "Nothing is delivered to a driver. The Driver Workflow is built in its own module and is not connected here; answers are recorded by a dispatcher on the driver's behalf.",
  replacedBy: "the Driver Workflow branch",
};

/* -------------------------------------------------------------------------- */
/* The port                                                                    */
/* -------------------------------------------------------------------------- */

export const mockDriverWorkflowPort: DriverWorkflowPort = {
  async sendOpportunity(_ctx: ServiceContext, payload: OutgoingOpportunity): Promise<DeliveryReceipt> {
    await sleep(LATENCY_MS);
    held.set(payload.reviewId, {
      opportunity: payload,
      updates: [],
      decisions: [],
      status: "waiting",
    });
    return {
      ok: true,
      delivered: false,
      deliveryId: rowId("mockdel"),
      reason: "Held by the stand-in. No driver was notified.",
    };
  },

  async sendProgressUpdate(_ctx, payload: OutgoingProgressUpdate): Promise<DeliveryReceipt> {
    await sleep(LATENCY_MS);
    const row = held.get(payload.reviewId);
    if (!row) return { ok: false, delivered: false, reason: "That review is not here." };
    // An update on an answered review is still worth holding: a driver who
    // already said yes is entitled to hear that the rate moved.
    row.updates.push(payload);
    return { ok: true, delivered: false, deliveryId: rowId("mockdel") };
  },

  async postLoad(_ctx, payload: OutgoingLoadPost): Promise<DeliveryReceipt> {
    await sleep(LATENCY_MS);
    loadPosts.push(payload);
    return {
      ok: true,
      delivered: false,
      deliveryId: rowId("mockdel"),
      reason: "Held by the stand-in. The Driver Workflow will receive this when it is merged.",
    };
  },

  async withdrawOpportunity(_ctx, reviewId: string, reason: string): Promise<DeliveryReceipt> {
    await sleep(LATENCY_MS);
    const row = held.get(reviewId);
    if (!row) return { ok: false, delivered: false, reason: "That review is not here." };
    row.status = "withdrawn";
    row.withdrawnReason = reason;
    return { ok: true, delivered: false };
  },

  async decisionsFor(_ctx, reviewId: string): Promise<DriverDecision[]> {
    return [...(held.get(reviewId)?.decisions ?? [])];
  },

  async statusFor(_ctx, reviewId: string): Promise<DriverReviewStatus | undefined> {
    return held.get(reviewId)?.status;
  },

  describe(): PortDescription {
    return DESCRIPTION;
  },
};

registerDriverWorkflowPort(mockDriverWorkflowPort);

/* -------------------------------------------------------------------------- */
/* Standing in for the driver                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Record what the driver said.
 *
 * NOT part of the port. The real Driver Workflow produces decisions by itself
 * and this function disappears with the merge; putting it on the interface
 * would mean Dispatch could write a driver's answer, which is exactly the thing
 * the boundary exists to prevent.
 *
 * It is exported for the one screen that needs it — a dispatcher taking the
 * answer down after a phone call — and everything it produces is stamped
 * `mock_adapter`.
 */
export async function recordDriverAnswer(input: {
  reviewId: string;
  kind: DriverDecisionKind;
  comment?: string;
  wantedRateCents?: number;
}): Promise<DriverDecision | undefined> {
  await sleep(LATENCY_MS);
  const row = held.get(input.reviewId);
  if (!row) return undefined;
  if (row.status === "withdrawn") return undefined;

  const decision: DriverDecision = {
    decisionId: rowId("dd"),
    reviewId: input.reviewId,
    kind: input.kind,
    at: nowIso(),
    comment: input.comment?.trim() || undefined,
    wantedRateCents: input.wantedRateCents,
    source: "mock_adapter",
  };
  row.decisions.push(decision);
  row.status = input.kind;
  return decision;
}

/** What the stand-in was handed, for a screen showing the driver's view. */
export function heldOpportunity(reviewId: string): OutgoingOpportunity | undefined {
  return held.get(reviewId)?.opportunity;
}

export function heldUpdates(reviewId: string): OutgoingProgressUpdate[] {
  return [...(held.get(reviewId)?.updates ?? [])];
}

/** Load posts waiting for the Driver Workflow. Milestone 9 reads these. */
export function heldLoadPosts(): OutgoingLoadPost[] {
  return [...loadPosts];
}
