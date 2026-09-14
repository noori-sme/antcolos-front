import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import {
  CASCADE_DRIVER, STONEBRIDGE_DRIVER, contextFor, resetWorld,
} from "./harness";

/**
 * A smoke test over the seeded world. It is here because every other test in
 * this suite builds on the fixture set, so a broken seed should fail once and
 * obviously rather than as twenty confusing assertions elsewhere.
 */
describe("seeded world", () => {
  beforeEach(resetWorld);

  it("gives the company driver proposals and trips through the real gate", async () => {
    const ctx = contextFor(CASCADE_DRIVER);

    const proposals = await services.driverWorkflow.listProposals(ctx);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.driverId === ctx.driverProfileId)).toBe(true);

    const trips = await services.driverWorkflow.listTrips(ctx);
    // CS-3318 (active) and CS-3309 (completed). CS-3324's rate confirmation was
    // never sent back to the broker, so it must NOT have become a post.
    expect(trips.map((t) => t.loadReference).sort()).toEqual(["CS-3309", "CS-3318"]);
    expect(trips.find((t) => t.loadReference === "CS-3309")?.status).toBe("completed");
    expect(trips.find((t) => t.loadReference === "CS-3318")?.status).toBe("active");
  });

  it("gives the owner-operator their own, separate world", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);

    const trips = await services.driverWorkflow.listTrips(ctx);
    expect(trips.map((t) => t.loadReference).sort()).toEqual(["SB-1036", "SB-1042"]);

    const proposals = await services.driverWorkflow.listProposals(ctx);
    expect(proposals.every((p) => p.organizationId === "org_stonebridge")).toBe(true);
  });

  it("starts the freshly finalized trip with nothing recorded and one suggestion", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const trips = await services.driverWorkflow.listTrips(ctx);
    const fresh = trips.find((t) => t.loadReference === "SB-1042")!;
    const view = await services.driverWorkflow.getTrip(ctx, fresh.workflowId);

    expect(view.milestones.every((m) => m.state === "not_reached")).toBe(true);
    expect(view.suggestedMilestones[0]).toBe("start_rolling");
    // The post exists because the rate con was reviewed, signed and sent.
    expect(view.post.rateConfirmationRef.externalId).toBe("rc_sb_1042");
  });
});
