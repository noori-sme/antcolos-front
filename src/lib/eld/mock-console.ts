import type { EldTransport } from "@/types";
import { findProvider } from "./providers";

/**
 * ★ THE LABELLED MOCK CONSOLE ★
 *
 * Payload builders for the developer affordance on the ELD screen. Every one of
 * them produces a body in a MOCK provider's wire format and hands it to the
 * same `ingest` path a webhook or a file import would use — there is no second
 * code path for "test data", which is the only way the console is worth having.
 *
 * The scenarios are chosen to be the ones worth being able to reproduce on
 * demand: the happy case, and then every way ingestion is supposed to refuse or
 * flag something. A reviewer can push each button and watch the pipeline say no
 * out loud, with the row still on file afterwards.
 */

export type MockScenario =
  | "fresh_position"
  | "duplicate"
  | "impossible_jump"
  | "future_timestamp"
  | "invalid_timestamp"
  | "out_of_order"
  | "critical_diagnostic"
  | "hos_summary"
  | "unsupported_signal"
  | "unknown_device";

export const MOCK_SCENARIO_LABEL: Record<MockScenario, string> = {
  fresh_position: "A normal position",
  duplicate: "The same signal twice",
  impossible_jump: "A physically impossible jump",
  future_timestamp: "A timestamp in the future",
  invalid_timestamp: "An unreadable timestamp",
  out_of_order: "A signal that arrives late",
  critical_diagnostic: "A critical fault code",
  hos_summary: "An hours-of-service summary",
  unsupported_signal: "A signal this provider cannot give",
  unknown_device: "A device nobody registered",
};

export const MOCK_SCENARIO_EXPECTATION: Record<MockScenario, string> = {
  fresh_position: "Accepted, attributed, and published to Fleet, MT Loop and Fuel/IFTA.",
  duplicate: "Rejected as a duplicate. The row is kept and changes nothing.",
  impossible_jump: "Flagged. Kept and readable, and it does not move the snapshot.",
  future_timestamp: "Rejected. The arrival time is never substituted for a bad source time.",
  invalid_timestamp: "Rejected. A signal that cannot be placed in time is not evidence.",
  out_of_order: "Flagged. Kept, and it does not drag the snapshot backwards.",
  critical_diagnostic: "Accepted, and queued for Maintenance and Compliance. Not interpreted.",
  hos_summary: "Accepted when a driver is bound. A summary, never a log.",
  unsupported_signal: "Refused before normalization, with the provider's capability as the reason.",
  unknown_device: "Rejected. The delivery is stored; the signal is attributed to nothing.",
};

const MINUTE = 60_000;

export interface MockDeliveryInput {
  providerId: string;
  /** The provider's own device id, exactly as registered. */
  deviceExternalId: string;
  scenario: MockScenario;
  /**
   * Where the device last was, when that is known.
   *
   * Supplied so "a normal position" is actually normal. Without it the console
   * would post a truck into Chicago a minute after the fixtures last saw it in
   * Indiana, the jump check would correctly flag it, and every scenario would
   * look like the impossible-jump one. The point of the console is that each
   * button demonstrates ONE behaviour.
   */
  origin?: { latitude: number; longitude: number; city?: string; state?: string };
  nowMs?: number;
}

export interface MockDelivery {
  body: Record<string, unknown>;
  externalId: string;
  transport: EldTransport;
  /** What the module expects to do with it, shown before it is sent. */
  expectation: string;
}

/**
 * Build a delivery for one provider and one scenario.
 *
 * Alpha is the only provider that speaks every signal, so the scenarios that
 * need a fault code or an HOS summary are built in its format. Beta's format is
 * used for the unsupported case, because "Beta has no hours of service" is a
 * fact about Beta and not a generic error.
 */
export function buildMockDelivery(input: MockDeliveryInput): MockDelivery {
  const now = input.nowMs ?? Date.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  const provider = findProvider(input.providerId);
  const transport: EldTransport = "simulated";
  const stamp = now.toString(36);
  const device = input.scenario === "unknown_device"
    ? "NOT-A-REGISTERED-DEVICE"
    : input.deviceExternalId;
  const expectation = MOCK_SCENARIO_EXPECTATION[input.scenario];
  const origin = input.origin ?? {
    latitude: 41.8781, longitude: -87.6298, city: "Chicago", state: "IL",
  };
  // A few hundredths of a degree — a couple of miles, which is what a truck
  // does between two pings and what the plausibility check is built to allow.
  const nearby = {
    latitude: origin.latitude + 0.02,
    longitude: origin.longitude + 0.02,
    city: origin.city,
    state: origin.state,
  };

  // Beta's wire format, for the one scenario that is about Beta's capabilities.
  if (input.scenario === "unsupported_signal") {
    return {
      transport,
      externalId: `console-${stamp}`,
      expectation: provider?.supports.includes("hos_summary")
        ? "This provider does support hours of service, so the signal is accepted rather than refused."
        : expectation,
      body: {
        records: [{
          unit: device, record_id: `c-${stamp}`, recorded_at: at(MINUTE),
          metric: "hos", value: 1,
        }],
        events: [{
          id: `console-hos-${stamp}`, device, ts: at(MINUTE),
          type: "hos", duty: "driving", drive_s: 18_000, shift_s: 25_200, cycle_s: 180_000,
        }],
      },
    };
  }

  const events: Record<string, unknown>[] = [];

  switch (input.scenario) {
    case "fresh_position":
    case "unknown_device":
      events.push(
        {
          id: `console-loc-${stamp}`, device, ts: at(MINUTE), type: "location",
          lat: nearby.latitude, lon: nearby.longitude,
          city: nearby.city, state: nearby.state,
          accuracy_m: 9, confidence: 0.95,
        },
        { id: `console-spd-${stamp}`, device, ts: at(MINUTE), type: "speed", mph: 47 },
      );
      break;

    case "duplicate":
      // The same id twice in one body. The first is accepted and the second is
      // refused, which is the behaviour a retried webhook depends on.
      events.push(
        {
          id: `console-dupe-${stamp}`, device, ts: at(MINUTE), type: "location",
          lat: nearby.latitude, lon: nearby.longitude,
          city: nearby.city, state: nearby.state, accuracy_m: 9,
        },
        {
          id: `console-dupe-${stamp}`, device, ts: at(MINUTE), type: "location",
          lat: nearby.latitude, lon: nearby.longitude,
          city: nearby.city, state: nearby.state, accuracy_m: 9,
        },
      );
      break;

    case "impossible_jump":
      events.push(
        {
          id: `console-jump-a-${stamp}`, device, ts: at(3 * MINUTE), type: "location",
          lat: nearby.latitude, lon: nearby.longitude,
          city: nearby.city, state: nearby.state, accuracy_m: 9,
        },
        {
          id: `console-jump-b-${stamp}`, device, ts: at(MINUTE), type: "location",
          lat: 25.7617, lon: -80.1918, city: "Miami", state: "FL", accuracy_m: 9,
        },
      );
      break;

    case "future_timestamp":
      events.push({
        id: `console-future-${stamp}`, device,
        ts: new Date(now + 4 * 60 * MINUTE).toISOString(),
        type: "odometer", miles: 999_999,
      });
      break;

    case "invalid_timestamp":
      events.push({
        id: `console-bad-ts-${stamp}`, device, ts: "yesterday afternoon",
        type: "location", lat: nearby.latitude, lon: nearby.longitude,
        city: nearby.city, state: nearby.state,
      });
      break;

    case "out_of_order":
      events.push(
        {
          id: `console-order-a-${stamp}`, device, ts: at(MINUTE), type: "location",
          lat: nearby.latitude, lon: nearby.longitude,
          city: nearby.city, state: nearby.state, accuracy_m: 9,
        },
        {
          // Stamped 90 minutes ago and delivered after the one above: a device
          // that was out of coverage flushing its buffer, newest first.
          id: `console-order-b-${stamp}`, device, ts: at(90 * MINUTE), type: "location",
          lat: origin.latitude, lon: origin.longitude,
          city: origin.city, state: origin.state, accuracy_m: 11,
        },
      );
      break;

    case "critical_diagnostic":
      events.push({
        id: `console-fault-${stamp}`, device, ts: at(MINUTE), type: "diagnostic",
        code: "SPN-1569-FMI-31", desc: "Engine protection derate active",
        severity: "critical", active: true, spn: 1569, fmi: 31,
      });
      break;

    case "hos_summary":
      events.push({
        id: `console-hos-${stamp}`, device, ts: at(MINUTE), type: "hos",
        duty: "driving", drive_s: 14_400, shift_s: 21_600, cycle_s: 172_800,
      });
      break;
  }

  return {
    transport,
    externalId: `console-${input.scenario}-${stamp}`,
    expectation,
    // Both shapes are included so the same body works whichever provider the
    // selected connection uses. An adapter reads only the key it knows about.
    body: {
      events,
      records: events.map((e, i) => ({
        unit: device,
        record_id: `${stamp}-${i}`,
        recorded_at: e.ts,
        metric: e.type === "location" ? "position" : e.type === "speed" ? "speed_kph"
          : e.type === "odometer" ? "odometer_km" : e.type === "diagnostic" ? "fault" : "hos",
        latitude: e.lat, longitude: e.lon, locality: e.city, region: e.state,
        value: e.type === "speed" ? Number(e.mph ?? 0) * 1.609344
          : e.type === "odometer" ? Number(e.miles ?? 0) * 1.609344 : 1,
        code: e.code, text: e.desc, level: e.severity, spn: e.spn, fmi: e.fmi,
      })),
      // Gamma's nightly-export shape, where one row carries several signals and
      // the provider stamps no ids — so the same file sent twice has to be
      // caught by the DERIVED dedupe key rather than by an external id.
      rows: events
        .filter((e) => e.type === "location" || e.type === "odometer")
        .map((e) => ({
          vehicle: device, at: e.ts,
          lat: e.lat, lon: e.lon, city: e.city, state: e.state,
          odo: e.miles,
        })),
      pings: events
        .filter((e) => e.type === "location")
        .map((e, i) => ({
          tag: device, ping_id: `${stamp}-p${i}`, t: e.ts,
          lat: e.lat, lng: e.lon, near: e.city, acc: e.accuracy_m,
        })),
    },
  };
}
