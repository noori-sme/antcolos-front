import { beforeEach, describe, expect, it } from "vitest";
import { mockEldService } from "@/lib/api/mock/eld";
import {
  listConnections, listDevices, listEvents, listRawPayloads, resetEldRegistry,
} from "@/lib/api/mock/eld-registry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { buildMockDelivery } from "@/lib/eld/mock-console";
import { NORTHLINE_OWNER, contextFor } from "../helpers/context";

/**
 * Ingestion is the part of this module that has to be right.
 *
 * Everything above it — the snapshot, the published signals, the Needs You
 * items — is derived, and a derivation of bad data is bad data with more
 * confidence attached. So these tests are about the five things that actually
 * go wrong with telemetry, and about the one rule that governs all of them:
 * nothing is ever silently deleted.
 */

const ORG = "org_northline";

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetEldRegistry();
});

function alphaConnection() {
  const connection = listConnections(ORG).find((c) => c.label.includes("main account"));
  if (!connection) throw new Error("fixture connection missing");
  return connection;
}

function deviceOn(connectionId: string, externalId: string) {
  const device = listDevices(ORG).find(
    (d) => d.connectionId === connectionId && d.externalRef.externalId === externalId,
  );
  if (!device) throw new Error(`fixture device ${externalId} missing`);
  return device;
}

/**
 * The device's own last accepted position.
 *
 * Every console scenario starts from here, for the same reason the screen does:
 * a "normal position" posted into a different state a minute after the fixtures
 * last saw the truck would be correctly flagged as impossible, and then every
 * scenario would be testing the same rule.
 */
function originFor(externalId: string) {
  const device = deviceOn(alphaConnection().id, externalId);
  const last = listEvents(ORG, { deviceId: device.id, kinds: ["location"], ingestion: ["accepted"], limit: 1 })[0];
  return last?.value.kind === "location"
    ? {
      latitude: last.value.latitude, longitude: last.value.longitude,
      city: last.value.city, state: last.value.state,
    }
    : undefined;
}

async function send(scenario: Parameters<typeof buildMockDelivery>[0]["scenario"], externalId = "AL-88201") {
  const ctx = contextFor(NORTHLINE_OWNER);
  const connection = alphaConnection();
  const delivery = buildMockDelivery({
    providerId: connection.providerId,
    deviceExternalId: externalId,
    scenario,
    origin: originFor(externalId),
  });
  return mockEldService.ingest(ctx, {
    connectionId: connection.id,
    transport: delivery.transport,
    body: delivery.body,
    externalId: delivery.externalId,
  });
}

describe("idempotency", () => {
  it("accepts a delivery once and refuses the replay, without losing either", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const connection = alphaConnection();
    const delivery = buildMockDelivery({
      providerId: connection.providerId,
      deviceExternalId: "AL-88201",
      scenario: "fresh_position",
      origin: originFor("AL-88201"),
    });
    const payload = {
      connectionId: connection.id,
      transport: delivery.transport,
      body: delivery.body,
      externalId: delivery.externalId,
    };

    const first = await mockEldService.ingest(ctx, payload);
    expect(first.accepted).toBe(2);
    expect(first.rejected).toBe(0);

    const second = await mockEldService.ingest(ctx, payload);
    expect(second.accepted).toBe(0);
    // Every row of the replay is refused, not just the ones that were accepted
    // the first time: identity is the dedupe key, and a flagged row has one too.
    expect(second.rejected).toBe(first.outcomes.length);
    expect(second.outcomes.every((o) => o.anomalies.includes("duplicate"))).toBe(true);

    // Both deliveries are on file. The second is not "nothing happened" — it is
    // a delivery that arrived and was refused, and those are different facts.
    const raws = listRawPayloads(ORG);
    expect(raws.filter((r) => r.externalId === delivery.externalId)).toHaveLength(2);
  });

  it("catches a duplicate inside a single delivery", async () => {
    const result = await send("duplicate");
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
  });

  it("deduplicates a provider that stamps no event ids, on the derived key", () => {
    // Gamma's nightly export is seeded twice in the fixtures. If the derived
    // key were wrong, every odometer and hours reading in it would be doubled.
    const gamma = listConnections(ORG).find((c) => c.label.includes("nightly export"))!;
    const events = listEvents(ORG, { limit: 5000 })
      .filter((e) => e.connectionId === gamma.id);
    const accepted = events.filter((e) => e.ingestion === "accepted");
    const duplicates = events.filter((e) => e.anomalies.includes("duplicate"));

    expect(duplicates.length).toBe(accepted.length);
    // One export row produces a position, an odometer, an hours reading and an
    // HOS summary that all share a device and a timestamp. They must NOT
    // collapse into one another: the dedupe key includes the signal kind.
    const kinds = new Set(accepted.map((e) => e.kind));
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe("timestamps", () => {
  it("refuses a source timestamp in the future rather than repairing it", async () => {
    const result = await send("future_timestamp");
    expect(result.accepted).toBe(0);
    expect(result.outcomes[0].anomalies).toContain("future_timestamp");

    const stored = listEvents(ORG, { limit: 5000 })
      .find((e) => e.id === result.outcomes[0].eventId)!;
    // The arrival time is never substituted for a bad source time: doing that
    // would make the row sort correctly and be wrong about when it happened.
    expect(stored.sourceAt).not.toBe(stored.receivedAt);
    expect(stored.ingestion).toBe("rejected");
  });

  it("refuses an unreadable timestamp and keeps the row", async () => {
    const result = await send("invalid_timestamp");
    expect(result.outcomes[0].anomalies).toContain("invalid_timestamp");
    expect(listEvents(ORG, { limit: 5000 }).some(
      (e) => e.id === result.outcomes[0].eventId,
    )).toBe(true);
  });

  it("flags a late arrival and refuses to let it move the snapshot backwards", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const before = await mockEldService.snapshot(ctx, truckIdFor("104"));
    const result = await send("out_of_order");

    const late = result.outcomes.find((o) => o.anomalies.includes("out_of_order"));
    expect(late).toBeDefined();
    expect(late!.state).toBe("flagged");

    const after = await mockEldService.snapshot(ctx, truckIdFor("104"));
    // The newest accepted position still wins. A buffered signal from 90
    // minutes ago is real and is not where the truck is now.
    expect(after.location.sourceAt! >= before.location.sourceAt!).toBe(true);
  });
});

describe("physics", () => {
  it("flags an impossible jump instead of accepting it or deleting it", async () => {
    const result = await send("impossible_jump");
    const flagged = result.outcomes.find((o) => o.anomalies.includes("impossible_jump"));
    expect(flagged).toBeDefined();
    expect(flagged!.state).toBe("flagged");
    expect(flagged!.note).toMatch(/mph/);
  });

  it("flags an odometer that went backwards", () => {
    // Seeded: Beta reports 115,560 km and then 114,900 km for the same unit.
    const regression = listEvents(ORG, { limit: 5000 })
      .find((e) => e.anomalies.includes("odometer_regression"));
    expect(regression).toBeDefined();
    expect(regression!.ingestion).toBe("flagged");
  });
});

describe("provider capability", () => {
  it("reports a signal the provider cannot serve as unsupported, not as an error", () => {
    // Beta has no hours-of-service feed at all. The seeded poll asks for one.
    const beta = listConnections(ORG).find((c) => c.label.includes("owner-operator"))!;
    const raw = listRawPayloads(ORG).find((r) => r.connectionId === beta.id);
    expect(raw).toBeDefined();
    // The delivery was not refused — the other three records in it landed.
    expect(raw!.rejectionReason).toBeUndefined();
    expect(raw!.producedEvents).toBeGreaterThan(0);
  });

  it("refuses a delivery for a device nobody registered, and keeps the body", async () => {
    const result = await send("unknown_device");
    expect(result.accepted).toBe(0);
    expect(result.outcomes.every((o) => o.anomalies.includes("unknown_device"))).toBe(true);
    expect(listRawPayloads(ORG).some((r) => r.id === result.rawPayloadId)).toBe(true);
  });

  it("refuses a delivery on a connection this organization does not hold", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const result = await mockEldService.ingest(ctx, {
      connectionId: "conn_does_not_exist",
      transport: "simulated",
      body: { events: [] },
    });
    expect(result.deliveryRejectedReason).toMatch(/No such connection/);
    // Stored anyway, under the organization that sent it. "We never got it" and
    // "we got it and threw it out" are different answers.
    expect(listRawPayloads(ORG).some((r) => r.id === result.rawPayloadId)).toBe(true);
  });
});

describe("raw payloads are kept apart from normalized events", () => {
  it("stores the provider's body verbatim and links every event back to it", async () => {
    const result = await send("fresh_position");
    const raw = listRawPayloads(ORG).find((r) => r.id === result.rawPayloadId)!;
    expect(raw.body).toBeTypeOf("object");
    expect(raw.signature).toBe("unsigned");

    const events = listEvents(ORG, { limit: 5000 })
      .filter((e) => e.rawPayloadId === raw.id);
    expect(events.length).toBe(raw.producedEvents);
    expect(events.every((e) => e.rawPayloadId === raw.id)).toBe(true);
  });

  it("never marks an unsigned delivery as verified", async () => {
    await send("fresh_position");
    expect(listRawPayloads(ORG).every((r) => r.signature !== "verified")).toBe(true);
  });
});

describe("nothing is ever deleted", () => {
  it("keeps every refused and flagged row where it can be read", async () => {
    const before = listEvents(ORG, { limit: 5000 }).length;
    await send("duplicate");
    await send("impossible_jump");
    await send("future_timestamp");
    await send("invalid_timestamp");
    const after = listEvents(ORG, { limit: 5000 });

    expect(after.length).toBeGreaterThan(before);
    expect(after.some((e) => e.ingestion === "rejected")).toBe(true);
    expect(after.some((e) => e.ingestion === "flagged")).toBe(true);
    // Every non-accepted row explains itself. A flag with no reason is a row
    // nobody can act on.
    expect(after.filter((e) => e.ingestion !== "accepted").every((e) => e.ingestionNote)).toBe(true);
  });
});

/** The permanent truck id behind a unit number, via the device bindings. */
function truckIdFor(unit: string): string {
  const device = deviceOn(alphaConnection().id, "AL-88201");
  const event = listEvents(ORG, { deviceId: device.id, limit: 50 })
    .find((e) => e.attribution.truckUnitSnapshot === unit);
  if (!event?.attribution.truckId) throw new Error(`no truck for unit ${unit}`);
  return event.attribution.truckId;
}
