import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { services } from "@/lib/api";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import {
  DuplicateSubmissionError, InvalidTransitionError, NotYourRecordError,
  PolicyDeniedError, StalePauseError, StaleVersionError,
} from "@/lib/driver-workflow/errors";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { DriverProposalView } from "@/types";
import {
  CASCADE_DRIVER, MERIDIAN_DISPATCHER, STONEBRIDGE_DRIVER, contextFor, key,
  resetWorld,
} from "./driver-workflow-harness";

async function openProposal(ctx: ServiceContext): Promise<DriverProposalView> {
  const open = await services.driverWorkflow.listProposals(ctx, { view: "open" });
  assert.ok(open.length > 0);
  return open[0];
}

describe("driver decisions on a proposal", () => {
  beforeEach(resetWorld);

  it("approves continued negotiation without granting booking consent", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    const { proposal: next, events } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "approve",
      proposalId: proposal.id,
      note: "Works for me, keep pushing on the rate.",
      idempotencyKey: key(),
    });

    assert.equal(next.status, "approved");
    // The distinction the whole feature turns on.
    assert.equal(next.approval?.bookingConsent, "not_granted");
    assert.equal(next.approval?.policyLabelSnapshot, proposal.policyLabel);
    assert.equal(events[0].type, "proposal.approved");
    assert.match(events[0].payload?.reason ?? "", /not consent to be booked/i);
  });

  it("records which channel the decision came from", async () => {
    const ctx = contextFor(CASCADE_DRIVER, { source: "telegram" });
    const proposal = await openProposal(ctx);

    const { events } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "approve",
      proposalId: proposal.id,
      idempotencyKey: key(),
    });

    // Same service, same command, same rules — only the source differs. This is
    // the seam the Telegram bot will arrive through.
    assert.equal(events[0].source, "telegram");
  });

  it("accepts a rejection with no reason given", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    const { proposal: next } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "reject",
      proposalId: proposal.id,
      idempotencyKey: key(),
    });

    assert.equal(next.status, "rejected");
    assert.equal(next.rejection?.reason, undefined);
  });

  it("keeps a rejection reason when one is given", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    const { proposal: next } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "reject",
      proposalId: proposal.id,
      reason: "That delivery window puts me over on hours.",
      idempotencyKey: key(),
    });

    assert.match(next.rejection?.reason ?? "", /over on hours/);
  });

  it("refuses any further command on a closed proposal, keeping its history", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "comment",
      proposalId: proposal.id,
      body: "Looking at it now.",
      idempotencyKey: key(),
    });
    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "reject",
      proposalId: proposal.id,
      idempotencyKey: key(),
    });

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "comment",
        proposalId: proposal.id,
        body: "Actually...",
        idempotencyKey: key(),
      }),
      InvalidTransitionError,
    );

    const after = await services.driverWorkflow.getProposal(ctx, proposal.id);
    // Closed, but nothing was thrown away.
    assert.equal(after.comments.length, 1);
    const events = await services.driverWorkflow.proposalEvents(ctx, proposal.id);
    assert.ok(events.map((e) => e.type).includes("proposal.comment_added"));
  });

  it("refuses to approve twice", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "approve",
      proposalId: proposal.id,
      idempotencyKey: key(),
    });

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "approve",
        proposalId: proposal.id,
        idempotencyKey: key(),
      }),
      DuplicateSubmissionError,
    );
  });

  it("treats a replayed idempotency key as the same submission, not a new one", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);
    const sameKey = key("retry");

    const first = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "comment",
      proposalId: proposal.id,
      body: "On my way to look at it.",
      idempotencyKey: sameKey,
    });
    const second = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "comment",
      proposalId: proposal.id,
      body: "On my way to look at it.",
      idempotencyKey: sameKey,
    });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.events.map((e) => e.id), first.events.map((e) => e.id));
    // One comment, not two, however many times the phone retried.
    assert.equal(second.proposal.comments.length, 1);
  });

  it("refuses a command built against a version that has moved on", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "comment",
      proposalId: proposal.id,
      body: "First.",
      idempotencyKey: key(),
    });

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "comment",
        proposalId: proposal.id,
        body: "Built from the stale copy.",
        idempotencyKey: key(),
        expectedVersion: proposal.version,
      }),
      StaleVersionError,
    );
  });
});

describe("pausing a proposal", () => {
  beforeEach(resetWorld);
  afterEach(() => mock.timers.reset());

  it("pauses for a duration the carrier allows and refuses one it does not", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);
    assert.ok(proposal.policy.pauseDurationsMinutes.includes(5));

    const { proposal: paused } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: proposal.id,
      minutes: 5,
      reason: "Checking my hours.",
      idempotencyKey: key(),
    });

    assert.equal(paused.status, "paused");
    assert.equal(paused.activePause?.minutes, 5);

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "pause",
        proposalId: proposal.id,
        minutes: 7,
        idempotencyKey: key(),
      }),
      PolicyDeniedError,
    );
  });

  it("returns to Awaiting Driver Response when the pause runs out — never approved, never rejected", async () => {
    // Only the clock is faked — the adapters still await real timers.
    mock.timers.enable({ apis: ["Date"] });
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: proposal.id,
      minutes: 5,
      idempotencyKey: key(),
    });

    mock.timers.tick(6 * 60_000);

    const after = await services.driverWorkflow.getProposal(ctx, proposal.id);
    assert.equal(after.status, "awaiting_driver_response");
    assert.equal(after.approval, undefined);
    assert.equal(after.rejection, undefined);
    assert.equal(after.activePause, undefined);

    const events = await services.driverWorkflow.proposalEvents(ctx, proposal.id);
    const expiry = events.find((e) => e.type === "proposal.pause_expired");
    assert.equal(expiry?.payload?.newStatus, "awaiting_driver_response");
    // Said out loud, because silence being read as consent is the failure mode.
    assert.match(expiry?.payload?.note ?? "", /not treated as approved or rejected/i);
  });

  it("refuses a resume that names a pause which already ran out", async () => {
    mock.timers.enable({ apis: ["Date"] });
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    const { proposal: paused } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: proposal.id,
      minutes: 5,
      idempotencyKey: key(),
    });
    const pauseId = paused.activePause!.id;

    mock.timers.tick(6 * 60_000);

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "resume",
        proposalId: proposal.id,
        pauseId,
        idempotencyKey: key(),
      }),
      StalePauseError,
    );
  });

  it("refuses a resume that names a pause from another proposal", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const open = await services.driverWorkflow.listProposals(ctx, { view: "open" });
    const [first, second] = open;

    const { proposal: paused } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: first.id,
      minutes: 5,
      idempotencyKey: key(),
    });

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "resume",
        proposalId: second.id,
        pauseId: paused.activePause!.id,
        idempotencyKey: key(),
      }),
      StalePauseError,
    );
  });

  it("lets the driver resume early, and counts the pause against the carrier's limit", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);
    const max = proposal.policy.maxPauses;

    let activeId = "";
    for (let i = 0; i < max; i += 1) {
      const { proposal: paused } = await services.driverWorkflow.executeProposalCommand(ctx, {
        type: "pause",
        proposalId: proposal.id,
        minutes: 5,
        idempotencyKey: key(),
      });
      activeId = paused.activePause!.id;
      const { proposal: resumed } = await services.driverWorkflow.executeProposalCommand(ctx, {
        type: "resume",
        proposalId: proposal.id,
        pauseId: activeId,
        idempotencyKey: key(),
      });
      assert.equal(resumed.status, "awaiting_driver_response");
    }

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "pause",
        proposalId: proposal.id,
        minutes: 5,
        idempotencyKey: key(),
      }),
      PolicyDeniedError,
    );
  });
});

describe("who may act on a proposal", () => {
  beforeEach(resetWorld);

  it("hides one driver's proposals from another organization entirely", async () => {
    const cascade = contextFor(CASCADE_DRIVER);
    const stonebridge = contextFor(STONEBRIDGE_DRIVER);
    const mine = await openProposal(cascade);

    // Not "forbidden": a 403 would confirm the record exists.
    await assert.rejects(
      services.driverWorkflow.getProposal(stonebridge, mine.id),
      NotFoundError,
    );
  });

  it("refuses a command from a membership without proposals:respond", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(driver);
    const dispatcher = contextFor(MERIDIAN_DISPATCHER);

    assert.equal(dispatcher.permissions.has("proposals:view"), true);
    assert.equal(dispatcher.permissions.has("proposals:respond"), false);

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(dispatcher, {
        type: "approve",
        proposalId: proposal.id,
        idempotencyKey: key(),
      }),
      PermissionDeniedError,
    );
  });

  it("refuses a command on a proposal that belongs to another driver", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(driver);

    // Same organization, holds both permissions, but is not this driver.
    const impostor: ServiceContext = {
      ...driver,
      driverProfileId: "drv_cs_02",
      scope: { loads: "all", financials: "all" },
    };

    await assert.rejects(
      services.driverWorkflow.executeProposalCommand(impostor, {
        type: "approve",
        proposalId: proposal.id,
        idempotencyKey: key(),
      }),
      NotYourRecordError,
    );
  });
});
