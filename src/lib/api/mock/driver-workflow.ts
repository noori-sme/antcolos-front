import type {
  CarrierDriverPolicy, DriverLoadPost, DriverProposalView, DriverTripSummary,
  DriverWorkflow, DriverWorkflowEvent, DriverWorkflowView, EventSource,
  IntegrationStatus, IsoDateTime, LoadProposal, MilestoneKind,
  PendingIntegrationEvent, PermissionKey, ProposalEvent,
} from "@/types";
import { integrations } from "@/lib/integrations";
import { externalRef } from "@/lib/integrations/mock/support";
import type { ProposalCommand, WorkflowCommand } from "@/lib/driver-workflow/commands";
import {
  isActivityKind, isMilestoneKind, milestoneMeta,
} from "@/lib/driver-workflow/catalog";
import {
  InvalidTransitionError, NotYourRecordError, PolicyDeniedError,
  WorkflowClosedError,
} from "@/lib/driver-workflow/errors";
import {
  activePause, applyProposalCommand, availableActions, settleClock,
} from "@/lib/driver-workflow/proposal-machine";
import {
  assertCommandAllowed, completeWorkflow, currentMilestone, project,
  recordMilestoneDrafts, type WorkflowEventDraft,
} from "@/lib/driver-workflow/trip-machine";
import {
  discloseEverything, discloseRate, resolvePolicy,
} from "@/lib/driver-workflow/policy";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  DriverProposalFilters, DriverWorkflowService, FinalizeLoadInput,
  ProposalCommandResult, WorkflowCommandResult,
} from "../contracts/driver-workflow";
import { driverWorkflowStore, nextId, type StoredPost } from "./driver-workflow-store";
import { finalizeLoad } from "./driver-workflow-finalize";
import { ensureSeeded } from "./driver-workflow-seed";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The enforcement seam.
 *
 * Every rule that matters is checked HERE and not in a screen: the permission,
 * the organization boundary, whose driver record this is, what carrier policy
 * discloses, which counteroffer subjects are allowed, whether a pause is still
 * the current one, and whether a command has already been applied. A UI bug
 * that renders a forbidden button still fails at this line — which is exactly
 * the expectation the real API has to meet.
 *
 * The Telegram bot, when it arrives, calls these same methods with the same
 * commands. It inherits all of this for free, and it cannot drift.
 */

/** Simulated network delay. Off under test so the suite is not mostly sleep. */
const LATENCY_MS = process.env.ANTCOLOS_TEST === "1" ? 0 : 140;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

function require(ctx: ServiceContext, ...keys: PermissionKey[]): void {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/** Events a driver appends carry the channel they came from, never a guess. */
function sourceOf(ctx: ServiceContext): EventSource {
  return ctx.actor.source;
}

const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

async function policyFor(
  ctx: ServiceContext,
  driverId: string,
): Promise<CarrierDriverPolicy> {
  const engagementType = await integrations.assignments.engagementType(
    ctx.organizationId,
    driverId,
  );
  return resolvePolicy(ctx.organizationId, engagementType);
}

/** The driver whose records this caller is acting on, when they are a driver. */
function callerDriverId(ctx: ServiceContext): string | undefined {
  return ctx.scope.loads === "assigned" ? ctx.driverProfileId : undefined;
}

/* -------------------------------------------------------------------------- */
/* Proposal views                                                              */
/* -------------------------------------------------------------------------- */

function toProposalView(
  ctx: ServiceContext,
  proposal: LoadProposal,
  policy: CarrierDriverPolicy,
  now: IsoDateTime,
): DriverProposalView {
  // Money is reduced HERE, where the value is assembled. A driver never
  // receives the full rate object, so there is nothing for the UI to leak.
  const rate = ctx.permissions.has("rates:view")
    ? discloseEverything(proposal.rate)
    : discloseRate(proposal.rate, policy.proposals.disclosedRateFields, policy.label);

  return {
    id: proposal.id,
    organizationId: proposal.organizationId,
    driverId: proposal.driverId,
    engagementType: proposal.engagementType,
    status: proposal.status,
    version: proposal.version,
    customerName: proposal.customerName,
    customerKind: proposal.customerKind,
    commodity: proposal.commodity,
    weightLbs: proposal.weightLbs,
    equipmentType: proposal.equipment.type,
    stops: proposal.stops,
    serviceWindow: proposal.serviceWindow,
    dispatchNote: proposal.dispatchNote,
    rate,
    sentAt: proposal.sentAt,
    sentByName: proposal.sentBy.displayNameSnapshot,
    respondByAt: proposal.respondByAt,
    approval: proposal.approval,
    rejection: proposal.rejection,
    unavailability: proposal.unavailability,
    activePause: activePause(proposal, now),
    pauses: proposal.pauses,
    comments: proposal.comments,
    counteroffers: proposal.counteroffers,
    policy: policy.proposals,
    policyLabel: policy.label,
    availableActions: availableActions(proposal, policy.proposals, now),
    provenance: proposal.provenance,
  };
}

/**
 * Persist whatever the clock has changed since this record was last touched, so
 * a pause that ran out is already back to "Awaiting Driver Response" before any
 * command or any read sees it.
 */
function settleAndPersist(
  organizationId: string,
  proposal: LoadProposal,
  now: IsoDateTime,
): LoadProposal {
  const decision = settleClock(proposal, now);
  if (decision.events.length === 0) return proposal;
  driverWorkflowStore.replaceProposal(organizationId, decision.next);
  driverWorkflowStore.appendProposalEvents(organizationId, proposal.id, decision.events);
  return decision.next;
}

function findProposal(ctx: ServiceContext, proposalId: string): LoadProposal {
  const proposal = driverWorkflowStore.proposal(ctx.organizationId, proposalId);
  // A proposal in another organization, or another driver's under a scoped
  // membership, is NOT FOUND rather than forbidden — a 403 would confirm it
  // exists.
  if (!proposal) throw new NotFoundError("Proposal");
  const mine = callerDriverId(ctx);
  if (mine && proposal.driverId !== mine) throw new NotFoundError("Proposal");
  return proposal;
}

/* -------------------------------------------------------------------------- */
/* Trip views                                                                  */
/* -------------------------------------------------------------------------- */

function postView(
  ctx: ServiceContext,
  post: StoredPost,
  policy: CarrierDriverPolicy,
): DriverLoadPost {
  const { fullRate, ...rest } = post;
  const rate = ctx.permissions.has("rates:view")
    ? discloseEverything(fullRate)
    : discloseRate(fullRate, policy.trip.disclosedRateFields, policy.label);
  return {
    ...rest,
    rate,
    contacts: policy.trip.showCustomerContacts ? rest.contacts : [],
  };
}

function toWorkflowView(
  ctx: ServiceContext,
  workflow: DriverWorkflow,
  policy: CarrierDriverPolicy,
): DriverWorkflowView {
  const post = driverWorkflowStore.post(ctx.organizationId, workflow.postId);
  if (!post) throw new NotFoundError("Driver load post");
  const events = driverWorkflowStore.workflowEventsFor(ctx.organizationId, workflow.id);
  const projection = project(workflow, events, policy.trip);

  return {
    workflow,
    post: postView(ctx, post, policy),
    milestones: projection.milestones,
    activities: projection.activities,
    documents: projection.documents,
    timeline: [...events].sort((a, b) => {
      const byTime = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
      return byTime !== 0 ? byTime : b.sequence - a.sequence;
    }),
    suggestedMilestones: projection.suggestedMilestones,
    warnings: projection.warnings,
    completionBlockedReason: projection.completionBlockedReason,
    policy: policy.trip,
    policyLabel: policy.label,
  };
}

function findWorkflow(ctx: ServiceContext, workflowId: string): DriverWorkflow {
  const workflow = driverWorkflowStore.workflow(ctx.organizationId, workflowId);
  if (!workflow) throw new NotFoundError("Trip");
  const mine = callerDriverId(ctx);
  if (mine && workflow.driverId !== mine) throw new NotFoundError("Trip");
  return workflow;
}

/** Commands are the driver's own. Reading is not the same as acting. */
function assertIsMine(ctx: ServiceContext, driverId: string, what: string): void {
  if (ctx.driverProfileId === driverId) return;
  throw new NotYourRecordError(what);
}

/* -------------------------------------------------------------------------- */
/* Handoffs                                                                    */
/* -------------------------------------------------------------------------- */

const ACTIVITY_TARGETS: Partial<Record<string, "fuel" | "scale" | "detention" | "accounting">> = {
  fuel: "fuel",
  scale: "scale",
  detention: "detention",
  damage: "accounting",
};

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockDriverWorkflowService: DriverWorkflowService = {
  async listProposals(ctx, filters: DriverProposalFilters = {}) {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "proposals:view");
    const now = nowIso();
    const mine = callerDriverId(ctx);

    const proposals = driverWorkflowStore
      .org(ctx.organizationId)
      .proposals.filter((p) => !mine || p.driverId === mine)
      .map((p) => settleAndPersist(ctx.organizationId, p, now));

    const views = await Promise.all(
      proposals.map(async (p) =>
        toProposalView(ctx, p, await policyFor(ctx, p.driverId), now),
      ),
    );

    const inView = (view: DriverProposalView) => {
      switch (filters.view) {
        case "open":
          return view.status === "awaiting_driver_response" || view.status === "paused";
        case "answered":
          return view.status === "approved" || view.status === "rejected";
        case "closed":
          return ["withdrawn", "expired", "unavailable", "finalized"].includes(view.status);
        default:
          return true;
      }
    };

    return views
      .filter(inView)
      .filter((v) => !filters.status?.length || filters.status.includes(v.status))
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  },

  async getProposal(ctx, proposalId) {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "proposals:view");
    const now = nowIso();
    const proposal = settleAndPersist(ctx.organizationId, findProposal(ctx, proposalId), now);
    return toProposalView(ctx, proposal, await policyFor(ctx, proposal.driverId), now);
  },

  async proposalEvents(ctx, proposalId): Promise<ProposalEvent[]> {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "proposals:view");
    findProposal(ctx, proposalId);
    return driverWorkflowStore.proposalEventsFor(ctx.organizationId, proposalId);
  },

  async executeProposalCommand(ctx, command: ProposalCommand): Promise<ProposalCommandResult> {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "proposals:view", "proposals:respond");

    const now = nowIso();
    const found = findProposal(ctx, command.proposalId);
    assertIsMine(ctx, found.driverId, "proposal");
    // Settle the clock BEFORE the command, so a command never lands on a pause
    // that quietly ran out five minutes ago.
    const proposal = settleAndPersist(ctx.organizationId, found, now);
    const policy = await policyFor(ctx, proposal.driverId);

    // Same key, same effect, exactly once.
    const replayed = driverWorkflowStore.replayOf(ctx.organizationId, command.idempotencyKey);
    if (replayed) {
      const all = driverWorkflowStore.proposalEventsFor(ctx.organizationId, proposal.id);
      return {
        proposal: toProposalView(ctx, proposal, policy, now),
        events: all.filter((e) => replayed.includes(e.id)),
        replayed: true,
      };
    }

    const decision = applyProposalCommand(proposal, command, {
      actor: ctx.actor,
      source: sourceOf(ctx),
      now,
      policy: policy.proposals,
      policyLabel: policy.label,
      newId: nextId,
    });

    driverWorkflowStore.replaceProposal(ctx.organizationId, decision.next);
    const events = driverWorkflowStore.appendProposalEvents(
      ctx.organizationId,
      proposal.id,
      decision.events,
    );
    driverWorkflowStore.recordKey(
      ctx.organizationId,
      command.idempotencyKey,
      events.map((e) => e.id),
    );

    // Dispatch is on another branch. This is queued for it, not sent to it.
    const decisionName =
      command.type === "counteroffer"
        ? "countered"
        : command.type === "comment"
          ? "commented"
          : command.type === "approve"
            ? "approved"
            : command.type === "reject"
              ? "rejected"
              : "paused";

    const handoff = await integrations.opportunities.reportDriverDecision({
      organizationId: ctx.organizationId,
      opportunityRef: proposal.opportunityRef,
      decision: decisionName,
      idempotencyKey: `${command.idempotencyKey}:dispatch`,
      detail: {
        commandType: command.type,
        proposalId: proposal.id,
        status: decision.next.status,
        // Named explicitly so Dispatch can never read an approval as a booking.
        bookingConsent: decision.next.approval?.bookingConsent ?? "not_granted",
        events: events.map((e) => ({ type: e.type, occurredAt: e.occurredAt })),
      },
    });

    return {
      proposal: toProposalView(ctx, decision.next, policy, now),
      events,
      replayed: false,
      handoff,
    };
  },

  async finalize(ctx, input: FinalizeLoadInput): Promise<DriverLoadPost> {
    await ensureSeeded(ctx.organizationId);
    await wait();
    // Finalization is a Dispatch authority, not a driver one: it needs the
    // right to assign freight and to accept the paperwork behind it.
    require(ctx, "loads:assign", "documents:approve");

    const result = await finalizeLoad({
      organizationId: ctx.organizationId,
      loadId: input.loadId,
      actor: ctx.actor,
      idempotencyKey: input.idempotencyKey,
      proposalId: input.proposalId,
    });
    const policy = await policyFor(ctx, result.post.driverId);
    return postView(ctx, result.post, policy);
  },

  async listTrips(ctx): Promise<DriverTripSummary[]> {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "loads:view");
    const mine = callerDriverId(ctx);

    const workflows = driverWorkflowStore
      .org(ctx.organizationId)
      .workflows.filter((w) => !mine || w.driverId === mine);

    const summaries = await Promise.all(
      workflows.map(async (workflow): Promise<DriverTripSummary> => {
        const policy = await policyFor(ctx, workflow.driverId);
        const post = driverWorkflowStore.post(ctx.organizationId, workflow.postId)!;
        const events = driverWorkflowStore.workflowEventsFor(ctx.organizationId, workflow.id);
        const projection = project(workflow, events, policy.trip);
        const pickup = post.stops.find((s) => s.kind === "pickup") ?? post.stops[0];
        const delivery =
          [...post.stops].reverse().find((s) => s.kind === "delivery") ??
          post.stops[post.stops.length - 1];
        return {
          workflowId: workflow.id,
          postId: post.id,
          loadId: workflow.loadId,
          loadReference: workflow.loadReference,
          status: workflow.status,
          customerName: post.customerName,
          originLabel: `${pickup.address.city}, ${pickup.address.state}`,
          destinationLabel: `${delivery.address.city}, ${delivery.address.state}`,
          pickupAt: pickup.appointmentAt,
          deliveryAt: delivery.appointmentAt,
          currentMilestone: currentMilestone(projection.milestones),
          openWarnings: projection.warnings.length,
          createdAt: workflow.createdAt,
          completedAt: workflow.completedAt,
        };
      }),
    );

    return summaries.sort((a, b) => {
      // Active trips first; then most recent.
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  },

  async getTrip(ctx, workflowId) {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "loads:view");
    const workflow = findWorkflow(ctx, workflowId);
    return toWorkflowView(ctx, workflow, await policyFor(ctx, workflow.driverId));
  },

  async getTripByLoad(ctx, loadId) {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "loads:view");
    const postId = driverWorkflowStore.org(ctx.organizationId).postByLoad.get(loadId);
    const workflow = postId
      ? driverWorkflowStore
          .org(ctx.organizationId)
          .workflows.find((w) => w.postId === postId)
      : undefined;
    if (!workflow) throw new NotFoundError("Trip");
    const mine = callerDriverId(ctx);
    if (mine && workflow.driverId !== mine) throw new NotFoundError("Trip");
    return toWorkflowView(ctx, workflow, await policyFor(ctx, workflow.driverId));
  },

  async executeWorkflowCommand(ctx, command: WorkflowCommand): Promise<WorkflowCommandResult> {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "trips:execute");

    const workflow = findWorkflow(ctx, command.workflowId);
    assertIsMine(ctx, workflow.driverId, "trip");
    const policy = await policyFor(ctx, workflow.driverId);

    const replayed = driverWorkflowStore.replayOf(ctx.organizationId, command.idempotencyKey);
    if (replayed) {
      const all = driverWorkflowStore.workflowEventsFor(ctx.organizationId, workflow.id);
      return {
        workflow: toWorkflowView(ctx, workflow, policy),
        events: all.filter((e) => replayed.includes(e.id)),
        replayed: true,
        handoffs: [],
      };
    }

    const events = driverWorkflowStore.workflowEventsFor(ctx.organizationId, workflow.id);
    const projection = project(workflow, events, policy.trip);
    const now = nowIso();
    const at = command.occurredAt ?? now;

    // Everything refusable is refused here. Out-of-order milestones are not on
    // the list, and never will be.
    assertCommandAllowed(workflow, projection, command);

    const drafts: WorkflowEventDraft[] = [];
    const handoffs: PendingIntegrationEvent[] = [];
    let nextWorkflow = { ...workflow, version: workflow.version + 1 };

    switch (command.type) {
      case "record_milestone": {
        drafts.push(
          ...recordMilestoneDrafts(command, {
            actor: ctx.actor,
            source: sourceOf(ctx),
            now,
            policy: policy.trip,
          }),
        );
        if (command.milestone === "trip_completed") {
          nextWorkflow = completeWorkflow(nextWorkflow, {
            at,
            actor: ctx.actor,
            exceptionReason: command.completionExceptionReason?.trim() || undefined,
          });
          drafts.push({
            type: "workflow.completed",
            occurredAt: at,
            actor: ctx.actor,
            source: sourceOf(ctx),
            confirmation: "driver_confirmed",
            payload: {
              note: "This workflow is closed. Its timeline, documents, comments, corrections and audit history are kept in full. The next load gets its own workflow.",
              exceptionReason: command.completionExceptionReason?.trim() || undefined,
            },
          });
        }
        handoffs.push(
          await integrations.downstream.emit({
            organizationId: ctx.organizationId,
            target: "dispatch",
            operation: "trip.milestone_recorded",
            idempotencyKey: `${command.idempotencyKey}:dispatch`,
            refs: [externalRef("load", workflow.loadId, { entityId: workflow.loadId, entityKind: "load" })],
            payload: {
              workflowId: workflow.id,
              milestone: command.milestone,
              occurredAt: at,
              recordedBy: ctx.actor.displayNameSnapshot,
              // Never presented as anything other than what it is.
              confirmation: "driver_confirmed",
            },
          }),
        );
        break;
      }

      case "record_activity": {
        if (!isActivityKind(command.activity)) {
          throw new InvalidTransitionError("Record activity", workflow.status, `"${command.activity}" is not an activity this workflow knows.`);
        }
        let documentId: string | undefined;
        if (command.upload) {
          if (!policy.trip.allowReceiptUploads) {
            throw new PolicyDeniedError(
              "receipt_upload",
              `${policy.label} does not take receipts through the driver app.`,
            );
          }
          require(ctx, "documents:upload");
          const attached = await integrations.documents.attach({
            organizationId: ctx.organizationId,
            loadId: workflow.loadId,
            kind: command.activity === "scale" ? "scale_ticket" : "other",
            upload: command.upload,
            actor: ctx.actor,
            idempotencyKey: `${command.idempotencyKey}:doc`,
            at,
          });
          documentId = attached.documentId;
          drafts.push({
            type: "document.attached",
            occurredAt: at,
            actor: ctx.actor,
            source: sourceOf(ctx),
            confirmation: "driver_confirmed",
            payload: {
              documentId,
              documentKind: command.activity === "scale" ? "scale_ticket" : "other",
              fileName: command.upload.fileName,
            },
          });
          const extraction = await integrations.documents.extract({
            organizationId: ctx.organizationId,
            documentId,
            kind: command.activity === "scale" ? "scale_ticket" : "other",
          });
          drafts.push({
            type: "document.extraction_recorded",
            occurredAt: at,
            actor: { ...ctx.actor, displayNameSnapshot: "Document extraction (mock)" },
            source: "ocr",
            confirmation: "system",
            payload: { documentId, fields: extraction.fields, note: extraction.note },
          });
        }

        drafts.push({
          type: "activity.recorded",
          activity: command.activity,
          occurredAt: at,
          actor: ctx.actor,
          source: sourceOf(ctx),
          confirmation: "driver_confirmed",
          idempotencyKey: command.idempotencyKey,
          payload: { ...command.payload, documentId },
        });

        const target = ACTIVITY_TARGETS[command.activity];
        if (target) {
          handoffs.push(
            await integrations.downstream.emit({
              organizationId: ctx.organizationId,
              target,
              operation: `${command.activity}.recorded`,
              idempotencyKey: `${command.idempotencyKey}:${target}`,
              refs: [
                externalRef("load", workflow.loadId, { entityId: workflow.loadId, entityKind: "load" }),
                ...(documentId
                  ? [externalRef("document_center", documentId, { entityId: documentId, entityKind: "document" })]
                  : []),
              ],
              payload: { workflowId: workflow.id, occurredAt: at, ...command.payload },
            }),
          );
        }
        break;
      }

      case "attach_document": {
        require(ctx, "documents:upload");
        const attached = await integrations.documents.attach({
          organizationId: ctx.organizationId,
          loadId: workflow.loadId,
          kind: command.documentKind,
          upload: command.upload,
          actor: ctx.actor,
          idempotencyKey: `${command.idempotencyKey}:doc`,
          at,
        });
        drafts.push({
          type: "document.attached",
          occurredAt: at,
          actor: ctx.actor,
          source: sourceOf(ctx),
          confirmation: "driver_confirmed",
          idempotencyKey: command.idempotencyKey,
          payload: {
            documentId: attached.documentId,
            documentKind: command.documentKind,
            fileName: command.upload.fileName,
            note: command.note,
          },
        });
        const extraction = await integrations.documents.extract({
          organizationId: ctx.organizationId,
          documentId: attached.documentId,
          kind: command.documentKind,
        });
        drafts.push({
          type: "document.extraction_recorded",
          occurredAt: at,
          actor: { ...ctx.actor, displayNameSnapshot: "Document extraction (mock)" },
          source: "ocr",
          confirmation: "system",
          payload: {
            documentId: attached.documentId,
            fields: extraction.fields,
            note: extraction.note,
          },
        });

        // THE non-blocking case. Uploading the BOL when "Arrived at Shipper"
        // was never marked must succeed, and it does: the milestone rides along
        // and the missing step becomes a warning, not a refusal.
        if (command.milestone && isMilestoneKind(command.milestone)) {
          const already = projection.milestones.find((m) => m.kind === command.milestone);
          if (already?.state !== "recorded") {
            drafts.push({
              type: "milestone.recorded",
              milestone: command.milestone,
              occurredAt: at,
              actor: ctx.actor,
              source: sourceOf(ctx),
              confirmation: "driver_confirmed",
              payload: { documentId: attached.documentId, note: command.note },
            });
          }
        }

        handoffs.push(
          await integrations.downstream.emit({
            organizationId: ctx.organizationId,
            target: "document_center",
            operation: "document.attached",
            idempotencyKey: `${command.idempotencyKey}:dc`,
            refs: [
              attached.externalRef,
              externalRef("load", workflow.loadId, { entityId: workflow.loadId, entityKind: "load" }),
            ],
            payload: {
              kind: command.documentKind,
              fileName: command.upload.fileName,
              workflowId: workflow.id,
            },
          }),
        );
        break;
      }

      case "correct_extraction": {
        const doc = projection.documents.find((d) => d.documentId === command.documentId);
        if (!doc) throw new NotFoundError("Document");
        const field = doc.fields.find((f) => f.key === command.fieldKey);
        if (!field) throw new NotFoundError("Extracted field");
        drafts.push({
          type: "document.extraction_corrected",
          occurredAt: at,
          actor: ctx.actor,
          source: sourceOf(ctx),
          confirmation: "driver_confirmed",
          idempotencyKey: command.idempotencyKey,
          payload: {
            documentId: command.documentId,
            fieldKey: command.fieldKey,
            // The extracted value is carried forward, never replaced.
            extractedValue: field.extractedValue,
            correctedValue: command.correctedValue,
            note: command.note,
          },
        });
        handoffs.push(
          await integrations.documents.reportCorrection({
            organizationId: ctx.organizationId,
            documentId: command.documentId,
            fieldKey: command.fieldKey,
            extractedValue: field.extractedValue,
            correctedValue: command.correctedValue,
            actor: ctx.actor,
            idempotencyKey: `${command.idempotencyKey}:dc`,
          }),
        );
        break;
      }

      case "confirm_inference": {
        const original = events.find((e) => e.id === command.eventId);
        if (!original || original.type !== "milestone.inferred" || !original.milestone) {
          throw new NotFoundError("Inferred milestone");
        }
        drafts.push({
          type: "milestone.confirmed",
          milestone: original.milestone,
          // The driver's own timestamp when they corrected it; otherwise the
          // machine's observation stands. Neither is invented.
          occurredAt: command.occurredAtCorrection ?? original.occurredAt,
          actor: ctx.actor,
          source: sourceOf(ctx),
          confirmation: "confirmed_from_inference",
          inference: original.inference,
          idempotencyKey: command.idempotencyKey,
          correctsEventId: original.id,
          payload: {
            note:
              command.note ??
              (command.occurredAtCorrection
                ? "Confirmed, with the time corrected by the driver."
                : "Confirmed by the driver."),
          },
        });
        break;
      }

      case "reject_inference": {
        const original = events.find((e) => e.id === command.eventId);
        if (!original || original.type !== "milestone.inferred" || !original.milestone) {
          throw new NotFoundError("Inferred milestone");
        }
        drafts.push({
          type: "milestone.inference_rejected",
          milestone: original.milestone,
          occurredAt: at,
          actor: ctx.actor,
          source: sourceOf(ctx),
          confirmation: "rejected_inference",
          idempotencyKey: command.idempotencyKey,
          correctsEventId: original.id,
          payload: { note: command.reason },
        });
        break;
      }

      case "comment": {
        const body = command.body.trim();
        if (!body) throw new PolicyDeniedError("comment_empty", "A comment needs something in it.");
        drafts.push({
          type: "comment.added",
          occurredAt: at,
          actor: ctx.actor,
          source: sourceOf(ctx),
          confirmation: "driver_confirmed",
          idempotencyKey: command.idempotencyKey,
          payload: { note: body },
        });
        break;
      }
    }

    driverWorkflowStore.replaceWorkflow(ctx.organizationId, nextWorkflow);
    const created = driverWorkflowStore.appendWorkflowEvents(
      ctx.organizationId,
      nextWorkflow,
      drafts,
    );
    driverWorkflowStore.recordKey(
      ctx.organizationId,
      command.idempotencyKey,
      created.map((e) => e.id),
    );

    return {
      workflow: toWorkflowView(ctx, nextWorkflow, policy),
      events: created,
      replayed: false,
      handoffs,
    };
  },

  async ingestSignals(ctx, workflowId) {
    await ensureSeeded(ctx.organizationId);
    await wait();
    require(ctx, "loads:view");
    const workflow = findWorkflow(ctx, workflowId);
    const policy = await policyFor(ctx, workflow.driverId);
    if (workflow.status !== "active") {
      // A closed workflow takes nothing new, not even a machine's opinion.
      return toWorkflowView(ctx, workflow, policy);
    }

    const org = driverWorkflowStore.org(ctx.organizationId);
    const since = org.signalCursor.get(workflow.id);
    const signals = await integrations.signals.poll(ctx.organizationId, workflow.loadId, since);
    if (signals.length === 0) return toWorkflowView(ctx, workflow, policy);

    const events = driverWorkflowStore.workflowEventsFor(ctx.organizationId, workflow.id);
    const projection = project(workflow, events, policy.trip);
    const drafts: WorkflowEventDraft[] = [];

    for (const signal of signals) {
      if (signal.suggests.kind !== "milestone") continue;
      if (!isMilestoneKind(signal.suggests.value)) continue;
      const milestone = signal.suggests.value as MilestoneKind;
      const cell = projection.milestones.find((m) => m.kind === milestone);
      // A guess never overwrites a person, and never repeats itself.
      if (cell?.state === "recorded" || cell?.state === "inferred") continue;
      if (cell?.confirmation === "rejected_inference") continue;

      drafts.push({
        type: "milestone.inferred",
        milestone,
        occurredAt: signal.observedAt,
        actor: {
          userId: "system",
          membershipId: "system",
          displayNameSnapshot: `${signal.source.toUpperCase()} signal`,
          source: "system",
        },
        source: signal.source === "ocr" ? "ocr" : signal.source === "eld" ? "eld" : "api",
        // The whole point: recorded as inferred, with its provenance, NOT as a
        // driver action and NOT as a confirmed fact.
        confirmation: "inferred",
        inference: {
          source: signal.source,
          signalId: signal.id,
          confidence: signal.confidence,
          observedAt: signal.observedAt,
          rationale: signal.rationale,
          provenance: signal.provenance,
        },
        payload: {
          note: `${milestoneMeta(milestone).label} probably happened. ${signal.rationale}`,
        },
      });
    }

    if (drafts.length > 0) {
      driverWorkflowStore.appendWorkflowEvents(ctx.organizationId, workflow, drafts);
    }
    const latest = signals.reduce(
      (acc, s) => (new Date(s.observedAt).getTime() > new Date(acc).getTime() ? s.observedAt : acc),
      since ?? signals[0].observedAt,
    );
    org.signalCursor.set(workflow.id, latest);

    return toWorkflowView(ctx, workflow, policy);
  },

  async policy(ctx): Promise<CarrierDriverPolicy> {
    await ensureSeeded(ctx.organizationId);
    const driverId = ctx.driverProfileId;
    if (!driverId) {
      // A non-driver membership has no engagement, so there is no policy to
      // report — the honest answer is the carrier's company-driver default.
      return resolvePolicy(ctx.organizationId, "company_driver");
    }
    return policyFor(ctx, driverId);
  },

  async pendingHandoffs(ctx): Promise<PendingIntegrationEvent[]> {
    await ensureSeeded(ctx.organizationId);
    require(ctx, "loads:view");
    return integrations.downstream.pending(ctx.organizationId);
  },

  async integrationStatus(): Promise<IntegrationStatus[]> {
    return integrations.status();
  },
};

/** Re-exported so tests can reach the closed-workflow rule by name. */
export { WorkflowClosedError };

export type { DriverWorkflowEvent };
