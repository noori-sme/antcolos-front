import type {
  ActorRef, Cents, Contact, CurrencyCode, DocumentKind, EngagementType,
  EquipmentType, ExternalRef, IdempotencyKey, IntegrationModule,
  IntegrationStatus, IsoDateTime, Load, OperationalSignal,
  PendingIntegrationEvent, Provenance, ProposalStop,
} from "@/types";
import type { ExtractionResult, UploadDescriptor } from "@/lib/driver-workflow/commands";

/**
 * ★ THE INTEGRATION BOUNDARY ★
 *
 * Dispatch, the Opportunity inbox, Rate Confirmation, the Unified Document
 * Center, OCR, GPS/ELD/telematics and the accounting side are all being built
 * on other branches. This file is the contract this branch talks to them
 * through, and the only contract — nothing in `features/` or in the service
 * adapter reaches past it.
 *
 * Rules this boundary exists to keep:
 *  1. This branch creates none of those modules' tables, canonical records,
 *     UI or business logic. It creates ports, and mocks behind them.
 *  2. Every record that crosses keeps the other module's own identifier
 *     (`ExternalRef`), where it came from (`Provenance`) and an idempotency key,
 *     so connecting the real module is a swap and not a data migration.
 *  3. Nothing pretends. A mock says it is a mock, in the type, at runtime, and
 *     on screen.
 */

/* -------------------------------------------------------------------------- */
/* 1. Load and Rate Confirmation                                              */
/* -------------------------------------------------------------------------- */

/**
 * The state of a rate confirmation, owned by the Rate Confirmation module.
 *
 * In Antcolos a load is not final until all three of these are true. This
 * module reads them; it never sets them, and it never signs anything.
 */
export interface RateConfirmationState {
  /** The rate confirmation document, by the document module's own id. */
  documentRef: ExternalRef;
  reviewedByDispatch: boolean;
  reviewedAt?: IsoDateTime;
  reviewedByName?: string;
  /** The authorized carrier signature. Applied by the Rate Con module alone. */
  carrierSignature: {
    signed: boolean;
    signedAt?: IsoDateTime;
    signerName?: string;
    /** The operating authority the signature was made under. */
    authorityRef?: ExternalRef;
  };
  /** Sent back to the broker. Until this is true there is no finalized load. */
  sentToBroker: {
    sent: boolean;
    sentAt?: IsoDateTime;
    channel?: "email" | "portal" | "fax";
  };
  provenance: Provenance;
}

/** Load data, as this module needs to read it. */
export interface LoadSourcePort {
  /**
   * The canonical Load record. Owned by the Load module — this module reads it
   * and never writes it.
   */
  getLoad(organizationId: string, loadId: string): Promise<Load | undefined>;
  /** Rate confirmation state for a load. The finalization gate reads this. */
  getRateConfirmation(
    organizationId: string,
    loadId: string,
  ): Promise<RateConfirmationState | undefined>;
}

/* -------------------------------------------------------------------------- */
/* 2. Dispatch-originated Load Opportunities                                  */
/* -------------------------------------------------------------------------- */

/**
 * What Dispatch sends when it wants a driver's opinion on an opportunity.
 * Dispatch decides what goes in it; this module decides what a driver may see
 * of it, which is a different question and stays on this side of the line.
 */
export interface InboundLoadProposal {
  /** Dispatch's own id for the opportunity. Kept verbatim, never re-minted. */
  opportunityRef: ExternalRef;
  organizationId: string;
  driverId: string;
  engagementType: EngagementType;
  customerName: string;
  customerKind: "broker" | "shipper";
  commodity?: string;
  weightLbs?: number;
  equipment: { type: EquipmentType; truckId?: string; trailerId?: string };
  stops: ProposalStop[];
  serviceWindow: { startAt: IsoDateTime; endAt: IsoDateTime };
  dispatchNote?: string;
  /** Full money as Dispatch holds it. Policy reduces it before a driver sees it. */
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
  respondByAt?: IsoDateTime;
  idempotencyKey: IdempotencyKey;
  provenance: Provenance;
}

export interface DispatchOpportunityPort {
  /** Proposals Dispatch has sent to this organization's drivers. */
  listInbound(organizationId: string): Promise<InboundLoadProposal[]>;
  /**
   * The driver's answer, going back to Dispatch. Returns a pending handoff:
   * nothing is transmitted and nothing is acknowledged while Dispatch lives on
   * another branch.
   */
  reportDriverDecision(input: {
    organizationId: string;
    opportunityRef: ExternalRef;
    decision: "approved" | "rejected" | "paused" | "countered" | "commented";
    idempotencyKey: IdempotencyKey;
    detail: Record<string, unknown>;
  }): Promise<PendingIntegrationEvent>;
}

/* -------------------------------------------------------------------------- */
/* 3. Driver assignments and authorized load posts                            */
/* -------------------------------------------------------------------------- */

/** The assignment record: which driver, truck and trailer are on a load. */
export interface AssignmentSnapshot {
  assignmentRef: ExternalRef;
  loadId: string;
  driverId: string;
  driverName: string;
  truckId?: string;
  truckUnit?: string;
  trailerId?: string;
  trailerUnit?: string;
  provenance: Provenance;
}

export interface AssignmentPort {
  getForLoad(organizationId: string, loadId: string): Promise<AssignmentSnapshot | undefined>;
  /** Every load currently assigned to one driver. Used for overlap detection. */
  listForDriver(organizationId: string, driverId: string): Promise<AssignmentSnapshot[]>;
  /** Which engagement this driver has with this carrier. Drives policy. */
  engagementType(organizationId: string, driverId: string): Promise<EngagementType>;
}

/* -------------------------------------------------------------------------- */
/* 4. Documents, uploads, OCR and verification                                */
/* -------------------------------------------------------------------------- */

/**
 * The Unified Document Center's seam. Document actions in the trip workflow —
 * BOL, POD, fuel and scale receipts — all go through here rather than growing a
 * second uploader inside this feature.
 *
 * Today the adapter behind it stores nothing and reads nothing: it records the
 * file's own name, type and size, which the browser supplies for free, and
 * throws the file away. The OCR and verification methods are typed and wired so
 * a real extractor is a drop-in, and they are honest about returning fixtures.
 */
export interface DocumentCenterPort {
  attach(input: {
    organizationId: string;
    loadId: string;
    kind: DocumentKind;
    upload: UploadDescriptor;
    actor: ActorRef;
    idempotencyKey: IdempotencyKey;
    at: IsoDateTime;
  }): Promise<{ documentId: string; externalRef: ExternalRef; provenance: Provenance }>;

  /** Typed today, mock today, replaceable tomorrow. Never invents confidence. */
  extract(input: {
    organizationId: string;
    documentId: string;
    kind: DocumentKind;
  }): Promise<ExtractionResult>;

  /**
   * Human verification lives in the Document Center, not here. Recording a
   * driver's correction produces a handoff for it to pick up.
   */
  reportCorrection(input: {
    organizationId: string;
    documentId: string;
    fieldKey: string;
    extractedValue: string;
    correctedValue: string;
    actor: ActorRef;
    idempotencyKey: IdempotencyKey;
  }): Promise<PendingIntegrationEvent>;
}

/* -------------------------------------------------------------------------- */
/* 5. GPS, geofencing, ELD and telematics                                     */
/* -------------------------------------------------------------------------- */

/**
 * Machine observations. The contract is deliberately narrow: a signal SUGGESTS
 * a milestone and carries its confidence. It cannot assert that a driver did
 * anything, because the type has nowhere to say so.
 */
export interface SignalPort {
  /** Signals observed for a load since a given moment. */
  poll(organizationId: string, loadId: string, sinceAt?: IsoDateTime): Promise<OperationalSignal[]>;
  /**
   * Development affordance: hand the module a signal as if a device produced
   * one. Present only on the mock adapter, and typed on the port so the real
   * adapter can refuse it out loud rather than by being missing.
   */
  simulate?(input: {
    organizationId: string;
    loadId: string;
    suggests: { kind: "milestone" | "activity"; value: string };
    confidence: number;
    observedAt: IsoDateTime;
    source: OperationalSignal["source"];
    rationale: string;
  }): Promise<OperationalSignal>;
}

/* -------------------------------------------------------------------------- */
/* 6. Downstream records: fuel, scale, detention, accounting, notifications   */
/* -------------------------------------------------------------------------- */

export interface DownstreamPort {
  /**
   * Record that another module has something to collect. It is queued, not
   * sent: nothing here claims the destination received, stored, verified or
   * processed anything.
   */
  emit(input: {
    organizationId: string;
    target: IntegrationModule;
    operation: string;
    idempotencyKey: IdempotencyKey;
    refs: ExternalRef[];
    payload: Record<string, unknown>;
  }): Promise<PendingIntegrationEvent>;

  /** Everything queued for this organization, newest first. */
  pending(organizationId: string): Promise<PendingIntegrationEvent[]>;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/** Contacts a finalized post may carry, assembled from the load's own records. */
export interface PostContacts {
  contacts: { role: string; name?: string; phone?: string; email?: string }[];
  shipperContact?: Contact;
  receiverContact?: Contact;
}

/** The whole boundary in one object. Swapped as a unit when modules land. */
export interface IntegrationPorts {
  loadSource: LoadSourcePort;
  opportunities: DispatchOpportunityPort;
  assignments: AssignmentPort;
  documents: DocumentCenterPort;
  signals: SignalPort;
  downstream: DownstreamPort;
  /** What each boundary currently is, so a screen can tell the truth about it. */
  status(): IntegrationStatus[];
}
