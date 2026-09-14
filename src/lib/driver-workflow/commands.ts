import type {
  ActivityKind, CounterofferKind, Cents, ExtractedField, GeoPoint,
  IdempotencyKey, IsoDateTime, MilestoneKind, UploadDescriptor,
} from "@/types";

export type { UploadDescriptor };

/**
 * THE command surface.
 *
 * The driver dashboard, the future Telegram bot and any script that drives this
 * module all build one of these and hand it to the service. There is no second
 * path: no screen calls a store, no bot handler calls a reducer. Same commands,
 * same validation, same permissions, same event history — which is the whole
 * reason this file exists rather than a set of per-screen methods.
 *
 * Every command carries an `idempotencyKey`. A phone with one bar retries; a
 * webhook fires twice; a driver taps the button again because nothing happened
 * on screen. Replaying a key returns the ORIGINAL result and records nothing
 * new, so none of those produce a second event.
 */

interface CommandBase {
  idempotencyKey: IdempotencyKey;
  /**
   * The version the caller last saw. When supplied and stale, the command is
   * refused rather than applied to a record that has moved on. Optional,
   * because a Telegram button tap has no version to quote.
   */
  expectedVersion?: number;
  /**
   * When it happened in the real world. Defaults to now. Supplied by an
   * offline client catching up, and never invented on the driver's behalf.
   */
  occurredAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Proposal commands                                                           */
/* -------------------------------------------------------------------------- */

export type ProposalCommand =
  | (CommandBase & {
      type: "approve";
      proposalId: string;
      /** The driver's words alongside the approval. */
      note?: string;
    })
  | (CommandBase & { type: "reject"; proposalId: string; reason?: string })
  | (CommandBase & {
      type: "pause";
      proposalId: string;
      minutes: number;
      reason?: string;
    })
  | (CommandBase & {
      type: "resume";
      proposalId: string;
      /** Which pause is being ended. A stale id is refused, never ignored. */
      pauseId: string;
    })
  | (CommandBase & { type: "comment"; proposalId: string; body: string })
  | (CommandBase & {
      type: "counteroffer";
      proposalId: string;
      kind: CounterofferKind;
      message: string;
      /** Only for financial kinds, and only where policy allows them. */
      proposedAmountCents?: Cents;
    })
  | (CommandBase & {
      type: "withdraw_counteroffer";
      proposalId: string;
      counterofferId: string;
    });

export type ProposalCommandType = ProposalCommand["type"];

/* -------------------------------------------------------------------------- */
/* Trip workflow commands                                                      */
/* -------------------------------------------------------------------------- */

export interface MilestonePayload {
  note?: string;
  location?: GeoPoint;
  locationLabel?: string;
  odometerMiles?: number;
}

export interface ActivityPayload {
  note?: string;
  durationMinutes?: number;
  amountCents?: Cents;
  gallons?: number;
  weightLbs?: number;
  odometerMiles?: number;
  location?: GeoPoint;
  locationLabel?: string;
}

export type WorkflowCommand =
  | (CommandBase & {
      type: "record_milestone";
      workflowId: string;
      milestone: MilestoneKind;
      payload?: MilestonePayload;
      /**
       * Required to complete a trip with no proof of delivery, for a carrier
       * whose policy bills on one. Recorded on the workflow, not swallowed.
       */
      completionExceptionReason?: string;
    })
  | (CommandBase & {
      type: "record_activity";
      workflowId: string;
      activity: ActivityKind;
      payload?: ActivityPayload;
      /** Fuel and scale receipts ride along with the activity. */
      upload?: UploadDescriptor;
    })
  | (CommandBase & {
      type: "attach_document";
      workflowId: string;
      documentKind: "bill_of_lading" | "proof_of_delivery" | "scale_ticket" | "lumper_receipt" | "other";
      upload: UploadDescriptor;
      /** Set when the upload also satisfies a milestone, e.g. BOL or POD. */
      milestone?: MilestoneKind;
      note?: string;
    })
  | (CommandBase & {
      type: "correct_extraction";
      workflowId: string;
      documentId: string;
      fieldKey: string;
      correctedValue: string;
      note?: string;
    })
  | (CommandBase & {
      type: "confirm_inference";
      workflowId: string;
      /** The inferred event being confirmed. */
      eventId: string;
      /** The driver may correct the time the machine guessed. */
      occurredAtCorrection?: IsoDateTime;
      note?: string;
    })
  | (CommandBase & {
      type: "reject_inference";
      workflowId: string;
      eventId: string;
      reason: string;
    })
  | (CommandBase & { type: "comment"; workflowId: string; body: string });

export type WorkflowCommandType = WorkflowCommand["type"];

/** What extraction produced, handed in by the document adapter. */
export interface ExtractionResult {
  state: "not_applicable" | "pending" | "succeeded" | "failed";
  fields: ExtractedField[];
  note: string;
}
