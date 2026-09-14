import type { EngagementType } from "./driver-profile";

/**
 * Carrier policy: what a driver of a given engagement type may SEE and may DO.
 *
 * This is the rulebook behind "Owner-Operators and Company Drivers get
 * different views". It is data, not code, so a carrier can change what its
 * company drivers may counter without a release — and so the same rulebook is
 * read by the web dashboard, by the future Telegram bot, and by the service
 * that enforces it.
 *
 * Policy is a FLOOR for drivers, not a ceiling for everyone: a dispatcher who
 * holds `rates:view` still sees money through the ordinary permission system.
 * What policy decides is what a driver is shown when they hold no such
 * permission — which is the case that matters here.
 */

/** A financial field a proposal or a load post can disclose. */
export type DisclosableRateField =
  | "linehaul"
  | "total_rate"
  | "rate_per_mile"
  | "accessorials"
  | "driver_share"
  | "loaded_miles"
  | "deadhead_miles";

/** The subjects a driver may raise when countering a proposal. */
export type CounterofferKind =
  // Financial — owner-operator territory unless a carrier says otherwise.
  | "rate"
  | "accessorial"
  // Operational — the concerns any driver has about running the load.
  | "schedule"
  | "route"
  | "home_time"
  | "hos"
  | "pickup"
  | "delivery"
  | "equipment"
  | "condition"
  | "other";

export const FINANCIAL_COUNTEROFFER_KINDS: readonly CounterofferKind[] = [
  "rate",
  "accessorial",
] as const;

/** What a driver may do with a proposal before it is booked. */
export interface ProposalPolicy {
  /** Fields a driver of this engagement type may see on a proposal. */
  disclosedRateFields: DisclosableRateField[];
  /** Subjects this driver may counter on. Enforced at the service, not the UI. */
  allowedCounterofferKinds: CounterofferKind[];
  /** Open counteroffers a driver may have at once. 1 means "one at a time". */
  maxOpenCounteroffers: number;
  allowComments: boolean;
  allowReject: boolean;
  allowPause: boolean;
  /** Durations the driver may choose, in minutes. The first is the default. */
  pauseDurationsMinutes: number[];
  /** Total pauses allowed on one proposal, across the whole negotiation. */
  maxPauses: number;
  /**
   * THE consequential flag. When false — the default — a driver approving
   * continued negotiation has NOT consented to being booked, and the carrier
   * must come back for booking consent separately.
   */
  approvalGrantsBookingConsent: boolean;
}

/** What a driver may see on a finalized load post, and do during the trip. */
export interface TripPolicy {
  disclosedRateFields: DisclosableRateField[];
  /** Whether the driver may see the customer's own contact details. */
  showCustomerContacts: boolean;
  /**
   * Genuine rule, not a courtesy: closing a trip without proof of delivery
   * needs a recorded reason. Carriers that bill on POD keep this true.
   */
  requirePodBeforeCompletion: boolean;
  /** Whether the driver may attach receipts to fuel and scale activities. */
  allowReceiptUploads: boolean;
}

/**
 * One carrier's rulebook for one engagement type. Keyed by both, because the
 * same person can be a company driver at one carrier and an owner-operator at
 * another, and the two must never share a view.
 */
export interface CarrierDriverPolicy {
  organizationId: string;
  engagementType: EngagementType;
  /** Display name for the rulebook, shown when the UI explains a restriction. */
  label: string;
  proposals: ProposalPolicy;
  trip: TripPolicy;
}
