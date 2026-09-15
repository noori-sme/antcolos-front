import type {
  FleetAssetKind, FleetLocationReading, FleetTelemetryReading, FleetTelemetrySource,
} from "@/types";
import { TRUCK_IDS } from "./truck-registry";
import { TRAILER_IDS } from "./trailer-registry";
import { contributeMeterReading } from "./meter-ledger";

/**
 * ███ MOCK ONLY — NOT A BACKEND, AND NOT A DEVICE ███
 *
 * The one store this layer owns: dated readings about WHERE equipment is.
 *
 * Location is genuinely new data. It is not derivable from the Truck, the
 * Trailer, the lease or the assignment, because none of those records knows
 * where the equipment physically is. So it gets a store — append-only, keyed by
 * the permanent asset id, and partitioned by the organization that recorded it,
 * because one carrier's operational reporting is not another's to read.
 *
 * ODOMETER AND ENGINE HOURS ARE NOT OWNED HERE. They belong to the canonical
 * Equipment Meter Ledger (`meter-ledger.ts`), which is keyed by the permanent
 * equipment UUID so one physical truck has one odometer. This store used to keep
 * its own, and the maintenance registry kept another set about the same trucks,
 * and the two disagreed — NL-104 read 118,442 here and 118,450 there. The seeded
 * values now live once, in `meter-seed.ts`. A reading submitted through
 * `appendReading` still records the numbers on its own row (that row is the
 * record of what was submitted) and CONTRIBUTES them to the ledger, which is
 * where every reader gets the accepted value.
 *
 * Every seeded row carries `source: "mock_adapter"` and says so on screen.
 * Nothing here came from an ELD, a GPS tracker or a telematics feed; no such
 * integration exists in this build. The fixtures are deliberately uneven —
 * some assets fresh, some days old, some never reported at all — because a
 * fleet where every reading is an hour old is not a fleet anybody has run.
 */

const HOUR_MS = 3_600_000;

const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();

let seq = 0;
const rowId = () => `tel_${(++seq).toString(36)}${Date.now().toString(36)}`;

interface TelemetryState {
  readings: FleetTelemetryReading[];
}

let state: TelemetryState | null = null;

function db(): TelemetryState {
  if (!state) state = { readings: buildFixtures() };
  return state;
}

/** Test hook. Never called by the UI. */
export function resetFleetTelemetry() {
  seq = 0;
  state = { readings: buildFixtures() };
}

function reading(
  assetKind: FleetAssetKind,
  assetId: string,
  organizationId: string,
  observedHoursAgo: number,
  location: FleetLocationReading,
  extras: {
    odometerMiles?: number;
    engineHours?: number;
    source?: FleetTelemetrySource;
    recordedByName?: string;
    note?: string;
  } = {},
): FleetTelemetryReading {
  const observedAt = hoursAgo(observedHoursAgo);
  return {
    id: rowId(),
    assetKind,
    assetId,
    organizationId,
    location,
    odometerMiles: extras.odometerMiles,
    engineHours: extras.engineHours,
    source: extras.source ?? "mock_adapter",
    providerLabel: undefined,
    observedAt,
    // Written up a little after it was true, the way a phone call actually is.
    recordedAt: hoursAgo(Math.max(0, observedHoursAgo - 0.25)),
    recordedByName: extras.recordedByName,
    note: extras.note,
  };
}

function buildFixtures(): FleetTelemetryReading[] {
  const T = TRUCK_IDS;
  const R = TRAILER_IDS;
  const NL = "org_northline";
  const BX = "org_baxter";
  const CS = "org_cascade";

  return [
    /* Northline power units --------------------------------------------- */
    reading("truck", T.nl104, NL, 1.5, { city: "Lafayette", state: "IN", description: "Customer yard" },
      { recordedByName: "Dmitri Kovalenko", source: "driver_report" }),
    reading("truck", T.nl107, NL, 3, { city: "Indianapolis", state: "IN", description: "I-70 westbound" },
      { recordedByName: "Priya Raman", source: "driver_report" }),
    reading("truck", T.nl111, NL, 6, { city: "Chicago", state: "IL", description: "Home terminal" },
      { source: "dispatcher_entry", recordedByName: "Sam Murtaza" }),
    // In the shop, and nobody has reported on it for the better part of a week.
    reading("truck", T.nl115, NL, 140, { city: "Memphis", state: "TN", description: "Peterbilt dealer" },
      { note: "Dropped for aftertreatment work." }),
    // Deliberately stale: this is what the stale-location item is built from.
    reading("truck", T.nl118, NL, 52, { city: "Joliet", state: "IL" },
      { source: "manual_entry", recordedByName: "Marcus Hale" }),
    reading("truck", T.nl131, NL, 2, { city: "Chicago", state: "IL", description: "Home terminal" }),
    // T.nl121 and T.claimed have NO reading at all, on purpose. An asset nobody
    // has ever reported on is exactly the one worth surfacing.

    /* Baxter power units ------------------------------------------------- */
    reading("truck", T.mdA12, BX, 2, { city: "Allentown", state: "PA", description: "I-78 eastbound" },
      { source: "driver_report" }),
    reading("truck", T.mdA18, BX, 30, { city: "Baltimore", state: "MD" }),

    /* Cascade ------------------------------------------------------------ */
    reading("truck", T.cs47, CS, 5, { city: "Portland", state: "OR", description: "Swan Island yard" },
      { source: "driver_report" }),

    /* Northline trailers ------------------------------------------------- */
    reading("trailer", R.dv220, NL, 4, { city: "Chicago", state: "IL", description: "Dock 6" }),
    reading("trailer", R.rf114, NL, 20, { city: "Indianapolis", state: "IN" },
      { note: "Reefer running at set point." }),
    // Well past the 48-hour trailer expectation.
    reading("trailer", R.fb410, NL, 96, { city: "Gary", state: "IN", description: "Drop yard" }),
    reading("trailer", R.mt501, NL, 12, { city: "Chicago", state: "IL", description: "Shop bay 2" },
      { note: "In for brake work." }),
    reading("trailer", R.oos602, NL, 240, { city: "Chicago", state: "IL", description: "Back lot" },
      { note: "Out of service pending frame inspection." }),

    /* Baxter trailers ---------------------------------------------------- */
    reading("trailer", R.bx810, BX, 8, { city: "Allentown", state: "PA" }),
  ];
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The newest reading for an asset, as seen by one organization.
 *
 * Readings are partitioned by the organization that recorded them and are never
 * pooled: a carrier does not get to read another carrier's operational
 * reporting on a truck they both happen to be approved on. Visibility of the
 * ASSET is a registry question and is settled before this is ever called.
 */
export function latestReading(
  assetId: string,
  organizationId: string,
): FleetTelemetryReading | undefined {
  let best: FleetTelemetryReading | undefined;
  for (const r of db().readings) {
    if (r.assetId !== assetId || r.organizationId !== organizationId) continue;
    if (!best || r.observedAt > best.observedAt) best = r;
  }
  return best ? { ...best } : undefined;
}

/** Every reading for one asset, newest first. The history, never edited. */
export function readingHistory(
  assetId: string,
  organizationId: string,
  limit = 20,
): FleetTelemetryReading[] {
  return db().readings
    .filter((r) => r.assetId === assetId && r.organizationId === organizationId)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface RecordReadingInput {
  assetKind: FleetAssetKind;
  assetId: string;
  location?: FleetLocationReading;
  odometerMiles?: number;
  engineHours?: number;
  /** When the fact was true. Defaults to now when nobody says otherwise. */
  observedAt?: string;
  note?: string;
}

/**
 * Append a reading.
 *
 * Append, never update: a correction is a new row with a later `recordedAt`,
 * so what was believed at the time survives. The source is fixed to
 * `manual_entry` because a person typed it — this function has no way to
 * produce a reading from a device, and pretending otherwise is the exact claim
 * this layer refuses to make.
 *
 * Permission is checked by the caller in the service layer; this is the store.
 */
export function appendReading(
  input: RecordReadingInput,
  by: { organizationId: string; membershipId: string; actorName: string },
): FleetTelemetryReading {
  const nowIso = new Date().toISOString();
  const observedAt = input.observedAt ?? nowIso;
  if (Date.parse(observedAt) > Date.now() + 60_000) {
    throw new Error("A reading cannot be observed in the future.");
  }
  if (input.odometerMiles != null && input.odometerMiles < 0) {
    throw new Error("An odometer reading cannot be negative.");
  }
  if (input.engineHours != null && input.engineHours < 0) {
    throw new Error("Engine hours cannot be negative.");
  }
  const hasSomething = Boolean(
    input.location?.city || input.location?.description
    || input.odometerMiles != null || input.engineHours != null,
  );
  if (!hasSomething) {
    throw new Error("A reading needs a location, an odometer or engine hours.");
  }

  const row: FleetTelemetryReading = {
    id: rowId(),
    assetKind: input.assetKind,
    assetId: input.assetId,
    organizationId: by.organizationId,
    location: input.location,
    odometerMiles: input.odometerMiles,
    engineHours: input.engineHours,
    source: "manual_entry",
    observedAt,
    recordedAt: nowIso,
    recordedByMembershipId: by.membershipId,
    recordedByName: by.actorName,
    note: input.note?.trim() || undefined,
  };
  db().readings = [row, ...db().readings];

  /*
   * The meters go to the canonical ledger. The row above is this store's record
   * of what was submitted; the ledger is where maintenance, fuel and anything
   * else reads the accepted odometer from. Keyed on this row's id, so a retried
   * submission contributes once.
   */
  if (input.odometerMiles != null || input.engineHours != null) {
    contributeMeterReading({
      equipmentKind: input.assetKind === "trailer" ? "trailer" : "truck",
      equipmentId: input.assetId,
      odometerMiles: input.odometerMiles ?? undefined,
      engineHours: input.engineHours ?? undefined,
      readAt: observedAt,
      source: "manual_entry",
      contributor: "fleet",
      scope: {
        organizationId: by.organizationId,
        carrierOrganizationId: by.organizationId,
      },
      verification: "confirmed",
      recordedBy: {
        userId: by.membershipId,
        membershipId: by.membershipId,
        displayNameSnapshot: by.actorName,
        source: "web",
      },
      note: input.note?.trim() || undefined,
      idempotencyKey: `fleet:reading:${row.id}`,
      provenance: {
        module: "telematics",
        adapter: "mock:fleet-telemetry",
        mock: true,
        observedAt,
        receivedAt: nowIso,
      },
    });
  }

  return { ...row };
}
