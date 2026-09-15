import type {
  AuditAction, AuditEntityRef, AuditEvent, AuditEventSource, AuditModule,
  AuditOutcome, EventSource, IsoDateTime,
} from "@/types";
import type { ActorRef } from "@/types";
import type { RawFieldChange } from "./redaction";

/**
 * ★ HOW OTHER MODULES REACH THE LEDGER ★
 *
 * They do not write to it. They EXPOSE their own typed history and this module
 * projects it.
 *
 * That distinction is the whole design. A settlement's audit trail, an
 * invoice's versions, the fuel ledger and a compliance requirement's timeline
 * remain the canonical record of their own module: they are the authority on
 * what they say, they keep their own ids, and nothing here edits, replaces or
 * deletes one. The ledger holds a projection — a read-only second view of the
 * same fact, joined to everything else that happened that day.
 *
 * Which means:
 *  - No module gains an audit log it did not have. There is one ledger.
 *  - Projection is IDEMPOTENT. A module's entry maps to a stable ledger id
 *    (`projectionId`), so reading the same history twice appends nothing.
 *  - A module that is not yet merged is reached through a mock adapter behind
 *    this same interface, and says so in the data.
 */

/** What a module hands over for one of its own history entries. */
export interface ModuleAuditRecord {
  /** The producing module's own entry id. Stable, and never reassigned. */
  readonly entryId: string;
  /** The canonical record the entry belongs to. */
  readonly recordId: string;
  readonly action: AuditAction;
  /** The module's own action key, kept verbatim so nothing is lost. */
  readonly sourceAction?: string;
  readonly occurredAt: IsoDateTime;
  readonly actor: ActorRef;
  readonly entity: AuditEntityRef;
  readonly relatedEntities?: readonly AuditEntityRef[];
  readonly summary: string;
  readonly source?: AuditEventSource;
  readonly channel?: EventSource;
  readonly outcome?: AuditOutcome;
  /** Raw, un-sanitized. The service redacts on the way in — never the module. */
  readonly changes?: readonly RawFieldChange[];
  readonly correlationId?: string;
}

/**
 * One module's feed. Implemented by the mock adapters in
 * `src/lib/api/mock/audit-sources.ts`, and by whatever real module owns the
 * history later — the shape does not change when it does.
 */
export interface ModuleAuditFeed<Ctx> {
  readonly module: AuditModule;
  /** The permissions a caller needs before this feed is read at all. */
  readonly requires: readonly string[];
  /**
   * True while the feed is a placeholder for a module on another branch.
   * Rendered on screen; never inferred from anything else.
   */
  readonly mock: boolean;
  read(ctx: Ctx): ModuleAuditRecord[] | Promise<ModuleAuditRecord[]>;
}

/**
 * The deterministic ledger id for a projected entry.
 *
 * Same module + same entry id = same ledger id, forever. This is what makes
 * re-reading a module's history idempotent instead of duplicating it, and it is
 * why a projected event can never be "appended twice by accident".
 */
export function projectionId(module: AuditModule, entryId: string): string {
  return `aev_${module}_${entryId}`;
}

export function isProjectedEvent(event: AuditEvent): boolean {
  return event.projection !== undefined;
}
