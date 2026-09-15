import type {
  DomainEvent, DomainEventKind, ProjectionRecord, ProjectionState,
  ProjectionSubscriber, PublishResult,
} from "@/types";
import { ambientCorrelationId } from "@/lib/audit/correlation";

/**
 * ★ THE CENTRAL DATA-PROPAGATION LAYER ★
 *
 * One canonical record changes, one event is published, and every authorized
 * projection consumes it. This module is the seam that makes that true, and the
 * whole point of it is what it refuses to do:
 *
 *  1. **It never writes a canonical record.** A subscriber writes what its own
 *     module owns, through that module's own service. The bus only decides who
 *     is offered what, and remembers what happened.
 *  2. **Publishing twice does nothing twice.** An event is identified by
 *     `eventId`; re-publishing one that has already been seen returns the first
 *     result with `duplicate: true` and runs no subscriber again. That is what
 *     makes a retried UI action safe.
 *  3. **One failing projection cannot block the others.** Every subscriber runs
 *     inside its own try/catch, sequentially so ordering is reproducible, and a
 *     throw becomes a `failed` record with the reason and a retry affordance.
 *     The next subscriber still runs.
 *  4. **A version it does not understand is `needs_review`, not a guess.** A
 *     subscriber declares the payload versions it handles; anything else stops
 *     and asks for a person rather than reading fields it has never seen.
 *
 * ███ FRONTEND ONLY — NOT A MESSAGE BROKER ███
 * There is no persistence, no ordering guarantee across tabs, no at-least-once
 * delivery, no dead-letter queue and no transport. Everything is a Map that
 * lives as long as the page. `idempotencyKey` and `eventId` describe the
 * contract the backend must honour; here they are honoured by that Map. Nothing
 * in this file transmits anything anywhere.
 */

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The deterministic event id for one intent.
 *
 * Built from the event kind and the caller's idempotency key, which is the
 * pair that means "this same thing happening". Signing the same rate
 * confirmation twice produces the same key, so it produces the same event id,
 * so nothing downstream runs twice. Nothing parses this; only equality matters.
 */
export function domainEventId(kind: DomainEventKind, idempotencyKey: string): string {
  return `dev_${kind}:${idempotencyKey}`;
}

/** `${eventId}:${subscriberId}` — the unit idempotency actually applies to. */
function projectionKey(eventId: string, subscriberId: string): string {
  return `${eventId}:${subscriberId}`;
}

/* -------------------------------------------------------------------------- */
/* The bus                                                                     */
/* -------------------------------------------------------------------------- */

export interface DomainEventBus {
  /** Register a projection. Registering the same id twice replaces it. */
  subscribe(subscriber: ProjectionSubscriber<never>): void;
  /**
   * Publish one event and run every subscriber that handles its kind.
   *
   * Returns after all of them have been offered it — a projection that fails
   * does not reject this call, because the caller's own write already
   * succeeded and reporting it as a failure would be a lie.
   */
  publish<P>(event: DomainEvent<P>): Promise<PublishResult>;
  /** Every event published in this session, newest first. */
  events(organizationId: string): DomainEvent[];
  /** One event by id, scoped. */
  event(organizationId: string, eventId: string): DomainEvent | undefined;
  /** Projection records for one event, in registration order. */
  projectionsFor(eventId: string): ProjectionRecord[];
  /** Every projection record for an organization, newest event first. */
  projections(organizationId: string, filter?: {
    state?: ProjectionState[];
    eventKind?: DomainEventKind[];
  }): ProjectionRecord[];
  /**
   * Run one projection again.
   *
   * Only offered for records marked `retryable`. A successful retry replaces
   * the record's state and bumps `attempts`; the event itself is untouched,
   * because the event is a statement about the past and retrying is not.
   */
  retry(eventId: string, subscriberId: string): Promise<ProjectionRecord | undefined>;
  /** Test/debug helper. Never called by the UI. */
  reset(): void;
}

class InMemoryDomainEventBus implements DomainEventBus {
  /** Registration order is run order, so a replay reads the same every time. */
  private subscribers: ProjectionSubscriber<never>[] = [];
  private eventsById = new Map<string, DomainEvent>();
  /** Insertion order is publication order. */
  private order: string[] = [];
  private records = new Map<string, ProjectionRecord>();

  subscribe(subscriber: ProjectionSubscriber<never>): void {
    const i = this.subscribers.findIndex((s) => s.id === subscriber.id);
    if (i >= 0) this.subscribers[i] = subscriber;
    else this.subscribers.push(subscriber);
  }

  async publish<P>(event: DomainEvent<P>): Promise<PublishResult> {
    const existing = this.eventsById.get(event.eventId);
    if (existing) {
      // The retry path. Nothing re-runs: the first publication's projections
      // stand, exactly as they were, which is what "exactly once" has to mean
      // for a caller who cannot tell whether their first click landed.
      return {
        event: existing,
        duplicate: true,
        projections: this.projectionsFor(event.eventId),
      };
    }

    const frozen = Object.freeze({ ...event }) as DomainEvent;
    this.eventsById.set(frozen.eventId, frozen);
    this.order.push(frozen.eventId);

    const interested = this.subscribers.filter((s) => s.handles.includes(event.kind));
    const produced: ProjectionRecord[] = [];

    for (const subscriber of interested) {
      produced.push(await this.run(subscriber, frozen));
    }

    return { event: frozen, duplicate: false, projections: produced };
  }

  /**
   * Offer one event to one subscriber and record what came back.
   *
   * Deliberately sequential rather than `Promise.all`: these projections write
   * to shared in-memory stores, and a reproducible order is worth more than
   * concurrency the real backend will not have either.
   */
  private async run(
    subscriber: ProjectionSubscriber<never>,
    event: DomainEvent,
  ): Promise<ProjectionRecord> {
    const id = projectionKey(event.eventId, subscriber.id);
    const at = new Date().toISOString();
    const previous = this.records.get(id);
    const attempts = (previous?.attempts ?? 0) + 1;

    const base: Omit<ProjectionRecord, "state" | "detail" | "reason" | "retryable" | "producedRefs"> = {
      id,
      eventId: event.eventId,
      eventKind: event.kind,
      eventVersion: event.version,
      subscriberId: subscriber.id,
      subscriberLabel: subscriber.label,
      targetModule: subscriber.targetModule,
      attempts,
      firstAttemptAt: previous?.firstAttemptAt ?? at,
      lastAttemptAt: at,
      mock: subscriber.mock,
      organizationId: event.scope.organizationId,
      correlationId: event.correlationId,
    };

    // A payload version this subscriber has never seen is never guessed at.
    if (!subscriber.versions.includes(event.version)) {
      const record: ProjectionRecord = {
        ...base,
        state: "needs_review",
        detail: `${subscriber.label} understands ${DOMAIN_VERSIONS(subscriber)} of ${event.kind} and this one is v${event.version}.`,
        reason: "The payload version is newer than this projection. A person must decide what to do with it rather than have fields read that were never agreed.",
        retryable: false,
        producedRefs: [],
      };
      this.records.set(id, record);
      return record;
    }

    try {
      const outcome = await subscriber.project(event as DomainEvent<never>);
      const record: ProjectionRecord = {
        ...base,
        state: outcome.state,
        detail: outcome.detail,
        reason: outcome.reason,
        retryable: outcome.retryable ?? (outcome.state === "failed"),
        producedRefs: outcome.producedRefs ?? [],
      };
      this.records.set(id, record);
      return record;
    } catch (error) {
      // A subscriber is never asked to be careful on the bus's behalf. It may
      // throw, and the only consequence is its own record — never the caller's
      // write, and never another subscriber's turn.
      const record: ProjectionRecord = {
        ...base,
        state: "failed",
        detail: `${subscriber.label} could not be updated from this event.`,
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
        producedRefs: [],
      };
      this.records.set(id, record);
      return record;
    }
  }

  events(organizationId: string): DomainEvent[] {
    return [...this.order]
      .reverse()
      .map((id) => this.eventsById.get(id)!)
      .filter((e) => e.scope.organizationId === organizationId);
  }

  event(organizationId: string, eventId: string): DomainEvent | undefined {
    const event = this.eventsById.get(eventId);
    if (!event || event.scope.organizationId !== organizationId) return undefined;
    return event;
  }

  projectionsFor(eventId: string): ProjectionRecord[] {
    return this.subscribers
      .map((s) => this.records.get(projectionKey(eventId, s.id)))
      .filter((r): r is ProjectionRecord => r !== undefined);
  }

  projections(
    organizationId: string,
    filter: { state?: ProjectionState[]; eventKind?: DomainEventKind[] } = {},
  ): ProjectionRecord[] {
    const out: ProjectionRecord[] = [];
    for (const eventId of [...this.order].reverse()) {
      for (const record of this.projectionsFor(eventId)) {
        if (record.organizationId !== organizationId) continue;
        if (filter.state?.length && !filter.state.includes(record.state)) continue;
        if (filter.eventKind?.length && !filter.eventKind.includes(record.eventKind)) continue;
        out.push(record);
      }
    }
    return out;
  }

  async retry(eventId: string, subscriberId: string): Promise<ProjectionRecord | undefined> {
    const record = this.records.get(projectionKey(eventId, subscriberId));
    const event = this.eventsById.get(eventId);
    const subscriber = this.subscribers.find((s) => s.id === subscriberId);
    if (!record || !event || !subscriber) return undefined;
    if (!record.retryable) return record;
    return this.run(subscriber, event);
  }

  reset(): void {
    this.eventsById = new Map();
    this.order = [];
    this.records = new Map();
    // Subscribers are architecture, not data: a reset clears what happened,
    // never who is listening.
  }
}

function DOMAIN_VERSIONS(subscriber: ProjectionSubscriber<never>): string {
  const vs = subscriber.versions.map((v) => `v${v}`);
  return vs.length === 1 ? vs[0] : `${vs.slice(0, -1).join(", ")} and ${vs.at(-1)}`;
}

/**
 * The one bus.
 *
 * A module-level singleton for the same reason every mock store here is one:
 * the app is one tab, and handing it around as a parameter would mean every
 * screen could be given a different one.
 */
export const propagationBus: DomainEventBus = new InMemoryDomainEventBus();

export function resetPropagationBus(): void {
  propagationBus.reset();
}

/* -------------------------------------------------------------------------- */
/* Building an event                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Assemble an event with the fields every one of them must carry.
 *
 * Takes the correlation id from the ambient scope when the caller has one, so a
 * chain of writes inside one `withCorrelation` block reads back as one act
 * without every call site remembering to thread it through.
 */
export function buildDomainEvent<P>(input: {
  kind: DomainEventKind;
  version: number;
  scope: DomainEvent<P>["scope"];
  subjectId: string;
  subjectKind: string;
  occurredAt: string;
  actor: DomainEvent<P>["actor"];
  idempotencyKey: string;
  payload: P;
  provenance: DomainEvent<P>["provenance"];
  correlationId?: string;
  causationId?: string;
  recordedAt?: string;
}): DomainEvent<P> {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  return {
    eventId: domainEventId(input.kind, input.idempotencyKey),
    kind: input.kind,
    version: input.version,
    scope: input.scope,
    subjectId: input.subjectId,
    subjectKind: input.subjectKind,
    occurredAt: input.occurredAt,
    recordedAt,
    actor: input.actor,
    correlationId: input.correlationId ?? ambientCorrelationId(),
    causationId: input.causationId,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    provenance: input.provenance,
  };
}
