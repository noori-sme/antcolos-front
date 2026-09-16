import type { IsoDateTime } from "./common";
import type { ExternalRef, IntegrationModule, Provenance } from "./integration";
import type { ActorRef } from "./user";

/**
 * ★ THE SHARED DATA FLOW ★
 *
 *   Input → Extraction Candidate → Verification → Canonical Record
 *         → Domain Event → Authorized Projections
 *
 * This file is the vocabulary that flow speaks. It adds no store and no
 * behaviour: it is the shape every module agrees on so that a fact captured
 * once can be read everywhere without being typed in again.
 *
 * ███ FRONTEND ONLY ███
 * Nothing here is a database, a message broker, a queue or a delivery
 * guarantee. `idempotencyKey` describes the contract a backend must honour; in
 * this build it is honoured by an in-memory map that lives as long as the tab.
 * Real authorization, persistence, ordering, exactly-once delivery and security
 * are the backend's to enforce — see `docs/zero-entry-data-audit.md`.
 */

/* -------------------------------------------------------------------------- */
/* 1. Where a fact came from                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The kind of thing that produced a value. Deliberately about the MECHANISM,
 * not the module: "a person typed it" and "a scanner read it" need different
 * treatment on screen no matter which screen they arrive through.
 */
export type FactSourceKind =
  /** Read off a document by OCR or an extractor. Never yet seen by a person. */
  | "document_extraction"
  /** A person uploaded the document the value was taken from. */
  | "document_upload"
  /** A driver did something in the app, the portal or Telegram. */
  | "driver_action"
  /** A dispatcher, biller or owner did something in the workspace. */
  | "dispatcher_action"
  | "gps"
  | "geofence"
  | "eld"
  | "telematics"
  | "fuel_card"
  /** Another system Antcolos talks to. Not connected in this build. */
  | "external_integration"
  /** Somebody typed it because nothing else could supply it. */
  | "manual_entry"
  /** Computed from other canonical facts. Never a source of truth itself. */
  | "derived";

export const FACT_SOURCE_LABEL: Record<FactSourceKind, string> = {
  document_extraction: "Read from a document",
  document_upload: "From an uploaded document",
  driver_action: "Reported by the driver",
  dispatcher_action: "Entered by dispatch",
  gps: "GPS",
  geofence: "Geofence",
  eld: "ELD",
  telematics: "Telematics",
  fuel_card: "Fuel card",
  external_integration: "External integration",
  manual_entry: "Typed in",
  derived: "Derived",
};

/**
 * How far a value has got through verification.
 *
 * These stay visibly distinct everywhere, which is the point: a dispatcher
 * looking at a rate must be able to tell "the scanner thinks it says this" from
 * "a person checked it and it says this". Collapsing the two is how a carrier
 * invoices the wrong number.
 */
export type FactVerification =
  /** A machine produced it. Nobody has looked. */
  | "extracted"
  /** Derived from a signal with a confidence. Suggests, never asserts. */
  | "inferred"
  /** Waiting for a person, and known to be waiting. */
  | "pending"
  /** A person looked at it and accepted it as written. */
  | "confirmed"
  /** A person looked at it and changed it. Both values are kept. */
  | "corrected"
  /** A person looked at it and refused it. */
  | "rejected"
  /** The source could not produce a value. Not the same as "no value". */
  | "failed";

export const FACT_VERIFICATION_LABEL: Record<FactVerification, string> = {
  extracted: "Extracted",
  inferred: "Inferred",
  pending: "Needs review",
  confirmed: "Confirmed",
  corrected: "Corrected",
  rejected: "Rejected",
  failed: "Could not be read",
};

/** The states a person still has to act on. */
export const FACT_VERIFICATION_NEEDS_PERSON: readonly FactVerification[] = [
  "extracted", "inferred", "pending", "failed",
];

/**
 * Which organizations a fact belongs to.
 *
 * One field is not enough. A truck's odometer reading is recorded BY an
 * organization, under a carrier's operating authority, possibly while a
 * dispatch agency covers it — and a reading does not stop being true when any
 * of those three change. Keeping them apart is what lets meter history survive
 * a lease ending without being reset or split.
 */
export interface FactScope {
  /**
   * The organization the fact is attributed to. Always present.
   *
   * For an operational fact about a piece of equipment this is the carrier that
   * was operating it when the fact happened — NOT whoever happened to type it
   * in. A dispatch agency recording an odometer for a carrier it dispatches for
   * appears below as `dispatchOrganizationId`, and does not become the carrier
   * by having pressed the button.
   */
  organizationId: string;
  /** The carrier whose operating authority the fact happened under. */
  carrierOrganizationId?: string;
  /** The dispatch workspace responsible at the time, when there was one. */
  dispatchOrganizationId?: string;
  /**
   * RESERVED. There is no canonical Operating Authority record in Antcolos, so
   * nothing can populate this and nothing may read it. Supplying it is refused
   * rather than ignored: a field nobody can validate is a field that will
   * eventually be trusted. The lease references below are what actually prove
   * operating authority for an interval.
   */
  operatingAuthorityId?: string;
  /**
   * The `TruckOperatingLease.id` that covered `occurredAt`, for a fact about a
   * truck. Absent when the operating carrier was proven another way.
   *
   * Pinned permanently at publication and never rewritten: ending a lease does
   * not move the facts that happened under it, and a relationship id alone
   * cannot tell two separate lease cycles apart. A trailer's lease id NEVER
   * goes in this field.
   */
  truckOperatingLeaseId?: string;
  /**
   * The `TrailerOperatingLease.id` that covered `occurredAt`, for a fact about
   * a trailer. The same rules as above, over the trailer's own registry.
   */
  trailerOperatingLeaseId?: string;
}

/**
 * ★ A FACT SCOPE IS ATTRIBUTION, NOT A GRANT ★
 *
 * Every field above answers "who was this true of", and NONE of them answers
 * "who may read it". Being named as the carrier or the dispatch workspace on a
 * fact is not permission to read it, and never has been: reading is decided by
 * the canonical sharing grants each module already owns — `TruckDispatchAccess`,
 * `MaintenanceShare`, `FuelSharingGrant`, `DocumentShare` and the rest — and by
 * the permissions on the membership doing the reading.
 *
 * This is written down because the opposite is the easy mistake to make. A
 * filter of the form `scope.carrierOrganizationId === myOrganizationId` reads
 * like a scope check and is actually a silent cross-organization grant: it
 * hands a whole history to anyone a fact happens to mention.
 */

/* -------------------------------------------------------------------------- */
/* 2. A canonical fact                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One important fact, with everything needed to defend it a year later.
 *
 * Every field on this envelope exists because somebody eventually asks the
 * question it answers: what does it say, what did it ORIGINALLY say, who says
 * so, how sure are they, when did it happen versus when did we hear, what one
 * intent produced it, and which audit line proves it.
 *
 * `T` is the value's own type. A fact never widens it to `unknown`.
 */
export interface CanonicalFact<T> {
  /** Immutable id for this observation of this fact. */
  factId: string;
  /** The canonical entity UUID the fact is about. Never a display code. */
  entityId: string;
  /** What kind of entity, in the owning module's words. */
  entityKind: string;
  scope: FactScope;
  /** Which fact about the entity this is, e.g. "odometerMiles". */
  key: string;

  /**
   * What the source originally said, when a person has since changed it.
   *
   * Absent means nothing was changed — NOT that the original is unknown. A
   * corrected fact always carries both, which is what lets a signed document
   * read "shown as X, corrected to Y".
   */
  originalValue?: T;
  /** The value that stands now: confirmed, corrected, or still a candidate. */
  value: T;

  verification: FactVerification;
  /** 0–1 where the source can express one. Absent means "not a guess". */
  confidence?: number;

  /** When it was true in the world. What timelines are ordered by. */
  occurredAt: IsoDateTime;
  /** When Antcolos learned it. Differs for offline and batched reports. */
  receivedAt: IsoDateTime;

  /** Groups everything one intent produced, across modules. */
  correlationId: string;
  /** The event or command that caused this one, when it had a cause. */
  causationId?: string;
  /** Same key, same effect, exactly once. A retry cannot double-write. */
  idempotencyKey: string;

  /** The ledger line that proves it. Set once the projection has run. */
  auditEventId?: string;

  source: FactSourceKind;
  provenance: Provenance;
  /** Who observed or entered it, when a person did. */
  actor?: ActorRef;
  /** Corrections point back at what they correct. History is never rewritten. */
  correctsFactId?: string;
}

/* -------------------------------------------------------------------------- */
/* 3. Domain events                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The events the canonical modules publish. One name per fact that changed,
 * never one name per screen that wants to know.
 */
export type DomainEventKind =
  /** A load became final: reviewed, signed, returned, committed. Once. */
  | "load.finalized"
  /** A confirmed fuel transaction: created or corrected. */
  | "fuel_transaction.confirmed"
  /** A meter reading was accepted into the equipment meter ledger. */
  | "equipment_meter.reading_recorded";

export const DOMAIN_EVENT_LABEL: Record<DomainEventKind, string> = {
  "load.finalized": "Load finalized",
  "fuel_transaction.confirmed": "Fuel transaction confirmed",
  "equipment_meter.reading_recorded": "Meter reading recorded",
};

/**
 * One published event.
 *
 * `version` is on the envelope rather than in the kind because a subscriber
 * that only understands v1 must be able to say so out loud instead of guessing
 * at a payload it has never seen. `eventId` is the idempotency identity: the
 * same intent republished produces the SAME id and nothing happens twice.
 */
export interface DomainEvent<P = unknown> {
  eventId: string;
  kind: DomainEventKind;
  /** Contract version of `payload`. Incremented, never reinterpreted. */
  version: number;
  scope: FactScope;
  /** The canonical entity this event is about. */
  subjectId: string;
  subjectKind: string;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  actor: ActorRef;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  payload: P;
  provenance: Provenance;
}

/* -------------------------------------------------------------------------- */
/* 4. Projections                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What happened when one subscriber was given one event.
 *
 * Four states, and every one of them is honest:
 *  - `pending`      — registered, not yet run, or waiting for a module that
 *                     does not exist in this build.
 *  - `processed`    — the projection ran and wrote what it owns.
 *  - `failed`       — it ran and threw. Kept with the reason, and retryable.
 *  - `needs_review` — it ran and could not decide without a person. A possible
 *                     duplicate party profile is the archetype: guessing is how
 *                     duplicates are made, so it stops and asks.
 */
export type ProjectionState = "pending" | "processed" | "failed" | "needs_review";

export const PROJECTION_STATE_LABEL: Record<ProjectionState, string> = {
  pending: "Pending",
  processed: "Processed",
  failed: "Failed",
  needs_review: "Needs review",
};

/** One subscriber's outcome for one event. Append-only; retries add attempts. */
export interface ProjectionRecord {
  /** `${eventId}:${subscriberId}` — the unit idempotency applies to. */
  id: string;
  eventId: string;
  eventKind: DomainEventKind;
  eventVersion: number;
  subscriberId: string;
  /** What a person should see this called. */
  subscriberLabel: string;
  /** The module that owns the records this projection writes. */
  targetModule: IntegrationModule;
  state: ProjectionState;
  /** How many times it has been run. 0 while still pending. */
  attempts: number;
  firstAttemptAt?: IsoDateTime;
  lastAttemptAt?: IsoDateTime;
  /** Always populated, in the words a dispatcher would use. */
  detail: string;
  /** Set on `failed` and on `needs_review`. Never a stack trace. */
  reason?: string;
  /** Whether running it again could change the outcome. */
  retryable: boolean;
  /**
   * True while the receiving module is a labelled mock or lives on another
   * branch. Rendered on screen; never inferred from anything else.
   */
  mock: boolean;
  /** What the projection produced, so the destination can link up later. */
  producedRefs: ExternalRef[];
  organizationId: string;
  correlationId: string;
}

/** A subscriber's own report of what it did. The bus records the rest. */
export interface ProjectionOutcome {
  state: ProjectionState;
  detail: string;
  reason?: string;
  retryable?: boolean;
  producedRefs?: ExternalRef[];
}

/** What one subscriber is and what it promises. */
export interface ProjectionSubscriber<P = unknown> {
  id: string;
  label: string;
  targetModule: IntegrationModule;
  /** The event kinds it understands. Anything else is not offered to it. */
  handles: readonly DomainEventKind[];
  /** The payload versions it understands. An unknown version is `needs_review`. */
  versions: readonly number[];
  /** True while this subscriber stands in for a module on another branch. */
  mock: boolean;
  /**
   * Do the work. Throwing is allowed and is recorded as `failed` with the
   * message — a subscriber is never asked to be careful on the bus's behalf,
   * and one that throws cannot stop the others from running.
   */
  project(event: DomainEvent<P>): ProjectionOutcome | Promise<ProjectionOutcome>;
}

/** The result of publishing once: the event, and every subscriber's outcome. */
export interface PublishResult {
  event: DomainEvent;
  /** True when this exact event had already been published and nothing re-ran. */
  duplicate: boolean;
  projections: ProjectionRecord[];
}
