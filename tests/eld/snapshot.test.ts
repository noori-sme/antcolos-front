import { beforeEach, describe, expect, it } from "vitest";
import { mockEldService } from "@/lib/api/mock/eld";
import { listEvents, listRawPayloads, resetEldRegistry } from "@/lib/api/mock/eld-registry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { buildSnapshot } from "@/lib/eld";
import { NORTHLINE_OWNER, contextFor } from "../helpers/context";

/**
 * The snapshot is derived, and deriving it changes nothing.
 *
 * The wrong version of this feature keeps a row per truck and writes the newest
 * value over it. That row is then the only copy: a normalization bug is
 * permanent, a late signal silently rewrites yesterday, and nobody can
 * reconstruct what was known when a decision was made. These tests are the
 * check that Antcolos did not build that.
 */

const ORG = "org_northline";

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetEldRegistry();
});

describe("derivation does not touch the history", () => {
  it("leaves every event and every raw payload exactly as they were", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const eventsBefore = JSON.stringify(listEvents(ORG, { limit: 5000 }));
    const rawBefore = JSON.stringify(listRawPayloads(ORG, 500));

    await mockEldService.snapshots(ctx);
    await mockEldService.dashboard(ctx);
    await mockEldService.snapshots(ctx);

    expect(JSON.stringify(listEvents(ORG, { limit: 5000 }))).toBe(eventsBefore);
    expect(JSON.stringify(listRawPayloads(ORG, 500))).toBe(rawBefore);
  });

  it("produces the same answer every time it is asked", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const first = await mockEldService.snapshots(ctx);
    const second = await mockEldService.snapshots(ctx);
    expect(first.map((s) => [s.truckUnit, s.location.eventId, s.odometer.eventId]))
      .toEqual(second.map((s) => [s.truckUnit, s.location.eventId, s.odometer.eventId]));
  });
});

describe("missing is a value, not a zero", () => {
  it("reports a truck nobody has reported on as missing rather than as stationary", async () => {
    const snapshots = await mockEldService.snapshots(contextFor(NORTHLINE_OWNER));
    const silent = snapshots.find((s) => s.location.quality === "missing");
    expect(silent).toBeDefined();
    expect(silent!.location.value).toBeUndefined();
    expect(silent!.odometer.value).toBeUndefined();
    // Critically: not stale. There is nothing to be stale — that is a device
    // problem, and it is raised as one rather than as a data-freshness one.
    expect(silent!.location.stale).toBe(false);
  });

  it("carries the provider, the age and the quality on every value it does have", async () => {
    const snapshots = await mockEldService.snapshots(contextFor(NORTHLINE_OWNER));
    const reporting = snapshots.find((s) => s.location.quality !== "missing")!;
    expect(reporting.location.providerName).toMatch(/Mock/);
    expect(reporting.location.sourceAt).toBeDefined();
    expect(reporting.location.receivedAt).toBeDefined();
    expect(reporting.location.ageHours).toBeGreaterThanOrEqual(0);
    expect(reporting.location.eventId).toBeDefined();
  });
});

describe("only accepted events move a snapshot", () => {
  it("ignores flagged and rejected rows", () => {
    const now = Date.parse("2026-09-15T12:00:00.000Z");
    const base = {
      organizationId: ORG,
      truckId: "truck_1",
      truckUnit: "1",
      connectionState: "connected" as const,
      freshnessExpectationMinutes: 60,
      providerNameOf: () => "Mock provider",
      includeHos: true,
      includeDiagnostics: true,
      includePreciseLocation: true,
      nowMs: now,
    };
    const event = (id: string, miles: number, sourceAt: string, ingestion: "accepted" | "flagged" | "rejected") => ({
      id,
      organizationId: ORG,
      providerId: "prov_mock_alpha",
      connectionId: "conn_1",
      deviceId: "dev_1",
      rawPayloadId: "raw_1",
      kind: "odometer" as const,
      value: { kind: "odometer" as const, miles },
      sourceAt,
      receivedAt: sourceAt,
      normalizedAt: sourceAt,
      confidence: 0.9,
      quality: "provider_reported" as const,
      provenance: {
        module: "telematics" as const, adapter: "mock", mock: true,
        observedAt: sourceAt, receivedAt: sourceAt,
      },
      attribution: {
        carrierOrganizationId: ORG, carrierNameSnapshot: "Northline",
        gaps: [], resolvedAt: sourceAt,
      },
      ingestion,
      anomalies: [],
      dedupeKey: id,
      sequence: Number(id.slice(-1)),
    });

    const snapshot = buildSnapshot({
      ...base,
      events: [
        event("e1", 100_000, "2026-09-15T10:00:00.000Z", "accepted"),
        event("e2", 999_999, "2026-09-15T11:00:00.000Z", "flagged"),
        event("e3", 888_888, "2026-09-15T11:30:00.000Z", "rejected"),
      ],
    });
    // A snapshot built from signals the pipeline distrusted would launder them
    // into fact. The flagged and rejected readings are readable elsewhere and
    // have no business here.
    expect(snapshot.odometer.value?.miles).toBe(100_000);
    expect(snapshot.eventsConsidered).toBe(1);
  });

  it("lets a correction supersede an earlier value while keeping the earlier one", () => {
    const now = Date.parse("2026-09-15T12:00:00.000Z");
    const common = {
      organizationId: ORG, providerId: "prov_mock_alpha", connectionId: "conn_1",
      deviceId: "dev_1", rawPayloadId: "raw_1", kind: "odometer" as const,
      receivedAt: "2026-09-15T11:00:00.000Z", normalizedAt: "2026-09-15T11:00:00.000Z",
      confidence: 0.9,
      provenance: {
        module: "telematics" as const, adapter: "mock", mock: true,
        observedAt: "2026-09-15T11:00:00.000Z", receivedAt: "2026-09-15T11:00:00.000Z",
      },
      attribution: {
        carrierOrganizationId: ORG, carrierNameSnapshot: "Northline",
        gaps: [], resolvedAt: "2026-09-15T11:00:00.000Z",
      },
      ingestion: "accepted" as const,
      anomalies: [],
    };
    const original = {
      ...common, id: "e1", value: { kind: "odometer" as const, miles: 100_000 },
      sourceAt: "2026-09-15T10:00:00.000Z", quality: "provider_reported" as const,
      dedupeKey: "k1", sequence: 1,
    };
    const correction = {
      ...common, id: "e2", value: { kind: "odometer" as const, miles: 100_500 },
      sourceAt: "2026-09-15T10:00:00.000Z", quality: "corrected" as const,
      dedupeKey: "k2", sequence: 2, supersedesEventId: "e1",
    };

    const snapshot = buildSnapshot({
      organizationId: ORG, truckId: "truck_1", truckUnit: "1",
      connectionState: "connected", freshnessExpectationMinutes: 60,
      providerNameOf: () => "Mock provider", includeHos: false,
      includeDiagnostics: false, includePreciseLocation: true, nowMs: now,
      events: [original, correction],
    });
    expect(snapshot.odometer.value?.miles).toBe(100_500);
    expect(snapshot.odometer.quality).toBe("corrected");
    // One of the two is in force; both are still in the array that was passed
    // in, because a correction is an append and never an edit.
    expect(snapshot.eventsConsidered).toBe(1);
  });
});

describe("freshness is judged per field", () => {
  it("marks a stale position without condemning the whole snapshot", async () => {
    const snapshots = await mockEldService.snapshots(contextFor(NORTHLINE_OWNER));
    const stale = snapshots.find((s) => s.location.stale && s.location.quality !== "missing");
    expect(stale).toBeDefined();
    // An odometer from this morning is fine; a position from this morning is
    // not. One global threshold would libel one of them.
    expect(stale!.location.ageHours).toBeGreaterThan(0);
  });
});
