import type { Cents, IsoDateTime } from "./common";
import type { EngagementType } from "./driver-profile";

/**
 * Asking the driver before committing them.
 *
 * A dispatcher can spend an hour agreeing a load and discover the driver will
 * not take it. Worse, they can book it and find out afterwards — which is a
 * broker to ring back, a truck that is still empty, and a driver who has been
 * volunteered for something without being asked. This is the step that stops
 * both: the opportunity goes to the driver BEFORE the negotiation, and the
 * negotiation waits for their answer.
 *
 * Two things are kept strictly apart here:
 *
 *   What is SENT     A redacted view of the load, built once, at the boundary,
 *                    from the visibility policy. A company driver and an
 *                    owner-operator are shown different things, and neither is
 *                    shown anything the dispatcher sending it cannot see.
 *
 *   What comes BACK  The driver's decision, their comment, a pause, or a
 *                    counteroffer. These are the Driver Workflow's records, not
 *                    Dispatch's; Dispatch holds a projection of them and never
 *                    pretends to be their source.
 *
 * The Driver Workflow and Driver Dashboard are built elsewhere. Nothing here
 * re-implements them: these are the types that cross the wire between the two,
 * and the mock adapter behind them is a stand-in that says so.
 */

/* -------------------------------------------------------------------------- */
/* What the driver may be shown                                                */
/* -------------------------------------------------------------------------- */

/**
 * One thing about a load that a driver may or may not be entitled to see.
 *
 * Money is the reason this list exists. A company driver is paid by the mile or
 * by percentage and has no business seeing what the carrier is billing the
 * broker; an owner-operator IS the business and has every right to. Getting
 * that wrong in either direction is a serious mistake — one leaks the carrier's
 * margin, the other treats a business partner like an employee.
 */
export type DriverVisibilityField =
  | "total_rate"
  | "rate_per_mile"
  | "estimated_profit"
  | "carrier_margin"
  | "driver_pay_estimate"
  | "broker_name"
  | "broker_contact"
  | "deadhead_miles"
  | "loaded_miles"
  | "pickup_window"
  | "commodity_and_weight"
  | "accessorial_terms";

export const VISIBILITY_FIELD_LABEL: Record<DriverVisibilityField, string> = {
  total_rate: "What the load pays",
  rate_per_mile: "Rate per mile",
  estimated_profit: "Estimated profit",
  carrier_margin: "The carrier's margin",
  driver_pay_estimate: "What the driver would earn",
  broker_name: "Who the broker is",
  broker_contact: "The broker's contact details",
  deadhead_miles: "Empty miles to the pickup",
  loaded_miles: "Loaded miles",
  pickup_window: "Pickup and delivery times",
  commodity_and_weight: "What it is and what it weighs",
  accessorial_terms: "Detention and accessorial terms",
};

/** The money fields. Named once so no screen has to decide what counts. */
export const FINANCIAL_FIELDS: readonly DriverVisibilityField[] = [
  "total_rate", "rate_per_mile", "estimated_profit", "carrier_margin",
  "driver_pay_estimate",
];

/**
 * What a carrier shows its drivers, per pay model.
 *
 * Stored per carrier per engagement type, with a shipped default that a carrier
 * can change. `updatedByName` is kept because "who decided the drivers can see
 * the rate" is a question that gets asked.
 */
export interface DriverVisibilityPolicy {
  carrierOrganizationId: string;
  engagementType: EngagementType;
  visible: DriverVisibilityField[];
  /** False while the shipped default is still in force. */
  customized: boolean;
  updatedAt?: IsoDateTime;
  updatedByName?: string;
}

/**
 * The policy as it actually applies to one send.
 *
 * Narrower than the stored policy, never wider: a dispatcher without permission
 * to see rates cannot send a rate, whatever the carrier's policy says, because
 * they would be forwarding a number they are not entitled to read. The reason
 * for every removal is kept so the screen can say why a field is missing.
 */
export interface EffectiveVisibility {
  engagementType: EngagementType;
  visible: DriverVisibilityField[];
  /** Field → why it is not being sent. */
  withheld: { field: DriverVisibilityField; because: string }[];
}

/* -------------------------------------------------------------------------- */
/* What goes out                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The opportunity as the driver receives it.
 *
 * Deliberately NOT the match, the listing or the load: it is a flat, redacted
 * snapshot built at the boundary. A record the Driver Workflow can render
 * without reaching back into Dispatch, and without any field the driver is not
 * entitled to. Absent means absent — there are no nulls standing in for
 * "withheld", because the Driver Workflow must not be able to tell the
 * difference between a field that was withheld and one nobody knows.
 */
export interface OutgoingOpportunity {
  /** Stable id for this send. The Driver Workflow answers against it. */
  reviewId: string;
  dispatchCycleId: string;
  carrierOrganizationId: string;
  carrierName: string;
  driverProfileId: string;
  truckUnit: string;

  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  equipmentLabel: string;

  pickupAt?: IsoDateTime;
  deliverBy?: IsoDateTime;
  loadedMiles?: number;
  deadheadMiles?: number;
  commodity?: string;
  weightLbs?: number;

  brokerName?: string;
  brokerContact?: string;

  totalRateCents?: Cents;
  ratePerMileCents?: Cents;
  estimatedProfitCents?: Cents;
  driverPayEstimateCents?: Cents;
  accessorialTerms?: string;

  /**
   * What the carrier's policy says about booking this load, in one line.
   *
   * ★ A DRIVER IS NEVER TOLD A LOAD IS FUNDED WHEN NOBODY HAS ASKED ★
   * An opportunity can legitimately go out before factoring has cleared it —
   * many carriers want the driver's answer first — but it must not READ as
   * bookable. This carries the honest sentence ("Driver review allowed ·
   * Booking requires factoring approval") and is absent only where the
   * carrier's policy does not require factoring at all.
   *
   * It never carries a credit limit, a factor's name or a rejection reason:
   * that is the carrier's banking relationship, and a driver is not a party
   * to it.
   */
  factoringNote?: string;

  /** What the dispatcher wants to say about it. */
  note?: string;
  /**
   * How it reached them.
   *
   * ★ RECORDED BECAUSE THE ANSWER DEPENDS ON IT ★
   * A load read out over the phone and a load pushed to an app are answered
   * differently and evidenced differently: the first is a dispatcher writing
   * down what somebody said, the second is the driver's own tap. A review that
   * did not say which cannot be argued with later.
   */
  channel: DriverSendChannel;
  sentAt: IsoDateTime;
  sentByName: string;
  /** Said plainly on the driver's screen as well as ours. */
  isMockDelivery: true;
}

/**
 * How a load is put in front of a driver.
 *
 * `phone` is not a lesser channel — for a lot of carriers it IS the channel,
 * and a dispatcher reading a load down the phone needs the same facts in front
 * of them, filtered the same way, as the ones that would have been sent.
 */
export type DriverSendChannel = "app" | "sms" | "phone";

export const DRIVER_SEND_CHANNEL_LABEL: Record<DriverSendChannel, string> = {
  app: "Driver app",
  sms: "Text message",
  phone: "Read over the phone",
};

/** A progress update on a negotiation, while the driver is waiting. */
export interface OutgoingProgressUpdate {
  updateId: string;
  reviewId: string;
  dispatchCycleId: string;
  at: IsoDateTime;
  byName: string;
  /** What moved, in the dispatcher's words. */
  note: string;
  /** Included only when the driver may see money at all. */
  onTheTableCents?: Cents;
  isMockDelivery: true;
}

/**
 * The finalized load, posted to the driver once it is booked.
 *
 * Defined here with the rest of the boundary because it is the same wire, and
 * because milestone 9 posts it. Dispatch builds it; the Driver Workflow owns
 * everything that happens to it afterwards.
 */
export interface OutgoingLoadPost {
  loadPostId: string;
  dispatchCycleId: string;
  loadId: string;
  loadReference: string;
  driverProfileId: string;
  truckUnit: string;
  trailerUnit?: string;
  postedAt: IsoDateTime;
  postedByName: string;
  isMockDelivery: true;
}

/* -------------------------------------------------------------------------- */
/* What comes back                                                             */
/* -------------------------------------------------------------------------- */

export type DriverDecisionKind =
  /** Yes. The dispatcher may go and negotiate it. */
  | "approved"
  /** No, with a reason. */
  | "declined"
  /** Not yet — they want something answered first. */
  | "paused"
  /** Yes, but at a number. */
  | "countered";

export const DRIVER_DECISION_LABEL: Record<DriverDecisionKind, string> = {
  approved: "Driver approved",
  declined: "Driver declined",
  paused: "Driver has a question",
  countered: "Driver countered",
};

/**
 * One answer from the driver.
 *
 * `source` is the honest field. Today every one of these is produced by the
 * mock adapter standing in for the Driver Workflow, and it says so; when the
 * real one is merged, the same records arrive with a real source and nothing
 * else about this changes.
 */
export interface DriverDecision {
  decisionId: string;
  reviewId: string;
  kind: DriverDecisionKind;
  at: IsoDateTime;
  /** The driver's own words. Present on everything except a bare approval. */
  comment?: string;
  /** Counteroffers only: what they want for it. */
  wantedRateCents?: Cents;
  /** Where this record came from. Never presented as a real driver's answer. */
  source: "mock_adapter" | "driver_workflow";
}

export type DriverReviewStatus =
  /** Sent, and the driver has not answered. */
  | "waiting"
  | "approved"
  | "declined"
  | "paused"
  | "countered"
  /** The dispatcher pulled it back, or the load went. */
  | "withdrawn";

export const DRIVER_REVIEW_STATUS_LABEL: Record<DriverReviewStatus, string> = {
  waiting: "Waiting on the driver",
  approved: "Driver approved",
  declined: "Driver declined",
  paused: "Driver has a question",
  countered: "Driver countered",
  withdrawn: "Pulled back",
};

/** Dispatch's projection of one review. The Driver Workflow owns the truth. */
export interface DriverReview {
  reviewId: string;
  organizationId: string;
  carrierOrganizationId: string;
  dispatchCycleId: string;
  matchId: string;
  listingId: string;
  driverProfileId: string;
  driverName: string;
  truckUnit: string;

  status: DriverReviewStatus;
  sentAt: IsoDateTime;
  sentByName: string;
  answeredAt?: IsoDateTime;

  /** Exactly what was sent, so a dispatcher can see what the driver saw. */
  sent: OutgoingOpportunity;
  visibility: EffectiveVisibility;
  decisions: DriverDecision[];
  updates: OutgoingProgressUpdate[];
  withdrawnReason?: string;

  /**
   * What the driver says they need for this load.
   *
   * ★ IT IS A FLOOR, NOT A COMMENT ★
   * An owner-operator who says "not under $1,800" has set the bottom of the
   * dispatcher's negotiation before it starts. Kept as a figure rather than
   * buried in the decision's note so the negotiation can actually open at or
   * above it — a requirement nobody could read would be a requirement nobody
   * honoured, and the driver would find that out at the dock.
   */
  rateRequirementCents?: Cents;
  rateRequirementNote?: string;
  rateRequirementAt?: IsoDateTime;
  rateRequirementByName?: string;
}

/** Whether a negotiation may begin, and why not when it may not. */
export interface DriverGate {
  /** True when the dispatcher may go ahead and negotiate. */
  clear: boolean;
  /** True when carrier policy says this cannot be skipped. */
  reviewRequired: boolean;
  /**
   * Whether there is anybody to send it to.
   *
   * Separate from `clear` because an empty truck with no driver does not block
   * the negotiation — it just cannot be sent anywhere, and a screen that offers
   * "Send to driver" on it is offering something that will fail.
   */
  hasDriver: boolean;
  driverName?: string;
  status?: DriverReviewStatus;
  reason?: string;
}
