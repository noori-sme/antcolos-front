import type { IsoDateTime } from "./common";

/**
 * The shapes every module boundary speaks.
 *
 * Several modules this workflow reads from and writes to — Dispatch, the
 * Opportunity inbox, Rate Confirmation, the Unified Document Center, GPS/ELD
 * telematics, accounting — are being built on other branches. This branch must
 * NOT create their tables, their canonical records or their business logic.
 * What it creates instead is the contract: a typed port, a labelled mock
 * adapter behind it, and enough provenance on every record that connecting the
 * real module later is a swap, not a migration.
 *
 * The three things that make that swap cheap are all here:
 *  - `ExternalRef`   — the other module's own identifier, kept verbatim.
 *  - `Provenance`    — which system said this, when, and how sure it was.
 *  - `IdempotencyKey`— so a retry across the boundary cannot double-write.
 */

/** Modules this workflow exchanges data with. One name per owning branch. */
export type IntegrationModule =
  | "load"
  | "rate_confirmation"
  | "dispatch"
  | "opportunity"
  | "assignment"
  | "document_center"
  | "ocr"
  | "telematics"
  | "geofencing"
  | "eld"
  | "accounting"
  | "notifications"
  | "fuel"
  | "scale"
  | "detention";

/**
 * A reference to a record that belongs to another module. Never dereferenced
 * here, never parsed, never regenerated — carried so the canonical module can
 * recognise its own record after the branches merge.
 */
export interface ExternalRef {
  module: IntegrationModule;
  /** The other module's identifier, exactly as it gave it. */
  externalId: string;
  /** The entity UUID when this workflow already knows the canonical record. */
  entityId?: string;
  /** What kind of thing the external id names, in the other module's words. */
  entityKind?: string;
}

/**
 * How a piece of information got here. Attached to anything this branch did not
 * observe first-hand, so nothing inferred is ever mistaken for something a
 * person did.
 */
export interface Provenance {
  module: IntegrationModule;
  /** The adapter that produced it. "mock:…" while the real module is absent. */
  adapter: string;
  /** True whenever the value came from a mock, so the UI can say so honestly. */
  mock: boolean;
  /** When the source system observed it, not when we received it. */
  observedAt: IsoDateTime;
  receivedAt: IsoDateTime;
  /** 0–1, when the source can express one. Absent means "not a guess". */
  confidence?: number;
  /** The source's own record id for this observation. */
  externalId?: string;
}

/**
 * Deduplication key for a command that crosses the boundary in either
 * direction. Same key, same effect, exactly once — which is what makes every
 * command in this module safe to retry from a flaky phone or a Telegram
 * webhook that fires twice.
 */
export type IdempotencyKey = string;

/** Whether a handoff to another module has actually gone anywhere. */
export type HandoffState =
  /** Recorded here, queued for a module that does not exist yet. */
  | "pending_integration"
  /** Handed to a real adapter and acknowledged. Never set by a mock. */
  | "delivered"
  /** The adapter refused it. Kept, with the reason, never silently dropped. */
  | "rejected";

/**
 * Something this workflow produced FOR another module. It is deliberately not
 * called an "event sent": nothing here transmits anything. It records what the
 * destination will be given once that destination exists.
 */
export interface PendingIntegrationEvent {
  id: string;
  organizationId: string;
  /** Who should eventually receive this. */
  target: IntegrationModule;
  /** The destination's operation name, agreed in the port contract. */
  operation: string;
  idempotencyKey: IdempotencyKey;
  createdAt: IsoDateTime;
  state: HandoffState;
  /** Why it is still pending, or why it was rejected. Always populated. */
  stateReason: string;
  /** References back into this workflow, so the destination can link up. */
  refs: ExternalRef[];
  /** The typed body, shaped by the destination's contract. */
  payload: Record<string, unknown>;
}

/** Where an operational signal came from. Never a driver. */
export type SignalSource = "gps" | "geofence" | "eld" | "telematics" | "document" | "ocr";

/**
 * An observation from a machine. It may SUGGEST that a milestone happened; it
 * never asserts that the driver did anything. Recording one produces an
 * "inferred" workflow event that a person can later confirm or correct.
 */
export interface OperationalSignal {
  id: string;
  source: SignalSource;
  /** The load this observation is about, by canonical id. */
  loadId: string;
  observedAt: IsoDateTime;
  /** 0–1. A signal with no confidence has no business inferring anything. */
  confidence: number;
  /** What the signal suggests, in this module's vocabulary. */
  suggests: {
    kind: "milestone" | "activity";
    /** MilestoneKind or ActivityKind. Validated by the receiving service. */
    value: string;
  };
  /** Plain-language reason, shown to the driver next to the suggestion. */
  rationale: string;
  provenance: Provenance;
}

/** Health of one boundary, so a screen can say what is and is not connected. */
export interface IntegrationStatus {
  module: IntegrationModule;
  adapter: string;
  mock: boolean;
  /** The branch or team that owns the real implementation. */
  ownedBy: string;
  note: string;
}
