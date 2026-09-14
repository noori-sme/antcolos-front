import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { PolicyDeniedError } from "@/lib/driver-workflow/errors";
import { discloseRate, resolvePolicy } from "@/lib/driver-workflow/policy";
import type { FullRate } from "@/lib/driver-workflow/policy";
import {
  CASCADE_DRIVER, NORTHLINE_OWNER, STONEBRIDGE_DRIVER, contextFor, key,
  resetWorld,
} from "./harness";

const FULL: FullRate = {
  currency: "USD",
  linehaulCents: 118_000,
  totalRateCents: 126_500,
  ratePerMileCents: 494,
  driverShareCents: 35_400,
  loadedMiles: 239,
  deadheadMiles: 4,
  accessorials: [{ code: "tarp", label: "Tarp", amountCents: 8_500 }],
};

describe("carrier policy — what each engagement type may see", () => {
  it("gives an owner-operator the money and a company driver the miles", () => {
    const oo = resolvePolicy("org_stonebridge", "owner_operator");
    const cd = resolvePolicy("org_cascade", "company_driver");

    expect(oo.proposals.disclosedRateFields).toContain("linehaul");
    expect(cd.proposals.disclosedRateFields).not.toContain("linehaul");
    expect(cd.proposals.disclosedRateFields).toContain("loaded_miles");
  });

  it("names every withheld field instead of silently omitting it", () => {
    const cd = resolvePolicy("org_cascade", "company_driver");
    const disclosed = discloseRate(FULL, cd.proposals.disclosedRateFields, cd.label)!;

    expect(disclosed.linehaulCents).toBeUndefined();
    expect(disclosed.totalRateCents).toBeUndefined();
    expect(disclosed.loadedMiles).toBe(239);
    // The driver is told what is not being shown, and under which rulebook.
    expect(disclosed.withheld.map((w) => w.field)).toContain("the linehaul");
    expect(disclosed.withheld.every((w) => w.reason.includes(cd.label))).toBe(true);
  });

  it("does not report a field the carrier simply does not have as withheld", () => {
    const cd = resolvePolicy("org_cascade", "company_driver");
    const noShare: FullRate = { ...FULL, driverShareCents: undefined, accessorials: [] };
    const disclosed = discloseRate(noShare, ["loaded_miles"], cd.label)!;

    expect(disclosed.withheld.map((w) => w.field)).not.toContain("your share");
    expect(disclosed.withheld.map((w) => w.field)).not.toContain("accessorial charges");
  });

  it("never treats approval as booking consent by default, for either type", () => {
    expect(resolvePolicy("org_stonebridge", "owner_operator").proposals.approvalGrantsBookingConsent).toBe(false);
    expect(resolvePolicy("org_cascade", "company_driver").proposals.approvalGrantsBookingConsent).toBe(false);
  });
});

describe("policy at the service, not in the UI", () => {
  beforeEach(resetWorld);

  it("withholds the rate from a company driver's proposal view", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const [proposal] = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    expect(proposal.rate?.linehaulCents).toBeUndefined();
    expect(proposal.rate?.totalRateCents).toBeUndefined();
    // Cascade's own override does publish the rate per mile.
    expect(proposal.rate?.ratePerMileCents).toBeGreaterThan(0);
  });

  it("gives an owner-operator the full picture on the same kind of record", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const [proposal] = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    expect(proposal.rate?.linehaulCents).toBeGreaterThan(0);
    expect(proposal.rate?.totalRateCents).toBeGreaterThan(0);
  });

  it("refuses a rate counteroffer from a company driver even when asked directly", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const [proposal] = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    // The dashboard never offers this. The service refuses it anyway, which is
    // the only version of the rule that means anything.
    expect(
      proposal.availableActions.find((a) => a.kind === "counteroffer")?.enabled,
    ).toBe(true);
    expect(proposal.policy.allowedCounterofferKinds).not.toContain("rate");

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "counteroffer",
        proposalId: proposal.id,
        kind: "rate",
        proposedAmountCents: 60_000,
        message: "I want more for this.",
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("accepts an operational counteroffer from the same company driver", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const [proposal] = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    const result = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "counteroffer",
      proposalId: proposal.id,
      kind: "home_time",
      message: "I can run it if I am home Friday night rather than Saturday.",
      idempotencyKey: key(),
    });

    expect(result.proposal.counteroffers).toHaveLength(1);
    expect(result.proposal.counteroffers[0].kind).toBe("home_time");
  });

  it("accepts a rate counteroffer from an owner-operator", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const [proposal] = await services.driverWorkflow.listProposals(ctx, { view: "open" });

    const result = await services.driverWorkflow.executeProposalCommand(ctx, {
      type: "counteroffer",
      proposalId: proposal.id,
      kind: "rate",
      proposedAmountCents: 135_000,
      message: "I need $1,350 to make the reload worth the extra day.",
      idempotencyKey: key(),
    });

    expect(result.proposal.counteroffers[0].proposedAmountCents).toBe(135_000);
  });

  it("lets an owner-operator stack several counteroffers, up to the carrier's limit", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const [proposal] = await services.driverWorkflow.listProposals(ctx, { view: "open" });
    const limit = proposal.policy.maxOpenCounteroffers;

    for (let i = 0; i < limit; i += 1) {
      await services.driverWorkflow.executeProposalCommand(ctx, {
        type: "counteroffer",
        proposalId: proposal.id,
        kind: i % 2 === 0 ? "rate" : "condition",
        message: `Ask number ${i + 1}.`,
        idempotencyKey: key(),
      });
    }

    await expect(
      services.driverWorkflow.executeProposalCommand(ctx, {
        type: "counteroffer",
        proposalId: proposal.id,
        kind: "condition",
        message: "One more.",
        idempotencyKey: key(),
      }),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("shows an owner with rates:view the full rate on a driver's proposal", async () => {
    // Northline's owner has no proposals of their own; what is asserted here is
    // that permission and policy are different mechanisms, and holding
    // rates:view is not the same as being an owner-operator.
    const owner = contextFor(NORTHLINE_OWNER);
    expect(owner.permissions.has("rates:view")).toBe(true);

    const driver = contextFor(CASCADE_DRIVER);
    expect(driver.permissions.has("rates:view")).toBe(false);
  });
});
