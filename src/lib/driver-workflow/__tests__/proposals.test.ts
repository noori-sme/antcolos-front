import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
} from "./harness";

async function openProposal(ctx: ServiceContext): Promise<DriverProposalView> {
  const open = await services.driverWorkflow.listProposals(ctx, { view: "open" });
  expect(open.length).toBeGreaterThan(0);
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

    expect(next.status).toBe("approved");
    // The distinction the whole feature turns on.
    expect(next.approval?.bookingConsent).toBe("not_granted");
    expect(next.approval?.policyLabelSnapshot).toBe(proposal.policyLabel);
    expect(events[0].type).toBe("proposal.approved");
    expect(events[0].payload?.reason).toMatch(/not consent to be booked/i);
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
    expect(events[0].source).toBe("telegram");
  });

  it("accepts a rejection with no reason given", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    const { proposal: next } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "reject",
      proposalId: proposal.id,
      idempotencyKey: key(),
    });

    expect(next.status).toBe("rejected");
    expect(next.rejection?.reason).toBeUndefined();
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

    expect(next.rejection?.reason).toMatch(/over on hours/);
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

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "comment",
        proposalId: proposal.id,
        body: "Actually...",
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);

    const after = await services.driverWorkflow.getProposal(ctx, proposal.id);
    // Closed, but nothing was thrown away.
    expect(after.comments).toHaveLength(1);
    const events = await services.driverWorkflow.proposalEvents(ctx, proposal.id);
    expect(events.map((e) => e.type)).toContain("proposal.comment_added");
  });

  it("refuses to approve twice", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "approve",
      proposalId: proposal.id,
      idempotencyKey: key(),
    });

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "approve",
        proposalId: proposal.id,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(DuplicateSubmissionError);
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

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.events.map((e) => e.id)).toEqual(first.events.map((e) => e.id));
    // One comment, not two, however many times the phone retried.
    expect(second.proposal.comments).toHaveLength(1);
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

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "comment",
        proposalId: proposal.id,
        body: "Built from the stale copy.",
        idempotencyKey: key(),
        expectedVersion: proposal.version,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError);
  });
});

describe("pausing a proposal", () => {
  beforeEach(resetWorld);
  afterEach(() => vi.useRealTimers());

  it("pauses for a duration the carrier allows and refuses one it does not", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);
    expect(proposal.policy.pauseDurationsMinutes).toContain(5);

    const { proposal: paused } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: proposal.id,
      minutes: 5,
      reason: "Checking my hours.",
      idempotencyKey: key(),
    });

    expect(paused.status).toBe("paused");
    expect(paused.activePause?.minutes).toBe(5);

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "pause",
        proposalId: proposal.id,
        minutes: 7,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("returns to Awaiting Driver Response when the pause runs out — never approved, never rejected", async () => {
    // Only the clock is faked — the adapters still await real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: proposal.id,
      minutes: 5,
      idempotencyKey: key(),
    });

    vi.setSystemTime(Date.now() + 6 * 60_000);

    const after = await services.driverWorkflow.getProposal(ctx, proposal.id);
    expect(after.status).toBe("awaiting_driver_response");
    expect(after.approval).toBeUndefined();
    expect(after.rejection).toBeUndefined();
    expect(after.activePause).toBeUndefined();

    const events = await services.driverWorkflow.proposalEvents(ctx, proposal.id);
    const expiry = events.find((e) => e.type === "proposal.pause_expired");
    expect(expiry?.payload?.newStatus).toBe("awaiting_driver_response");
    // Said out loud, because silence being read as consent is the failure mode.
    expect(expiry?.payload?.note).toMatch(/not treated as approved or rejected/i);
  });

  it("refuses a resume that names a pause which already ran out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ctx = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(ctx);

    const { proposal: paused } = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "pause",
      proposalId: proposal.id,
      minutes: 5,
      idempotencyKey: key(),
    });
    const pauseId = paused.activePause!.id;

    vi.setSystemTime(Date.now() + 6 * 60_000);

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "resume",
        proposalId: proposal.id,
        pauseId,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(StalePauseError);
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

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "resume",
        proposalId: second.id,
        pauseId: paused.activePause!.id,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(StalePauseError);
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
      expect(resumed.status).toBe("awaiting_driver_response");
    }

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "pause",
        proposalId: proposal.id,
        minutes: 5,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });
});

describe("who may act on a proposal", () => {
  beforeEach(resetWorld);

  it("hides one driver's proposals from another organization entirely", async () => {
    const cascade = contextFor(CASCADE_DRIVER);
    const stonebridge = contextFor(STONEBRIDGE_DRIVER);
    const mine = await openProposal(cascade);

    // Not "forbidden": a 403 would confirm the record exists.
    await expect(
      services.driverWorkflow.getProposal(stonebridge, mine.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a command from a membership without proposals:respond", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const proposal = await openProposal(driver);
    const dispatcher = contextFor(MERIDIAN_DISPATCHER);

    expect(dispatcher.permissions.has("proposals:view")).toBe(true);
    expect(dispatcher.permissions.has("proposals:respond")).toBe(false);

    await expect(
      services.driverWorkflow.executeProposalCommand(dispatcher, {
        type: "approve",
        proposalId: proposal.id,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
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

    await expect(
      services.driverWorkflow.executeProposalCommand(impostor, {
        type: "approve",
        proposalId: proposal.id,
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(NotYourRecordError);
  });
});
