import type { AuditEvent, AuditEventFilters } from "@/types";
import { OrganizationScopeError } from "../contracts/context";
import { buildAuditSeed } from "./audit-seed";

/**
 * The in-memory audit ledger, PARTITIONED BY ORGANIZATION.
 *
 * Append-only in the strongest sense this layer can manage: events are frozen
 * on the way in, the only mutation is `push`, and there is no method on this
 * class that removes, replaces or edits one. `reset()` exists for tests and
 * rebuilds the whole seed rather than editing anything.
 *
 * Every accessor REQUIRES an organizationId. There is no way to read across
 * the boundary, which is the same rule every other mock store in this
 * repository keeps.
 */
class AuditLedger {
  private data = buildAuditSeed();
  private index = new Map<string, AuditEvent>();

  constructor() {
    this.reindex();
  }

  private reindex() {
    this.index = new Map();
    for (const events of Object.values(this.data)) {
      for (const event of events) this.index.set(event.id, event);
    }
  }

  private bucket(organizationId: string): AuditEvent[] {
    let bucket = this.data[organizationId];
    if (!bucket) {
      // An organization with no seeded history still has a ledger. Refusing
      // here would make a brand-new workspace look broken rather than empty.
      bucket = [];
      this.data[organizationId] = bucket;
    }
    return bucket;
  }

  /** The ONLY write path. Returns the frozen event that was stored. */
  append(event: AuditEvent): AuditEvent {
    if (this.index.has(event.id)) {
      // Projection ids are deterministic, so re-reading a module's history
      // lands here. That is the mechanism working, not a failure: the first
      // projection stands and nothing is duplicated or overwritten.
      return this.index.get(event.id)!;
    }
    const frozen = Object.freeze({
      ...event,
      relatedEntities: event.relatedEntities
        ? Object.freeze([...event.relatedEntities])
        : undefined,
      changes: event.changes
        ? Object.freeze({
          ...event.changes,
          changes: Object.freeze(event.changes.changes.map((c) => Object.freeze(c))),
        })
        : undefined,
    }) as AuditEvent;
    this.bucket(event.organizationId).push(frozen);
    this.index.set(frozen.id, frozen);
    return frozen;
  }

  has(eventId: string): boolean {
    return this.index.has(eventId);
  }

  /** Newest first. Never crosses the organization boundary. */
  all(organizationId: string): readonly AuditEvent[] {
    return [...this.bucket(organizationId)].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }

  /**
   * One event, scoped.
   *
   * A record belonging to another organization throws `OrganizationScopeError`
   * rather than returning it, and the service turns that into a NotFound —
   * a "forbidden" would confirm the event exists.
   */
  find(organizationId: string, eventId: string): AuditEvent | undefined {
    const event = this.index.get(eventId);
    if (!event) return undefined;
    if (event.organizationId !== organizationId) {
      throw new OrganizationScopeError(event.organizationId, organizationId);
    }
    return event;
  }

  correctionsOf(organizationId: string, eventId: string): AuditEvent[] {
    return this.bucket(organizationId)
      .filter((e) => e.correctsEventId === eventId)
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  correlated(organizationId: string, correlationId: string): AuditEvent[] {
    return this.bucket(organizationId)
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  /** Test/debug helper. Rebuilds the seed; it never edits an event. */
  reset() {
    this.data = buildAuditSeed();
    this.reindex();
  }
}

export const auditLedger = new AuditLedger();

export function resetAuditLedger() {
  auditLedger.reset();
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

const ms = (iso: string) => new Date(iso).getTime();

export function matchesAuditFilters(
  event: AuditEvent,
  f: AuditEventFilters = {},
): boolean {
  if (f.module?.length && !f.module.includes(event.module)) return false;
  if (f.action?.length && !f.action.includes(event.action)) return false;
  if (f.source?.length && !f.source.includes(event.source)) return false;
  if (f.outcome?.length && !f.outcome.includes(event.outcome)) return false;
  if (f.actorMembershipId && event.membershipId !== f.actorMembershipId) return false;
  if (f.entityKind?.length && !f.entityKind.includes(event.entity.kind)) return false;
  if (f.correlationId && event.correlationId !== f.correlationId) return false;
  if (f.entityId) {
    const touches = event.entity.id === f.entityId
      || (event.relatedEntities ?? []).some((r) => r.id === f.entityId);
    if (!touches) return false;
  }
  if (f.from && ms(event.occurredAt) < ms(f.from)) return false;
  if (f.to && ms(event.occurredAt) > ms(f.to)) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const related = (event.relatedEntities ?? []).map((r) => r.label).join(" ");
    const hay = [
      event.summary, event.entity.label, event.actor.displayNameSnapshot,
      event.action, event.sourceAction ?? "", related,
    ].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
