import type {
  ActorRef, ExtractedField, IsoDateTime, LoadProposal, MilestoneKind,
} from "@/types";
import { integrations, seedSignal, withoutLatency } from "@/lib/integrations";
import type { InboundLoadProposal } from "@/lib/integrations/ports";
import { externalRef, mockProvenance } from "@/lib/integrations/mock/support";
import { extractionFixture } from "@/lib/integrations/mock/fixtures";
import type { WorkflowEventDraft } from "@/lib/driver-workflow/trip-machine";
import { completeWorkflow } from "@/lib/driver-workflow/trip-machine";
import {
  driverWorkflowStore, nextId,
} from "./driver-workflow-store";
import { canonicalLoad, finalizeLoad } from "./driver-workflow-finalize";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Seeds one organization's proposals, posts and trips the first time anything
 * asks for them.
 *
 * Everything here goes through the SAME code paths the product uses: proposals
 * are built from what the Opportunity boundary hands over, posts are created by
 * the real finalization gate, and timelines are written as ordinary events. A
 * fixture that skipped the gate would be a fixture that proves nothing.
 */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function driverActor(membershipId: string, name: string): ActorRef {
  return { userId: "usr_sam", membershipId, displayNameSnapshot: name, source: "web" };
}

const OFFICE_ACTOR: ActorRef = {
  userId: "usr_dispatch_mock",
  membershipId: "mem_dispatch_mock",
  displayNameSnapshot: "Dispatch (mock)",
  source: "web",
};

/* -------------------------------------------------------------------------- */
/* Proposals                                                                   */
/* -------------------------------------------------------------------------- */

function toProposal(inbound: InboundLoadProposal): LoadProposal {
  return {
    id: nextId("prop"),
    organizationId: inbound.organizationId,
    driverId: inbound.driverId,
    engagementType: inbound.engagementType,
    status: "awaiting_driver_response",
    version: 1,
    opportunityRef: inbound.opportunityRef,
    equipment: inbound.equipment,
    customerName: inbound.customerName,
    customerKind: inbound.customerKind,
    commodity: inbound.commodity,
    weightLbs: inbound.weightLbs,
    stops: inbound.stops,
    serviceWindow: inbound.serviceWindow,
    dispatchNote: inbound.dispatchNote,
    rate: inbound.rate,
    sentAt: inbound.sentAt,
    sentBy: inbound.sentBy,
    respondByAt: inbound.respondByAt,
    pauses: [],
    comments: [],
    counteroffers: [],
    provenance: inbound.provenance,
  };
}

/* -------------------------------------------------------------------------- */
/* Trip timelines                                                              */
/* -------------------------------------------------------------------------- */

interface SeedStep {
  milestone?: MilestoneKind;
  activity?: WorkflowEventDraft["activity"];
  hoursAgo: number;
  note?: string;
  durationMinutes?: number;
  amountCents?: number;
  gallons?: number;
  weightLbs?: number;
  locationLabel?: string;
  /** Attach a document with this kind, and record its extraction. */
  document?: { kind: string; fileName: string };
  /** Correct one extracted field, keeping both values. */
  correction?: { fieldKey: string; correctedValue: string; note: string };
}

/**
 * The seeded trips, by load reference.
 *
 * CS-3318 is the one worth reading: the driver never marked "Arrived at
 * Shipper", went straight to loading and uploaded the BOL, and a geofence
 * crossing later suggested the arrival. Nothing was blocked, nothing was
 * invented, and the missing step is a question rather than a hole.
 */
const TRIPS: Record<string, SeedStep[]> = {
  "CS-3318": [
    { activity: "pre_trip_inspection", hoursAgo: 6.4, note: "Walkaround done. Right rear marker light replaced before leaving." },
    { milestone: "start_rolling", hoursAgo: 6.2, locationLabel: "Portland, OR" },
    // No "Arrived at Shipper" and no "Waiting for Loading". The driver was in a
    // dead zone at the dock and picked the thread back up here.
    { milestone: "loading_started", hoursAgo: 5.1, note: "They started as soon as I backed in." },
    { milestone: "loaded", hoursAgo: 4.6, note: "14 pallets, doors sealed." },
    {
      milestone: "bol_uploaded",
      hoursAgo: 4.5,
      document: { kind: "bill_of_lading", fileName: "bol-cs-3318.jpg" },
      correction: {
        fieldKey: "weight_lbs",
        correctedValue: "8,410",
        note: "Extraction read the shipper's estimate. The scale ticket says 8,410.",
      },
    },
    { milestone: "good_to_go", hoursAgo: 4.3 },
    { activity: "fuel", hoursAgo: 3, amountCents: 18_644, gallons: 42.1, locationLabel: "Pilot #412, Albany, OR", note: "Topped off before the climb.", document: { kind: "other", fileName: "fuel-receipt-0412.jpg" } },
    { activity: "rest", hoursAgo: 2.2, durationMinutes: 30, note: "30-minute break." },
    { activity: "traffic_ahead", hoursAgo: 1.1, note: "I-5 backed up south of Salem. Might be 20 minutes late." },
  ],
  "CS-3309": [
    { milestone: "start_rolling", hoursAgo: 78 },
    { milestone: "arrived_at_shipper", hoursAgo: 76 },
    { milestone: "waiting_for_loading", hoursAgo: 75.6 },
    { milestone: "loading_started", hoursAgo: 75 },
    { milestone: "loaded", hoursAgo: 74.2 },
    { milestone: "bol_uploaded", hoursAgo: 74, document: { kind: "bill_of_lading", fileName: "bol-cs-3309.jpg" } },
    { milestone: "good_to_go", hoursAgo: 73.8 },
    { milestone: "arrived_at_receiver", hoursAgo: 70.5 },
    { milestone: "unloading_started", hoursAgo: 70 },
    { milestone: "pod_uploaded", hoursAgo: 69.2, document: { kind: "proof_of_delivery", fileName: "pod-cs-3309.jpg" } },
    { milestone: "delivered_and_unloaded", hoursAgo: 69 },
    { activity: "post_trip_inspection", hoursAgo: 68.8, note: "Nothing to report." },
    { milestone: "trip_completed", hoursAgo: 68.5 },
  ],
  // SB-1042 is finalized and has not started. It exists so the very first thing
  // an owner-operator sees is the post and a single suggestion: Start Rolling.
  "SB-1042": [],
  "SB-1036": [
    { milestone: "start_rolling", hoursAgo: 96 },
    { milestone: "arrived_at_shipper", hoursAgo: 94 },
    { milestone: "loading_started", hoursAgo: 93.4 },
    { milestone: "loaded", hoursAgo: 92.6 },
    { milestone: "bol_uploaded", hoursAgo: 92.4, document: { kind: "bill_of_lading", fileName: "bol-sb-1036.jpg" } },
    { milestone: "good_to_go", hoursAgo: 92.2 },
    { activity: "scale", hoursAgo: 91.8, weightLbs: 31_220, document: { kind: "scale_ticket", fileName: "scale-sb-1036.jpg" }, note: "Legal on all axles." },
    { milestone: "arrived_at_receiver", hoursAgo: 76 },
    { activity: "detention", hoursAgo: 75, durationMinutes: 120, note: "Two hours past the appointment before a door opened." },
    { milestone: "unloading_started", hoursAgo: 73.5 },
    { milestone: "pod_uploaded", hoursAgo: 72.6, document: { kind: "proof_of_delivery", fileName: "pod-sb-1036.jpg" } },
    { milestone: "delivered_and_unloaded", hoursAgo: 72.4 },
    { milestone: "trip_completed", hoursAgo: 72 },
  ],
};

/** Loads that are finalized in the fixture set, per organization. */
const FINALIZED_BY_ORG: Record<string, string[]> = {
  org_cascade: ["CS-3318", "CS-3309"],
  org_stonebridge: ["SB-1042", "SB-1036"],
};

const DRIVER_MEMBERSHIP: Record<string, { membershipId: string; name: string }> = {
  org_cascade: { membershipId: "mem_cascade_driver", name: "Sam Murtaza" },
  org_stonebridge: { membershipId: "mem_stonebridge_driver", name: "Sam Murtaza" },
};

async function seedTrip(
  organizationId: string,
  reference: string,
  steps: SeedStep[],
  actor: ActorRef,
): Promise<void> {
  const load = canonicalLoad(organizationId, reference);
  if (!load) return;

  // Through the real gate. A fixture that bypassed it would prove nothing.
  const { workflow } = await finalizeLoad({
    organizationId,
    loadId: load.id,
    actor: OFFICE_ACTOR,
    idempotencyKey: `seed:finalize:${reference}`,
    at: ago(steps.length > 0 ? steps[0].hoursAgo + 0.5 : 2),
  });

  let completedAt: IsoDateTime | undefined;
  let current = workflow;

  for (const step of steps) {
    const at = ago(step.hoursAgo);
    const drafts: WorkflowEventDraft[] = [];
    let documentId: string | undefined;
    let fields: ExtractedField[] = [];

    if (step.document) {
      const attached = await integrations.documents.attach({
        organizationId,
        loadId: load.id,
        kind: step.document.kind as never,
        upload: {
          fileName: step.document.fileName,
          mimeType: step.document.fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
          sizeBytes: 1_240_000,
          capture: "camera",
        },
        actor,
        idempotencyKey: `seed:${reference}:${step.document.fileName}`,
        at,
      });
      documentId = attached.documentId;
      fields = extractionFixture(step.document.kind, at);
      drafts.push({
        type: "document.attached",
        occurredAt: at,
        actor,
        source: "web",
        confirmation: "driver_confirmed",
        payload: {
          documentId,
          documentKind: step.document.kind,
          fileName: step.document.fileName,
        },
      });
      drafts.push({
        type: "document.extraction_recorded",
        occurredAt: at,
        actor: { ...actor, displayNameSnapshot: "Document extraction (mock)" },
        source: "ocr",
        confirmation: "system",
        payload: { documentId, fields },
      });
    }

    if (step.milestone) {
      drafts.push({
        type: "milestone.recorded",
        milestone: step.milestone,
        occurredAt: at,
        actor,
        source: "web",
        confirmation: "driver_confirmed",
        payload: { note: step.note, locationLabel: step.locationLabel, documentId },
      });
      if (step.milestone === "trip_completed") completedAt = at;
    }

    if (step.activity) {
      drafts.push({
        type: "activity.recorded",
        activity: step.activity,
        occurredAt: at,
        actor,
        source: "web",
        confirmation: "driver_confirmed",
        payload: {
          note: step.note,
          durationMinutes: step.durationMinutes,
          amountCents: step.amountCents,
          gallons: step.gallons,
          weightLbs: step.weightLbs,
          locationLabel: step.locationLabel,
          documentId,
        },
      });
    }

    if (step.correction && documentId) {
      const field = fields.find((f) => f.key === step.correction!.fieldKey);
      drafts.push({
        type: "document.extraction_corrected",
        occurredAt: new Date(new Date(at).getTime() + 90_000).toISOString(),
        actor,
        source: "web",
        confirmation: "driver_confirmed",
        payload: {
          documentId,
          fieldKey: step.correction.fieldKey,
          // Both values survive, here and in the handoff below.
          extractedValue: field?.extractedValue,
          correctedValue: step.correction.correctedValue,
          note: step.correction.note,
        },
      });
      await integrations.documents.reportCorrection({
        organizationId,
        documentId,
        fieldKey: step.correction.fieldKey,
        extractedValue: field?.extractedValue ?? "",
        correctedValue: step.correction.correctedValue,
        actor,
        idempotencyKey: `seed:${reference}:${step.correction.fieldKey}:corrected`,
      });
    }

    driverWorkflowStore.appendWorkflowEvents(organizationId, current, drafts);
  }

  if (completedAt) {
    current = completeWorkflow(current, { at: completedAt, actor });
    driverWorkflowStore.replaceWorkflow(organizationId, current);
  }
}

/* -------------------------------------------------------------------------- */
/* Hydration                                                                   */
/* -------------------------------------------------------------------------- */

async function seedOrganization(organizationId: string): Promise<void> {
  const org = driverWorkflowStore.org(organizationId);
  const who = DRIVER_MEMBERSHIP[organizationId];
  const actor = who ? driverActor(who.membershipId, who.name) : OFFICE_ACTOR;

  /* --- Proposals from the Opportunity boundary ------------------------- */
  const inbound = await integrations.opportunities.listInbound(organizationId);
  for (const item of inbound) {
    const exists = org.proposals.some(
      (p) => p.opportunityRef.externalId === item.opportunityRef.externalId,
    );
    if (exists) continue;
    const proposal = toProposal(item);
    org.proposals.push(proposal);
    driverWorkflowStore.appendProposalEvents(organizationId, proposal.id, [
      {
        type: "proposal.received",
        occurredAt: item.sentAt,
        actor: item.sentBy,
        source: "web",
        idempotencyKey: item.idempotencyKey,
        payload: {
          note: item.dispatchNote,
          newStatus: "awaiting_driver_response",
        },
      },
    ]);
  }

  /* --- Finalized loads, through the real gate --------------------------- */
  for (const reference of FINALIZED_BY_ORG[organizationId] ?? []) {
    await seedTrip(organizationId, reference, TRIPS[reference] ?? [], actor);
  }

  /* --- A machine's opinion, waiting for a person ------------------------ */
  // The geofence noticed the truck inside the shipper's fence at a moment the
  // driver never marked anything. It SUGGESTS the arrival. It is recorded as
  // inferred, with its source, time and confidence, and it stays that way until
  // Sam confirms or corrects it.
  if (organizationId === "org_cascade") {
    const load = canonicalLoad(organizationId, "CS-3318");
    if (load) {
      seedSignal(organizationId, {
        id: nextId("sig"),
        source: "geofence",
        loadId: load.id,
        observedAt: ago(5.4),
        confidence: 0.82,
        suggests: { kind: "milestone", value: "arrived_at_shipper" },
        rationale:
          "The truck was inside the Pacline Cross-dock geofence for 26 minutes before loading was recorded.",
        provenance: mockProvenance("geofencing", { observedAt: ago(5.4), confidence: 0.82 }),
      });
    }
  }
}

/** Called by every service method before it reads anything. Runs once per org. */
export function ensureSeeded(organizationId: string): Promise<void> {
  return driverWorkflowStore.hydrate(organizationId, () =>
    withoutLatency(() => seedOrganization(organizationId)),
  );
}

/** Test hook. Never called by the UI. */
export { externalRef as seedExternalRef };
