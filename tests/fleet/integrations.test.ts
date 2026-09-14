import { describe, expect, it } from "vitest";
import {
  FLEET_ADAPTERS, FLEET_INTEGRATIONS, FleetIntegrationNotConnectedError,
  eldAdapter, fuelCardAdapter, gpsAdapter, integrationDescriptor, isConnected,
  stateRegistrationAdapter, telematicsAdapter, tollAdapter,
} from "@/lib/fleet/integrations";

/**
 * The extension points exist so the shape is decided before anybody wires a
 * real provider up. These tests exist so nothing in that shape can quietly
 * start returning data that came from nowhere.
 */
describe("every fleet integration is declared and none is connected", () => {
  it("reports not_connected for all six", () => {
    expect(FLEET_INTEGRATIONS).toHaveLength(6);
    for (const d of FLEET_INTEGRATIONS) {
      expect(d.status).toBe("not_connected");
      expect(isConnected(d.kind)).toBe(false);
      expect(d.wouldPopulate.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(30);
    }
  });

  it("describes itself consistently from the adapter and the registry", () => {
    for (const adapter of FLEET_ADAPTERS) {
      expect(adapter.describe()).toBe(integrationDescriptor(adapter.kind));
      expect(adapter.describe().kind).toBe(adapter.kind);
    }
  });

  it("throws rather than returning a plausible-looking fixture", async () => {
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["eld.dutyStatus", () => eldAdapter.dutyStatus("dp_x")],
      ["eld.engineReading", () => eldAdapter.engineReading("t_x")],
      ["gps.currentPosition", () => gpsAdapter.currentPosition("t_x")],
      ["telematics.odometerAndHours", () => telematicsAdapter.odometerAndHours("t_x")],
      ["telematics.faultCodes", () => telematicsAdapter.faultCodes("t_x")],
      ["fuelCard.purchases", () => fuelCardAdapter.purchases("t_x", "2026-01-01T00:00:00Z")],
      ["toll.transactions", () => tollAdapter.transactions("t_x", "2026-01-01T00:00:00Z")],
      ["stateRegistration.verifyPlate", () => stateRegistrationAdapter.verifyPlate("IL-1", "IL")],
    ];

    for (const [name, call] of calls) {
      let thrown: unknown;
      try {
        await call();
      } catch (e) {
        thrown = e;
      }
      expect(thrown, name).toBeInstanceOf(FleetIntegrationNotConnectedError);
      expect((thrown as Error).message).toMatch(/will not guess at a value it has not been told/);
    }
  });

  it("rejects an unknown integration kind instead of inventing one", () => {
    // @ts-expect-error — deliberately outside the union.
    expect(() => integrationDescriptor("crystal_ball")).toThrow(/Unknown fleet integration/);
  });
});
