import type {
  ActorRef, CarrierAttribution, Document, FuelAuditEntry, FuelSharingGrant,
  FuelTransaction, FuelTransactionState, FuelType, IftaPeriod,
  JurisdictionMileageRecord, Jurisdiction, MileageRecordState, Quarter,
} from "@/types";
import { findDuplicate } from "@/lib/fuel/duplicates";
import { qualifyForIfta } from "@/lib/fuel/ifta";
import {
  isWithinQuarter, periodId, quarterBounds, quarterDueDate, recentQuarters,
} from "@/lib/fuel/periods";
import { roundHalfUp } from "@/lib/fuel/units";
import { validateMileage, validateTransaction } from "@/lib/fuel/validation";
import { TRUCK_IDS } from "./truck-registry";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The fuel and IFTA ledger.
 *
 * Like the truck registry, this is NOT partitioned by organization: a purchase
 * belongs to a carrier's ledger, and a dispatch organization reaches it only
 * through a sharing grant that carrier wrote. Partitioning would make that
 * grant impossible to express honestly.
 *
 * Everything here is generated, and generated to be believable rather than
 * tidy: the MPG figures come out of miles and gallons that were produced
 * independently, so the dashboard is doing real arithmetic on plausible data
 * instead of displaying numbers somebody typed. A handful of records are
 * deliberately wrong — a missing receipt, a re-imported duplicate, an odometer
 * that went backwards, a mileage row with more taxable miles than total miles —
 * because a review queue with nothing in it proves nothing.
 */

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export interface FuelState {
  transactions: FuelTransaction[];
  mileage: JurisdictionMileageRecord[];
  periods: IftaPeriod[];
  grants: FuelSharingGrant[];
  audit: FuelAuditEntry[];
  /**
   * Fuel receipts, as canonical `Document` records. Fuel does not get a
   * document entity of its own — when the Documents module lands these move
   * into the same store it reads, unchanged.
   */
  receipts: Document[];
}

let state: FuelState | null = null;
let seq = 0;

export function nextFuelId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36).padStart(4, "0")}`;
}

export function fuelDb(): FuelState {
  if (!state) state = buildFuelFixtures();
  return state;
}

/** Test hook. Never called by the UI. */
export function resetFuelStore() {
  seq = 0;
  state = buildFuelFixtures();
}

/* -------------------------------------------------------------------------- */
/* Deterministic generation                                                    */
/* -------------------------------------------------------------------------- */

/** A small linear congruential generator, so fixtures are the same every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** `spread` of ±1 around 1, e.g. jitter(r, 0.08) → 0.92 … 1.08. */
function jitter(next: () => number, spread: number): number {
  return 1 + (next() * 2 - 1) * spread;
}

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

const IMPORT_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Fuel card import",
  source: "system",
};

/** A point inside a quarter, never in the future. */
function instantInQuarter(
  year: number,
  quarter: Quarter,
  fraction: number,
  now: number,
): string {
  const { startsOn, endsOn } = quarterBounds(year, quarter);
  const start = Date.parse(`${startsOn}T13:00:00.000Z`);
  const latest = Math.min(Date.parse(`${endsOn}T13:00:00.000Z`), now - 6 * 3_600_000);
  if (latest <= start) return new Date(start).toISOString();
  return new Date(Math.round(start + (latest - start) * fraction)).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Fixture shape                                                               */
/* -------------------------------------------------------------------------- */

interface CorridorLeg {
  code: Jurisdiction;
  /** Typical miles run inside this jurisdiction on one trip. */
  miles: number;
  city: string;
  merchant: string;
}

interface TruckFixture {
  truckId: string;
  unit: string;
  driverProfileId: string;
  driverName: string;
  fuelType: FuelType;
  /** The truck's real-world economy. Gallons are generated from it, not to it. */
  mpg: number;
  odometerStart: number;
  corridor: CorridorLeg[];
  seed: number;
}

interface CarrierFixture {
  organizationId: string;
  carrierName: string;
  /** Base pump price in mills, before per-quarter and per-stop variation. */
  basePriceMills: number;
  tripsPerQuarter: number;
  trucks: TruckFixture[];
}

const NORTHLINE: CarrierFixture = {
  organizationId: "org_northline",
  carrierName: "Northline Freight",
  basePriceMills: 3899,
  tripsPerQuarter: 4,
  trucks: [
    {
      truckId: TRUCK_IDS.nl104, unit: "104", driverProfileId: "dp_dmitri", driverName: "Dmitri Kovalenko",
      fuelType: "gasoline", mpg: 14.2, odometerStart: 88_400, seed: 1041,
      corridor: [
        { code: "IL", miles: 96, city: "Chicago", merchant: "Gas City Chicago" },
        { code: "IN", miles: 152, city: "Lafayette", merchant: "Pilot Lafayette" },
        { code: "OH", miles: 118, city: "Columbus", merchant: "Speedway Columbus" },
      ],
    },
    {
      truckId: TRUCK_IDS.nl107, unit: "107", driverProfileId: "dp_marisol", driverName: "Marisol Ortiz",
      fuelType: "diesel", mpg: 17.8, odometerStart: 142_900, seed: 1071,
      corridor: [
        { code: "IL", miles: 84, city: "Joliet", merchant: "TA Joliet" },
        { code: "IN", miles: 118, city: "Indianapolis", merchant: "Love's Indianapolis" },
      ],
    },
    {
      truckId: TRUCK_IDS.nl111, unit: "111", driverProfileId: "dp_ray", driverName: "Ray Bell",
      fuelType: "diesel", mpg: 9.1, odometerStart: 231_500, seed: 1111,
      corridor: [
        { code: "IL", miles: 108, city: "Rockford", merchant: "Road Ranger Rockford" },
        { code: "WI", miles: 164, city: "Madison", merchant: "Kwik Trip Madison" },
        { code: "MN", miles: 142, city: "Rochester", merchant: "Pilot Rochester" },
      ],
    },
    {
      truckId: TRUCK_IDS.nl115, unit: "115", driverProfileId: "dp_amir", driverName: "Amir Haddad",
      fuelType: "diesel", mpg: 6.4, odometerStart: 486_200, seed: 1151,
      corridor: [
        { code: "IL", miles: 132, city: "Effingham", merchant: "Flying J Effingham" },
        { code: "MO", miles: 214, city: "Sikeston", merchant: "TA Sikeston" },
        { code: "TN", miles: 186, city: "Memphis", merchant: "Love's Memphis" },
        { code: "MS", miles: 96, city: "Southaven", merchant: "Pilot Southaven" },
      ],
    },
    {
      truckId: TRUCK_IDS.nl118, unit: "118", driverProfileId: "dp_marcus", driverName: "Marcus Hale",
      fuelType: "diesel", mpg: 11.3, odometerStart: 97_800, seed: 1181,
      corridor: [
        { code: "IL", miles: 88, city: "Joliet", merchant: "Flying J Joliet" },
        { code: "IN", miles: 146, city: "Indianapolis", merchant: "TA Indianapolis" },
        { code: "KY", miles: 122, city: "Louisville", merchant: "Pilot Louisville" },
      ],
    },
    {
      truckId: TRUCK_IDS.nl131, unit: "131", driverProfileId: "dp_tomas", driverName: "Tomas Reyes",
      fuelType: "diesel", mpg: 6.9, odometerStart: 61_300, seed: 1311,
      corridor: [
        { code: "IL", miles: 118, city: "Rock Island", merchant: "Flying J Rock Island" },
        { code: "IA", miles: 236, city: "Des Moines", merchant: "Pilot Des Moines" },
        { code: "NE", miles: 188, city: "Lincoln", merchant: "Bosselman Lincoln" },
      ],
    },
  ],
};

const BAXTER: CarrierFixture = {
  organizationId: "org_baxter",
  carrierName: "Baxter Transit LLC",
  basePriceMills: 4079,
  tripsPerQuarter: 3,
  trucks: [
    {
      truckId: TRUCK_IDS.mdA12, unit: "A-12", driverProfileId: "dp_serge", driverName: "Serge Petrov",
      fuelType: "diesel", mpg: 6.2, odometerStart: 512_400, seed: 2121,
      corridor: [
        { code: "PA", miles: 142, city: "Allentown", merchant: "Pilot Allentown" },
        { code: "MD", miles: 96, city: "Baltimore", merchant: "TA Baltimore" },
        { code: "VA", miles: 178, city: "Richmond", merchant: "Love's Richmond" },
        { code: "NC", miles: 148, city: "Durham", merchant: "Flying J Durham" },
      ],
    },
    {
      truckId: TRUCK_IDS.mdA18, unit: "A-18", driverProfileId: "dp_grace", driverName: "Grace Lindqvist",
      fuelType: "gasoline", mpg: 15.4, odometerStart: 34_700, seed: 2181,
      corridor: [
        { code: "PA", miles: 74, city: "Philadelphia", merchant: "Wawa Philadelphia" },
        { code: "NJ", miles: 92, city: "Newark", merchant: "QuickChek Newark" },
        { code: "NY", miles: 68, city: "Yonkers", merchant: "Sunoco Yonkers" },
      ],
    },
  ],
};

const CASCADE: CarrierFixture = {
  organizationId: "org_cascade",
  carrierName: "Cascade Haul",
  basePriceMills: 4249,
  tripsPerQuarter: 3,
  trucks: [
    {
      truckId: TRUCK_IDS.cs47, unit: "47", driverProfileId: "dp_sam", driverName: "Sam Murtaza",
      fuelType: "diesel", mpg: 16.9, odometerStart: 121_600, seed: 4701,
      corridor: [
        { code: "OR", miles: 118, city: "Portland", merchant: "Pilot Portland" },
        { code: "WA", miles: 164, city: "Ellensburg", merchant: "Love's Ellensburg" },
        { code: "ID", miles: 96, city: "Boise", merchant: "Flying J Boise" },
      ],
    },
  ],
};

/**
 * Baxter also runs Northline's 104 under its own authority, as BX-04.
 *
 * This is the case the attribution rule exists for: one permanent truck, two
 * carriers, and two sets of records that must never be pooled. Baxter's rows
 * live in Baxter's ledger, attributed to Baxter, and Northline's older rows on
 * the same truck stay attributed to Northline forever.
 */
const BAXTER_ON_NL104: TruckFixture = {
  truckId: TRUCK_IDS.nl104, unit: "BX-04", driverProfileId: "dp_serge", driverName: "Serge Petrov",
  fuelType: "gasoline", mpg: 13.6, odometerStart: 96_800, seed: 2041,
  corridor: [
    { code: "PA", miles: 88, city: "Harrisburg", merchant: "Rutter's Harrisburg" },
    { code: "OH", miles: 164, city: "Youngstown", merchant: "Speedway Youngstown" },
  ],
};

const CARRIERS: CarrierFixture[] = [NORTHLINE, BAXTER, CASCADE];

/**
 * The economy each truck was generated to have, per ledger.
 *
 * Exported so a test can check that the MPG the dashboard derives from the
 * generated miles and gallons actually comes back out near the figure that
 * went in. Without that check a change to how fills are sized can silently
 * halve the fleet's measured economy and every screen will still look fine.
 */
export const FUEL_FIXTURE_ECONOMY: readonly {
  organizationId: string;
  truckId: string;
  unit: string;
  mpg: number;
}[] = [
  ...CARRIERS.flatMap((c) =>
    c.trucks.map((t) => ({
      organizationId: c.organizationId,
      truckId: t.truckId,
      unit: t.unit,
      mpg: t.mpg,
    })),
  ),
  {
    organizationId: BAXTER.organizationId,
    truckId: BAXTER_ON_NL104.truckId,
    unit: BAXTER_ON_NL104.unit,
    mpg: BAXTER_ON_NL104.mpg,
  },
];

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Attribution as it was FROZEN when the record was written.
 *
 * Seeded records carry their snapshot directly, exactly as a real ledger would:
 * the resolution happened at the time, and re-deriving it now from today's
 * relationships is precisely the mistake the whole model is built to avoid.
 * Only records created through the service resolve attribution live.
 */
function snapshot(
  carrierOrganizationId: string,
  carrierNameSnapshot: string,
  resolvedAt: string,
  basis: CarrierAttribution["basis"] = "carrier_relationship",
): CarrierAttribution {
  return { carrierOrganizationId, carrierNameSnapshot, basis, resolvedAt };
}

const UNRESOLVED: CarrierAttribution = {
  carrierOrganizationId: "",
  carrierNameSnapshot: "Not established",
  basis: "unresolved",
  resolvedAt: new Date().toISOString(),
};

function receiptFor(
  transactionId: string,
  organizationId: string,
  truckId: string,
  merchant: string,
  at: string,
): Document {
  return {
    id: nextFuelId("doc"),
    organizationId,
    kind: "fuel_receipt",
    fileName: `${merchant.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${at.slice(0, 10)}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 240_000,
    links: [
      { entityKind: "fuel_transaction", entityId: transactionId },
      { entityKind: "truck", entityId: truckId },
    ],
    uploadedAt: at,
    uploadedBy: SYSTEM_ACTOR,
    source: "web",
    // Nothing is read off these. No OCR provider is connected, and saying
    // "succeeded" here would be the first dishonest field in the module.
    ocr: { state: "not_applicable" },
    verification: { state: "not_required" },
    version: 1,
  };
}

interface GeneratedTrip {
  transactions: FuelTransaction[];
  mileage: JurisdictionMileageRecord[];
  receipts: Document[];
}

/**
 * One trip: the miles run in each jurisdiction, and the fuel bought along the
 * way.
 *
 * The two are produced from the same journey but as SEPARATE records, and
 * neither is computed from the other — gallons come from the truck's real
 * economy plus noise, miles come from the corridor plus noise. That is what
 * makes the resulting MPG a measurement rather than a restatement.
 */
function generateTrip(
  carrier: CarrierFixture,
  truck: TruckFixture,
  attribution: CarrierAttribution,
  organizationId: string,
  startedAt: string,
  odometerAt: number,
  priceMills: number,
  next: () => number,
  fuelState: FuelTransactionState,
  mileageState: MileageRecordState,
  source: FuelTransaction["source"],
  withReceipts: boolean,
): { trip: GeneratedTrip; odometerAfter: number } {
  const transactions: FuelTransaction[] = [];
  const mileage: JurisdictionMileageRecord[] = [];
  const receipts: Document[] = [];

  let cursor = Date.parse(startedAt);
  let odometer = odometerAt;

  // Miles are drawn first, for the whole trip, so a fill can be sized against
  // the stretch it actually has to cover.
  const legMiles = truck.corridor.map((leg) => Math.max(1, roundHalfUp(leg.miles * jitter(next, 0.14))));

  // Fuel at the start, and again part-way through a long corridor.
  const fuelStops = truck.corridor
    .map((_, index) => index)
    .filter((index) => index === 0 || (index === 2 && truck.corridor.length >= 4));

  truck.corridor.forEach((leg, index) => {
    const miles = legMiles[index];
    const hours = Math.max(1, miles / 52);
    const segmentStart = new Date(cursor).toISOString();
    cursor += Math.round(hours * 3_600_000);
    const segmentEnd = new Date(cursor).toISOString();
    const odometerStart = odometer;
    odometer += miles;

    // Toll miles come out of the taxable figure in a couple of corridors. This
    // is why taxable is recorded rather than assumed equal to total.
    const tollMiles = leg.code === "IL" || leg.code === "NY" ? roundHalfUp(miles * 0.06) : 0;

    mileage.push({
      id: nextFuelId("mil"),
      organizationId,
      truckId: truck.truckId,
      truckUnitSnapshot: truck.unit,
      driverProfileId: truck.driverProfileId,
      driverNameSnapshot: truck.driverName,
      attribution,
      jurisdiction: leg.code,
      travelStartedAt: segmentStart,
      travelEndedAt: segmentEnd,
      totalMiles: miles,
      taxableMiles: miles - tollMiles,
      odometerStartMiles: odometerStart,
      odometerEndMiles: odometer,
      source: mileageState === "manual" ? "manual" : "eld",
      sourceRef:
        mileageState === "manual"
          ? undefined
          : {
              adapterId: "eld.mock",
              externalId: `eld-${truck.unit}-${segmentStart.slice(0, 16)}`,
              importedAt: segmentEnd,
            },
      state: mileageState,
      verifiedBy: mileageState === "verified" ? SYSTEM_ACTOR : undefined,
      verifiedAt: mileageState === "verified" ? segmentEnd : undefined,
      flags: [],
      revision: { number: 1, originalId: "", isCurrent: true },
      createdAt: segmentEnd,
      createdBy: mileageState === "manual" ? SYSTEM_ACTOR : IMPORT_ACTOR,
    });

    if (!fuelStops.includes(index)) return;

    // A fill covers the road until the NEXT fill, not the whole trip again.
    // Sizing every stop against the rest of the journey would double-count the
    // tail and quietly drag the fleet's measured MPG below what it really is.
    const nextStop = fuelStops.find((i) => i > index) ?? truck.corridor.length;
    const coveredMiles = legMiles.slice(index, nextStop).reduce((sum, m) => sum + m, 0);
    const gallons = roundHalfUp((coveredMiles / truck.mpg) * 1000 * jitter(next, 0.1));
    const price = roundHalfUp(priceMills * jitter(next, 0.05));
    const cost = roundHalfUp((gallons * price) / 1_000_000 * 100);
    const qualification = qualifyForIfta(truck.fuelType, leg.code);
    const transactionId = nextFuelId("fuel");
    const receipt = withReceipts
      ? receiptFor(transactionId, organizationId, truck.truckId, leg.merchant, segmentStart)
      : null;
    if (receipt) receipts.push(receipt);

    transactions.push({
      id: transactionId,
      organizationId,
      truckId: truck.truckId,
      truckUnitSnapshot: truck.unit,
      driverProfileId: truck.driverProfileId,
      driverNameSnapshot: truck.driverName,
      attribution,
      purchasedAt: segmentStart,
      location: {
        jurisdiction: leg.code,
        address: { city: leg.city, state: leg.code, country: "US" },
        merchantName: leg.merchant,
      },
      odometerMiles: odometerStart,
      fuelType: truck.fuelType,
      gallonsThousandths: gallons,
      cost: { currency: "USD", pricePerGallonMills: price, totalCostCents: cost },
      qualifiesForIfta: qualification.qualifies,
      qualificationNote: qualification.note,
      source,
      sourceRef:
        source === "manual"
          ? undefined
          : {
              adapterId: "fuel_card.mock",
              externalId: `fc-${truck.unit}-${segmentStart.slice(0, 16)}`,
              importBatchId: `batch-${segmentStart.slice(0, 7)}`,
              importedAt: segmentStart,
            },
      state: fuelState,
      verifiedBy: fuelState === "verified" ? SYSTEM_ACTOR : undefined,
      verifiedAt: fuelState === "verified" ? segmentEnd : undefined,
      receiptDocumentId: receipt?.id,
      flags: [],
      revision: { number: 1, originalId: transactionId, isCurrent: true },
      createdAt: segmentStart,
      createdBy: source === "manual" ? SYSTEM_ACTOR : IMPORT_ACTOR,
    });
  });

  // Every record's revision chain starts with itself.
  for (const record of mileage) record.revision.originalId = record.id;

  return { trip: { transactions, mileage, receipts }, odometerAfter: odometer };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function buildFuelFixtures(): FuelState {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const quarters = recentQuarters(nowIso, 3);

  const transactions: FuelTransaction[] = [];
  const mileage: JurisdictionMileageRecord[] = [];
  const receipts: Document[] = [];
  const periods: IftaPeriod[] = [];
  const audit: FuelAuditEntry[] = [];

  const emit = (
    carrier: CarrierFixture,
    truck: TruckFixture,
    organizationId: string,
    attribution: CarrierAttribution,
  ) => {
    const next = rng(truck.seed);
    let odometer = truck.odometerStart;

    // Oldest quarter first, so odometers only ever go up.
    [...quarters].reverse().forEach(({ year, quarter }, quarterIndex) => {
      // The quarter still running has fewer trips in it — it is not over.
      const isCurrent = quarterIndex === quarters.length - 1;
      const trips = isCurrent ? Math.max(1, carrier.tripsPerQuarter - 2) : carrier.tripsPerQuarter;
      // Older quarters are closed out and reviewed. The live one is not.
      const fuelState: FuelTransactionState = isCurrent ? "imported" : "verified";
      const mileageState: MileageRecordState = isCurrent ? "imported" : "verified";
      const priceMills = roundHalfUp(carrier.basePriceMills * (1 + (quarterIndex - 1) * 0.045));

      for (let i = 0; i < trips; i += 1) {
        const fraction = (i + 0.5) / trips;
        const startedAt = instantInQuarter(year, quarter, fraction, now);
        const { trip, odometerAfter } = generateTrip(
          carrier, truck, attribution, organizationId, startedAt, odometer,
          priceMills, next, fuelState, mileageState,
          i % 3 === 0 ? "manual" : "fuel_card",
          // One trip a quarter has no receipt on it. That is the single most
          // common real gap, and it needs to be visible in the queue.
          !(isCurrent && i === 0),
        );
        transactions.push(...trip.transactions);
        mileage.push(...trip.mileage);
        receipts.push(...trip.receipts);
        odometer = odometerAfter;
      }
    });
  };

  for (const carrier of CARRIERS) {
    const attribution = snapshot(carrier.organizationId, carrier.carrierName, nowIso);
    for (const truck of carrier.trucks) {
      emit(carrier, truck, carrier.organizationId, attribution);
    }
  }

  // Baxter's own authority over Northline's 104. Separate ledger, separate
  // attribution, same permanent truckId — and Northline's history on that
  // truck is untouched by it.
  emit(
    BAXTER,
    BAXTER_ON_NL104,
    BAXTER.organizationId,
    snapshot(BAXTER.organizationId, BAXTER.carrierName, nowIso, "operating_lease"),
  );

  applyDeliberateProblems(transactions, mileage, receipts, nowIso, now);

  // One quarterly period per carrier per quarter. The oldest is recorded as
  // filed — by a person, somewhere else. Antcolos filed nothing.
  for (const carrier of CARRIERS) {
    quarters.forEach(({ year, quarter }, index) => {
      const { startsOn, endsOn } = quarterBounds(year, quarter);
      const filed = index === 2 && carrier.organizationId !== "org_cascade";
      periods.push({
        id: periodId(carrier.organizationId, carrier.organizationId, year, quarter),
        organizationId: carrier.organizationId,
        carrierOrganizationId: carrier.organizationId,
        carrierNameSnapshot: carrier.carrierName,
        year,
        quarter,
        startsOn,
        endsOn,
        dueOn: quarterDueDate(year, quarter),
        state: filed ? "filed" : "incomplete",
        filing: filed
          ? {
              filedAt: `${quarterDueDate(year, quarter)}T16:30:00.000Z`,
              filedBy: SYSTEM_ACTOR,
              confirmationReference: `EXT-${year}Q${quarter}-${carrier.organizationId.slice(-4).toUpperCase()}`,
              channel: "external",
              note: "Filed through the base jurisdiction's own portal. Antcolos has no connection to it and did not submit anything.",
            }
          : undefined,
        lockedAt: filed ? `${quarterDueDate(year, quarter)}T16:30:00.000Z` : undefined,
        amendments: [],
        createdAt: `${startsOn}T00:00:00.000Z`,
      });
    });
  }

  const grants: FuelSharingGrant[] = [
    {
      id: "fshare_baxter_meridian",
      carrierOrganizationId: "org_baxter",
      dispatchOrganizationId: "org_meridian",
      dispatchOrganizationName: "Meridian Dispatch",
      scope: "listed_trucks",
      truckIds: [TRUCK_IDS.mdA12, TRUCK_IDS.mdA18],
      includesOperationalFuel: true,
      // Deliberately off. A dispatcher moving freight does not need to know
      // what the carrier pays for diesel, and tax filing is not theirs at all.
      includesCosts: false,
      includesTaxFiling: false,
      status: "active",
      startedAt: new Date(now - 120 * 86_400_000).toISOString(),
      grantedBy: SYSTEM_ACTOR,
      createdAt: new Date(now - 120 * 86_400_000).toISOString(),
    },
  ];

  for (const grant of grants) {
    audit.push({
      id: nextFuelId("faud"),
      organizationId: grant.carrierOrganizationId,
      kind: "sharing.granted",
      at: grant.createdAt,
      actor: grant.grantedBy,
      subject: { kind: "sharing", id: grant.id, label: grant.dispatchOrganizationName },
      summary: `${grant.dispatchOrganizationName} was given operational fuel information for ${grant.truckIds.length} trucks. Cost and tax filing were not included.`,
    });
  }

  for (const period of periods) {
    audit.push({
      id: nextFuelId("faud"),
      organizationId: period.organizationId,
      kind: "period.opened",
      at: period.createdAt,
      actor: SYSTEM_ACTOR,
      subject: { kind: "period", id: period.id, label: `Q${period.quarter} ${period.year}` },
      summary: `Q${period.quarter} ${period.year} opened for ${period.carrierNameSnapshot}.`,
    });
    if (period.filing) {
      audit.push({
        id: nextFuelId("faud"),
        organizationId: period.organizationId,
        kind: "period.filed",
        at: period.filing.filedAt,
        actor: period.filing.filedBy,
        subject: { kind: "period", id: period.id, label: `Q${period.quarter} ${period.year}` },
        summary: `Recorded as filed externally, reference ${period.filing.confirmationReference}. Antcolos did not submit it.`,
      });
    }
  }

  const built: FuelState = { transactions, mileage, periods, grants, audit, receipts };
  recomputeFlags(built);
  return built;
}

/* -------------------------------------------------------------------------- */
/* Deliberate problems                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The records that are wrong on purpose.
 *
 * A review queue nobody can exercise is a review queue nobody trusts. Each of
 * these is a failure that happens weekly in a real fleet, planted in the most
 * recent quarter where somebody would actually be working on it, and each one
 * produces exactly one Needs You item through the normal derivation — none of
 * them is a hand-written alert.
 */
function applyDeliberateProblems(
  transactions: FuelTransaction[],
  mileage: JurisdictionMileageRecord[],
  receipts: Document[],
  nowIso: string,
  now: number,
) {
  const northline = transactions.filter(
    (t) => t.organizationId === "org_northline" && t.state === "imported",
  );
  const recent = [...northline].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));

  // 1. A re-imported fuel-card row. Same adapter, same external id, same
  //    everything — the classic double import, and the one duplicate case
  //    that needs no human judgement at all.
  const original = recent[1];
  if (original) {
    const copy: FuelTransaction = {
      ...original,
      id: nextFuelId("fuel"),
      receiptDocumentId: undefined,
      createdAt: new Date(Date.parse(original.createdAt) + 3_600_000).toISOString(),
      createdBy: IMPORT_ACTOR,
      state: "imported",
      revision: { number: 1, originalId: "", isCurrent: true },
      sourceRef: original.sourceRef
        ? { ...original.sourceRef, importBatchId: `${original.sourceRef.importBatchId}-rerun` }
        : undefined,
      notes: "Arrived a second time when the card feed was re-run for the month.",
    };
    copy.revision.originalId = copy.id;
    transactions.push(copy);
  }

  // 2. A price nowhere near what the rest of the fleet paid. Almost always a
  //    mis-keyed pump price; occasionally a different product entirely.
  const odd = recent[2];
  if (odd?.cost) {
    const inflated = roundHalfUp(odd.cost.pricePerGallonMills * 1.85);
    odd.cost = {
      currency: "USD",
      pricePerGallonMills: inflated,
      totalCostCents: roundHalfUp((odd.gallonsThousandths * inflated) / 1_000_000 * 100),
    };
    odd.notes = "Entered from a paper receipt at the end of the week.";
  }

  // 3. An odometer reading lower than the previous one on the same truck.
  const regressed = recent.find((t) => t.odometerMiles !== undefined && t.id !== odd?.id);
  if (regressed && regressed.odometerMiles !== undefined) {
    regressed.odometerMiles = Math.max(0, regressed.odometerMiles - 4_200);
  }

  // 4. A mileage row claiming more taxable miles than it ran in total. An
  //    arithmetic impossibility, and it must never reach a return.
  const badMileage = mileage
    .filter((r) => r.organizationId === "org_northline" && r.state === "imported")
    .sort((a, b) => b.travelStartedAt.localeCompare(a.travelStartedAt))[1];
  if (badMileage) {
    badMileage.taxableMiles = badMileage.totalMiles + 38;
    badMileage.notes = "Corrected total came in from the ELD after the segment closed.";
  }

  // 5. A purchase nothing in the operating-authority history covers. The row
  //    is kept, flagged and put in front of a person — never deleted, and
  //    never quietly attributed to whoever happens to hold the truck today.
  const orphan = recent[0];
  if (orphan) {
    orphan.attribution = { ...UNRESOLVED, resolvedAt: nowIso };
    orphan.notes = "Card was used during the gap between two operating leases.";
  }

  // 6. A receipt that was never filed, in the quarter that has just CLOSED.
  //    The current quarter is where the noise is; the closed one is where the
  //    pressure is, and a foundation that only ever blocks a running quarter
  //    never shows what a return actually gets stuck on.
  const [, previousQuarter] = recentQuarters(nowIso, 2);
  const lastQuarter = transactions
    .filter(
      (t) =>
        t.organizationId === "org_northline" &&
        t.receiptDocumentId &&
        isWithinQuarter(t.purchasedAt, previousQuarter.year, previousQuarter.quarter),
    )
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))[0];
  if (lastQuarter) {
    const orphaned = receipts.findIndex((d) => d.id === lastQuarter.receiptDocumentId);
    if (orphaned >= 0) receipts.splice(orphaned, 1);
    lastQuarter.receiptDocumentId = undefined;
    lastQuarter.notes = "The driver said the receipt was in the truck. It was not in the envelope.";
  }

  // 7. A correction chain. The original stays exactly as it was written, is
  //    marked corrected, and stops counting; revision 2 carries the right
  //    gallons and the reason. Both are readable forever.
  const verified = transactions
    .filter((t) => t.organizationId === "org_northline" && t.state === "verified")
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))[0];
  if (verified) {
    const correctedAt = new Date(Math.min(now - 86_400_000, Date.parse(verified.purchasedAt) + 5 * 86_400_000)).toISOString();
    // The pump printed 84.2 gallons and 8.42 was keyed in, so the ORIGINAL is
    // the wrong one and the revision carries the real figure. Writing it the
    // other way round would leave the current record wrong by a factor of ten
    // and quietly wreck the fleet's MPG.
    const rightGallons = verified.gallonsThousandths;
    const rightCost = verified.cost;
    verified.gallonsThousandths = roundHalfUp(rightGallons / 10);
    if (verified.cost) {
      verified.cost = { ...verified.cost, totalCostCents: roundHalfUp(verified.cost.totalCostCents / 10) };
    }

    const revised: FuelTransaction = {
      ...verified,
      id: nextFuelId("fuel"),
      gallonsThousandths: rightGallons,
      cost: rightCost,
      state: "verified",
      verifiedAt: correctedAt,
      createdAt: correctedAt,
      createdBy: SYSTEM_ACTOR,
      notes: undefined,
      revision: {
        number: 2,
        originalId: verified.revision.originalId,
        supersedesId: verified.id,
        isCurrent: true,
        correctionReason: "Gallons were keyed in with the decimal point one place out. Re-entered from the receipt.",
      },
    };
    // The original does not change. It is superseded, and stops counting.
    verified.revision = { ...verified.revision, isCurrent: false, supersededById: revised.id };
    verified.state = "corrected";
    transactions.push(revised);

    // The receipt follows the current revision — it is the same piece of paper.
    const receipt = receipts.find((d) => d.id === verified.receiptDocumentId);
    if (receipt) {
      receipt.links = [
        { entityKind: "fuel_transaction", entityId: revised.id },
        ...receipt.links.filter((l) => l.entityKind !== "fuel_transaction"),
      ];
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Flags                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The fleet's own average pump price, used as the band a price is judged
 * against. Its own fleet, its own quarter — a national average would flag half
 * of California and none of a genuinely mis-keyed receipt.
 */
export function referencePriceMills(
  transactions: readonly FuelTransaction[],
  organizationId: string,
  fuelType: FuelType,
): number | undefined {
  const peers = transactions.filter(
    (t) =>
      t.organizationId === organizationId &&
      t.fuelType === fuelType &&
      t.revision.isCurrent &&
      t.state !== "rejected" &&
      t.state !== "duplicate",
  );
  const priced = peers.filter((t) => t.cost !== undefined);
  if (priced.length < 3) return undefined;
  return roundHalfUp(
    priced.reduce((s, t) => s + (t.cost?.pricePerGallonMills ?? 0), 0) / priced.length,
  );
}

/**
 * Jurisdictions a truck recorded miles in, for the travel check.
 *
 * Scoped to ONE ledger. A truck run by two carriers has two independent sets
 * of records, and each carrier can only be asked about its own — reaching
 * across would both leak the other carrier's movements and mis-answer the
 * question, since the other carrier's miles are not evidence about this one's.
 */
export function jurisdictionsTravelled(
  mileage: readonly JurisdictionMileageRecord[],
  organizationId: string,
  truckId: string,
): string[] {
  return [
    ...new Set(
      mileage
        .filter(
          (r) =>
            r.organizationId === organizationId &&
            r.truckId === truckId &&
            r.revision.isCurrent &&
            r.state !== "rejected",
        )
        .map((r) => r.jurisdiction),
    ),
  ];
}

/**
 * The rest of one ledger's purchases on a truck — the only history another
 * purchase on it may be judged against. Two carriers running the same truck
 * keep separate odometer series and separate receipts, so mixing them
 * manufactures regressions and duplicates that never happened.
 */
export function ledgerHistoryFor(
  transactions: readonly FuelTransaction[],
  organizationId: string,
  truckId: string,
  excludeId?: string,
): FuelTransaction[] {
  return transactions.filter(
    (t) =>
      t.organizationId === organizationId &&
      t.truckId === truckId &&
      t.id !== excludeId &&
      t.revision.isCurrent,
  );
}

/**
 * Recomputes every flag across the ledger.
 *
 * Flags are STORED, not derived on read: a flag is what a person was shown
 * when they reviewed the record, and recomputing it later would change the
 * history of a decision somebody already made. This runs when a record is
 * written and when the fixtures are built, and nowhere else.
 */
export function recomputeFlags(db: FuelState) {
  const ownLedger = (organizationId: string) =>
    db.transactions.filter((o) => o.organizationId === organizationId);

  for (const t of db.transactions) {
    const match = findDuplicate(t, ownLedger(t.organizationId));
    if (match) t.duplicateOfId = match.transactionId;
    t.flags = validateTransaction({
      transaction: t,
      truckHistory: ledgerHistoryFor(db.transactions, t.organizationId, t.truckId, t.id),
      referencePriceMills: referencePriceMills(db.transactions, t.organizationId, t.fuelType),
      jurisdictionsTravelled: jurisdictionsTravelled(db.mileage, t.organizationId, t.truckId),
      duplicateOfId: match?.transactionId,
    });

    // Anything wrong beyond a missing receipt stops being "just imported" and
    // starts waiting for a person.
    const substantive = t.flags.filter((f) => f !== "missing_receipt");
    if (substantive.length > 0 && (t.state === "manual" || t.state === "imported")) {
      t.state = "pending_review";
    }
  }

  for (const r of db.mileage) {
    r.flags = validateMileage({
      record: r,
      truckRecords: db.mileage.filter(
        (o) => o.organizationId === r.organizationId && o.truckId === r.truckId,
      ),
    });
    if (r.flags.length > 0 && (r.state === "manual" || r.state === "imported")) {
      r.state = "pending_review";
    }
  }
}
