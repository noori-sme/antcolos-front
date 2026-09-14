import type {
  Address, Contact, EventSource, GeoPoint, IsoDateTime, TimeZone,
} from "./common";
import type { DisclosedRate } from "./driver-proposal";
import type { TripPolicy } from "./driver-policy";
import type { EngagementType } from "./driver-profile";
import type { EquipmentType } from "./load";
import type {
  ExternalRef, IdempotencyKey, Provenance, SignalSource,
} from "./integration";
import type { ActorRef } from "./user";

/**
 * The trip. One finalized load, one immutable workflow instance, one
 * append-only timeline that Telegram, the driver dashboard, an ELD and the
 * office all write to through the same commands.
 *
 * Two ideas separate this from a status field:
 *
 *  1. Milestones are MARKERS, not a gate. A driver who uploads the BOL without
 *     having marked "Arrived at shipper" is a driver doing their job in a bad
 *     signal area, not an invalid transition. The out-of-order event is
 *     accepted and the real sequence is preserved; the missing marker becomes a
 *     warning the driver can answer, never a block.
 *
 *  2. A machine's opinion is not a driver's action. A geofence crossing may
 *     suggest arrival; it is recorded as INFERRED with its source, timestamp
 *     and confidence, and stays inferred until a person confirms it.
 */

/**
 * The trip's spine, in the order it is normally travelled. Order matters for
 * suggestions and for "you skipped this" warnings — and for nothing else. It
 * is never used to reject an event.
 */
export type MilestoneKind =
  | "start_rolling"
  | "arrived_at_shipper"
  | "waiting_for_loading"
  | "loading_started"
  | "loaded"
  | "bol_uploaded"
  | "waiting_for_broker_approval"
  | "good_to_go"
  | "arrived_at_receiver"
  | "waiting_for_unloading"
  | "unloading_started"
  | "pod_uploaded"
  | "delivered_and_unloaded"
  | "trip_completed";

/**
 * Repeatable operational updates. These are NOT statuses and NOT mutually
 * exclusive: a driver can be resting, fuelling and in detention on the same
 * trip, several times each, and every occurrence is its own record.
 */
export type ActivityKind =
  | "rest"
  | "fuel"
  | "pre_trip_inspection"
  | "post_trip_inspection"
  | "traffic_ahead"
  | "scale"
  | "delay"
  | "detention"
  | "damage"
  | "breakdown"
  | "weather"
  | "note";

/** How sure we are that a milestone happened, and on whose word. */
export type ConfirmationState =
  /** A person recorded it. The only state that counts as a driver action. */
  | "driver_confirmed"
  /** A machine suggested it. Carries source, confidence and time. */
  | "inferred"
  /** An inferred milestone a person has since confirmed. */
  | "confirmed_from_inference"
  /** An inferred milestone a person has since said did not happen. */
  | "rejected_inference"
  /**
   * The system itself wrote this — workflow creation, an extraction result.
   * It makes no claim about the driver, which is why it is not "inferred".
   */
  | "system";

/** Where a milestone stands in the projection. Derived, never stored. */
export type MilestoneState =
  | "not_reached"
  /** Recorded by a person. */
  | "recorded"
  /** Suggested by a signal, awaiting a person. */
  | "inferred"
  /** A later milestone was recorded while this one never was. */
  | "skipped";

export type WorkflowStatus = "active" | "completed" | "cancelled";

/** What a machine observed, kept with any milestone it inferred. */
export interface InferenceDetail {
  source: SignalSource;
  /** The signal record's own id, so the signal module can be reconciled. */
  signalId: string;
  /** 0–1. Displayed to the driver; never rounded up to certainty. */
  confidence: number;
  observedAt: IsoDateTime;
  rationale: string;
  provenance: Provenance;
}

/**
 * One extracted field and, when a person disagreed with the machine, BOTH
 * values. The extracted value is never overwritten — a correction is an
 * addition, so the audit trail can always show what the machine read and what
 * the human said instead.
 */
/**
 * A field extraction produced for the DRIVER workflow.
 *
 * Distinct from the rate confirmation's ExtractedField, which is keyed by
 * RateConFieldKey and carries the page region a reviewer checks it against.
 * This one is keyed by a plain string and records a correction rather than a
 * side-by-side review.
 */
export interface DriverExtractedField {
  key: string;
  label: string;
  /** Exactly what extraction produced. Immutable once written. */
  extractedValue: string;
  /** 0–1 from the extractor. */
  extractionConfidence?: number;
  /** Present only after a person corrected it. */
  correctedValue?: string;
  correctedAt?: IsoDateTime;
  correctedBy?: ActorRef;
  correctionNote?: string;
}

/**
 * What the browser can honestly tell us about a file the driver picked. Nothing
 * is uploaded and no file leaves the device: this is the name, type and size
 * the browser gives away for free, plus whether the camera or the file picker
 * was used. A real storage adapter replaces the port behind it, not this shape.
 */
export interface UploadDescriptor {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  capture: "camera" | "file";
}

export type WorkflowEventType =
  | "workflow.created"
  | "milestone.recorded"
  | "milestone.inferred"
  | "milestone.confirmed"
  | "milestone.inference_rejected"
  | "milestone.corrected"
  | "activity.recorded"
  | "document.attached"
  | "document.extraction_recorded"
  | "document.extraction_corrected"
  | "comment.added"
  | "handoff.emitted"
  | "workflow.completed";

/**
 * Immutable. Appended, never edited, never deleted. A mistake is corrected by
 * appending a correcting event that points back at the one it corrects.
 */
export interface DriverWorkflowEvent {
  id: string;
  organizationId: string;
  workflowId: string;
  loadId: string;
  /** 1-based, gap-free. The true order of what happened, as recorded. */
  sequence: number;
  type: WorkflowEventType;
  /** Set for milestone.* events. */
  milestone?: MilestoneKind;
  /** Set for activity.recorded. */
  activity?: ActivityKind;
  /** When it happened in the world — what the timeline is ordered by. */
  occurredAt: IsoDateTime;
  /** When Antcolos learned of it. Differs for offline and batched reports. */
  recordedAt: IsoDateTime;
  actor: ActorRef;
  source: EventSource;
  confirmation: ConfirmationState;
  inference?: InferenceDetail;
  /** Makes every command safe to retry from a phone or a webhook. */
  idempotencyKey?: IdempotencyKey;
  /** Points back at the event this one corrects or confirms. */
  correctsEventId?: string;
  payload?: {
    note?: string;
    documentId?: string;
    documentKind?: string;
    fileName?: string;
    /** Minutes, for rest, detention, delay and waiting activities. */
    durationMinutes?: number;
    /** Money in cents, for fuel and scale receipts. Not a payment. */
    amountCents?: number;
    gallons?: number;
    odometerMiles?: number;
    weightLbs?: number;
    location?: GeoPoint;
    locationLabel?: string;
    /** For extraction events. */
    fields?: DriverExtractedField[];
    fieldKey?: string;
    extractedValue?: string;
    correctedValue?: string;
    /** For handoff.emitted. */
    handoffId?: string;
    handoffTarget?: string;
    /** For a completion recorded without proof of delivery. */
    exceptionReason?: string;
  };
}

/**
 * A stop as the driver sees it on a finalized post: the authorized version,
 * taken from the approved rate confirmation rather than from the planning
 * record that preceded it.
 */
export interface DriverStopView {
  stopId: string;
  kind: "pickup" | "delivery";
  sequence: number;
  facilityName?: string;
  address: Address;
  timeZone: TimeZone;
  appointmentType: string;
  appointmentAt: IsoDateTime;
  appointmentEndAt?: IsoDateTime;
  instructions?: string;
  contact?: Contact;
  referenceNumbers: { label: string; value: string }[];
}

/**
 * The finalized Driver Load Post.
 *
 * It exists ONLY after the rate confirmation has been reviewed and approved by
 * Dispatch, signed with the authorized carrier signature, and sent back to the
 * broker. Before that there is nothing to post, and the service refuses to make
 * one. What it contains is the authorized version of the load — not the draft
 * the office was still arguing about.
 */
export interface DriverLoadPost {
  id: string;
  organizationId: string;
  /** Canonical Load record. Owned by the Load module, referenced here. */
  loadId: string;
  loadReference: string;
  driverId: string;
  engagementType: EngagementType;
  /** The workflow instance this post created. One post, one workflow. */
  workflowId: string;

  customerName: string;
  customerKind: "broker" | "shipper";
  stops: DriverStopView[];
  equipment: {
    type: EquipmentType;
    truckId?: string;
    truckUnit?: string;
    trailerId?: string;
    trailerUnit?: string;
    notes?: string;
  };
  loadDetails: {
    weightLbs?: number;
    commodity?: string;
    temperatureF?: { min: number; max: number };
  };
  /** Essential instructions and notes, authorized at finalization. */
  instructions: string[];
  contacts: { role: string; name?: string; phone?: string; email?: string }[];
  /** Policy-filtered. Absent when policy discloses nothing. */
  rate?: DisclosedRate;

  finalizedAt: IsoDateTime;
  finalizedBy: ActorRef;
  /** The rate confirmation that authorized this post. */
  rateConfirmationRef: ExternalRef;
  /** Everything this post points at in other modules. */
  externalRefs: ExternalRef[];
  provenance: Provenance;
}

/** The workflow instance. Immutable identity; its timeline is append-only. */
export interface DriverWorkflow {
  id: string;
  organizationId: string;
  loadId: string;
  loadReference: string;
  driverId: string;
  postId: string;
  status: WorkflowStatus;
  createdAt: IsoDateTime;
  createdBy: ActorRef;
  /** Set when the trip closed. The timeline survives untouched. */
  completedAt?: IsoDateTime;
  completedBy?: ActorRef;
  /** Set when completion happened without a POD, with the recorded reason. */
  completionException?: string;
  /** Optimistic-concurrency token. Every accepted command increments it. */
  version: number;
}

/** One milestone's place in the projection. */
export interface MilestoneProgress {
  kind: MilestoneKind;
  state: MilestoneState;
  /** The event that put it in this state. */
  eventId?: string;
  occurredAt?: IsoDateTime;
  recordedAt?: IsoDateTime;
  byName?: string;
  source?: EventSource;
  confirmation?: ConfirmationState;
  inference?: InferenceDetail;
}

/** One occurrence of a repeatable activity. Several of a kind is normal. */
export interface ActivityEntry {
  eventId: string;
  kind: ActivityKind;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  byName: string;
  source: EventSource;
  note?: string;
  durationMinutes?: number;
  amountCents?: number;
  gallons?: number;
  weightLbs?: number;
  locationLabel?: string;
  documentId?: string;
}

/** A document the trip produced, with whatever the extractor made of it. */
export interface WorkflowDocument {
  documentId: string;
  kind: string;
  fileName: string;
  attachedAt: IsoDateTime;
  byName: string;
  source: EventSource;
  /** "not_applicable" until an extractor exists; honest about being a mock. */
  extractionState: string;
  fields: DriverExtractedField[];
  provenance: Provenance;
  /** The activity or milestone this document belongs to, when any. */
  relatedMilestone?: MilestoneKind;
  relatedActivityEventId?: string;
}

export type WarningKind =
  | "skipped_milestone"
  | "unconfirmed_inference"
  | "missing_document"
  | "completion_blocked";

/**
 * Advisory. A warning NEVER prevents the next operational action — it asks a
 * question the driver can answer whenever they get to it.
 */
export interface WorkflowWarning {
  kind: WarningKind;
  milestone?: MilestoneKind;
  eventId?: string;
  message: string;
  /** The command that would settle it, when there is one. */
  suggestedAction?: string;
}

/** The read model every channel renders. Derived from the timeline, always. */
export interface DriverWorkflowView {
  workflow: DriverWorkflow;
  post: DriverLoadPost;
  milestones: MilestoneProgress[];
  activities: ActivityEntry[];
  documents: WorkflowDocument[];
  /** Newest first. The record of what happened. */
  timeline: DriverWorkflowEvent[];
  /** What the interface should offer next. A suggestion, never a gate. */
  suggestedMilestones: MilestoneKind[];
  warnings: WorkflowWarning[];
  /** The one genuine rule that can stop a command, when it applies. */
  completionBlockedReason?: string;
  policy: TripPolicy;
  policyLabel: string;
}

/** Row shape for the driver's list of trips. */
export interface DriverTripSummary {
  workflowId: string;
  postId: string;
  loadId: string;
  loadReference: string;
  status: WorkflowStatus;
  customerName: string;
  originLabel: string;
  destinationLabel: string;
  pickupAt: IsoDateTime;
  deliveryAt: IsoDateTime;
  /** The furthest milestone actually reached, for the row's badge. */
  currentMilestone?: MilestoneKind;
  openWarnings: number;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
}
