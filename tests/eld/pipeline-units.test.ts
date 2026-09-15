import { describe, expect, it } from "vitest";
import {
  MAX_CLOCK_SKEW_MINUTES, checkTimestamp, coordinatesAreImpossible, dedupeKeyFor,
  deriveConnectionState, distanceMiles, judgeCandidate, type DeviceValidationFacts,
} from "@/lib/eld";
import type { NormalizedCandidate } from "@/lib/eld/adapters";

/**
 * The rules, on their own, with no store behind them.
 *
 * Validation is a pure function of (candidate, facts, now), which is what makes
 * every rule below testable without seeding a registry — and what makes it
 * possible to say precisely which rule fired rather than "ingestion did
 * something".
 */

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

const facts = (over: Partial<DeviceValidationFacts> = {}): DeviceValidationFacts => ({
  providerId: "prov_mock_alpha",
  deviceKnown: true,
  knownDedupeKeys: new Set<string>(),
  driverBound: true,
  vehicleBound: true,
  ...over,
});

const candidate = (over: Partial<NormalizedCandidate> = {}): NormalizedCandidate => ({
  deviceExternalId: "AL-1",
  kind: "location",
  value: { kind: "location", latitude: 41.8781, longitude: -87.6298 },
  sourceAt: "2026-09-15T11:59:00.000Z",
  ...over,
});

describe("the idempotency key", () => {
  it("anchors on the provider's own event id when it has one", () => {
    const a = dedupeKeyFor({
      providerId: "p", deviceExternalId: "d", kind: "location",
      sourceAt: "2026-09-15T11:00:00.000Z", externalEventId: "e1",
    });
    const b = dedupeKeyFor({
      providerId: "p", deviceExternalId: "d", kind: "location",
      // A different timestamp, the same provider event. Still one event.
      sourceAt: "2026-09-15T11:00:05.000Z", externalEventId: "e1",
    });
    expect(a).toBe(b);
  });

  it("keeps signals of different kinds apart when the provider stamps nothing", () => {
    // One export row produces a position, an odometer and an hours reading that
    // share a device and a timestamp. Without the kind in the key, two of the
    // three would be thrown away as duplicates of the first.
    const shared = { providerId: "p", deviceExternalId: "d", sourceAt: "2026-09-15T11:00:00.000Z" };
    const keys = new Set([
      dedupeKeyFor({ ...shared, kind: "location" }),
      dedupeKeyFor({ ...shared, kind: "odometer" }),
      dedupeKeyFor({ ...shared, kind: "engine_hours" }),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("timestamps", () => {
  it("rejects an empty or unparseable source time and never substitutes now", () => {
    expect(checkTimestamp("", NOW).anomaly).toBe("invalid_timestamp");
    expect(checkTimestamp("", NOW).iso).toBeUndefined();
    expect(checkTimestamp("last Tuesday", NOW).anomaly).toBe("invalid_timestamp");
  });

  it("allows a small clock skew and refuses a large one", () => {
    const withinSkew = new Date(NOW + (MAX_CLOCK_SKEW_MINUTES - 1) * 60_000).toISOString();
    const beyondSkew = new Date(NOW + (MAX_CLOCK_SKEW_MINUTES + 1) * 60_000).toISOString();
    expect(checkTimestamp(withinSkew, NOW).anomaly).toBeUndefined();
    expect(checkTimestamp(beyondSkew, NOW).anomaly).toBe("future_timestamp");
  });
});

describe("geography", () => {
  it("measures a real distance", () => {
    // Chicago to Indianapolis, about 165 miles as the crow flies.
    const miles = distanceMiles(
      { latitude: 41.8781, longitude: -87.6298 },
      { latitude: 39.7684, longitude: -86.1581 },
    );
    expect(miles).toBeGreaterThan(150);
    expect(miles).toBeLessThan(180);
  });

  it("treats a lost fix reported as 0, 0 as no position at all", () => {
    expect(coordinatesAreImpossible({ latitude: 0, longitude: 0 })).toBe(true);
    expect(coordinatesAreImpossible({ latitude: 91, longitude: 0 })).toBe(true);
    expect(coordinatesAreImpossible({ latitude: 41.8, longitude: -87.6 })).toBe(false);
  });
});

describe("judging a candidate", () => {
  it("accepts a clean signal", () => {
    const verdict = judgeCandidate(candidate(), facts(), NOW);
    expect(verdict.state).toBe("accepted");
    expect(verdict.anomalies).toHaveLength(0);
  });

  it("does not also report a duplicate as out of order", () => {
    const c = candidate({ externalEventId: "e1" });
    const key = dedupeKeyFor({
      providerId: "prov_mock_alpha", deviceExternalId: c.deviceExternalId,
      kind: c.kind, sourceAt: c.sourceAt, externalEventId: "e1",
    });
    const verdict = judgeCandidate(c, facts({
      knownDedupeKeys: new Set([key]),
      newestAcceptedSourceAt: "2026-09-15T11:59:30.000Z",
    }), NOW);
    // It is not a new observation at all — it is the same one, again. Running
    // physics against it would report an impossible jump of zero miles.
    expect(verdict.anomalies).toEqual(["duplicate"]);
    expect(verdict.state).toBe("rejected");
  });

  it("flags a late arrival rather than refusing it", () => {
    const verdict = judgeCandidate(candidate({ sourceAt: "2026-09-15T10:00:00.000Z" }), facts({
      newestAcceptedSourceAt: "2026-09-15T11:00:00.000Z",
    }), NOW);
    expect(verdict.anomalies).toContain("out_of_order");
    expect(verdict.state).toBe("flagged");
  });

  it("measures an impossible jump instead of asserting one", () => {
    const verdict = judgeCandidate(candidate(), facts({
      lastPosition: {
        latitude: 39.7392, longitude: -104.9903, sourceAt: "2026-09-15T11:50:00.000Z",
      },
    }), NOW);
    expect(verdict.anomalies).toContain("impossible_jump");
    expect(verdict.note).toMatch(/mph/);
  });

  it("ignores two positions too close together in time to judge", () => {
    const verdict = judgeCandidate(candidate(), facts({
      lastPosition: {
        latitude: 41.87, longitude: -87.62, sourceAt: "2026-09-15T11:58:55.000Z",
      },
    }), NOW);
    expect(verdict.anomalies).not.toContain("impossible_jump");
  });

  it("refuses a signal from a device that is not registered", () => {
    const verdict = judgeCandidate(candidate(), facts({ deviceKnown: false }), NOW);
    expect(verdict.anomalies).toContain("unknown_device");
    expect(verdict.state).toBe("rejected");
  });

  it("flags an HOS summary with nobody bound to the device", () => {
    const verdict = judgeCandidate(candidate({
      kind: "hos_summary",
      value: { kind: "hos_summary", dutyStatus: "driving" },
    }), facts({ driverBound: false }), NOW);
    expect(verdict.anomalies).toContain("missing_driver_binding");
    expect(verdict.state).toBe("flagged");
  });

  it("flags a meter that went backwards", () => {
    const odometer = judgeCandidate(candidate({
      kind: "odometer", value: { kind: "odometer", miles: 1_000 },
    }), facts({ lastOdometerMiles: 5_000 }), NOW);
    expect(odometer.anomalies).toContain("odometer_regression");

    const hours = judgeCandidate(candidate({
      kind: "engine_hours", value: { kind: "engine_hours", hours: 10 },
    }), facts({ lastEngineHours: 900 }), NOW);
    expect(hours.anomalies).toContain("engine_hours_regression");
  });

  it("tolerates the small wobble every meter has", () => {
    const verdict = judgeCandidate(candidate({
      kind: "odometer", value: { kind: "odometer", miles: 4_999.5 },
    }), facts({ lastOdometerMiles: 5_000 }), NOW);
    expect(verdict.anomalies).not.toContain("odometer_regression");
  });
});

describe("connection state", () => {
  const base = {
    transport: "webhook" as const,
    freshnessExpectationMinutes: 15,
    connectedAt: "2026-09-15T08:00:00.000Z",
  };

  it("never overrides a state somebody declared", () => {
    // A disconnected link is not "stale". Calling it stale would put a row in
    // the Needs You queue that nobody should act on.
    expect(deriveConnectionState({
      ...base, state: "disconnected", lastEventAt: "2026-09-01T00:00:00.000Z",
      disconnectedReason: "Account closed.",
    }, NOW).state).toBe("disconnected");

    expect(deriveConnectionState({
      ...base, state: "error", stateReason: "Refused.",
      lastEventAt: "2026-09-15T11:59:00.000Z",
    }, NOW).state).toBe("error");

    expect(deriveConnectionState({
      ...base, state: "unsupported", stateReason: "No HOS feed.",
    }, NOW).state).toBe("unsupported");
  });

  it("derives connected, stale and offline from when data last arrived", () => {
    const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
    expect(deriveConnectionState({ ...base, state: "connected", lastEventAt: at(5) }, NOW).state)
      .toBe("connected");
    expect(deriveConnectionState({ ...base, state: "connected", lastEventAt: at(30) }, NOW).state)
      .toBe("stale");
    expect(deriveConnectionState({ ...base, state: "connected", lastEventAt: at(300) }, NOW).state)
      .toBe("offline");
  });

  it("scales the expectation to the transport rather than using one global number", () => {
    const nightly = {
      transport: "import" as const,
      freshnessExpectationMinutes: 1_440,
      connectedAt: "2026-09-01T00:00:00.000Z",
      state: "connected" as const,
      lastEventAt: new Date(NOW - 300 * 60_000).toISOString(),
    };
    // Five hours old is stale for a webhook and perfectly healthy for a
    // nightly export. One threshold would libel the slower of the two.
    expect(deriveConnectionState(nightly, NOW).state).toBe("connected");
  });

  it("says why, every time", () => {
    const states = [
      deriveConnectionState({ ...base, state: "connected" }, NOW),
      deriveConnectionState({ ...base, state: "syncing" }, NOW),
      deriveConnectionState({ ...base, state: "disconnected" }, NOW),
    ];
    // A state with no reason is a state nobody can act on.
    expect(states.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("calls a sync that never finished an error rather than leaving it syncing", () => {
    const stuck = deriveConnectionState({
      ...base, state: "syncing", lastSyncAt: new Date(NOW - 120 * 60_000).toISOString(),
    }, NOW);
    expect(stuck.state).toBe("error");
    expect(stuck.reason).toMatch(/stuck/);
  });
});
