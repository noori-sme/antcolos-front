import { beforeEach, describe, expect, it } from "vitest";
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
} from "./harness";

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
    expect(trip.milestones.every((m) => m.state === "not_reached")).toBe(true);

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

    expect(workflow.documents).toHaveLength(1);
    expect(workflow.milestones.find((m) => m.kind === "bol_uploaded")?.state).toBe("recorded");
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
    expect(skipped).toContain("start_rolling");
    expect(skipped).toContain("arrived_at_shipper");

    const warning = workflow.warnings.find(
      (w) => w.kind === "skipped_milestone" && w.milestone === "arrived_at_shipper",
    );
    expect(warning?.message).toMatch(/nothing is blocked/i);

    // And the skipped steps are offered first, because going back and recording
    // them is the shortest path to a correct record.
    expect(workflow.suggestedMilestones[0]).toBe("start_rolling");
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
    expect(cell.state).toBe("recorded");
    expect(new Date(cell.occurredAt!).getTime()).toBeLessThan(new Date(cell.recordedAt!).getTime());
    expect(workflow.warnings.some((w) => w.milestone === "arrived_at_shipper")).toBe(false);
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

    await expect(
      services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_milestone",
        workflowId: trip.workflow.id,
        milestone: "start_rolling",
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(DuplicateSubmissionError);
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

    expect(second.replayed).toBe(true);
    expect(second.events.map((e) => e.id)).toEqual(first.events.map((e) => e.id));
    const rolled = second.workflow.timeline.filter((e) => e.milestone === "start_rolling");
    expect(rolled).toHaveLength(1);
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
    expect(rests).toHaveLength(3);
    expect(rests.map((r) => r.durationMinutes).sort((a, b) => a! - b!)).toEqual([30, 45, 600]);
    // An activity is never a milestone and never a status.
    expect(view.milestones.every((m) => m.state === "not_reached")).toBe(true);
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

    expect(workflow.documents).toHaveLength(1);
    const fuel = handoffs.find((h) => h.target === "fuel")!;
    // Queued, never claimed as delivered.
    expect(fuel.state).toBe("pending_integration");
    expect(fuel.stateReason).toMatch(/nothing has been sent/i);
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
    expect(before.milestones.find((m) => m.kind === "arrived_at_shipper")?.state).toBe("skipped");

    const after = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const arrived = after.milestones.find((m) => m.kind === "arrived_at_shipper")!;

    expect(arrived.state).toBe("inferred");
    expect(arrived.confirmation).toBe("inferred");
    expect(arrived.inference?.source).toBe("geofence");
    expect(arrived.inference?.confidence).toBeCloseTo(0.82);
    expect(arrived.inference?.provenance.mock).toBe(true);
    // Not attributed to the driver.
    expect(arrived.byName).not.toBe("Sam Murtaza");

    const warning = after.warnings.find((w) => w.kind === "unconfirmed_inference");
    expect(warning?.message).toMatch(/not as something you did/i);
  });

  it("does not re-infer the same milestone on a second poll", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;

    await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const after = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);

    const inferred = after.timeline.filter((e) => e.type === "milestone.inferred");
    expect(inferred).toHaveLength(1);
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
    expect(arrived.state).toBe("recorded");
    expect(arrived.confirmation).toBe("confirmed_from_inference");
    expect(arrived.occurredAt).toBe(corrected);
    // The machine's original guess is still in the timeline, untouched.
    expect(workflow.timeline.find((e) => e.id === inferred.id)?.occurredAt)
      .toBe(inferred.occurredAt);
    expect(workflow.warnings.some((w) => w.kind === "unconfirmed_inference")).toBe(false);
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
    expect(arrived.state).toBe("skipped");
    expect(workflow.timeline.some((e) => e.type === "milestone.inference_rejected")).toBe(true);
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
    expect(weight.extractedValue).toBe("8,140");
    expect(weight.correctedValue).toBe("8,410");
    expect(weight.correctedBy?.displayNameSnapshot).toBe("Sam Murtaza");
    expect(weight.correctionNote).toMatch(/scale ticket/i);
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
    expect(after.extractedValue).toBe(pieces.extractedValue);
    expect(after.correctedValue).toBe("15");

    // Both values cross the boundary, so the Document Center never has to guess.
    const handoff = handoffs.find((h) => h.target === "document_center")!;
    expect(handoff.payload.extractedValue).toBe(pieces.extractedValue);
    expect(handoff.payload.correctedValue).toBe("15");
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
    expect(extraction.payload?.note).toMatch(/no document was read/i);
    expect(workflow.documents[0].provenance.mock).toBe(true);
  });
});

describe("closing a trip", () => {
  beforeEach(resetWorld);

  it("refuses to complete a trip with no proof of delivery", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trip = await freshTrip(ctx);
    expect(trip.completionBlockedReason).toMatch(/without one/i);

    await expect(
      services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_milestone",
        workflowId: trip.workflow.id,
        milestone: "trip_completed",
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(CompletionBlockedError);
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

    expect(workflow.workflow.status).toBe("completed");
    expect(workflow.workflow.completedAt).toBeDefined();
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

    expect(workflow.workflow.status).toBe("completed");
    // The reason is on the record, not swallowed to make the trip look clean.
    expect(workflow.workflow.completionException).toMatch(/only signed copy/i);
  });

  it("closes a completed workflow for writing and keeps every bit of it", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const done = trips.find((t) => t.status === "completed")!;
    const before = await services.driverWorkflow.getTrip(ctx, done.workflowId);

    await expect(
      services.driverWorkflow.executeWorkflowCommand(ctx, {
        type: "record_activity",
        workflowId: done.workflowId,
        activity: "note",
        payload: { note: "One more thought." },
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(WorkflowClosedError);

    const after = await services.driverWorkflow.getTrip(ctx, done.workflowId);
    expect(after.timeline).toHaveLength(before.timeline.length);
    expect(after.documents).toHaveLength(before.documents.length);
  });
});

describe("who may run a trip", () => {
  beforeEach(resetWorld);

  it("hides another organization's trip completely", async () => {
    const cascade = contextFor(CASCADE_DRIVER);
    const stonebridge = contextFor(STONEBRIDGE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(cascade);

    await expect(
      services.driverWorkflow.getTrip(stonebridge, trips[0].workflowId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a trip command from a membership without trips:execute", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(driver);
    const stripped: ServiceContext = {
      ...driver,
      permissions: new Set([...driver.permissions].filter((p) => p !== "trips:execute")),
    };

    await expect(
      services.driverWorkflow.executeWorkflowCommand(stripped, {
        type: "record_activity",
        workflowId: trips[0].workflowId,
        activity: "note",
        payload: { note: "Hello." },
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a trip command from someone who is not that driver", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(driver);
    const impostor: ServiceContext = {
      ...driver,
      driverProfileId: "drv_cs_02",
      scope: { loads: "all", financials: "all" },
    };

    await expect(
      services.driverWorkflow.executeWorkflowCommand(impostor, {
        type: "record_activity",
        workflowId: trips[0].workflowId,
        activity: "note",
        payload: { note: "Not mine." },
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(NotYourRecordError);
  });
});
