import type {
  Address, Cents, CurrencyCode, EventSource, IsoDateTime, TimeZone,
} from "./common";
import type { CounterofferKind, ProposalPolicy } from "./driver-policy";
import type { EngagementType } from "./driver-profile";
import type { EquipmentType } from "./load";
import type { ExternalRef, IdempotencyKey, Provenance } from "./integration";
import type { ActorRef } from "./user";

/**
 * A Driver Load Proposal is Dispatch asking a driver about a load opportunity
 * BEFORE it is booked. It is not an assignment, not a booking, and not a load:
 * the load may never exist. What it is, is a conversation with a record.
 *
 * The opportunity itself belongs to Dispatch and the Opportunity inbox, which
 * are built elsewhere. This module holds only the driver's side of it, and
 * reaches the rest through the integration boundary.
 */

export type ProposalStatus =
  /** The only state in which the driver owes an answer. */
  | "awaiting_driver_response"
  /** Driver asked for time. Returns to awaiting_driver_response on expiry. */
  | "paused"
  /** Driver approved CONTINUED NEGOTIATION. Booking consent is separate. */
  | "approved"
  | "rejected"
  /** Dispatch pulled it back. */
  | "withdrawn"
  /** The proposal's own deadline passed with no answer. */
  | "expired"
  /** A different load was finalized over this driver or this equipment. */
  | "unavailable"
  /** This proposal's load was finalized. The trip workflow takes over. */
  | "finalized";

/** Statuses that accept no further driver action. History is kept regardless. */
export const CLOSED_PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "rejected", "withdrawn", "expired", "unavailable", "finalized",
] as const;

/**
 * What the driver is allowed to see of the money on this proposal.
 *
 * Built by the service from carrier policy. A driver never receives a
 * `LoadFinancials`; they receive this, with the withheld fields named rather
 * than silently missing, so the interface can be honest about what it is not
 * showing instead of pretending the number does not exist.
 */
export interface DisclosedRate {
  currency: CurrencyCode;
  linehaulCents?: Cents;
  totalRateCents?: Cents;
  ratePerMileCents?: Cents;
  driverShareCents?: Cents;
  loadedMiles?: number;
  deadheadMiles?: number;
  accessorials?: { code: string; label: string; amountCents: Cents }[];
  /** Named, not hidden: every field policy withheld, with the reason. */
  withheld: { field: string; reason: string }[];
}

/** A stop as a driver sees it while deciding. No customer-confidential detail. */
export interface ProposalStop {
  kind: "pickup" | "delivery";
  sequence: number;
  facilityName?: string;
  address: Address;
  timeZone: TimeZone;
  appointmentAt: IsoDateTime;
  appointmentEndAt?: IsoDateTime;
  /** "appointment" | "fcfs" | "window", carried through from the opportunity. */
  appointmentType: string;
  notes?: string;
}

export type CounterofferStatus =
  | "submitted"
  | "withdrawn"
  /** Dispatch's answer. Arrives through the boundary; never invented here. */
  | "accepted"
  | "declined"
  | "superseded";

/**
 * A driver's counter on one subject. Financial kinds are refused at the service
 * for engagement types whose policy does not allow them — a company driver
 * cannot submit a rate counter by calling the API directly.
 */
export interface Counteroffer {
  id: string;
  proposalId: string;
  kind: CounterofferKind;
  /** Only meaningful for financial kinds, and only when policy allows them. */
  proposedAmountCents?: Cents;
  /** The driver's words. Required — a bare number explains nothing. */
  message: string;
  status: CounterofferStatus;
  submittedAt: IsoDateTime;
  submittedBy: ActorRef;
  source: EventSource;
  respondedAt?: IsoDateTime;
  responseNote?: string;
  /** Set when a later counter on the same subject replaced this one. */
  supersededByCounterofferId?: string;
}

export interface ProposalComment {
  id: string;
  proposalId: string;
  body: string;
  at: IsoDateTime;
  by: ActorRef;
  source: EventSource;
}

/** One pause. Kept in full so an expired pause can be told from a live one. */
export interface ProposalPause {
  id: string;
  startedAt: IsoDateTime;
  /** When the proposal returns to awaiting_driver_response by itself. */
  expiresAt: IsoDateTime;
  minutes: number;
  reason?: string;
  by: ActorRef;
  source: EventSource;
  /** Set when the driver resumed early, or when expiry returned it. */
  endedAt?: IsoDateTime;
  endedReason?: "resumed_by_driver" | "expired" | "superseded";
}

export type ProposalEventType =
  | "proposal.received"
  | "proposal.viewed"
  | "proposal.approved"
  | "proposal.rejected"
  | "proposal.paused"
  | "proposal.pause_expired"
  | "proposal.resumed"
  | "proposal.comment_added"
  | "proposal.counteroffer_submitted"
  | "proposal.counteroffer_withdrawn"
  | "proposal.counteroffer_answered"
  | "proposal.withdrawn"
  | "proposal.expired"
  | "proposal.marked_unavailable"
  | "proposal.finalized";

/**
 * Append-only. A proposal's status is a projection of these; the events are the
 * record. Nothing is edited and nothing is deleted, including on a proposal
 * that has become unavailable.
 */
export interface ProposalEvent {
  id: string;
  organizationId: string;
  proposalId: string;
  /** 1-based, gap-free within a proposal. Orders events recorded in one ms. */
  sequence: number;
  type: ProposalEventType;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  actor: ActorRef;
  source: EventSource;
  /** Present on every event produced by a command. Makes retries safe. */
  idempotencyKey?: IdempotencyKey;
  payload?: {
    reason?: string;
    note?: string;
    minutes?: number;
    pauseId?: string;
    counterofferId?: string;
    commentId?: string;
    previousStatus?: ProposalStatus;
    newStatus?: ProposalStatus;
    /** For marked_unavailable: the load that won. */
    conflictingLoadId?: string;
    conflictReason?: string;
  };
}

/**
 * The stored proposal. The driver-facing shape is `DriverProposalView`, which
 * the service builds by applying policy — screens never receive this record.
 */
export interface LoadProposal {
  id: string;
  organizationId: string;
  /** The driver record this was sent to, inside this organization. */
  driverId: string;
  /** Engagement type at the time of sending. Snapshot: policy must not shift. */
  engagementType: EngagementType;
  status: ProposalStatus;
  /** Optimistic-concurrency token. Every accepted command increments it. */
  version: number;

  /** Dispatch's own opportunity reference, kept verbatim. */
  opportunityRef: ExternalRef;
  /** Set only once the load exists as a canonical record. */
  loadRef?: ExternalRef;
  /** Equipment this proposal would commit, for overlap detection. */
  equipment: {
    type: EquipmentType;
    truckId?: string;
    trailerId?: string;
  };

  customerName: string;
  customerKind: "broker" | "shipper";
  commodity?: string;
  weightLbs?: number;
  stops: ProposalStop[];
  /** Earliest pickup and latest delivery — the window overlap is computed on. */
  serviceWindow: { startAt: IsoDateTime; endAt: IsoDateTime };
  /** What dispatch asked the driver, in words. */
  dispatchNote?: string;

  /** Full money, as received from Dispatch. NEVER sent to a driver as-is. */
  rate: {
    currency: CurrencyCode;
    linehaulCents: Cents;
    totalRateCents: Cents;
    ratePerMileCents: Cents;
    driverShareCents?: Cents;
    loadedMiles: number;
    deadheadMiles: number;
    accessorials: { code: string; label: string; amountCents: Cents }[];
  };

  sentAt: IsoDateTime;
  sentBy: ActorRef;
  /** When the proposal stops being answerable on its own. */
  respondByAt?: IsoDateTime;

  /** Set by the driver's approval. */
  approval?: {
    at: IsoDateTime;
    by: ActorRef;
    source: EventSource;
    note?: string;
    /**
     * Whether this approval also granted consent to be booked. Derived from
     * carrier policy at the moment of approval and then frozen — a later policy
     * change must not retroactively turn "keep negotiating" into "book me".
     */
    bookingConsent: "granted" | "not_granted";
    policyLabelSnapshot: string;
  };
  rejection?: { at: IsoDateTime; by: ActorRef; source: EventSource; reason?: string };
  /** Why it became unavailable, and to which load. */
  unavailability?: {
    at: IsoDateTime;
    reason: string;
    conflictingLoadId: string;
    conflictKind: "driver" | "equipment";
  };

  pauses: ProposalPause[];
  comments: ProposalComment[];
  counteroffers: Counteroffer[];

  /** Where this proposal's data came from. Mock while Dispatch is elsewhere. */
  provenance: Provenance;
}

/**
 * What a driver actually receives. Money is already reduced to what policy
 * permits, and the permitted actions are computed by the same service that
 * enforces them — so the UI cannot offer a button the service would refuse.
 */
export interface DriverProposalView {
  id: string;
  organizationId: string;
  driverId: string;
  engagementType: EngagementType;
  status: ProposalStatus;
  version: number;

  customerName: string;
  customerKind: "broker" | "shipper";
  commodity?: string;
  weightLbs?: number;
  equipmentType: EquipmentType;
  stops: ProposalStop[];
  serviceWindow: { startAt: IsoDateTime; endAt: IsoDateTime };
  dispatchNote?: string;

  /** Absent entirely when policy discloses nothing financial. */
  rate?: DisclosedRate;

  sentAt: IsoDateTime;
  sentByName: string;
  respondByAt?: IsoDateTime;

  approval?: LoadProposal["approval"];
  rejection?: LoadProposal["rejection"];
  unavailability?: LoadProposal["unavailability"];
  /** The live pause, when there is one and it has not expired. */
  activePause?: ProposalPause;
  pauses: ProposalPause[];
  comments: ProposalComment[];
  counteroffers: Counteroffer[];

  /** The policy this view was built from, so the UI can explain itself. */
  policy: ProposalPolicy;
  policyLabel: string;
  /** Exactly what this caller may do right now, and why not when they cannot. */
  availableActions: ProposalAction[];
  provenance: Provenance;
}

export type ProposalActionKind =
  | "approve" | "reject" | "pause" | "resume" | "comment" | "counteroffer";

export interface ProposalAction {
  kind: ProposalActionKind;
  enabled: boolean;
  /** Populated whenever `enabled` is false. Always says why, never just "no". */
  disabledReason?: string;
}
