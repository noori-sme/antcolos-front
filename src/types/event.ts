import type { EventSource, GeoPoint, IsoDateTime } from "./common";
import type { ActorRef } from "./user";

/**
 * Execution is an append-only event timeline, not a mutable status field.
 *
 * `Load.status` is a DERIVED convenience for lists and badges. The timeline is
 * the record of what happened. Events are never edited or deleted; a mistake is
 * corrected by appending a correcting event.
 *
 * Telegram, the driver web portal and the office all append to the SAME stream,
 * which is why every event carries its source.
 */

export type LoadEventKind =
  // Creation and verification
  | "load.created"
  | "load.rate_confirmation_received"
  | "load.fields_extracted"
  | "load.verified"
  | "load.updated"
  // Offer and consent
  | "load.offered"
  | "load.accepted"
  | "load.declined"
  // Assignment
  | "assignment.created"
  | "assignment.changed"
  | "assignment.removed"
  | "load.dispatched"
  // Execution — driver-facing, from Telegram, the portal or an ELD
  | "stop.arrived"
  | "stop.loading_started"
  | "stop.loaded"
  | "stop.departed"
  | "stop.unloading_started"
  | "stop.unloaded"
  | "load.in_transit"
  | "load.delivered"
  | "load.location_reported"
  | "load.eta_updated"
  // Exceptions
  | "exception.delay_reported"
  | "exception.detention_started"
  | "exception.detention_ended"
  | "exception.problem_reported"
  // Documents
  | "document.uploaded"
  | "document.verified"
  | "document.rejected"
  // Financial close-out
  | "load.ready_to_invoice"
  | "load.invoiced"
  | "load.paid"
  | "load.settled"
  // Termination
  | "load.cancelled";

/**
 * Event-specific data. Deliberately a narrow discriminated payload rather than
 * a free-form bag, so the backend and frontend agree on what each kind carries.
 */
export interface LoadEventPayload {
  /** Which stop the event happened at, for stop.* kinds. */
  stopId?: string;
  documentId?: string;
  truckId?: string;
  trailerId?: string;
  driverId?: string;
  /** For load.eta_updated. */
  etaAt?: IsoDateTime;
  /** For load.location_reported. */
  location?: GeoPoint;
  locationLabel?: string;
  /** For status-shaped changes: what it was, and what it became. */
  previousValue?: string;
  newValue?: string;
  /** Minutes, for detention and delay events. */
  durationMinutes?: number;
  /** Operator-supplied text. Never a substitute for a typed field above. */
  note?: string;
}

export interface LoadEvent {
  id: string;
  organizationId: string;
  loadId: string;
  kind: LoadEventKind;
  /** When it happened in the real world — what the timeline is ordered by. */
  occurredAt: IsoDateTime;
  /** When Antcolos learned about it. Differs for offline and batched reports. */
  recordedAt: IsoDateTime;
  /** Snapshot attribution: readable after the person leaves the organization. */
  actor: ActorRef;
  source: EventSource;
  payload?: LoadEventPayload;
}
