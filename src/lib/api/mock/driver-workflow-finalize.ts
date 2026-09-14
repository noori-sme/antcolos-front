import type {
  ActorRef, DriverStopView, DriverWorkflow, ExternalRef, IsoDateTime, Load,
  PendingIntegrationEvent, Stop,
} from "@/types";
import { destinationStop, originStop } from "@/types";
import { integrations } from "@/lib/integrations";
import { externalRef, mockProvenance } from "@/lib/integrations/mock/support";
import type { RateConfirmationState } from "@/lib/integrations/ports";
import { FinalizationBlockedError } from "@/lib/driver-workflow/errors";
import {
  markFinalized, markUnavailable, windowsOverlap,
} from "@/lib/driver-workflow/proposal-machine";
import {
  driverWorkflowStore, nextId, type StoredPost,
} from "./driver-workflow-store";
import { mockStore } from "./store";

/**
 * Finalization: the one place a Driver Load Post comes into existence.
 *
 * In Antcolos a load is not final until its rate confirmation has been reviewed
 * and approved by Dispatch, signed with the authorized carrier signature, and
 * sent back to the broker. All three are read from the Rate Confirmation module
 * through the boundary; none of them is decided here, and none of them can be
 * skipped by calling this function directly.
 */

/** Exactly what is still missing, in the words Dispatch would use. */
export function finalizationBlockers(rc: RateConfirmationState | undefined): string[] {
  if (!rc) return ["there is no rate confirmation on this load yet"];
  const missing: string[] = [];
  if (!rc.reviewedByDispatch) missing.push("dispatch has not reviewed and approved the rate confirmation");
  if (!rc.carrierSignature.signed) missing.push("it has not been signed with the authorized carrier signature");
  if (!rc.sentToBroker.sent) missing.push("it has not been sent back to the broker");
  return missing;
}

function stopView(stop: Stop): DriverStopView {
  return {
    stopId: stop.id,
    kind: stop.kind,
    sequence: stop.sequence,
    facilityName: stop.facilityName,
    address: stop.address,
    timeZone: stop.timeZone,
    appointmentType: stop.appointmentType,
    appointmentAt: stop.appointmentAt,
    appointmentEndAt: stop.appointmentEndAt,
    instructions: stop.instructions,
    contact: stop.contact,
    referenceNumbers: stop.referenceNumbers ?? [],
  };
}

/** The span the load occupies, used to decide which proposals now conflict. */
export function loadServiceWindow(load: Load): { startAt: IsoDateTime; endAt: IsoDateTime } {
  const first = originStop(load);
  const last = destinationStop(load);
  return {
    startAt: first.appointmentAt,
    endAt: last.appointmentEndAt ?? last.appointmentAt,
  };
}

export interface FinalizeResult {
  post: StoredPost;
  workflow: DriverWorkflow;
  /** Proposals that became Unavailable because this load won the slot. */
  supersededProposalIds: string[];
  handoffs: PendingIntegrationEvent[];
}

/**
 * Create the post and its workflow. Called by the service, and by the seed so
 * that fixture data goes through exactly the same gate real data will.
 */
export async function finalizeLoad(input: {
  organizationId: string;
  loadId: string;
  actor: ActorRef;
  idempotencyKey: string;
  /** The proposal this load came from, when it came from one. */
  proposalId?: string;
  at?: IsoDateTime;
}): Promise<FinalizeResult> {
  const { organizationId, loadId, actor } = input;
  const at = input.at ?? new Date().toISOString();
  const org = driverWorkflowStore.org(organizationId);

  // Finalizing the same load twice returns the same post. Retries are safe.
  const existingPostId = org.postByLoad.get(loadId);
  if (existingPostId) {
    const post = driverWorkflowStore.post(organizationId, existingPostId)!;
    const workflow = org.workflows.find((w) => w.id === post.workflowId)!;
    return { post, workflow, supersededProposalIds: [], handoffs: [] };
  }

  const load = await integrations.loadSource.getLoad(organizationId, loadId);
  if (!load) throw new FinalizationBlockedError(["the load could not be read"]);

  const rc = await integrations.loadSource.getRateConfirmation(organizationId, loadId);
  const blockers = finalizationBlockers(rc);
  // THE gate. No post, no workflow, nothing for a driver to start rolling on.
  if (blockers.length > 0 || !rc) throw new FinalizationBlockedError(blockers);

  const assignment = await integrations.assignments.getForLoad(organizationId, loadId);
  if (!assignment) {
    throw new FinalizationBlockedError(["no driver is assigned to it"]);
  }

  const engagementType = await integrations.assignments.engagementType(
    organizationId,
    assignment.driverId,
  );

  const workflowId = nextId("wf");
  const postId = nextId("post");

  const externalRefs: ExternalRef[] = [
    externalRef("load", load.id, { entityId: load.id, entityKind: "load" }),
    rc.documentRef,
    assignment.assignmentRef,
  ];
  if (assignment.truckId) {
    externalRefs.push(externalRef("assignment", assignment.truckId, { entityId: assignment.truckId, entityKind: "truck" }));
  }
  if (assignment.trailerId) {
    externalRefs.push(externalRef("assignment", assignment.trailerId, { entityId: assignment.trailerId, entityKind: "trailer" }));
  }

  const instructions = load.stops
    .map((s) => s.instructions)
    .filter((s): s is string => Boolean(s));

  const post: StoredPost = {
    id: postId,
    organizationId,
    loadId: load.id,
    loadReference: load.reference,
    driverId: assignment.driverId,
    engagementType,
    workflowId,
    customerName: load.customer.name,
    customerKind: load.customer.kind,
    stops: [...load.stops].sort((a, b) => a.sequence - b.sequence).map(stopView),
    equipment: {
      type: load.equipment,
      truckId: assignment.truckId,
      truckUnit: assignment.truckUnit,
      trailerId: assignment.trailerId,
      trailerUnit: assignment.trailerUnit,
    },
    loadDetails: {
      weightLbs: load.weightLbs,
      commodity: load.commodity,
      temperatureF: load.temperatureF,
    },
    instructions,
    contacts: [
      {
        role: `${load.customer.kind === "broker" ? "Broker" : "Shipper"} — ${load.customer.name}`,
        name: load.customer.contact?.name,
        phone: load.customer.contact?.phone,
        email: load.customer.contact?.email,
      },
      ...load.stops
        .filter((s) => s.contact)
        .map((s) => ({
          role: `${s.kind === "pickup" ? "Pickup" : "Delivery"} — ${s.facilityName ?? s.address.city}`,
          name: s.contact?.name,
          phone: s.contact?.phone,
          email: s.contact?.email,
        })),
    ],
    // The full rate is stored; what a driver sees of it is decided on read.
    fullRate: {
      currency: load.financials?.currency ?? "USD",
      linehaulCents: load.financials?.linehaulCents ?? 0,
      totalRateCents: load.financials?.totalRateCents ?? 0,
      ratePerMileCents: load.financials?.ratePerMileCents ?? 0,
      driverShareCents: load.financials?.driverShareCents,
      loadedMiles: load.financials?.loadedMiles ?? 0,
      deadheadMiles: load.financials?.deadheadMiles ?? 0,
      accessorials: (load.financials?.accessorials ?? []).map((a) => ({
        code: a.code,
        label: a.label,
        amountCents: a.amountCents,
      })),
    },
    finalizedAt: at,
    finalizedBy: actor,
    rateConfirmationRef: rc.documentRef,
    externalRefs,
    provenance: mockProvenance("rate_confirmation", { observedAt: at, externalId: rc.documentRef.externalId }),
  };

  const workflow: DriverWorkflow = {
    id: workflowId,
    organizationId,
    loadId: load.id,
    loadReference: load.reference,
    driverId: assignment.driverId,
    postId,
    status: "active",
    createdAt: at,
    createdBy: actor,
    version: 1,
  };

  org.posts.push(post);
  org.postByLoad.set(load.id, postId);
  driverWorkflowStore.replaceWorkflow(organizationId, workflow);
  driverWorkflowStore.appendWorkflowEvents(organizationId, workflow, [
    {
      type: "workflow.created",
      occurredAt: at,
      actor,
      source: "web",
      confirmation: "system",
      idempotencyKey: input.idempotencyKey,
      payload: {
        note: `Rate confirmation ${rc.documentRef.externalId} was reviewed, signed and sent to the broker. This trip is the only workflow for ${load.reference}.`,
      },
    },
  ]);

  /* ---- Overlapping proposals become Unavailable ------------------------- */

  const window = loadServiceWindow(load);
  const superseded: string[] = [];
  for (const proposal of org.proposals) {
    if (input.proposalId && proposal.id === input.proposalId) continue;
    if (proposal.status === "finalized") continue;

    const sameDriver = proposal.driverId === assignment.driverId;
    const sameEquipment =
      (Boolean(assignment.truckId) && proposal.equipment.truckId === assignment.truckId) ||
      (Boolean(assignment.trailerId) && proposal.equipment.trailerId === assignment.trailerId);
    if (!sameDriver && !sameEquipment) continue;
    if (!windowsOverlap(proposal.serviceWindow, window)) continue;

    const decision = markUnavailable(proposal, {
      at,
      conflictingLoadId: load.id,
      conflictKind: sameDriver ? "driver" : "equipment",
      reason: sameDriver
        ? `${load.reference} was finalized over the same hours, so this one can no longer be run.`
        : `${load.reference} was finalized on the same equipment, so this one can no longer be run.`,
    });
    if (decision.events.length === 0) continue;
    driverWorkflowStore.replaceProposal(organizationId, decision.next);
    driverWorkflowStore.appendProposalEvents(organizationId, proposal.id, decision.events);
    superseded.push(proposal.id);
  }

  // The proposal this load came from is closed as finalized, not as unavailable.
  if (input.proposalId) {
    const source = driverWorkflowStore.proposal(organizationId, input.proposalId);
    if (source && source.status !== "finalized") {
      const decision = markFinalized(source, { at, loadId: load.id, actor });
      driverWorkflowStore.replaceProposal(organizationId, {
        ...decision.next,
        loadRef: externalRef("load", load.id, { entityId: load.id, entityKind: "load" }),
      });
      driverWorkflowStore.appendProposalEvents(organizationId, source.id, decision.events);
    }
  }

  /* ---- Tell the modules that will care --------------------------------- */

  const handoffs = await Promise.all([
    integrations.downstream.emit({
      organizationId,
      target: "notifications",
      operation: "driver.load_post_published",
      idempotencyKey: `${input.idempotencyKey}:notify`,
      refs: externalRefs,
      payload: { driverId: assignment.driverId, loadReference: load.reference, workflowId },
    }),
    integrations.downstream.emit({
      organizationId,
      target: "dispatch",
      operation: "driver.workflow_started",
      idempotencyKey: `${input.idempotencyKey}:dispatch`,
      refs: externalRefs,
      payload: { workflowId, postId, supersededProposalIds: superseded },
    }),
  ]);

  return { post, workflow, supersededProposalIds: superseded, handoffs };
}

/** Reads a load straight from the canonical store. Used by the seed. */
export function canonicalLoad(organizationId: string, reference: string): Load | undefined {
  return mockStore.org(organizationId).loads.find((l) => l.reference === reference);
}
