import type {
  AuditAction, AuditEntityRef, AuditEvent, AuditEventDetail, AuditEventFilters,
  AuditEventPage, AuditEventQuery, AuditEventSource, AuditExportView,
  AuditModule, AuditOutcome, EventSource, IsoDateTime, PermissionKey,
} from "@/types";
import type { RawFieldChange } from "@/lib/audit/redaction";
import type { ServiceContext } from "./context";

/**
 * ★ THE AUDIT SEAM ★
 *
 * One ledger, organization-scoped, append-only.
 *
 * Notice what is NOT here: no `update`, no `delete`, no `purge`, no
 * `redactEvent`. There is no method that changes an event once it exists, and
 * adding one would be the single change that makes every other guarantee in
 * this module worthless. A mistake is fixed with `correct`, which APPENDS a new
 * event pointing at the old one; both stay readable forever.
 *
 * `record` is the only way in, and it redacts before it stores — see
 * `src/lib/audit/redaction.ts`. A caller cannot opt out, because the sanitizing
 * happens on this side of the boundary rather than in whatever called it.
 */

/** What a module hands to `record`. Raw: the service sanitizes it. */
export interface RecordAuditEventInput {
  module: AuditModule;
  action: AuditAction;
  /** The producing module's own action key, kept verbatim alongside `action`. */
  sourceAction?: string;
  entity: AuditEntityRef;
  relatedEntities?: AuditEntityRef[];
  summary: string;
  source?: AuditEventSource;
  channel?: EventSource;
  outcome?: AuditOutcome;
  /** Un-sanitized field changes. Sensitive values are stripped on the way in. */
  changes?: RawFieldChange[];
  permissionContext?: { required: PermissionKey[]; missing?: PermissionKey[] };
  /** Defaults to now. Supplied for imports and backfills, never to rewrite. */
  occurredAt?: IsoDateTime;
  /** Joins this event to everything else one intent produced. */
  correlationId?: string;
}

export interface CorrectAuditEventInput {
  /** Why the original was wrong. Required: a correction with no reason is a
   *  second version of the truth with nothing to choose between them. */
  reason: string;
  /** What the record should have said. Sanitized like any other change. */
  changes?: RawFieldChange[];
  summary?: string;
}

export interface AuditService {
  /**
   * Appends one event. The ONLY write path.
   *
   * Requires nothing: a refusal is itself worth recording, and a service that
   * needed permission to write down that somebody was refused would lose
   * exactly the events an auditor came for. Reading is what is gated.
   */
  record(ctx: ServiceContext, input: RecordAuditEventInput): Promise<AuditEvent>;

  /** Newest first. Requires `audit:view`. */
  list(ctx: ServiceContext, query?: AuditEventQuery): Promise<AuditEventPage>;

  /** One event with its correction chain and its correlated siblings. */
  get(ctx: ServiceContext, eventId: string): Promise<AuditEventDetail>;

  /** Entity links: everything that happened to one record, newest first. */
  forEntity(
    ctx: ServiceContext,
    entityId: string,
    query?: AuditEventQuery,
  ): Promise<AuditEventPage>;

  /** Actor history: everything one membership did, newest first. */
  forActor(
    ctx: ServiceContext,
    membershipId: string,
    query?: AuditEventQuery,
  ): Promise<AuditEventPage>;

  /**
   * Appends a correcting event linked to the original. The original is NOT
   * touched — not edited, not flagged, not hidden. Requires `audit:view`, and
   * a person may not correct an event about somebody else's action without
   * `risk:investigate`, so a correction cannot be used to quietly restate what
   * a colleague did.
   */
  correct(
    ctx: ServiceContext,
    eventId: string,
    input: CorrectAuditEventInput,
  ): Promise<AuditEvent>;

  /**
   * An export-READY view. Requires `audit:export`.
   *
   * Nothing is written, sent, uploaded or delivered anywhere: the result is a
   * flat projection the screen renders, and preparing one is itself recorded in
   * the ledger.
   */
  exportView(ctx: ServiceContext, filters?: AuditEventFilters): Promise<AuditExportView>;

  /** Which module feeds are projected into the ledger, and which are mocks. */
  sources(ctx: ServiceContext): Promise<AuditSourceStatus[]>;
}

/**
 * What the ledger is reading from, said out loud.
 *
 * A module whose feed is a placeholder reports `mock: true`, and the screen
 * says so — because "no events from Settlements" and "not connected to
 * Settlements" look identical on a list and mean opposite things.
 */
export interface AuditSourceStatus {
  readonly module: AuditModule;
  readonly label: string;
  /** True while the feed is a placeholder for a module on another branch. */
  readonly mock: boolean;
  /** Permissions the caller needs before this feed contributes anything. */
  readonly requires: readonly PermissionKey[];
  /** False when the caller lacks them — the feed exists, they just cannot see it. */
  readonly readable: boolean;
  readonly eventCount: number;
}
