import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { integrations, integrationsAreMocked } from "@/lib/integrations";
import type { UploadDescriptor } from "@/types";
import {
  CASCADE_DRIVER, STONEBRIDGE_DRIVER, contextFor, key, resetWorld,
} from "./harness";

/**
 * The boundary's own invariants. Not "does the feature work", but "is this
 * branch still honest about what it is standing in for, and will the real
 * modules be able to recognise their own records when they arrive".
 */

const RECEIPT: UploadDescriptor = {
  fileName: "scale-ticket.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 900_000,
  capture: "camera",
};

describe("the integration boundary", () => {
  beforeEach(resetWorld);

  it("says out loud that every port is a placeholder", async () => {
    expect(integrationsAreMocked()).toBe(true);
    const status = await services.driverWorkflow.integrationStatus(contextFor(CASCADE_DRIVER));

    expect(status.length).toBeGreaterThan(0);
    expect(status.every((s) => s.mock)).toBe(true);
    expect(status.every((s) => s.adapter.startsWith("mock:"))).toBe(true);
    // Each one names the branch that owns the real thing.
    expect(status.every((s) => s.ownedBy.length > 0)).toBe(true);
  });

  it("never claims a handoff was delivered", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposals = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    const { handoff } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "approve",
      proposalId: proposals[0].id,
      idempotencyKey: key(),
    });

    expect(handoff?.state).toBe("pending_integration");
    expect(handoff?.stateReason).toMatch(/nothing has been sent, stored, verified or processed/i);

    const pending = await services.driverWorkflow.pendingHandoffs(ctx);
    expect(pending.every((p) => p.state === "pending_integration")).toBe(true);
  });

  it("tells Dispatch explicitly that an approval is not booking consent", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposals = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    const { handoff } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "approve",
      proposalId: proposals[0].id,
      idempotencyKey: key(),
    });

    expect(handoff?.operation).toBe("driver.approved");
    expect(handoff?.payload.bookingConsent).toBe("not_granted");
  });

  it("keeps the other module's own identifier on everything that crosses", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposals = await services.driverWorkflow.listProposals(ctx);
    const { handoff } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "comment",
      proposalId: proposals[0].id,
      body: "Looking now.",
      idempotencyKey: key(),
    });

    const ref = handoff!.refs[0];
    expect(ref.module).toBe("opportunity");
    // Dispatch's own id, kept verbatim rather than re-minted here.
    expect(ref.externalId).toMatch(/^opp_/);
  });

  it("does not double-write when the same handoff key arrives twice", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const sameKey = key("dup");

    const first = await integrations.downstream.emit({
      organizationId: ctx.organizationId,
      target: "accounting",
      operation: "test.emit",
      idempotencyKey: sameKey,
      refs: [],
      payload: { n: 1 },
    });
    const second = await integrations.downstream.emit({
      organizationId: ctx.organizationId,
      target: "accounting",
      operation: "test.emit",
      idempotencyKey: sameKey,
      refs: [],
      payload: { n: 2 },
    });

    expect(second.id).toBe(first.id);
    expect(second.payload.n).toBe(1);
  });

  it("links a trip document back to the canonical load record", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const fresh = trips.find((t) => t.loadReference === "SB-1042")!;

    const { handoffs } = await services.driverWorkflow.executeWorkflowCommand(ctx, {
      type: "record_activity",
      workflowId: fresh.workflowId,
      activity: "scale",
      payload: { weightLbs: 31_220 },
      upload: RECEIPT,
      idempotencyKey: key(),
    });

    const scale = handoffs.find((h) => h.target === "scale")!;
    const modules = scale.refs.map((r) => r.module);
    expect(modules).toContain("load");
    expect(modules).toContain("document_center");
    // The entity UUID, so the destination links rather than duplicates.
    expect(scale.refs.find((r) => r.module === "load")?.entityId).toBe(fresh.loadId);
  });

  it("stamps provenance on inferred milestones, marked as coming from a mock", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;

    const view = await services.driverWorkflow.ingestSignals(ctx, active.workflowId);
    const inferred = view.timeline.find((e) => e.type === "milestone.inferred")!;

    expect(inferred.inference?.provenance.mock).toBe(true);
    expect(inferred.inference?.provenance.module).toBe("geofencing");
    expect(inferred.inference?.signalId).toBeDefined();
    expect(inferred.inference?.observedAt).toBeDefined();
  });

  it("does not let one organization read another's queued handoffs", async () => {
    const cascade = contextFor(CASCADE_DRIVER);
    const stonebridge = contextFor(STONEBRIDGE_DRIVER);

    const proposals = await services.driverWorkflow.listProposals(cascade, { view: "open" });
    await services.driverWorkflow.executeProposalCommand(cascade, {
      type: "approve",
      proposalId: proposals[0].id,
      idempotencyKey: key(),
    });

    const theirs = await services.driverWorkflow.pendingHandoffs(stonebridge);
    expect(theirs.every((h) => h.organizationId === "org_stonebridge")).toBe(true);
  });
});
