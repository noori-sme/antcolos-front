import type {
  EldBindingEndReason, EldConnectionState, EldDeviceKind, EldSignalClass, EldTransport,
  TelemetrySignalKind,
} from "@/types";
import { TRUCK_IDS } from "./truck-registry";

/**
 * ███ MOCK FIXTURES — NOT A DEVICE, NOT A PROVIDER, NOT A FEED ███
 *
 * Pure data. This module imports nothing from the registry, which is what keeps
 * the two free of a cycle, and every row below is applied through the same
 * write functions the application uses — `registerConnection`, `registerDevice`,
 * `bindDeviceToTruck`, `ingestDelivery`.
 *
 * That matters more than it sounds. A fixture file that hand-built event rows
 * would produce a store the ingestion pipeline had never seen: the "duplicate"
 * would be a duplicate because somebody typed the word, the "impossible jump"
 * would be a label rather than a measurement, and the first real delivery would
 * behave differently from everything already on screen. Here the seeded
 * duplicate is genuinely caught by the dedupe key, the seeded jump is genuinely
 * measured at several hundred miles an hour, and the seeded nightly export is
 * genuinely ingested twice to prove that re-uploading a file changes nothing.
 *
 * The fleet is deliberately uneven — fresh links, stale links, a link somebody
 * took down, a link that errored, a device nobody bound to anything, two
 * devices disagreeing about one odometer — because a fixture where everything
 * works proves only that the happy path renders.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface FixtureBinding {
  truckId: string;
  truckUnit: string;
  effectiveFrom: string;
  effectiveTo?: string;
  endReason?: EldBindingEndReason;
  note?: string;
}

export interface FixtureDriverBinding {
  driverProfileId: string;
  driverName: string;
  effectiveFrom: string;
  effectiveTo?: string;
  endReason?: EldBindingEndReason;
  note?: string;
}

export interface FixtureDevice {
  externalId: string;
  serialNumber: string;
  kind: EldDeviceKind;
  model?: string;
  firmware?: string;
  vehicleBindings: FixtureBinding[];
  driverBindings: FixtureDriverBinding[];
}

export interface FixtureDelivery {
  body: Record<string, unknown>;
  transport?: EldTransport;
  externalId?: string;
}

export interface FixtureConnection {
  providerId: string;
  label: string;
  transport: EldTransport;
  freshnessExpectationMinutes: number;
  devices: FixtureDevice[];
  deliveries: FixtureDelivery[];
  /** Applied AFTER the deliveries, so a deliberately broken link stays broken. */
  finalState?: {
    state: EldConnectionState;
    reason: string;
    unsupportedSignals?: readonly TelemetrySignalKind[];
  };
}

export interface FixtureShare {
  viewerOrganizationId: string;
  truckId: string;
  signalClasses: readonly EldSignalClass[];
  note?: string;
}

export interface FixtureOrg {
  organizationId: string;
  organizationName: string;
  connections: FixtureConnection[];
  shares: FixtureShare[];
}

export function buildEldFixtures(nowMs: number): FixtureOrg[] {
  const at = (ms: number) => new Date(nowMs - ms).toISOString();
  const T = TRUCK_IDS;

  /* ---- Alpha rows ------------------------------------------------------- */
  const alphaEvent = (
    device: string, minutesAgo: number, type: string, fields: Record<string, unknown>,
    eventId?: string,
  ) => ({
    id: eventId ?? `alpha-${device}-${type}-${minutesAgo}`,
    device,
    ts: at(minutesAgo * MINUTE),
    type,
    ...fields,
  });

  return [
    /* ====================================================================== */
    /* Northline Freight — the carrier the module is demonstrated on          */
    /* ====================================================================== */
    {
      organizationId: "org_northline",
      organizationName: "Northline Freight",
      shares: [
        {
          // Summit dispatches units 111 and 131 for Northline. It is granted
          // position on ONE of them, so "explicitly shared" is visibly
          // per-truck rather than per-relationship: Summit can see where 111
          // is and has no telemetry at all for 131.
          viewerOrganizationId: "org_summit",
          truckId: T.nl111,
          signalClasses: ["position"],
          note: "Position only, for load planning. No meters, no diagnostics, no driver clock.",
        },
      ],
      connections: [
        /* -- A. Healthy webhook link ------------------------------------- */
        {
          providerId: "prov_mock_alpha",
          label: "Mock Telematics — Alpha (main account)",
          transport: "webhook",
          freshnessExpectationMinutes: 15,
          devices: [
            {
              externalId: "AL-88201",
              serialNumber: "MOCK-AL-88201",
              kind: "hardwired_gateway",
              model: "Simulated Gateway 2",
              firmware: "mock-4.1.2",
              vehicleBindings: [
                { truckId: T.nl104, truckUnit: "104", effectiveFrom: at(210 * DAY) },
              ],
              driverBindings: [
                {
                  driverProfileId: "dp_dmitri", driverName: "Dmitri Kovalenko",
                  effectiveFrom: at(210 * DAY),
                },
              ],
            },
            {
              // The device with a PAST life. It reported for 104 until the
              // gateway above replaced it, then moved to 107. Both intervals
              // stand, and every event from the first one still says 104.
              externalId: "AL-88202",
              serialNumber: "MOCK-AL-88202",
              kind: "obd_dongle",
              model: "Simulated Dongle 1",
              firmware: "mock-3.9.0",
              vehicleBindings: [
                {
                  truckId: T.nl104, truckUnit: "104",
                  effectiveFrom: at(300 * DAY), effectiveTo: at(211 * DAY),
                  endReason: "unbound",
                  note: "Moved to 107 when the gateway was fitted to 104.",
                },
                { truckId: T.nl107, truckUnit: "107", effectiveFrom: at(7 * DAY) },
              ],
              driverBindings: [
                {
                  driverProfileId: "dp_marisol", driverName: "Marisol Ortiz",
                  effectiveFrom: at(7 * DAY),
                },
              ],
            },
            {
              // Bound to a truck, and nobody is bound to it. Attribution will
              // resolve the truck and report the driver as a gap rather than
              // reaching for whoever is on 111 today.
              externalId: "AL-88203",
              serialNumber: "MOCK-AL-88203",
              kind: "hardwired_gateway",
              vehicleBindings: [
                { truckId: T.nl111, truckUnit: "111", effectiveFrom: at(150 * DAY) },
              ],
              driverBindings: [],
            },
          ],
          deliveries: [
            {
              externalId: "alpha-batch-1",
              body: {
                events: [
                  alphaEvent("AL-88201", 95, "location", {
                    lat: 40.4167, lon: -86.8753, city: "Lafayette", state: "IN",
                    place: "Customer yard", accuracy_m: 8, confidence: 0.95,
                  }),
                  alphaEvent("AL-88201", 95, "motion", { moving: false }),
                  alphaEvent("AL-88201", 95, "ignition", { on: false }),
                  alphaEvent("AL-88201", 95, "odometer", { miles: 118_442 }),
                  alphaEvent("AL-88201", 95, "engine_hours", { hours: 4_210 }),
                  alphaEvent("AL-88201", 95, "fuel_level", { percent: 62 }),
                ],
              },
            },
            {
              externalId: "alpha-batch-2",
              body: {
                events: [
                  // The truck pulls out: motion flips false -> true, which is
                  // the only thing that licenses a departure inference.
                  alphaEvent("AL-88201", 9, "motion", { moving: true }),
                  alphaEvent("AL-88201", 9, "ignition", { on: true }),
                  alphaEvent("AL-88201", 9, "location", {
                    lat: 40.4212, lon: -86.8901, city: "Lafayette", state: "IN",
                    accuracy_m: 6, confidence: 0.94,
                  }),
                  alphaEvent("AL-88201", 9, "speed", { mph: 54 }),
                  alphaEvent("AL-88201", 9, "heading", { deg: 291 }),
                  // A fault the provider itself marked critical. Antcolos
                  // carries the code and does not interpret it.
                  alphaEvent("AL-88201", 8, "diagnostic", {
                    code: "SPN-3364-FMI-18",
                    desc: "Aftertreatment diesel exhaust fluid level low",
                    severity: "critical", active: true, spn: 3364, fmi: 18,
                  }),
                ],
              },
            },
            {
              // The SAME batch, delivered again — a retried webhook. Every row
              // in it is refused as a duplicate, kept, and changes nothing.
              externalId: "alpha-batch-2",
              body: {
                events: [
                  alphaEvent("AL-88201", 9, "motion", { moving: true }),
                  alphaEvent("AL-88201", 9, "ignition", { on: true }),
                  alphaEvent("AL-88201", 9, "speed", { mph: 54 }),
                ],
              },
            },
            {
              externalId: "alpha-batch-3",
              body: {
                events: [
                  alphaEvent("AL-88202", 120, "location", {
                    lat: 39.7684, lon: -86.1581, city: "Indianapolis", state: "IN",
                    place: "I-70 westbound", accuracy_m: 12, confidence: 0.9,
                  }),
                  alphaEvent("AL-88202", 120, "odometer", { miles: 96_015 }),
                  alphaEvent("AL-88202", 120, "engine_hours", { hours: 3_488 }),
                  alphaEvent("AL-88202", 118, "hos", {
                    duty: "driving", drive_s: 7_200, shift_s: 10_800, cycle_s: 158_400,
                  }),
                  alphaEvent("AL-88202", 12, "location", {
                    lat: 39.9612, lon: -86.5264, city: "Lebanon", state: "IN",
                    accuracy_m: 9, confidence: 0.93,
                  }),
                  alphaEvent("AL-88202", 12, "speed", { mph: 62 }),
                ],
              },
            },
            {
              // Unit 111's gateway reports a position on the other side of the
              // country eleven minutes after the last one. Nothing on a road
              // does that; it is kept, flagged, and left out of the snapshot.
              externalId: "alpha-batch-4",
              body: {
                events: [
                  alphaEvent("AL-88203", 30, "location", {
                    lat: 41.8781, lon: -87.6298, city: "Chicago", state: "IL",
                    place: "Home terminal", accuracy_m: 10,
                  }),
                  alphaEvent("AL-88203", 19, "location", {
                    lat: 39.7392, lon: -104.9903, city: "Denver", state: "CO",
                    accuracy_m: 14,
                  }),
                ],
              },
            },
            {
              // A device that was offline flushes its buffer late. This position
              // is genuinely older than one already accepted for the same unit:
              // kept, flagged, and specifically prevented from dragging the
              // snapshot backwards to where the truck was two hours ago.
              externalId: "alpha-batch-late",
              body: {
                events: [
                  alphaEvent("AL-88202", 55, "location", {
                    lat: 39.8600, lon: -86.3100, city: "Brownsburg", state: "IN",
                    accuracy_m: 15,
                  }, "alpha-late-1"),
                ],
              },
            },
            {
              // A signal stamped in the future. Refused, kept, and explained.
              externalId: "alpha-batch-5",
              body: {
                events: [{
                  id: "alpha-future-1",
                  device: "AL-88203",
                  ts: new Date(nowMs + 3 * HOUR).toISOString(),
                  type: "odometer",
                  miles: 204_900,
                }],
              },
            },
          ],
        },

        /* -- B. A link that has gone quiet, and a signal it cannot serve --- */
        {
          providerId: "prov_mock_beta",
          label: "Mock Telematics — Beta (owner-operator units)",
          transport: "poll",
          freshnessExpectationMinutes: 30,
          devices: [
            {
              externalId: "BX-4410",
              serialNumber: "MOCK-BX-4410",
              kind: "obd_dongle",
              vehicleBindings: [
                { truckId: T.nl118, truckUnit: "118", effectiveFrom: at(200 * DAY) },
              ],
              driverBindings: [
                {
                  driverProfileId: "dp_marcus", driverName: "Marcus Hale",
                  effectiveFrom: at(200 * DAY),
                },
              ],
            },
          ],
          deliveries: [
            {
              externalId: "beta-poll-1",
              body: {
                records: [
                  {
                    unit: "BX-4410", record_id: "b1", recorded_at: at(7 * HOUR),
                    metric: "position", latitude: 41.5250, longitude: -88.0817,
                    locality: "Joliet", region: "IL", hdop_m: 18,
                  },
                  {
                    unit: "BX-4410", record_id: "b2", recorded_at: at(7 * HOUR),
                    metric: "odometer_km", value: 115_560,
                  },
                  {
                    unit: "BX-4410", record_id: "b3", recorded_at: at(7 * HOUR),
                    metric: "engine_hours", value: 2_140,
                  },
                  // Beta has no hours-of-service feed. This comes back as an
                  // unsupported signal, with a reason, rather than as nothing.
                  {
                    unit: "BX-4410", record_id: "b4", recorded_at: at(7 * HOUR),
                    metric: "hos", value: 1,
                  },
                ],
              },
            },
            {
              externalId: "beta-poll-2",
              body: {
                records: [
                  // An odometer that went backwards by four hundred miles.
                  // Almost always a device swap or a unit mix-up; flagged, kept.
                  {
                    unit: "BX-4410", record_id: "b5", recorded_at: at(6 * HOUR),
                    metric: "odometer_km", value: 114_900,
                  },
                ],
              },
            },
          ],
        },

        /* -- C. Nightly file import, no provider ids, uploaded twice ------- */
        {
          providerId: "prov_mock_gamma",
          label: "Mock ELD — Gamma (nightly export)",
          transport: "import",
          freshnessExpectationMinutes: 1_440,
          devices: [
            {
              externalId: "GM-7",
              serialNumber: "MOCK-GM-7",
              kind: "mobile_app",
              vehicleBindings: [
                { truckId: T.nl115, truckUnit: "115", effectiveFrom: at(290 * DAY) },
              ],
              driverBindings: [
                {
                  driverProfileId: "dp_amir", driverName: "Amir Haddad",
                  effectiveFrom: at(290 * DAY),
                },
              ],
            },
            {
              // A SECOND source of truth for unit 104's odometer, several
              // hundred miles away from what Alpha's gateway reports. Two
              // honest sources disagreeing is exactly the case the Needs You
              // item exists for — and neither reading is deleted.
              externalId: "GM-8",
              serialNumber: "MOCK-GM-8",
              kind: "mobile_app",
              vehicleBindings: [
                { truckId: T.nl104, truckUnit: "104", effectiveFrom: at(60 * DAY) },
              ],
              driverBindings: [],
            },
          ],
          deliveries: [
            {
              externalId: "gamma-export-0912",
              transport: "import",
              body: {
                export_date: at(3 * DAY),
                rows: [
                  {
                    vehicle: "GM-7", at: at(3 * DAY), odo: 612_339, hours: 21_004,
                    lat: 35.1495, lon: -90.0490, city: "Memphis", state: "TN",
                    duty: "off_duty", drive_left_s: 39_600, shift_left_s: 50_400,
                    cycle_left_s: 216_000,
                  },
                  {
                    vehicle: "GM-8", at: at(3 * DAY), odo: 118_900,
                    lat: 40.4167, lon: -86.8753, city: "Lafayette", state: "IN",
                  },
                ],
              },
            },
            {
              // The same file, uploaded a second time by somebody who was not
              // sure the first upload worked. Gamma stamps no event ids, so
              // this is the case that proves the DERIVED dedupe key.
              externalId: "gamma-export-0912",
              transport: "import",
              body: {
                export_date: at(3 * DAY),
                rows: [
                  {
                    vehicle: "GM-7", at: at(3 * DAY), odo: 612_339, hours: 21_004,
                    lat: 35.1495, lon: -90.0490, city: "Memphis", state: "TN",
                    duty: "off_duty", drive_left_s: 39_600, shift_left_s: 50_400,
                    cycle_left_s: 216_000,
                  },
                  {
                    vehicle: "GM-8", at: at(3 * DAY), odo: 118_900,
                    lat: 40.4167, lon: -86.8753, city: "Lafayette", state: "IN",
                  },
                ],
              },
            },
          ],
        },

        /* -- D. Somebody took this one down, and forgot the binding ------- */
        {
          providerId: "prov_mock_alpha",
          label: "Mock Telematics — Alpha (retired yard account)",
          transport: "webhook",
          freshnessExpectationMinutes: 15,
          devices: [
            {
              externalId: "AL-88299",
              serialNumber: "MOCK-AL-88299",
              kind: "asset_tracker",
              vehicleBindings: [
                { truckId: T.nl131, truckUnit: "131", effectiveFrom: at(120 * DAY) },
              ],
              driverBindings: [],
            },
          ],
          deliveries: [
            {
              externalId: "alpha-retired-1",
              body: {
                events: [
                  alphaEvent("AL-88299", 6 * 24 * 60, "location", {
                    lat: 41.8781, lon: -87.6298, city: "Chicago", state: "IL",
                    place: "Home terminal", accuracy_m: 20,
                  }),
                ],
              },
            },
          ],
          finalState: {
            state: "disconnected",
            reason:
              "The account behind this simulated link was closed when the yard tracker "
              + "programme ended. Unit 131 is still bound to it.",
          },
        },

        /* -- E. A link that errored, with a device bound to nothing -------- */
        {
          providerId: "prov_mock_delta",
          label: "Mock Asset Tracker — Delta (trailer yard trial)",
          transport: "poll",
          freshnessExpectationMinutes: 240,
          devices: [
            {
              externalId: "DL-31",
              serialNumber: "MOCK-DL-31",
              kind: "asset_tracker",
              vehicleBindings: [],
              driverBindings: [],
            },
          ],
          deliveries: [
            {
              // The tracker reports, and it is bound to nothing. The position
              // is real and it is about no piece of equipment Antcolos knows,
              // so it is kept, flagged, and attributed to nothing rather than
              // being guessed onto the nearest truck.
              externalId: "delta-poll-1",
              transport: "poll",
              body: {
                pings: [{
                  tag: "DL-31", ping_id: "d1", t: at(9 * HOUR),
                  lat: 41.6005, lng: -87.3372, near: "Gary", acc: 40, moving: false,
                }],
              },
            },
          ],
          finalState: {
            state: "error",
            reason:
              "The simulated provider refused the last poll. Nothing has been read from "
              + "it since, and no real credentials are involved.",
          },
        },

        /* -- F. Brand new, nothing has arrived yet ------------------------- */
        {
          providerId: "prov_mock_alpha",
          label: "Mock Telematics — Alpha (new tractor, first sync)",
          transport: "webhook",
          freshnessExpectationMinutes: 15,
          devices: [
            {
              externalId: "AL-88310",
              serialNumber: "MOCK-AL-88310",
              kind: "hardwired_gateway",
              vehicleBindings: [],
              driverBindings: [],
            },
          ],
          deliveries: [],
        },
      ],
    },

    /* ====================================================================== */
    /* Baxter Transit — a second carrier, and the one that shares            */
    /* ====================================================================== */
    {
      organizationId: "org_baxter",
      organizationName: "Baxter Transit LLC",
      shares: [
        {
          // Meridian dispatches A-12 for Baxter and is given position and
          // meters — and never diagnostics, and never the driver's clock.
          viewerOrganizationId: "org_meridian",
          truckId: TRUCK_IDS.mdA12,
          signalClasses: ["position", "meters"],
          note: "Shared for load planning. Diagnostics and hours of service are not shared.",
        },
      ],
      connections: [
        {
          providerId: "prov_mock_beta",
          label: "Mock Telematics — Beta (Baxter account)",
          transport: "poll",
          freshnessExpectationMinutes: 20,
          devices: [
            {
              externalId: "BX-9001",
              serialNumber: "MOCK-BX-9001",
              kind: "hardwired_gateway",
              vehicleBindings: [
                { truckId: TRUCK_IDS.mdA12, truckUnit: "A-12", effectiveFrom: at(400 * DAY) },
              ],
              driverBindings: [],
            },
          ],
          deliveries: [
            {
              externalId: "baxter-poll-1",
              body: {
                records: [
                  {
                    unit: "BX-9001", record_id: "x1", recorded_at: at(11 * MINUTE),
                    metric: "position", latitude: 40.6023, longitude: -75.4714,
                    locality: "Allentown", region: "PA", hdop_m: 11,
                  },
                  {
                    unit: "BX-9001", record_id: "x2", recorded_at: at(11 * MINUTE),
                    metric: "speed_kph", value: 98,
                  },
                  {
                    unit: "BX-9001", record_id: "x3", recorded_at: at(11 * MINUTE),
                    metric: "odometer_km", value: 624_580,
                  },
                ],
              },
            },
          ],
        },
        {
          // Asked for something Beta does not do. Not an error, not a fault —
          // a capability this provider simply does not have.
          providerId: "prov_mock_beta",
          label: "Mock Telematics — Beta (hours of service trial)",
          transport: "poll",
          freshnessExpectationMinutes: 60,
          devices: [],
          deliveries: [],
          finalState: {
            state: "unsupported",
            reason:
              "This link was set up to read hours of service. Mock Telematics — Beta "
              + "reports vehicle data only and has no HOS feed at all.",
            unsupportedSignals: ["hos_summary"],
          },
        },
      ],
    },

    /* ====================================================================== */
    /* Cascade Haul — the carrier where the signed-in person is a DRIVER      */
    /* ====================================================================== */
    {
      organizationId: "org_cascade",
      organizationName: "Cascade Haul",
      shares: [],
      connections: [
        {
          providerId: "prov_mock_alpha",
          label: "Mock Telematics — Alpha (Cascade account)",
          transport: "webhook",
          freshnessExpectationMinutes: 15,
          devices: [
            {
              externalId: "AL-5501",
              serialNumber: "MOCK-AL-5501",
              kind: "hardwired_gateway",
              vehicleBindings: [
                { truckId: TRUCK_IDS.cs47, truckUnit: "47", effectiveFrom: at(108 * DAY) },
              ],
              driverBindings: [
                {
                  driverProfileId: "drv_cascade_0192", driverName: "Sam Murtaza",
                  effectiveFrom: at(108 * DAY),
                },
              ],
            },
            {
              // A second truck in the same carrier, with a different driver on
              // it. The driver membership must not be able to read this one.
              externalId: "AL-5502",
              serialNumber: "MOCK-AL-5502",
              kind: "hardwired_gateway",
              vehicleBindings: [
                { truckId: TRUCK_IDS.cs58, truckUnit: "58", effectiveFrom: at(60 * DAY) },
              ],
              driverBindings: [
                {
                  driverProfileId: "dp_owen", driverName: "Owen Fitz",
                  effectiveFrom: at(60 * DAY),
                },
              ],
            },
          ],
          deliveries: [
            {
              externalId: "cascade-batch-1",
              body: {
                events: [
                  alphaEvent("AL-5501", 9, "location", {
                    lat: 45.5698, lon: -122.7107, city: "Portland", state: "OR",
                    place: "Swan Island yard", accuracy_m: 7, confidence: 0.96,
                  }),
                  alphaEvent("AL-5501", 9, "odometer", { miles: 132_559 }),
                  alphaEvent("AL-5501", 9, "engine_hours", { hours: 5_012 }),
                  alphaEvent("AL-5501", 9, "hos", {
                    duty: "on_duty_not_driving", drive_s: 25_200, shift_s: 32_400,
                    cycle_s: 201_600,
                  }),
                  alphaEvent("AL-5502", 9, "location", {
                    lat: 45.5152, lon: -122.6784, city: "Portland", state: "OR",
                    accuracy_m: 9,
                  }),
                  alphaEvent("AL-5502", 9, "hos", {
                    duty: "driving", drive_s: 12_600, shift_s: 18_000, cycle_s: 144_000,
                  }),
                ],
              },
            },
          ],
        },
      ],
    },
  ];
}
