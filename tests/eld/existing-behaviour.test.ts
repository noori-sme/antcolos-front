import { beforeEach, describe, expect, it } from "vitest";
import { mockEldService } from "@/lib/api/mock/eld";
import { mockFleetService } from "@/lib/api/mock/fleet-operations";
import { resetEldRegistry } from "@/lib/api/mock/eld-registry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { MOCK_ELD_ADAPTERS, MOCK_ELD_PROVIDERS, adaptersAreMocked } from "@/lib/eld";
import { FLEET_INTEGRATIONS, isConnected } from "@/lib/fleet/integrations";
import { PERMISSION_CATALOG, availablePermissionKeys } from "@/lib/permissions/catalog";
import { services } from "@/lib/api";
import { NORTHLINE_OWNER, contextFor } from "../helpers/context";

/**
 * This module was added underneath the existing ones, not through them.
 *
 * Nothing above it was rewritten: Fleet still reconciles the permanent records
 * the way it did, Maintenance still holds no meter feed, the permission catalog
 * still gates what it gated, and the Trucks, Trailers, Drivers, Assignments,
 * Operating Authority, Trip Workflow, Fuel/IFTA and Compliance records are
 * exactly where they were. These tests are the proof that adding a machine
 * layer did not quietly become a rewrite of the layer above it.
 */

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFleetTelemetry();
  resetEldRegistry();
});

describe("the existing fleet layer is untouched", () => {
  it("still assembles its dashboard from the permanent records", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const dashboard = await mockFleetService.dashboard(ctx);
    expect(dashboard.trucks.total).toBeGreaterThan(0);
    expect(dashboard.triads.length).toBeGreaterThan(0);
    // The fleet layer's own telemetry store — hand-entered readings — still
    // exists and is still separate from the ELD event stream. This module did
    // not take it over, and did not write to it.
    const rows = await mockFleetService.equipment(ctx, { assetKind: "truck" });
    expect(rows.some((r) => r.telemetry.reading?.source === "mock_adapter"
      || r.telemetry.reading?.source === "driver_report"
      || r.telemetry.reading?.source === "manual_entry"
      || r.telemetry.reading?.source === "dispatcher_entry")).toBe(true);
  });

  it("still reports every fleet integration as not connected", () => {
    // The fleet layer's own extension points are separate from this module's
    // providers and are still honest about being unwired. A telemetry module
    // that flipped them to "connected" would be claiming a real feed.
    expect(FLEET_INTEGRATIONS.every((i) => i.status === "not_connected")).toBe(true);
    expect(FLEET_INTEGRATIONS.every((i) => !isConnected(i.kind))).toBe(true);
  });

  it("does not write a fleet telemetry reading when a device reports", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const before = await mockFleetService.equipment(ctx, { assetKind: "truck" });
    const beforeIds = before.map((r) => r.telemetry.reading?.id ?? null);

    await mockEldService.ingest(ctx, {
      connectionId: (await mockEldService.connections(ctx))[0].id,
      transport: "simulated",
      body: {
        events: [{
          id: `regression-${Date.now()}`, device: "AL-88201",
          ts: new Date().toISOString(), type: "odometer", miles: 200_000,
        }],
      },
    });

    const after = await mockFleetService.equipment(ctx, { assetKind: "truck" });
    // The ELD layer publishes a typed signal for Fleet to collect. It does not
    // reach into Fleet's records and move a number, and this is the assertion
    // that would fail the moment somebody made it.
    expect(after.map((r) => r.telemetry.reading?.id ?? null)).toEqual(beforeIds);
  });
});

describe("the permission catalog still gates what it gated", () => {
  it("keeps every existing key, and adds the ELD ones alongside", () => {
    const keys = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const key of [
      "fleet:view", "fleet:telemetry:record", "trucks:view", "trailers:view",
      "drivers:view", "maintenance:view", "compliance:view", "fuel:view", "ifta:view",
    ]) {
      expect(keys.has(key as never)).toBe(true);
    }
    for (const key of [
      "eld:view", "eld:devices:manage", "eld:bindings:manage", "eld:ingest",
      "eld:location:precise:view", "eld:diagnostics:view", "eld:hos:view", "eld:raw:view",
    ]) {
      expect(keys.has(key as never)).toBe(true);
    }
  });

  it("marks the intrusive ELD keys as sensitive", () => {
    const sensitive = new Set(
      PERMISSION_CATALOG.filter((p) => p.sensitive).map((p) => p.key),
    );
    expect(sensitive.has("eld:location:precise:view")).toBe(true);
    expect(sensitive.has("eld:hos:view")).toBe(true);
    expect(sensitive.has("eld:raw:view")).toBe(true);
  });

  it("keeps device and binding management to carrier organizations", () => {
    const dispatch = new Set(availablePermissionKeys("DISPATCH_AGENCY"));
    expect(dispatch.has("eld:devices:manage")).toBe(false);
    expect(dispatch.has("eld:bindings:manage")).toBe(false);
    expect(dispatch.has("eld:ingest")).toBe(false);
    // A dispatch workspace can still be shown what a carrier shares with it.
    expect(dispatch.has("eld:view")).toBe(true);
  });
});

describe("the service registry gained one member and changed nothing else", () => {
  it("still exposes every existing service", () => {
    for (const key of [
      "needsYou", "home", "directory", "loads", "fuel", "ifta", "reports",
      "compliance", "fleet", "settlements", "driverWorkflow", "invoices", "documents",
    ] as const) {
      expect(services[key]).toBeDefined();
    }
    expect(services.eld).toBeDefined();
  });
});

describe("nothing claims to be connected to anything real", () => {
  it("labels every provider as a mock, in the type and at runtime", () => {
    expect(adaptersAreMocked()).toBe(true);
    expect(MOCK_ELD_PROVIDERS.every((p) => p.mock === true)).toBe(true);
    // And says so in the name, where a person will actually read it.
    expect(MOCK_ELD_PROVIDERS.every((p) => /mock|simulated/i.test(p.name))).toBe(true);
    expect(MOCK_ELD_ADAPTERS.length).toBe(MOCK_ELD_PROVIDERS.length);
  });

  it("stamps mock provenance on every event and every published signal", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const events = await mockEldService.events(ctx, { limit: 500 });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.provenance.mock === true)).toBe(true);
    expect(events.every((e) => e.provenance.adapter.startsWith("mock:"))).toBe(true);

    const signals = await mockEldService.signals(ctx, 500);
    expect(signals.every((s) => s.provenance.mock === true)).toBe(true);
  });

  it("says out loud, on the dashboard payload, that every provider is a mock", async () => {
    const dashboard = await mockEldService.dashboard(contextFor(NORTHLINE_OWNER));
    expect(dashboard.allProvidersAreMock).toBe(true);
  });

  it("never reports an unsigned delivery as verified", async () => {
    const raws = await mockEldService.rawPayloads(contextFor(NORTHLINE_OWNER), 500);
    expect(raws.length).toBeGreaterThan(0);
    expect(raws.every((r) => r.signature !== "verified")).toBe(true);
  });
});

describe("the http adapter is still the unimplemented seam it was", () => {
  it("refuses out loud rather than serving fixtures", async () => {
    const { httpServices } = await import("@/lib/api/http");
    expect(() => httpServices.eld.dashboard(contextFor(NORTHLINE_OWNER)))
      .toThrow(/not implemented/i);
    expect(() => httpServices.fleet.dashboard(contextFor(NORTHLINE_OWNER)))
      .toThrow(/not implemented/i);
  });
});
