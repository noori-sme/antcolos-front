import type {
  AuditEvent, AuditEventFilters, AuditEventPage, AuditExportRow, AuditModule,
  PermissionKey,
} from "@/types";
import {
  AUDIT_MODULE_LABEL, AUDIT_OUTCOME_LABEL, AUDIT_SOURCE_LABEL, auditActionLabel,
} from "@/lib/audit/actions";
import { ambientCorrelationId, newRequestId } from "@/lib/audit/correlation";
import { projectionId } from "@/lib/audit/ingest";
import { sanitizeChanges } from "@/lib/audit/redaction";
import {
  NotFoundError, OrganizationScopeError, PermissionDeniedError,
  type ServiceContext,
} from "../contracts/context";
import type {
  AuditService, AuditSourceStatus, RecordAuditEventInput,
} from "../contracts/audit";
import { auditLedger, matchesAuditFilters } from "./audit-ledger";
import { AUDIT_FEEDS, readAllFeeds } from "./audit-sources";
import { nowIso } from "./time";

/**
 * The mock audit adapter.
 *
 * Reading is gated on `audit:view`; WRITING is not gated at all, and that is
 * deliberate. A refusal is the most audit-worthy thing that happens in a
 * permission system, and a ledger that needed permission to write down a
 * refusal would lose exactly the events somebody came looking for.
 *
 * There is no update path and no delete path, here or anywhere else.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 120;
const wait = () =>
  LATENCY_MS ? new Promise<void>((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve();

function requirePermissions(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

const DEFAULT_PAGE_SIZE = 50;
const EXPORT_ROW_CAP = 1000;
const DASHBOARD_WINDOW_HOURS = 30 * 24;

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Builds and appends one event.
 *
 * Every change summary passes through `sanitizeChanges` HERE, on the service
 * side of the boundary, so a caller cannot hand over a password field and have
 * the value stored — whatever the caller believed it was doing.
 */
/**
 * The correction link is NOT on the public input.
 *
 * `correct()` is the only thing that sets it, so a caller cannot fabricate a
 * correction pointing at an unrelated event.
 */
type InternalAuditInput = RecordAuditEventInput & {
  correctsEventId?: string;
  correctionReason?: string;
};

export function appendAuditEvent(
  ctx: ServiceContext,
  input: InternalAuditInput,
): AuditEvent {
  const sanitized = input.changes ? sanitizeChanges(input.changes) : undefined;
  const at = input.occurredAt ?? nowIso();

  return auditLedger.append({
    id: `aev_${newRequestId().slice(4)}`,
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    membershipId: ctx.membershipId,
    module: input.module,
    action: input.action,
    sourceAction: input.sourceAction,
    entity: input.entity,
    relatedEntities: input.relatedEntities,
    source: input.source ?? "human",
    channel: input.channel ?? ctx.actor.source ?? "web",
    outcome: input.outcome ?? "succeeded",
    occurredAt: at,
    recordedAt: nowIso(),
    correlationId: input.correlationId ?? ambientCorrelationId(),
    requestId: newRequestId(),
    summary: input.summary,
    changes: sanitized
      ? { changes: sanitized.changes, redactedCount: sanitized.redactedCount }
      : undefined,
    permissionContext: input.permissionContext,
    correctsEventId: input.correctsEventId,
    correctionReason: input.correctionReason,
  });
}

/**
 * Records a refusal. Exported so any module can call it at the point it throws,
 * rather than each module inventing its own way of noticing.
 */
export function recordPermissionDenied(
  ctx: ServiceContext,
  input: Omit<RecordAuditEventInput, "action" | "module" | "outcome"> & {
    required: PermissionKey[];
  },
): AuditEvent {
  const { required, ...rest } = input;
  return appendAuditEvent(ctx, {
    ...rest,
    module: "access",
    action: "access.permission_denied",
    outcome: "denied",
    permissionContext: {
      required,
      missing: required.filter((k) => !ctx.permissions.has(k)),
    },
  });
}

/** Records an attempt to reach another organization's record. */
export function recordCrossOrganizationAttempt(
  ctx: ServiceContext,
  input: Omit<RecordAuditEventInput, "action" | "module" | "outcome">,
): AuditEvent {
  return appendAuditEvent(ctx, {
    ...input,
    module: "access",
    action: "access.cross_organization_attempt",
    outcome: "denied",
  });
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pulls every module feed the caller may read and appends what is not already
 * there. Idempotent by construction: the ledger id is derived from the
 * producing module plus its own entry id, so a re-read appends nothing.
 */
export async function ensureProjected(ctx: ServiceContext): Promise<void> {
  const feeds = await readAllFeeds(ctx);
  for (const { module, records } of feeds) {
    for (const record of records) {
      const id = projectionId(module as AuditModule, record.entryId);
      if (auditLedger.has(id)) continue;
      const sanitized = record.changes ? sanitizeChanges([...record.changes]) : undefined;
      auditLedger.append({
        id,
        organizationId: ctx.organizationId,
        actor: record.actor,
        membershipId: record.actor.membershipId,
        module: module as AuditModule,
        action: record.action,
        sourceAction: record.sourceAction,
        entity: record.entity,
        relatedEntities: record.relatedEntities,
        source: record.source ?? "human",
        channel: record.channel ?? "web",
        outcome: record.outcome ?? "succeeded",
        occurredAt: record.occurredAt,
        // The ledger learned about it now. Saying otherwise would claim the
        // projection had existed all along, which it had not.
        recordedAt: nowIso(),
        correlationId: record.correlationId ?? `cor_${module}_${record.recordId}`,
        requestId: `req_${id}`,
        summary: record.summary,
        changes: sanitized
          ? { changes: sanitized.changes, redactedCount: sanitized.redactedCount }
          : undefined,
        projection: { module: module as AuditModule, recordId: record.recordId, entryId: record.entryId },
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Shared by the risk service, which reads the same ledger through the same gate. */
export async function readableEvents(
  ctx: ServiceContext,
  filters: AuditEventFilters = {},
): Promise<AuditEvent[]> {
  await ensureProjected(ctx);
  return auditLedger
    .all(ctx.organizationId)
    .filter((e) => matchesAuditFilters(e, filters));
}

function paginate(events: AuditEvent[], cursor?: string, limit = DEFAULT_PAGE_SIZE): AuditEventPage {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const slice = events.slice(from, from + limit);
  const next = from + limit;
  return {
    items: slice,
    nextCursor: next < events.length ? String(next) : undefined,
    totalCount: events.length,
  };
}

function findOrNotFound(ctx: ServiceContext, eventId: string): AuditEvent {
  let event: AuditEvent | undefined;
  try {
    event = auditLedger.find(ctx.organizationId, eventId);
  } catch (error) {
    if (error instanceof OrganizationScopeError) {
      // Another organization's event is NOT FOUND, never forbidden: a 403 would
      // confirm the event exists, which is itself a disclosure.
      throw new NotFoundError("Audit event");
    }
    throw error;
  }
  if (!event) throw new NotFoundError("Audit event");
  return event;
}

const EXPORT_COLUMNS = [
  { key: "occurredAt", label: "When it happened" },
  { key: "recordedAt", label: "When Antcolos recorded it" },
  { key: "actor", label: "Who" },
  { key: "membershipId", label: "Membership" },
  { key: "module", label: "Module" },
  { key: "action", label: "Action" },
  { key: "sourceAction", label: "Module's own action" },
  { key: "outcome", label: "Outcome" },
  { key: "source", label: "Source" },
  { key: "entity", label: "About" },
  { key: "entityId", label: "Record id" },
  { key: "summary", label: "Summary" },
  { key: "changedFields", label: "Fields changed" },
  { key: "redactedFields", label: "Fields withheld" },
  { key: "correlationId", label: "Correlation id" },
  { key: "requestId", label: "Request id" },
  { key: "correctsEventId", label: "Corrects" },
] as const;

function exportRow(event: AuditEvent): AuditExportRow {
  const changed = (event.changes?.changes ?? []).filter((c) => !c.redacted);
  const redacted = (event.changes?.changes ?? []).filter((c) => c.redacted);
  return {
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    actor: event.actor.displayNameSnapshot,
    membershipId: event.membershipId,
    module: AUDIT_MODULE_LABEL[event.module],
    action: auditActionLabel(event.action),
    sourceAction: event.sourceAction ?? "",
    outcome: AUDIT_OUTCOME_LABEL[event.outcome],
    source: AUDIT_SOURCE_LABEL[event.source],
    entity: event.entity.label,
    entityId: event.entity.id,
    summary: event.summary,
    changedFields: changed.map((c) => `${c.label}: ${c.before ?? "—"} → ${c.after ?? "—"}`).join("; "),
    redactedFields: redacted.map((c) => c.label).join("; "),
    correlationId: event.correlationId,
    requestId: event.requestId,
    correctsEventId: event.correctsEventId ?? "",
  };
}

export const EXPORT_NOTICE =
  "Prepared inside Antcolos from the records Antcolos holds. Nothing has been sent, uploaded or filed anywhere, "
  + "and this is not certified, notarised or tamper-proof evidence. Values withheld by the redaction rules are "
  + "listed by field name and are not recoverable from this view.";

export const mockAuditService: AuditService = {
  async record(ctx, input) {
    await wait();
    return appendAuditEvent(ctx, input);
  },

  async list(ctx, query = {}) {
    await wait();
    requirePermissions(ctx, "audit:view");
    const events = await readableEvents(ctx, query.filters);
    return paginate(events, query.cursor, query.limit);
  },

  async get(ctx, eventId) {
    await wait();
    requirePermissions(ctx, "audit:view");
    await ensureProjected(ctx);
    const event = findOrNotFound(ctx, eventId);
    const corrections = auditLedger.correctionsOf(ctx.organizationId, eventId);
    const corrected = event.correctsEventId
      ? auditLedger.find(ctx.organizationId, event.correctsEventId)
      : undefined;
    const correlated = auditLedger
      .correlated(ctx.organizationId, event.correlationId)
      .filter((e) => e.id !== eventId);
    return { event, corrections, corrected, correlated };
  },

  async forEntity(ctx, entityId, query = {}) {
    await wait();
    requirePermissions(ctx, "audit:view");
    const events = await readableEvents(ctx, { ...query.filters, entityId });
    return paginate(events, query.cursor, query.limit);
  },

  async forActor(ctx, membershipId, query = {}) {
    await wait();
    requirePermissions(ctx, "audit:view");
    const events = await readableEvents(ctx, {
      ...query.filters,
      actorMembershipId: membershipId,
    });
    return paginate(events, query.cursor, query.limit);
  },

  async correct(ctx, eventId, input) {
    await wait();
    requirePermissions(ctx, "audit:view");
    const reason = input.reason?.trim();
    if (!reason) {
      throw new Error(
        "A correction needs a reason. Without one there are two versions of what happened and nothing to choose between them.",
      );
    }
    await ensureProjected(ctx);
    const original = findOrNotFound(ctx, eventId);

    // Correcting the record of what SOMEBODY ELSE did is investigative work,
    // not housekeeping. Correcting your own mistake is not.
    if (original.membershipId !== ctx.membershipId) {
      requirePermissions(ctx, "risk:investigate");
    }

    return appendAuditEvent(ctx, {
      module: original.module,
      action: "audit.event_corrected",
      entity: original.entity,
      relatedEntities: [
        { kind: "audit_event", id: original.id, label: original.summary },
      ],
      summary: input.summary?.trim()
        || `Correction to: ${original.summary}`,
      changes: input.changes,
      // The link is what makes this a correction rather than a second opinion.
      correctsEventId: original.id,
      correctionReason: reason,
      // A correction belongs to the same intent as the thing it corrects, so it
      // reads back together rather than as an unrelated event later that day.
      correlationId: original.correlationId,
    }) as AuditEvent;
  },

  async exportView(ctx, filters = {}) {
    await wait();
    requirePermissions(ctx, "audit:view", "audit:export");
    const events = await readableEvents(ctx, filters);
    const rows = events.slice(0, EXPORT_ROW_CAP).map(exportRow);

    // Preparing an export is itself an audited act — including who prepared it
    // and what filter they used.
    appendAuditEvent(ctx, {
      module: "risk",
      action: "audit.export_prepared",
      entity: {
        kind: "organization",
        id: ctx.organizationId,
        label: ctx.organizationName,
      },
      summary: `Prepared an audit export of ${rows.length} event${rows.length === 1 ? "" : "s"}`,
      changes: [{ field: "filters", after: JSON.stringify(filters).slice(0, 200) }],
    });

    return {
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      generatedAt: nowIso(),
      generatedBy: ctx.actor,
      filters,
      columns: EXPORT_COLUMNS,
      rows,
      truncated: events.length > EXPORT_ROW_CAP,
      totalMatching: events.length,
      notice: EXPORT_NOTICE,
    };
  },

  async sources(ctx) {
    await wait();
    requirePermissions(ctx, "audit:view");
    await ensureProjected(ctx);
    const all = auditLedger.all(ctx.organizationId);

    const feedStatuses: AuditSourceStatus[] = AUDIT_FEEDS.map((feed) => {
      const requires = feed.requires as PermissionKey[];
      return {
        module: feed.module,
        label: AUDIT_MODULE_LABEL[feed.module],
        mock: feed.mock,
        requires,
        readable: requires.every((k) => ctx.permissions.has(k)),
        eventCount: all.filter((e) => e.projection?.module === feed.module).length,
      };
    });

    // Events this module raises itself are not a "feed" — nothing is projected
    // — but leaving them off the panel would make the numbers not add up.
    const projectedIds = new Set(feedStatuses.map((f) => f.module));
    const native = all.filter((e) => !e.projection);
    const nativeModules = new Set(native.map((e) => e.module));
    for (const nativeModule of nativeModules) {
      if (projectedIds.has(nativeModule)) continue;
      feedStatuses.push({
        module: nativeModule,
        label: AUDIT_MODULE_LABEL[nativeModule],
        mock: false,
        requires: [],
        readable: true,
        eventCount: native.filter((e) => e.module === nativeModule).length,
      });
    }

    return feedStatuses.sort((a, b) => b.eventCount - a.eventCount);
  },
};

export { DASHBOARD_WINDOW_HOURS };
