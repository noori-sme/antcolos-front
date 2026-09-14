import { beforeEach, describe, expect, it } from "vitest";
import { mockFleetService } from "@/lib/api/mock/fleet-operations";
import {
  assignDriver, endDriverAssignment, fleetSync, resetTruckRegistry, truckContextFrom,
} from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { NORTHLINE_OWNER, contextFor } from "./helpers/context";

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFleetTelemetry();
});

/**
 * Assignments are time-bound and the history is never rewritten.
 *
 * These tests drive the REAL registry mutation and then read the fleet layer,
 * because the property that matters is end-to-end: the layer must not be able
 * to show a tidy current picture while the record underneath was overwritten.
 */
describe("assignment records are time-bound and immutable", () => {
  const ctx = () => contextFor(NORTHLINE_OWNER);

  async function truckWithDriver() {
    const rows = await mockFleetService.equipment(ctx(), { assetKind: "truck" });
    const withDriver = rows.find((r) => r.driver && r.authority.availableToOrganization);
    expect(withDriver, "fixtures should have a truck with a live driver").toBeTruthy();
    return withDriver!;
  }

  it("ends the previous assignment instead of deleting it when reassigning", async () => {
    const row = await truckWithDriver();
    const before = await mockFleetService.assignmentHistory(ctx(), "truck", row.assetId);
    const live = before.filter((r) => r.kind === "driver_truck" && !r.effectiveTo);
    expect(live).toHaveLength(1);
    const previous = live[0];

    await assignDriver(
      row.assetId,
      { driverProfileId: "dp_newcomer", driverName: "Jordan Vale" },
      ["dp_newcomer"],
      truckContextFrom(ctx()),
    );

    const after = await mockFleetService.assignmentHistory(ctx(), "truck", row.assetId);
    const driverRows = after.filter((r) => r.kind === "driver_truck");

    // The old row still exists, at the same id, now closed.
    const kept = driverRows.find((r) => r.sourceId === previous.sourceId);
    expect(kept).toBeTruthy();
    expect(kept!.driverName).toBe(previous.driverName);
    expect(kept!.effectiveFrom).toBe(previous.effectiveFrom);
    expect(kept!.effectiveTo).toBeTruthy();
    expect(kept!.endReason).toBeTruthy();

    // Exactly one is live, and it is the new one.
    const stillLive = driverRows.filter((r) => !r.effectiveTo);
    expect(stillLive).toHaveLength(1);
    expect(stillLive[0].driverName).toBe("Jordan Vale");

    // The history only ever grows.
    expect(driverRows.length).toBe(
      before.filter((r) => r.kind === "driver_truck").length + 1,
    );
  });

  it("keeps an ended assignment readable, with its dates and reason", async () => {
    const row = await truckWithDriver();
    const [live] = (await mockFleetService.assignmentHistory(ctx(), "truck", row.assetId))
      .filter((r) => r.kind === "driver_truck" && !r.effectiveTo);

    await endDriverAssignment(live.sourceId, "Moved to another truck.", truckContextFrom(ctx()));

    const after = await mockFleetService.assignmentHistory(ctx(), "truck", row.assetId);
    const ended = after.find((r) => r.sourceId === live.sourceId)!;
    expect(ended.effectiveTo).toBeTruthy();
    expect(ended.endReason).toBe("Moved to another truck.");
    expect(Date.parse(ended.effectiveTo!)).toBeGreaterThanOrEqual(Date.parse(ended.effectiveFrom));
  });

  it("carries the permanent record id on every row, so nothing is a copy", async () => {
    const rows = await mockFleetService.equipment(ctx(), { assetKind: "truck" });
    for (const row of rows) {
      const history = await mockFleetService.assignmentHistory(ctx(), "truck", row.assetId);
      for (const r of history) {
        expect(r.sourceId).toBeTruthy();
        expect(["truck_driver_assignment", "trailer_attachment"]).toContain(r.source);
        expect(r.effectiveFrom).toBeTruthy();
      }
    }
  });

  it("never shows another organization's assignment rows", async () => {
    const rows = await mockFleetService.equipment(ctx(), { assetKind: "truck" });
    for (const row of rows) {
      const history = await mockFleetService.assignmentHistory(ctx(), "truck", row.assetId);
      expect(history.every((r) => r.organizationId === "org_northline")).toBe(true);
    }
  });

  it("leaves ownership and the truck's identity untouched by a reassignment", async () => {
    const row = await truckWithDriver();
    const before = await mockFleetService.asset(ctx(), "truck", row.assetId);

    await assignDriver(
      row.assetId,
      { driverProfileId: "dp_newcomer", driverName: "Jordan Vale" },
      ["dp_newcomer"],
      truckContextFrom(ctx()),
    );

    const after = await mockFleetService.asset(ctx(), "truck", row.assetId);
    // The permanent id, the unit, the equipment type and the readiness of the
    // truck are all unmoved: changing the driver changes the driver.
    expect(after.row.assetId).toBe(before.row.assetId);
    expect(after.row.unit).toBe(before.row.unit);
    expect(after.row.truckEquipmentType).toBe(before.row.truckEquipmentType);
    expect(after.row.readiness).toEqual(before.row.readiness);
    expect(after.row.authority.activationState).toBe(before.row.authority.activationState);
  });
});

describe("the triad is composed, never stored", () => {
  it("reports a truck with a driver and no trailer rather than hiding it", async () => {
    const dashboard = await mockFleetService.dashboard(contextFor(NORTHLINE_OWNER));
    expect(dashboard.triads.length).toBeGreaterThan(0);
    // Every triad has at least one live leg, and incomplete ones are included.
    for (const t of dashboard.triads) {
      expect(Boolean(t.driver) || Boolean(t.trailer)).toBe(true);
      expect(t.truckId).toBeTruthy();
      expect(t.truckUnit).toBeTruthy();
    }
    expect(dashboard.triads.some((t) => t.driver && !t.trailer)).toBe(true);
  });

  it("matches the trucks the registry says this organization operates", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const dashboard = await mockFleetService.dashboard(ctx);
    const operated = new Set(fleetSync(truckContextFrom(ctx)).map((t) => t.truckId));
    for (const t of dashboard.triads) expect(operated.has(t.truckId)).toBe(true);
  });
});
