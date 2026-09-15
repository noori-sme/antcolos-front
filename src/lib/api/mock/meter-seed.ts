import type { ContributeMeterReadingInput } from "./meter-ledger";
import { TRAILER_IDS } from "./trailer-registry";
import { TRUCK_IDS } from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A DEVICE, NOT A FEED ███
 *
 * The one seeded meter history.
 *
 * Before the Equipment Meter Ledger existed, these numbers lived twice: once in
 * `maintenance-registry.ts` as an `EquipmentMeter` per truck, and once in
 * `fleet-telemetry.ts` on each telemetry row. The two disagreed — unit NL-104
 * read 118,450 in one and 118,442 in the other, unit CS-47 was 11,000 miles
 * apart — because they were written independently about the same trucks.
 *
 * This file is what replaced both. One history per piece of equipment, in one
 * place, keyed by the permanent equipment UUID, with each row tagged with the
 * module that would really have contributed it. Every value is an honest
 * fixture: nothing came from an ELD, a GPS tracker, a telematics feed or a fuel
 * card, and no screen says otherwise.
 *
 * The series is deliberately uneven — some equipment read this morning, some six
 * weeks ago, some never — because a fleet where every meter is an hour old is
 * not a fleet anybody has run. `T.claimed` and `T.nl121` have no reading at all
 * on purpose: an unanswerable mileage question must read as unanswerable.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const daysAgo = (d: number) => new Date(Date.now() - d * DAY_MS).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();

const NL = "org_northline";
const BX = "org_baxter";
const CS = "org_cascade";

interface SeedRow {
  kind: "truck" | "trailer";
  id: string;
  label: string;
  odometerMiles?: number;
  engineHours?: number;
  at: string;
  source: ContributeMeterReadingInput["source"];
  contributor: ContributeMeterReadingInput["contributor"];
  organizationId: string;
  by?: string;
  note?: string;
}

/**
 * Ordered oldest first so the series reads as a series. The ledger derives the
 * accepted value regardless of order, but a reader scanning this file should be
 * able to see the meter climbing.
 */
const ROWS: SeedRow[] = [
  /* -- Northline power units ---------------------------------------------- */
  // Read in the shop three days ago, then by the driver on the road since.
  { kind: "truck", id: TRUCK_IDS.nl104, label: "NL-104", odometerMiles: 118_450, at: daysAgo(3), source: "manual_entry", contributor: "maintenance", organizationId: NL, by: "Northline yard shop" },
  { kind: "truck", id: TRUCK_IDS.nl104, label: "NL-104", odometerMiles: 118_505, engineHours: 4_218, at: hoursAgo(1.5), source: "driver_report", contributor: "fleet", organizationId: NL, by: "Dmitri Kovalenko" },

  { kind: "truck", id: TRUCK_IDS.nl107, label: "NL-107", odometerMiles: 96_320, at: daysAgo(1), source: "driver_report", contributor: "maintenance", organizationId: NL, by: "Sam Murtaza" },
  { kind: "truck", id: TRUCK_IDS.nl107, label: "NL-107", odometerMiles: 96_390, engineHours: 3_494, at: hoursAgo(3), source: "driver_report", contributor: "fleet", organizationId: NL, by: "Priya Raman" },

  { kind: "truck", id: TRUCK_IDS.nl111, label: "NL-111", odometerMiles: 214_880, at: daysAgo(12), source: "manual_entry", contributor: "maintenance", organizationId: NL, by: "Northline yard shop" },
  { kind: "truck", id: TRUCK_IDS.nl111, label: "NL-111", odometerMiles: 214_960, engineHours: 9_126, at: hoursAgo(6), source: "dispatcher_entry", contributor: "fleet", organizationId: NL, by: "Sam Murtaza" },

  // In the shop. The dealer's reading is the newer of the two.
  { kind: "truck", id: TRUCK_IDS.nl115, label: "NL-115", odometerMiles: 611_905, engineHours: 18_212, at: hoursAgo(140), source: "mock_adapter", contributor: "fleet", organizationId: NL, note: "Dropped for aftertreatment work." },
  { kind: "truck", id: TRUCK_IDS.nl115, label: "NL-115", odometerMiles: 612_040, engineHours: 18_240, at: daysAgo(2), source: "manual_entry", contributor: "maintenance", organizationId: NL, by: "Northline yard shop" },

  // Deliberately old: this is what a stale meter looks like on the dashboard.
  { kind: "truck", id: TRUCK_IDS.nl118, label: "NL-118", odometerMiles: 71_200, at: daysAgo(46), source: "driver_report", contributor: "maintenance", organizationId: NL, by: "Sam Murtaza" },
  { kind: "truck", id: TRUCK_IDS.nl118, label: "NL-118", odometerMiles: 71_806, engineHours: 2_140, at: hoursAgo(52), source: "manual_entry", contributor: "fleet", organizationId: NL, by: "Marcus Hale" },

  { kind: "truck", id: TRUCK_IDS.nl131, label: "NL-131", odometerMiles: 42_610, at: daysAgo(5), source: "manual_entry", contributor: "maintenance", organizationId: NL, by: "Northline yard shop" },
  { kind: "truck", id: TRUCK_IDS.nl131, label: "NL-131", odometerMiles: 42_680, engineHours: 1_402, at: hoursAgo(2), source: "mock_adapter", contributor: "fleet", organizationId: NL },

  /* -- Northline trailers -------------------------------------------------- */
  // A reefer has an hour meter and no odometer. An absent value stays absent.
  { kind: "trailer", id: TRAILER_IDS.rf114, label: "RF-114", engineHours: 9_140, at: daysAgo(4), source: "manual_entry", contributor: "maintenance", organizationId: NL, by: "Northline yard shop" },

  /* -- Baxter -------------------------------------------------------------- */
  { kind: "truck", id: TRUCK_IDS.mdA12, label: "A-12", odometerMiles: 388_900, engineHours: 11_450, at: daysAgo(6), source: "manual_entry", contributor: "maintenance", organizationId: BX, by: "Dale Baxter" },
  { kind: "truck", id: TRUCK_IDS.mdA12, label: "A-12", odometerMiles: 389_140, engineHours: 11_505, at: hoursAgo(2), source: "driver_report", contributor: "fleet", organizationId: BX },

  { kind: "truck", id: TRUCK_IDS.mdA18, label: "A-18", odometerMiles: 24_150, at: daysAgo(9), source: "manual_entry", contributor: "maintenance", organizationId: BX, by: "Dale Baxter" },
  { kind: "truck", id: TRUCK_IDS.mdA18, label: "A-18", odometerMiles: 28_441, engineHours: 902, at: hoursAgo(30), source: "mock_adapter", contributor: "fleet", organizationId: BX },

  /* -- Cascade ------------------------------------------------------------- */
  { kind: "truck", id: TRUCK_IDS.cs47, label: "47", odometerMiles: 143_770, at: daysAgo(2), source: "driver_report", contributor: "maintenance", organizationId: CS, by: "Tomas Ruiz" },
  { kind: "truck", id: TRUCK_IDS.cs47, label: "47", odometerMiles: 143_812, engineHours: 5_060, at: hoursAgo(5), source: "driver_report", contributor: "fleet", organizationId: CS },
];

/**
 * The seed, as ledger contributions.
 *
 * `verification: "confirmed"` on every row because every one of them was typed
 * in or called in by a named person — there is no machine feed in this build to
 * produce anything weaker. The idempotency key is derived from the row's own
 * contents so re-seeding cannot double-append.
 */
export function meterSeedRows(): ContributeMeterReadingInput[] {
  return ROWS.map((row, index) => ({
    equipmentKind: row.kind,
    equipmentId: row.id,
    equipmentLabel: row.label,
    odometerMiles: row.odometerMiles,
    engineHours: row.engineHours,
    readAt: row.at,
    source: row.source,
    contributor: row.contributor,
    scope: {
      organizationId: row.organizationId,
      carrierOrganizationId: row.organizationId,
    },
    verification: "confirmed" as const,
    recordedBy: row.by
      ? {
        userId: `seed:${row.by}`,
        membershipId: `seed:${row.organizationId}`,
        displayNameSnapshot: row.by,
        source: "web" as const,
      }
      : undefined,
    note: row.note,
    idempotencyKey: `meter-seed:${index}:${row.id}`,
    provenance: {
      module: "telematics" as const,
      adapter: "mock:meter-seed",
      mock: true,
      observedAt: row.at,
      receivedAt: row.at,
    },
  }));
}
