import type {
  ActivityEntry, ActorRef, ConfirmationState, DriverWorkflow,
  DriverWorkflowEvent, EventSource, ExtractedField, IdempotencyKey,
  IsoDateTime, MilestoneKind, MilestoneProgress, MilestoneState,
  TripPolicy, WorkflowDocument, WorkflowEventType, WorkflowWarning,
} from "@/types";
import {
  MILESTONE_ORDER, milestoneIndex, milestoneMeta,
} from "./catalog";
import {
  CompletionBlockedError, DuplicateSubmissionError, WorkflowClosedError,
} from "./errors";
import type { WorkflowCommand } from "./commands";

/**
 * The trip state machine — and the most important thing about it is what it
 * refuses to do.
 *
 * It does NOT reject a milestone because an earlier one is missing. A driver
 * who uploads the BOL having never tapped "Arrived at Shipper" is a driver in a
 * dead zone doing their job; the upload succeeds, the real sequence is kept,
 * and the gap becomes a question the interface asks later. There are exactly
 * two things it refuses: writing to a completed workflow, and closing a trip
 * with no proof of delivery and no recorded reason for its absence.
 *
 * It also never invents anything. A missed milestone stays missed until a
 * person records it or confirms a machine's guess. Nothing here back-fills a
 * timestamp to make a timeline look tidy.
 */

export interface WorkflowEventDraft {
  type: WorkflowEventType;
  milestone?: MilestoneKind;
  activity?: DriverWorkflowEvent["activity"];
  occurredAt: IsoDateTime;
  actor: ActorRef;
  source: EventSource;
  confirmation: ConfirmationState;
  inference?: DriverWorkflowEvent["inference"];
  idempotencyKey?: IdempotencyKey;
  correctsEventId?: string;
  payload?: DriverWorkflowEvent["payload"];
}

export interface WorkflowProjection {
  milestones: MilestoneProgress[];
  activities: ActivityEntry[];
  documents: WorkflowDocument[];
  suggestedMilestones: MilestoneKind[];
  warnings: WorkflowWarning[];
  completionBlockedReason?: string;
}

const DOCUMENT_MILESTONE: Partial<Record<string, MilestoneKind>> = {
  bill_of_lading: "bol_uploaded",
  proof_of_delivery: "pod_uploaded",
};

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

interface MilestoneCell {
  state: MilestoneState;
  eventId?: string;
  occurredAt?: IsoDateTime;
  recordedAt?: IsoDateTime;
  byName?: string;
  source?: EventSource;
  confirmation?: ConfirmationState;
  inference?: DriverWorkflowEvent["inference"];
}

/**
 * Replay the timeline into the read model every channel renders.
 *
 * `events` may arrive in any order; they are sorted by `sequence`, which is the
 * order they were RECORDED. Display order uses `occurredAt`, which is the order
 * things actually happened — those two differ exactly when a driver catches up
 * after being offline, and both are worth keeping.
 */
export function project(
  workflow: DriverWorkflow,
  events: readonly DriverWorkflowEvent[],
  policy: TripPolicy,
): WorkflowProjection {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);

  const cells = new Map<MilestoneKind, MilestoneCell>();
  const activities: ActivityEntry[] = [];
  const documents = new Map<string, WorkflowDocument>();

  const setCell = (kind: MilestoneKind, cell: MilestoneCell) => cells.set(kind, cell);

  for (const event of ordered) {
    switch (event.type) {
      case "milestone.recorded": {
        if (!event.milestone) break;
        setCell(event.milestone, {
          state: "recorded",
          eventId: event.id,
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          byName: event.actor.displayNameSnapshot,
          source: event.source,
          confirmation: "driver_confirmed",
        });
        break;
      }
      case "milestone.inferred": {
        if (!event.milestone) break;
        // A guess never overwrites something a person recorded.
        const existing = cells.get(event.milestone);
        if (existing?.state === "recorded") break;
        setCell(event.milestone, {
          state: "inferred",
          eventId: event.id,
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          byName: event.actor.displayNameSnapshot,
          source: event.source,
          confirmation: "inferred",
          inference: event.inference,
        });
        break;
      }
      case "milestone.confirmed": {
        if (!event.milestone) break;
        const prior = cells.get(event.milestone);
        setCell(event.milestone, {
          state: "recorded",
          eventId: event.id,
          // The driver may correct the time the machine guessed; when they do
          // not, the machine's observation time is what stands.
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          byName: event.actor.displayNameSnapshot,
          source: event.source,
          confirmation: "confirmed_from_inference",
          inference: prior?.inference ?? event.inference,
        });
        break;
      }
      case "milestone.inference_rejected": {
        if (!event.milestone) break;
        // The driver says it did not happen. Back to not reached — and the
        // rejected guess stays in the timeline for anyone who asks why.
        setCell(event.milestone, {
          state: "not_reached",
          confirmation: "rejected_inference",
        });
        break;
      }
      case "milestone.corrected": {
        if (!event.milestone) break;
        const prior = cells.get(event.milestone);
        if (!prior) break;
        setCell(event.milestone, {
          ...prior,
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          byName: event.actor.displayNameSnapshot,
        });
        break;
      }
      case "activity.recorded": {
        if (!event.activity) break;
        activities.push({
          eventId: event.id,
          kind: event.activity,
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          byName: event.actor.displayNameSnapshot,
          source: event.source,
          note: event.payload?.note,
          durationMinutes: event.payload?.durationMinutes,
          amountCents: event.payload?.amountCents,
          gallons: event.payload?.gallons,
          weightLbs: event.payload?.weightLbs,
          locationLabel: event.payload?.locationLabel,
          documentId: event.payload?.documentId,
        });
        break;
      }
      case "document.attached": {
        const documentId = event.payload?.documentId;
        if (!documentId) break;
        documents.set(documentId, {
          documentId,
          kind: event.payload?.documentKind ?? "other",
          fileName: event.payload?.fileName ?? "document",
          attachedAt: event.occurredAt,
          byName: event.actor.displayNameSnapshot,
          source: event.source,
          extractionState: "not_applicable",
          fields: [],
          provenance: {
            module: "document_center",
            adapter: "mock:document-center",
            mock: true,
            observedAt: event.occurredAt,
            receivedAt: event.recordedAt,
          },
          relatedMilestone: DOCUMENT_MILESTONE[event.payload?.documentKind ?? ""],
        });
        break;
      }
      case "document.extraction_recorded": {
        const documentId = event.payload?.documentId;
        const doc = documentId ? documents.get(documentId) : undefined;
        if (!doc) break;
        documents.set(doc.documentId, {
          ...doc,
          extractionState: "succeeded",
          fields: (event.payload?.fields ?? []).map((f) => ({ ...f })),
        });
        break;
      }
      case "document.extraction_corrected": {
        const documentId = event.payload?.documentId;
        const doc = documentId ? documents.get(documentId) : undefined;
        if (!doc || !event.payload?.fieldKey) break;
        // Both values survive. The extracted value is never overwritten —
        // the correction is added beside it with who and when.
        documents.set(doc.documentId, {
          ...doc,
          fields: doc.fields.map((f) =>
            f.key === event.payload?.fieldKey
              ? {
                  ...f,
                  correctedValue: event.payload?.correctedValue,
                  correctedAt: event.recordedAt,
                  correctedBy: event.actor,
                  correctionNote: event.payload?.note,
                }
              : f,
          ),
        });
        break;
      }
      default:
        break;
    }
  }

  // --- Skipped steps -------------------------------------------------------
  // "Skipped" means: something later happened and this never did. It is a
  // question, not a verdict, and it blocks nothing.
  const reachedIndices = MILESTONE_ORDER.map((kind, i) =>
    cells.get(kind)?.state === "recorded" || cells.get(kind)?.state === "inferred" ? i : -1,
  ).filter((i) => i >= 0);
  const furthest = reachedIndices.length > 0 ? Math.max(...reachedIndices) : -1;

  const milestones: MilestoneProgress[] = MILESTONE_ORDER.map((kind, index) => {
    const cell = cells.get(kind);
    const state: MilestoneState =
      cell && cell.state !== "not_reached"
        ? cell.state
        : index < furthest
          ? "skipped"
          : "not_reached";
    return {
      kind,
      state,
      eventId: cell?.eventId,
      occurredAt: cell?.occurredAt,
      recordedAt: cell?.recordedAt,
      byName: cell?.byName,
      source: cell?.source,
      confirmation: cell?.confirmation,
      inference: cell?.inference,
    };
  });

  // --- Suggestions ---------------------------------------------------------
  // Anything skipped comes first — it is the shortest path back to a correct
  // record — then the next steps forward.
  const skipped = milestones.filter((m) => m.state === "skipped").map((m) => m.kind);
  const ahead = milestones
    .filter((m) => m.state === "not_reached" && milestoneIndex(m.kind) > furthest)
    .map((m) => m.kind)
    .slice(0, 2);
  const suggestedMilestones =
    workflow.status === "active" ? [...skipped.slice(0, 2), ...ahead] : [];

  // --- Warnings ------------------------------------------------------------
  // Only on a live trip. A warning is a call to action, and a closed workflow
  // has none left — the milestone states and the timeline still show exactly
  // what was and was not recorded, for anyone auditing it later.
  const warnings: WorkflowWarning[] = [];
  const live = workflow.status === "active";
  for (const m of live ? milestones : []) {
    if (m.state === "skipped") {
      warnings.push({
        kind: "skipped_milestone",
        milestone: m.kind,
        message: `"${milestoneMeta(m.kind).label}" was never recorded, but later steps were. Record it if it happened — nothing is blocked either way.`,
        suggestedAction: "record_milestone",
      });
    }
    if (m.state === "inferred" && m.inference) {
      warnings.push({
        kind: "unconfirmed_inference",
        milestone: m.kind,
        eventId: m.eventId,
        message: `${m.inference.source.toUpperCase()} suggests "${milestoneMeta(m.kind).label}" happened at ${m.inference.observedAt}. It is recorded as inferred, not as something you did. Confirm or correct it when you can.`,
        suggestedAction: "confirm_inference",
      });
    }
  }

  const docKinds = new Set([...documents.values()].map((d) => d.kind));
  const loaded = milestones.find((m) => m.kind === "loaded");
  if (live && loaded && loaded.state !== "not_reached" && !docKinds.has("bill_of_lading")) {
    warnings.push({
      kind: "missing_document",
      milestone: "bol_uploaded",
      message: "You are loaded and there is no BOL on this trip yet.",
      suggestedAction: "attach_document",
    });
  }
  const delivered = milestones.find((m) => m.kind === "delivered_and_unloaded");
  const hasPod = docKinds.has("proof_of_delivery");
  if (live && delivered && delivered.state !== "not_reached" && !hasPod) {
    warnings.push({
      kind: "missing_document",
      milestone: "pod_uploaded",
      message: "This load is delivered and there is no POD on it yet.",
      suggestedAction: "attach_document",
    });
  }

  // --- The one genuine block ----------------------------------------------
  let completionBlockedReason: string | undefined;
  if (live && policy.requirePodBeforeCompletion && !hasPod) {
    completionBlockedReason =
      "This carrier bills on the POD, so a trip cannot be closed without one. Upload it, or complete the trip with a reason on the record.";
    warnings.push({
      kind: "completion_blocked",
      milestone: "trip_completed",
      message: completionBlockedReason,
      suggestedAction: "attach_document",
    });
  }

  return {
    milestones,
    activities: activities.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    ),
    documents: [...documents.values()].sort(
      (a, b) => new Date(b.attachedAt).getTime() - new Date(a.attachedAt).getTime(),
    ),
    suggestedMilestones,
    warnings,
    completionBlockedReason,
  };
}

/* -------------------------------------------------------------------------- */
/* Command validation                                                          */
/* -------------------------------------------------------------------------- */

export interface WorkflowCommandContext {
  actor: ActorRef;
  source: EventSource;
  now: IsoDateTime;
  policy: TripPolicy;
}

/**
 * The complete list of reasons a trip command can be refused. Everything not
 * listed here is accepted, including out-of-order milestones, repeated
 * activities, and documents that arrive before the step that expects them.
 */
export function assertCommandAllowed(
  workflow: DriverWorkflow,
  projection: WorkflowProjection,
  command: WorkflowCommand,
): void {
  // A completed workflow is closed for writing and kept forever for reading.
  if (workflow.status !== "active") {
    throw new WorkflowClosedError(workflow.id);
  }

  if (command.type !== "record_milestone") return;

  const current = projection.milestones.find((m) => m.kind === command.milestone);

  // The same milestone twice, with no idempotency match to explain it. The
  // adapter has already returned the original result for a replayed key, so
  // reaching here means a genuinely new submission of something recorded.
  if (current?.state === "recorded") {
    throw new DuplicateSubmissionError(`"${milestoneMeta(command.milestone).label}"`);
  }

  if (
    command.milestone === "trip_completed" &&
    projection.completionBlockedReason &&
    !command.completionExceptionReason?.trim()
  ) {
    throw new CompletionBlockedError("trip_completed", projection.completionBlockedReason);
  }
}

/** Ordinary milestone recording. Never rejected for arriving out of order. */
export function recordMilestoneDrafts(
  command: Extract<WorkflowCommand, { type: "record_milestone" }>,
  ctx: WorkflowCommandContext,
): WorkflowEventDraft[] {
  return [
    {
      type: "milestone.recorded",
      milestone: command.milestone,
      occurredAt: command.occurredAt ?? ctx.now,
      actor: ctx.actor,
      source: ctx.source,
      confirmation: "driver_confirmed",
      idempotencyKey: command.idempotencyKey,
      payload: {
        note: command.payload?.note,
        location: command.payload?.location,
        locationLabel: command.payload?.locationLabel,
        odometerMiles: command.payload?.odometerMiles,
        exceptionReason: command.completionExceptionReason?.trim() || undefined,
      },
    },
  ];
}

/** Applies a completed trip to the workflow record itself. */
export function completeWorkflow(
  workflow: DriverWorkflow,
  input: { at: IsoDateTime; actor: ActorRef; exceptionReason?: string },
): DriverWorkflow {
  return {
    ...workflow,
    status: "completed",
    completedAt: input.at,
    completedBy: input.actor,
    completionException: input.exceptionReason,
    version: workflow.version + 1,
  };
}

/** Helper for adapters: the furthest milestone actually reached, for a badge. */
export function currentMilestone(
  milestones: readonly MilestoneProgress[],
): MilestoneKind | undefined {
  let found: MilestoneKind | undefined;
  for (const m of milestones) {
    if (m.state === "recorded" || m.state === "inferred") found = m.kind;
  }
  return found;
}

/** Fields an extractor produced, normalised so corrections can find them. */
export function normaliseFields(fields: readonly ExtractedField[]): ExtractedField[] {
  return fields.map((f) => ({ ...f, key: f.key.trim() }));
}
