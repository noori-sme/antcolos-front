import { beforeEach, describe, expect, it } from "vitest";
import { mockEldService } from "@/lib/api/mock/eld";
import { listEvents, resetEldRegistry } from "@/lib/api/mock/eld-registry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { NORTHLINE_OWNER, contextFor } from "../helpers/context";

/**
 * What this layer hands to the modules that already exist — and, more
 * importantly, what it refuses to hand them.
 *
 * The failure mode these tests guard against is the quiet one: a machine
 * observation arriving in another module dressed as a confirmed human action.
 * A GPS fix inside a receiver's fence is not a driver saying they arrived, and
 * no amount of confidence makes it one.
 */

const ORG = "org_northline";

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetEldRegistry();
});

const signalsFor = () => mockEldService.signals(contextFor(NORTHLINE_OWNER), 1000);

describe("nothing is transmitted anywhere", () => {
  it("publishes every signal as pending, with a reason", async () => {
    const signals = await signalsFor();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.state === "pending_integration")).toBe(true);
    expect(signals.every((s) => s.stateReason.length > 0)).toBe(true);
    // The provenance says mock on every one of them, at runtime and not only
    // in a comment.
    expect(signals.every((s) => s.provenance.mock === true)).toBe(true);
  });

  it("reaches every module this layer is supposed to feed", async () => {
    const targets = new Set((await signalsFor()).map((s) => s.target));
    expect(targets).toContain("fleet");
    expect(targets).toContain("trip_workflow");
    expect(targets).toContain("mt_loop");
    expect(targets).toContain("hos");
    expect(targets).toContain("maintenance");
    expect(targets).toContain("fuel_ifta");
    expect(targets).toContain("compliance");
  });

  it("gives every signal a deterministic key so a replay cannot double-count", async () => {
    const signals = await signalsFor();
    for (const signal of signals) {
      expect(signal.idempotencyKey).toContain(signal.operation);
    }
  });
});

describe("inferred is never confirmed", () => {
  it("marks a movement inference as inferred and calls it a suggestion", async () => {
    const inferences = (await signalsFor())
      .filter((s) => s.operation === "trip.arrival_departure_inferred");
    expect(inferences.length).toBeGreaterThan(0);

    for (const signal of inferences) {
      expect(signal.quality).toBe("inferred");
      // Modest by construction: an inference that arrived at 0.95 would be
      // shown next to a provider reading and read as equally solid.
      expect(signal.confidence).toBeLessThanOrEqual(0.6);
      if (signal.operation === "trip.arrival_departure_inferred") {
        expect(["arrival", "departure"]).toContain(signal.payload.suggests);
        expect(signal.payload.rationale).toMatch(/Nobody has confirmed/);
      }
    }
  });

  it("never produces a confirmed value from a machine", async () => {
    const events = listEvents(ORG, { limit: 5000 });
    // "Confirmed" is reserved for a human act. Nothing in the ingestion path
    // can reach it, and nothing published from it can either.
    expect(events.every((e) => e.quality !== "confirmed")).toBe(true);
    expect((await signalsFor()).every((s) => s.quality !== "confirmed")).toBe(true);
  });

  it("does not draw an inference from a state it never watched change", async () => {
    // A truck parked overnight must not "arrive" every morning the moment a
    // device is bound to it. Only a motion CHANGE licenses the inference.
    const inferences = (await signalsFor())
      .filter((s) => s.operation === "trip.arrival_departure_inferred");
    const motionEvents = listEvents(ORG, { kinds: ["motion"], ingestion: ["accepted"], limit: 500 });
    expect(inferences.length).toBeLessThan(motionEvents.length);
  });
});

describe("the boundaries this module refuses to cross", () => {
  it("publishes no ETA, because routing is not built here", async () => {
    const eta = (await signalsFor()).filter((s) => s.target === "mt_loop");
    expect(eta.length).toBeGreaterThan(0);
    for (const signal of eta) {
      if (signal.operation !== "mt_loop.eta_updated") continue;
      expect(signal.payload.etaBasis).toBe("not_computed");
      expect(signal.payload.etaAt).toBeUndefined();
    }
  });

  it("marks jurisdiction mileage as an observation, never as filing-grade", async () => {
    const fuel = (await signalsFor()).filter((s) => s.target === "fuel_ifta");
    expect(fuel.length).toBeGreaterThan(0);
    for (const signal of fuel) {
      if (signal.operation !== "fuel.jurisdiction_mileage_observed") continue;
      expect(signal.payload.filingGrade).toBe(false);
    }
  });

  it("marks an HOS summary as a summary, never as a log", async () => {
    const hos = (await signalsFor()).filter((s) => s.target === "hos");
    expect(hos.length).toBeGreaterThan(0);
    for (const signal of hos) {
      if (signal.operation !== "hos.availability_reported") continue;
      expect(signal.payload.isFullLog).toBe(false);
      // No clock without a person. There is no such thing as anonymous hours
      // of service, and guessing at today's driver would misattribute it.
      expect(signal.payload.driverProfileId).toBeTruthy();
    }
  });

  it("hands a fault code over without interpreting it", async () => {
    const diagnostics = (await signalsFor())
      .filter((s) => s.operation === "maintenance.diagnostic_reported");
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const signal of diagnostics) {
      if (signal.operation !== "maintenance.diagnostic_reported") continue;
      expect(signal.payload.interpretation).toBe("none");
    }
  });
});

describe("only accepted events reach another module", () => {
  it("publishes nothing from a flagged or rejected row", async () => {
    const signals = await signalsFor();
    const bad = new Set(
      listEvents(ORG, { limit: 5000 })
        .filter((e) => e.ingestion !== "accepted")
        .map((e) => e.id),
    );
    expect(bad.size).toBeGreaterThan(0);
    for (const signal of signals) {
      for (const eventId of signal.sourceEventIds) {
        expect(bad.has(eventId)).toBe(false);
      }
    }
  });

  it("carries event-time attribution through to the signal unchanged", async () => {
    const signals = (await signalsFor()).filter((s) => s.sourceEventIds.length > 0);
    const byId = new Map(listEvents(ORG, { limit: 5000 }).map((e) => [e.id, e]));
    for (const signal of signals.slice(0, 40)) {
      const source = byId.get(signal.sourceEventIds[0]);
      if (!source) continue;
      expect(signal.attribution.truckId).toBe(source.attribution.truckId);
      expect(signal.attribution.driverProfileId).toBe(source.attribution.driverProfileId);
      expect(signal.provenance.observedAt).toBe(source.sourceAt);
    }
  });
});
