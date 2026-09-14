import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { services } from "@/lib/api";
import { canonicalLoad } from "@/lib/api/mock/driver-workflow-finalize";
import {
  FinalizationBlockedError, InvalidTransitionError,
} from "@/lib/driver-workflow/errors";
import type { ServiceContext } from "@/lib/api/contracts/context";
import {
  CASCADE_DRIVER, STONEBRIDGE_DRIVER, contextFor, key, resetWorld,
} from "./driver-workflow-harness";

/**
 * A load is not final until its rate confirmation has been reviewed and
 * approved by Dispatch, signed with the authorized carrier signature, and sent
 * back to the broker. Only then does a Driver Load Post exist.
 */

/** A dispatch-capable caller inside the driver's own organization. */
function dispatcherIn(driverMembership: string): ServiceContext {
  const base = contextFor(driverMembership);
  return {
    ...base,
    scope: { loads: "all", financials: "all" },
    driverProfileId: undefined,
    permissions: new Set([
      ...base.permissions,
      "loads:assign" as const,
      "documents:approve" as const,
    ]),
  };
}

describe("the finalization gate", () => {
  beforeEach(resetWorld);

  it("refuses a load whose rate confirmation was never sent back to the broker", async () => {
    const ctx = dispatcherIn(CASCADE_DRIVER);
    // CS-3324: reviewed and signed, but not sent. Two out of three is not final.
    const load = canonicalLoad("org_cascade", "CS-3324")!;

    await assert.rejects(
      services.driverWorkflow.finalize(ctx, { loadId: load.id, idempotencyKey: key() }),
      FinalizationBlockedError,
    );

    await assert.rejects(
      services.driverWorkflow.finalize(ctx, { loadId: load.id, idempotencyKey: key() }),
      /sent back to the broker/,
    );
  });

  it("refuses a load whose rate confirmation is unreviewed and unsigned", async () => {
    const ctx = dispatcherIn(CASCADE_DRIVER);
    const load = canonicalLoad("org_cascade", "CS-3321")!;

    await assert.rejects(
      services.driverWorkflow.finalize(ctx, { loadId: load.id, idempotencyKey: key() }),
      /reviewed and approved/,
    );
  });

  it("produces the authorized post once all three conditions are met", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const active = trips.find((t) => t.loadReference === "CS-3318")!;
    const view = await services.driverWorkflow.getTrip(ctx, active.workflowId);

    assert.equal(view.post.rateConfirmationRef.module, "rate_confirmation");
    assert.ok(view.post.stops.length >= 2);
    assert.equal(view.post.stops[0].kind, "pickup");
    // Every reference the destination modules will need to link back up.
    assert.ok(view.post.externalRefs.map((r) => r.module).includes("load"));
    assert.ok(view.post.externalRefs.map((r) => r.module).includes("assignment"));
  });

  it("returns the same post when the same load is finalized twice", async () => {
    const ctx = dispatcherIn(CASCADE_DRIVER);
    await services.driverWorkflow.listTrips(contextFor(CASCADE_DRIVER));
    const load = canonicalLoad("org_cascade", "CS-3318")!;

    const again = await services.driverWorkflow.finalize(ctx, {
      loadId: load.id,
      idempotencyKey: key(),
    });
    const trips = await services.driverWorkflow.listTrips(contextFor(CASCADE_DRIVER));

    // No second post, no second workflow, no duplicated timeline.
    assert.equal(trips.filter((t) => t.loadReference === "CS-3318").length, 1);
    assert.equal(again.workflowId, trips.find((t) => t.loadReference === "CS-3318")!.workflowId);
  });

  it("requires dispatch authority, not a driver's", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const load = canonicalLoad("org_cascade", "CS-3318")!;

    await assert.rejects(
      services.driverWorkflow.finalize(driver, { loadId: load.id, idempotencyKey: key() }),
      /Missing permission/,
    );
  });
});

describe("overlapping proposals when a load is finalized", () => {
  beforeEach(resetWorld);

  it("makes every overlapping proposal Unavailable and keeps everything on them", async () => {
    const driver = contextFor(STONEBRIDGE_DRIVER);
    const open = await services.driverWorkflow.listProposals(driver, { view: "open" });
    // Both sit over the same Richmond hours on the same truck. Only one of them
    // can ever be run, and SB-1048 is about to take the slot from both.
    const winner = open.find((p) => p.customerName === "Keystone Brokerage")!;
    const loser = open.find((p) => p.customerName === "Hartline Manufacturing")!;

    await services.driverWorkflow.executeProposalCommand(driver, {
      type: "comment",
      proposalId: loser.id,
      body: "Interested if the Keystone one falls through.",
      idempotencyKey: key(),
    });
    await services.driverWorkflow.executeProposalCommand(driver, {
      type: "counteroffer",
      proposalId: loser.id,
      kind: "rate",
      proposedAmountCents: 180_000,
      message: "Long day; I would need $1,800.",
      idempotencyKey: key(),
    });

    const ctx = dispatcherIn(STONEBRIDGE_DRIVER);
    const load = canonicalLoad("org_stonebridge", "SB-1048")!;
    await services.driverWorkflow.finalize(ctx, {
      loadId: load.id,
      proposalId: winner.id,
      idempotencyKey: key(),
    });

    const after = await services.driverWorkflow.getProposal(driver, loser.id);
    assert.equal(after.status, "unavailable");
    assert.equal(after.unavailability?.conflictKind, "driver");
    assert.equal(after.unavailability?.conflictingLoadId, load.id);
    // Preserved in full. Becoming unavailable deletes nothing.
    assert.equal(after.comments.length, 1);
    assert.equal(after.counteroffers.length, 1);

    const events = await services.driverWorkflow.proposalEvents(driver, loser.id);
    assert.ok(events.map((e) => e.type).includes("proposal.counteroffer_submitted"));
    assert.ok(events.map((e) => e.type).includes("proposal.marked_unavailable"));
  });

  it("refuses any further answer on an unavailable proposal", async () => {
    const driver = contextFor(STONEBRIDGE_DRIVER);
    const open = await services.driverWorkflow.listProposals(driver, { view: "open" });
    const loser = open.find((p) => p.customerName === "Hartline Manufacturing")!;

    const ctx = dispatcherIn(STONEBRIDGE_DRIVER);
    await services.driverWorkflow.finalize(ctx, {
      loadId: canonicalLoad("org_stonebridge", "SB-1048")!.id,
      idempotencyKey: key(),
    });

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(driver, {
        type: "approve",
        proposalId: loser.id,
        idempotencyKey: key(),
      }),
      InvalidTransitionError,
    );
  });

  it("closes the winning proposal as finalized rather than unavailable", async () => {
    const driver = contextFor(STONEBRIDGE_DRIVER);
    const open = await services.driverWorkflow.listProposals(driver, { view: "open" });
    const winner = open.find((p) => p.customerName === "Keystone Brokerage")!;

    const ctx = dispatcherIn(STONEBRIDGE_DRIVER);
    await services.driverWorkflow.finalize(ctx, {
      loadId: canonicalLoad("org_stonebridge", "SB-1048")!.id,
      proposalId: winner.id,
      idempotencyKey: key(),
    });

    const after = await services.driverWorkflow.getProposal(driver, winner.id);
    assert.equal(after.status, "finalized");
  });

  it("leaves proposals outside the finalized load's hours alone", async () => {
    // CS-3318 was finalized during seeding. Cascade's two open proposals both
    // start long after it delivers, so neither may be touched by it.
    const driver = contextFor(CASCADE_DRIVER);
    const all = await services.driverWorkflow.listProposals(driver);

    assert.ok(all.length > 0);
    assert.equal(all.every((p) => p.status === "awaiting_driver_response"), true);
  });
});

describe("one finalized load, one workflow", () => {
  beforeEach(resetWorld);

  it("gives each finalized load its own instance with its own timeline", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const [a, b] = trips;

    assert.notEqual(a.workflowId, b.workflowId);
    assert.notEqual(a.loadId, b.loadId);

    const viewA = await services.driverWorkflow.getTrip(ctx, a.workflowId);
    const viewB = await services.driverWorkflow.getTrip(ctx, b.workflowId);
    assert.equal(viewA.timeline.every((e) => e.workflowId === a.workflowId), true);
    assert.equal(viewB.timeline.every((e) => e.workflowId === b.workflowId), true);
  });

  it("keeps a completed workflow's record intact", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const done = trips.find((t) => t.status === "completed")!;
    const view = await services.driverWorkflow.getTrip(ctx, done.workflowId);

    assert.notEqual(view.workflow.completedAt, undefined);
    assert.ok(view.timeline.length > 5);
    assert.ok(view.documents.length > 0);
    assert.equal(view.milestones.find((m) => m.kind === "trip_completed")?.state, "recorded");
    // Closed means closed for writing, not gone.
    assert.equal(view.suggestedMilestones.length, 0);
  });
});
