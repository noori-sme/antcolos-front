import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { services } from "@/lib/api";
import {
  CompletionBlockedError, DuplicateSubmissionError, NotYourRecordError,
  WorkflowClosedError,
} from "@/lib/driver-workflow/errors";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { DriverWorkflowView, UploadDescriptor } from "@/types";
import {
  CASCADE_DRIVER, STONEBRIDGE_DRIVER, contextFor, key, resetWorld,
} from "./driver-workflow-harness";

const PHOTO: UploadDescriptor = {
  fileName: "bol.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 1_420_000,
  capture: "camera",
};

/** The Stonebridge trip that has been finalized and not yet started. */
async function freshTrip(ctx: ServiceContext): Promise<DriverWorkflowView> {
  const trips = await services.driverWorkflow.listTrips(ctx);
  const fresh = trips.find((t) => t.loadReference === "SB-1042")!;
  return services.driverWorkflow.getTrip(ctx, fresh.workflowId);
}

describe("milestones are markers, not a gate", () => {
  beforeEach(resetWorld);

  it("accepts a BOL upload from a driver who never marked Arrived at Shipper", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);
    assert.equal(trip.milestones.every((m) => m.state === "not_reached"), true);

    // The exact scenario from the brief: straight to the document, nothing
    // before it recorded. It must succeed.
    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "attach_document",
      workflowId: trip.workflow.id,
      documentKind: "bill_of_lading",
      upload: PHOTO,
      milestone: "bol_uploaded",
      idempotencyKey: key(),
    });

    assert.equal(workflow.documents.length, 1);
    assert.equal(workflow.milestones.find((m) => m.kind === "bol_uploaded")?.state, "recorded");
  });

  it("marks the passed-over steps as skipped and says so without blocking anything", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "loaded",
      idempotencyKey: key(),
    });

    const skipped = workflow.milestones.filter((m) => m.state === "skipped").map((m) => m.kind);
    assert.ok(skipped.includes("start_rolling"));
    assert.ok(skipped.includes("arrived_at_shipper"));

    const warning = workflow.warnings.find(
      (w) => w.kind === "skipped_milestone" && w.milestone === "arrived_at_shipper",
    );
    assert.match(warning?.message ?? "", /nothing is blocked/i);

    // And the skipped steps are offered first, because going back and recording
    // them is the shortest path to a correct record.
    assert.equal(workflow.suggestedMilestones[0], "start_rolling");
  });

  it("lets the driver go back and record a step they passed over", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "loaded",
      idempotencyKey: key(),
    });
    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "arrived_at_shipper",
      // Recorded now, but it happened two hours ago. Both times are kept.
      occurredAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      idempotencyKey: key(),
    });

    const cell = workflow.milestones.find((m) => m.kind === "arrived_at_shipper")!;
    assert.equal(cell.state, "recorded");
    assert.ok(new Date(cell.occurredAt!).getTime() < new Date(cell.recordedAt!).getTime());
    assert.equal(workflow.warnings.some((w) => w.milestone === "arrived_at_shipper"), false);
  });

  it("refuses the same milestone twice", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "start_rolling",
      idempotencyKey: key(),
    });

    await assert.rejects(
      services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_milestone",
        workflowId: trip.workflow.id,
        milestone: "start_rolling",
        idempotencyKey: key(),
      }),
      DuplicateSubmissionError,
    );
  });

  it("treats a retry of the same command as one event", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);
    const sameKey = key("flaky-phone");

    const first = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "start_rolling",
      idempotencyKey: sameKey,
    });
    const second = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "start_rolling",
      idempotencyKey: sameKey,
    });

    assert.equal(second.replayed, true);
    assert.deepEqual(second.events.map((e) => e.id), first.events.map((e) => e.id));
    const rolled = second.workflow.timeline.filter((e) => e.milestone === "start_rolling");
    assert.equal(rolled.length, 1);
  });
});

describe("repeatable activities", () => {
  beforeEach(resetWorld);

  it("records several of the same kind without any of them replacing another", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    for (const minutes of [30, 45, 600]) {
      await services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_activity",
        workflowId: trip.workflow.id,
        activity: "rest",
        payload: { durationMinutes: minutes },
        idempotencyKey: key(),
      });
    }

    const view = await services.driverWorkflow.getTrip(ctx, trip.workflow.id);
    const rests = view.activities.filter((a) => a.kind === "rest");
    assert.equal(rests.length, 3);
    assert.deepEqual(rests.map((r) => r.durationMinutes).sort((a, b) => a! - b!), [30, 45, 600]);
    // An activity is never a milestone and never a status.
    assert.equal(view.milestones.every((m) => m.state === "not_reached"), true);
  });

  it("takes a receipt with a fuel stop and queues it for the modules that want it", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    const { workflow, handoffs } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_activity",
      workflowId: trip.workflow.id,
      activity: "fuel",
      payload: { amountCents: 21_455, gallons: 48.2 },
      upload: { ...PHOTO, fileName: "fuel-receipt.jpg" },
      idempotencyKey: key(),
    });

    assert.equal(workflow.documents.length, 1);
    const fuel = handoffs.find((h) => h.target === "fuel")!;
    // Queued, never claimed as delivered.
    assert.equal(fuel.state, "pending_integration");
    assert.match(fuel.stateReason, /nothing has been sent/i);
  });
});

describe("a machine's opinion is not a driver's action", () => {
  beforeEach(resetWorld);

  it("records a geofence suggestion as inferred, with its source and confidence", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;

    const before = await services.driverWorkflow.getTrip(ctx, active.workflowId);
    // The driver went straight from Start Rolling to Loading Started.
    assert.equal(before.milestones.find((m) => m.kind === "arrived_at_shipper")?.state, "skipped");

    const after = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const arrived = after.milestones.find((m) => m.kind === "arrived_at_shipper")!;

    assert.equal(arrived.state, "inferred");
    assert.equal(arrived.confirmation, "inferred");
    assert.equal(arrived.inference?.source, "geofence");
    assert.ok(Math.abs((arrived.inference?.confidence) - (0.82)) < 0.005);
    assert.equal(arrived.inference?.provenance.mock, true);
    // Not attributed to the driver.
    assert.notEqual(arrived.byName, "Sam Murtaza");

    const warning = after.warnings.find((w) => w.kind === "unconfirmed_inference");
    assert.match(warning?.message ?? "", /not as something you did/i);
  });

  it("does not re-infer the same milestone on a second poll", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;

    await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const after = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);

    const inferred = after.timeline.filter((e) => e.type === "milestone.inferred");
    assert.equal(inferred.length, 1);
  });

  it("lets the driver confirm an inference, correcting the time the machine guessed", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;
    const view = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const inferred = view.timeline.find((e) => e.type === "milestone.inferred")!;

    const corrected = new Date(new Date(inferred.occurredAt).getTime() - 12 * 60_000).toISOString();
    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "confirm_inference",
      workflowId: active.workflowId,
      eventId: inferred.id,
      occurredAtCorrection: corrected,
      note: "I was on the property, the gate reader just missed me.",
      idempotencyKey: key(),
    });

    const arrived = workflow.milestones.find((m) => m.kind === "arrived_at_shipper")!;
    assert.equal(arrived.state, "recorded");
    assert.equal(arrived.confirmation, "confirmed_from_inference");
    assert.equal(arrived.occurredAt, corrected);
    // The machine's original guess is still in the timeline, untouched.
    assert.equal(
      workflow.timeline.find((e) => e.id === inferred.id)?.occurredAt,
      inferred.occurredAt,
    );
    assert.equal(workflow.warnings.some((w) => w.kind === "unconfirmed_inference"), false);
  });

  it("lets the driver say it did not happen, and does not quietly re-infer it", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;
    const view = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const inferred = view.timeline.find((e) => e.type === "milestone.inferred")!;

    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "reject_inference",
      workflowId: active.workflowId,
      eventId: inferred.id,
      reason: "That was the truck stop next door, not the shipper.",
      idempotencyKey: key(),
    });

    const arrived = workflow.milestones.find((m) => m.kind === "arrived_at_shipper")!;
    assert.equal(arrived.state, "skipped");
    assert.equal(workflow.timeline.some((e) => e.type === "milestone.inference_rejected"), true);
  });
});

describe("documents and corrections", () => {
  beforeEach(resetWorld);

  it("keeps the extracted value and the driver's correction side by side", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;
    const view = await services.driverWorkflow.getTrip(ctx, active.workflowId);

    const bol = view.documents.find((d) => d.kind === "bill_of_lading")!;
    const weight = bol.fields.find((f) => f.key === "weight_lbs")!;

    // Seeded through the same correction command a driver uses.
    assert.equal(weight.extractedValue, "8,140");
    assert.equal(weight.correctedValue, "8,410");
    assert.equal(weight.correctedBy?.displayNameSnapshot, "Sam Murtaza");
    assert.match(weight.correctionNote ?? "", /scale ticket/i);
  });

  it("records a new correction without overwriting what the extractor read", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;
    const before = await services.driverWorkflow.getTrip(ctx, active.workflowId);
    const bol = before.documents.find((d) => d.kind === "bill_of_lading")!;
    const pieces = bol.fields.find((f) => f.key === "pieces")!;

    const { workflow, handoffs } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "correct_extraction",
      workflowId: active.workflowId,
      documentId: bol.documentId,
      fieldKey: "pieces",
      correctedValue: "15",
      note: "One was loaded after the count.",
      idempotencyKey: key(),
    });

    const after = workflow.documents
      .find((d) => d.documentId === bol.documentId)!
      .fields.find((f) => f.key === "pieces")!;
    assert.equal(after.extractedValue, pieces.extractedValue);
    assert.equal(after.correctedValue, "15");

    // Both values cross the boundary, so the Document Center never has to guess.
    const handoff = handoffs.find((h) => h.target === "document_center")!;
    assert.equal(handoff.payload.extractedValue, pieces.extractedValue);
    assert.equal(handoff.payload.correctedValue, "15");
  });

  it("is honest that nothing was actually read", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "attach_document",
      workflowId: trip.workflow.id,
      documentKind: "bill_of_lading",
      upload: PHOTO,
      idempotencyKey: key(),
    });

    const extraction = workflow.timeline.find((e) => e.type === "document.extraction_recorded")!;
    assert.match(extraction.payload?.note ?? "", /no document was read/i);
    assert.equal(workflow.documents[0].provenance.mock, true);
  });
});

describe("closing a trip", () => {
  beforeEach(resetWorld);

  it("refuses to complete a trip with no proof of delivery", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);
    assert.match(trip.completionBlockedReason ?? "", /without one/i);

    await assert.rejects(
      services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_milestone",
        workflowId: trip.workflow.id,
        milestone: "trip_completed",
        idempotencyKey: key(),
      }),
      CompletionBlockedError,
    );
  });

  it("completes once the POD is on it", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "attach_document",
      workflowId: trip.workflow.id,
      documentKind: "proof_of_delivery",
      upload: { ...PHOTO, fileName: "pod.jpg" },
      milestone: "pod_uploaded",
      idempotencyKey: key(),
    });

    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "trip_completed",
      idempotencyKey: key(),
    });

    assert.equal(workflow.workflow.status, "completed");
    assert.notEqual(workflow.workflow.completedAt, undefined);
  });

  it("completes without a POD when the driver records why", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);

    const { workflow } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_milestone",
      workflowId: trip.workflow.id,
      milestone: "trip_completed",
      completionExceptionReason:
        "Receiver kept the only signed copy. Keystone is emailing it to the office.",
      idempotencyKey: key(),
    });

    assert.equal(workflow.workflow.status, "completed");
    // The reason is on the record, not swallowed to make the trip look clean.
    assert.match(workflow.workflow.completionException ?? "", /only signed copy/i);
  });

  it("closes a completed workflow for writing and keeps every bit of it", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const done = trips.find((t) => t.status === "completed")!;
    const before = await services.driverWorkflow.getTrip(ctx, done.workflowId);

    await assert.rejects(
      services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_activity",
        workflowId: done.workflowId,
        activity: "note",
        payload: { note: "One more thought." },
        idempotencyKey: key(),
      }),
      WorkflowClosedError,
    );

    const after = await services.driverWorkflow.getTrip(ctx, done.workflowId);
    assert.equal(after.timeline.length, before.timeline.length);
    assert.equal(after.documents.length, before.documents.length);
  });
});

describe("who may run a trip", () => {
  beforeEach(resetWorld);

  it("hides another organization's trip completely", async () => {
    const cascade = contextFor(CASCADE_DRIVER);
    const stonebridge = contextFor(STONEBRIDGE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(cascade);

    await assert.rejects(
      services.driverWorkflow.getTrip(stonebridge, trips[0].workflowId),
      NotFoundError,
    );
  });

  it("refuses a trip command from a membership without trips:execute", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(driver);
    const stripped: ServiceContext = {
      ...driver,
      permissions: new Set([...driver.permissions].filter((p) => p !== "trips:execute")),
    };

    await assert.rejects(
      services.driverWorkflow.executeWorkflowCommand(stripped, {
        type: "record_activity",
        workflowId: trips[0].workflowId,
        activity: "note",
        payload: { note: "Hello." },
        idempotencyKey: key(),
      }),
      PermissionDeniedError,
    );
  });

  it("refuses a trip command from someone who is not that driver", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(driver);
    const impostor: ServiceContext = {
      ...driver,
      driverProfileId: "drv_cs_02",
      scope: { loads: "all", financials: "all" },
    };

    await assert.rejects(
      services.driverWorkflow.executeWorkflowCommand(impostor, {
        type: "record_activity",
        workflowId: trips[0].workflowId,
        activity: "note",
        payload: { note: "Not mine." },
        idempotencyKey: key(),
      }),
      NotYourRecordError,
    );
  });
});
