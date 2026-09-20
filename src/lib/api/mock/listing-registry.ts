import type {
  IngestResult, Listing, ListingPlace, ListingSighting, ListingStatus,
  OpportunitySource, RawListingInput, SourceConnection,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The Opportunity Inbox's store, and the boundary everything outside talks to.
 *
 * One canonical Listing per real load. That is the whole job of this file, and
 * it is harder than it sounds: the same load turns up on two boards with two
 * different ids, in a broker's email with none, and typed in by hand by a
 * dispatcher who did not notice. Trusting any source's own identifier gives you
 * four copies; trusting nothing gives you none.
 *
 * So identity is derived from the LOAD — its lane, its pickup day, its
 * equipment and who is offering it — and a second arrival with the same
 * fingerprint folds into the listing already there as another sighting. Nothing
 * is lost: which source said what, when, and at what rate is all kept, because
 * sources disagree about the rate and that disagreement is worth seeing.
 *
 * `ingestListings` is the contract the planned browser extension will use, and
 * the same one a watched mailbox, a spreadsheet upload, a broker feed and the
 * manual-entry form use. It takes loads and nothing else: a collector never
 * says which carrier or truck a load is for, because a collector running inside
 * somebody's browser on a page we do not control must not be able to assert
 * that. Antcolos works it out afterwards, from records the collector cannot see.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 260;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;

function uuid(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const nowIso = () => new Date().toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/* -------------------------------------------------------------------------- */
/* Geography                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Rough coordinates for the places the fixtures use.
 *
 * Enough to compute a believable deadhead and no more. A real system geocodes;
 * this one is honest that it is looking a city up in a short list, and returns
 * nothing at all for a place it does not know rather than guessing a distance.
 */
const PLACES: Record<string, { lat: number; lon: number }> = {
  "chicago,il": { lat: 41.88, lon: -87.63 },
  "joliet,il": { lat: 41.53, lon: -88.08 },
  "aurora,il": { lat: 41.76, lon: -88.32 },
  "rockford,il": { lat: 42.27, lon: -89.09 },
  "gary,in": { lat: 41.59, lon: -87.35 },
  "lafayette,in": { lat: 40.42, lon: -86.89 },
  "indianapolis,in": { lat: 39.77, lon: -86.16 },
  "fort wayne,in": { lat: 41.08, lon: -85.14 },
  "south bend,in": { lat: 41.68, lon: -86.25 },
  "bloomington,il": { lat: 40.48, lon: -88.99 },
  "champaign,il": { lat: 40.12, lon: -88.24 },
  "peoria,il": { lat: 40.69, lon: -89.59 },
  "peru,il": { lat: 41.33, lon: -89.13 },
  "springfield,il": { lat: 39.80, lon: -89.64 },
  "davenport,ia": { lat: 41.52, lon: -90.58 },
  "grand rapids,mi": { lat: 42.96, lon: -85.67 },
  "dayton,oh": { lat: 39.76, lon: -84.19 },
  "cincinnati,oh": { lat: 39.10, lon: -84.51 },
  "columbus,oh": { lat: 39.96, lon: -82.99 },
  "cleveland,oh": { lat: 41.50, lon: -81.69 },
  "toledo,oh": { lat: 41.65, lon: -83.54 },
  "detroit,mi": { lat: 42.33, lon: -83.05 },
  "milwaukee,wi": { lat: 43.04, lon: -87.91 },
  "madison,wi": { lat: 43.07, lon: -89.40 },
  "st. louis,mo": { lat: 38.63, lon: -90.20 },
  "kansas city,mo": { lat: 39.10, lon: -94.58 },
  "nashville,tn": { lat: 36.16, lon: -86.78 },
  "memphis,tn": { lat: 35.15, lon: -90.05 },
  "louisville,ky": { lat: 38.25, lon: -85.76 },
  "portland,or": { lat: 45.52, lon: -122.68 },
  "salem,or": { lat: 44.94, lon: -123.04 },
  "eugene,or": { lat: 44.05, lon: -123.09 },
  "medford,or": { lat: 42.33, lon: -122.87 },
  "bend,or": { lat: 44.06, lon: -121.31 },
  "seattle,wa": { lat: 47.61, lon: -122.33 },
  "tacoma,wa": { lat: 47.25, lon: -122.44 },
  "spokane,wa": { lat: 47.66, lon: -117.43 },
  "vancouver,wa": { lat: 45.64, lon: -122.66 },
  "boise,id": { lat: 43.62, lon: -116.20 },
  "sacramento,ca": { lat: 38.58, lon: -121.49 },
  "reno,nv": { lat: 39.53, lon: -119.81 },
  "newark,nj": { lat: 40.74, lon: -74.17 },
  "allentown,pa": { lat: 40.60, lon: -75.47 },
  "pittsburgh,pa": { lat: 40.44, lon: -79.996 },
  "philadelphia,pa": { lat: 39.95, lon: -75.17 },
  "baltimore,md": { lat: 39.29, lon: -76.61 },
  "richmond,va": { lat: 37.54, lon: -77.44 },
  "norfolk,va": { lat: 36.85, lon: -76.29 },
  "charlotte,nc": { lat: 35.23, lon: -80.84 },
  "raleigh,nc": { lat: 35.78, lon: -78.64 },
  "atlanta,ga": { lat: 33.75, lon: -84.39 },
  "boston,ma": { lat: 42.36, lon: -71.06 },
  "denver,co": { lat: 39.74, lon: -104.99 },
  "greeley,co": { lat: 40.42, lon: -104.71 },
  "pueblo,co": { lat: 38.25, lon: -104.61 },
  "colorado springs,co": { lat: 38.83, lon: -104.82 },
  "salt lake city,ut": { lat: 40.76, lon: -111.89 },
  "albuquerque,nm": { lat: 35.08, lon: -106.65 },
  "phoenix,az": { lat: 33.45, lon: -112.07 },
  "las vegas,nv": { lat: 36.17, lon: -115.14 },
  "cheyenne,wy": { lat: 41.14, lon: -104.82 },
  "new york,ny": { lat: 40.71, lon: -74.01 },
};

const placeKey = (city: string, state: string) =>
  `${city.trim().toLowerCase()},${state.trim().toLowerCase()}`;

export function coordsFor(city?: string, state?: string): { lat: number; lon: number } | undefined {
  if (!city || !state) return undefined;
  return PLACES[placeKey(city, state)];
}

/**
 * Straight-line miles between two places, padded for the fact that roads bend.
 *
 * Returns nothing when either place is unknown. A deadhead we cannot compute is
 * reported as unknown rather than as zero — zero would quietly make every
 * unknown load look like it is parked next door.
 */
export function milesBetween(a?: ListingPlace, b?: ListingPlace): number | undefined {
  const from = a?.lat !== undefined && a.lon !== undefined ? a : coordsFor(a?.city, a?.state);
  const to = b?.lat !== undefined && b.lon !== undefined ? b : coordsFor(b?.city, b?.state);
  if (!from || !to) return undefined;
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(to.lat! - from.lat!);
  const dLon = toRad(to.lon! - from.lon!);
  const s =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.lat!)) * Math.cos(toRad(to.lat!)) * Math.sin(dLon / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(s));
  // Roads are about a fifth longer than a straight line over these distances.
  return Math.round(straight * 1.18);
}

/* -------------------------------------------------------------------------- */
/* Normalisation and identity                                                  */
/* -------------------------------------------------------------------------- */

const tidy = (s?: string) => (s ?? "").trim().replace(/\s+/g, " ");
const upperState = (s: string) => tidy(s).toUpperCase().slice(0, 2);
const titleCity = (s: string) =>
  tidy(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Normalise a broker's name enough to compare it.
 *
 * "Apex Logistics", "APEX LOGISTICS LLC" and "Apex Logistics, Inc." are one
 * broker. Company suffixes are dropped rather than kept, because they are
 * exactly the part that varies between a board posting and an email signature.
 */
function normalizeBroker(name: string): string {
  return tidy(name)
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|lp|llp)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The identity of a LOAD, derived from the load itself.
 *
 * Lane, pickup DAY (not time — boards and emails disagree about the hour),
 * equipment and broker. Two sources describing one real load agree on all four;
 * two genuinely different loads on the same lane the same day for the same
 * broker are rare, and folding them is a smaller error than showing a
 * dispatcher the same load four times and letting them email about it twice.
 */
export function fingerprintFor(input: {
  brokerName: string;
  brokerMcNumber?: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickupAt: string;
  equipment: string;
}): string {
  const day = input.pickupAt.slice(0, 10);
  // The MC number is the better key when a source bothers to give it.
  const broker = input.brokerMcNumber
    ? `mc:${tidy(input.brokerMcNumber).toLowerCase()}`
    : `nm:${normalizeBroker(input.brokerName)}`;
  return [
    broker,
    `${normalizeBroker(input.originCity)}-${upperState(input.originState)}`,
    `${normalizeBroker(input.destinationCity)}-${upperState(input.destinationState)}`,
    day,
    tidy(input.equipment).toLowerCase(),
  ].join("|");
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Partitioned by dispatch organization.
 *
 * An inbox belongs to a workspace. Two dispatch agencies reading the same board
 * genuinely both have that load, and neither is entitled to know the other saw
 * it, what they thought of it, or whether they emailed about it.
 */
const inboxes = new Map<string, Listing[]>();

function bucket(dispatchOrganizationId: string): Listing[] {
  let rows = inboxes.get(dispatchOrganizationId);
  if (!rows) {
    rows = [];
    inboxes.set(dispatchOrganizationId, rows);
  }
  return rows;
}

/** Test hook. Never called by the UI. */
export function resetListings() {
  inboxes.clear();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Ingestion                                                                   */
/* -------------------------------------------------------------------------- */

export interface IngestOptions {
  source: OpportunitySource;
  sourceName: string;
  connection: SourceConnection;
  /** The session that collected them, when one was running. */
  searchSessionId?: string;
}

/** Everything a load needs before it is worth putting in front of anybody. */
function validate(input: RawListingInput): string | null {
  if (!tidy(input.brokerName)) return "No broker name.";
  if (!tidy(input.originCity) || !tidy(input.originState)) return "No origin.";
  if (!tidy(input.destinationCity) || !tidy(input.destinationState)) return "No destination.";
  if (!input.pickupAt || Number.isNaN(Date.parse(input.pickupAt))) return "No usable pickup time.";
  if (!tidy(input.equipment)) return "No equipment type.";
  return null;
}

function toPlace(city: string, state: string): ListingPlace {
  const c = titleCity(city);
  const s = upperState(state);
  const at = coordsFor(c, s);
  return { city: c, state: s, lat: at?.lat, lon: at?.lon };
}

/**
 * Hand a batch of raw listings to Antcolos.
 *
 * THE boundary. Whatever collected them — the planned browser extension, a
 * mailbox, a spreadsheet, a broker's feed, a person typing — arrives here, and
 * everything downstream is identical from this point on. A new source is a new
 * `IngestOptions`, not a new code path.
 *
 * Note what the caller does NOT get to decide: which workspace the listing
 * lands in comes from the context, not the payload, and no caller can say which
 * truck or carrier a load is for. That is worked out afterwards by the matcher,
 * from records a collector cannot see.
 */
export function ingestListings(
  raw: RawListingInput[],
  dispatchOrganizationId: string,
  options: IngestOptions,
): IngestResult {
  const rows = bucket(dispatchOrganizationId);
  const result: IngestResult = {
    accepted: 0, foldedIntoExisting: 0, rejected: [], listingIds: [], matchesCreated: 0,
  };
  const at = nowIso();

  raw.forEach((input, index) => {
    const problem = validate(input);
    if (problem) {
      result.rejected.push({ index, reason: problem });
      return;
    }

    const fingerprint = fingerprintFor({
      brokerName: input.brokerName,
      brokerMcNumber: input.brokerMcNumber,
      originCity: input.originCity,
      originState: input.originState,
      destinationCity: input.destinationCity,
      destinationState: input.destinationState,
      pickupAt: input.pickupAt,
      equipment: input.equipment,
    });

    const sighting: ListingSighting = {
      id: rowId("sight"),
      source: options.source,
      sourceName: options.sourceName,
      connection: options.connection,
      observedAt: at,
      sourceReference: input.sourceReference,
      searchSessionId: options.searchSessionId,
      offeredRateCents: input.offeredRateCents,
    };

    /* ---- Already here? Fold in rather than making a second copy ---- */
    const existing = rows.find((l) => l.fingerprint === fingerprint);
    if (existing) {
      existing.sightings.push(sighting);
      // A later sighting can fill in what the first one did not say. It never
      // overwrites something we already know with nothing.
      if (existing.offeredRateCents === undefined && input.offeredRateCents !== undefined) {
        existing.offeredRateCents = input.offeredRateCents;
        existing.ratePerMileCents = perMile(input.offeredRateCents, existing.loadedMiles);
      }
      if (!existing.broker.email && input.brokerEmail) existing.broker.email = input.brokerEmail;
      if (!existing.broker.phone && input.brokerPhone) existing.broker.phone = input.brokerPhone;
      if (!existing.broker.contactName && input.brokerContactName) {
        existing.broker.contactName = input.brokerContactName;
      }
      if (existing.weightLbs === undefined && input.weightLbs !== undefined) {
        existing.weightLbs = input.weightLbs;
      }
      result.foldedIntoExisting += 1;
      if (!result.listingIds.includes(existing.listingId)) result.listingIds.push(existing.listingId);
      return;
    }

    const origin = toPlace(input.originCity, input.originState);
    const destination = toPlace(input.destinationCity, input.destinationState);
    const loadedMiles = input.loadedMiles ?? milesBetween(origin, destination) ?? 0;

    const listing: Listing = {
      listingId: uuid(),
      fingerprint,
      dispatchOrganizationId,
      source: options.source,
      sourceName: options.sourceName,
      connection: options.connection,
      sourceReference: input.sourceReference,
      observedAt: at,
      sightings: [sighting],
      broker: {
        name: tidy(input.brokerName),
        mcNumber: input.brokerMcNumber,
        contactName: input.brokerContactName,
        email: input.brokerEmail,
        phone: input.brokerPhone,
      },
      origin,
      destination,
      pickupAt: input.pickupAt,
      pickupWindowHours: input.pickupWindowHours,
      deliverBy: input.deliverBy,
      equipment: input.equipment,
      weightLbs: input.weightLbs,
      lengthFt: input.lengthFt,
      commodity: input.commodity,
      hazmat: input.hazmat === true,
      teamRequired: input.teamRequired === true,
      loadedMiles,
      offeredRateCents: input.offeredRateCents,
      ratePerMileCents: perMile(input.offeredRateCents, loadedMiles),
      notes: input.notes,
      status: "open",
      createdAt: at,
    };

    rows.push(listing);
    result.accepted += 1;
    result.listingIds.push(listing.listingId);
  });

  return result;
}

function perMile(rate: number | undefined, miles: number): number | undefined {
  if (rate === undefined || miles <= 0) return undefined;
  return Math.round(rate / miles);
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Every listing in this workspace's inbox, newest sighting first. */
export function listingsFor(dispatchOrganizationId: string): Listing[] {
  return [...bucket(dispatchOrganizationId)].sort(
    (a, b) => lastSeen(b).localeCompare(lastSeen(a)),
  );
}

const lastSeen = (l: Listing) => l.sightings[l.sightings.length - 1]?.observedAt ?? l.observedAt;

export function listingById(
  dispatchOrganizationId: string,
  listingId: string,
): Listing | undefined {
  return bucket(dispatchOrganizationId).find((l) => l.listingId === listingId);
}

/**
 * Mark a listing closed, whoever took it.
 *
 * A listing being covered is a fact about the market, not about us: a broker
 * covering it elsewhere closes it just as surely as us booking it. The reason
 * says which, and the matcher uses this to stand competing matches down.
 */
export function closeListing(
  dispatchOrganizationId: string,
  listingId: string,
  status: Exclude<ListingStatus, "open">,
  reason: string,
): Listing | undefined {
  const listing = listingById(dispatchOrganizationId, listingId);
  if (!listing || listing.status !== "open") return listing;
  listing.status = status;
  listing.closedAt = nowIso();
  listing.closeReason = reason;
  return listing;
}

/** Age out listings whose pickup has gone by. Runs on every read. */
export function expireStaleListings(dispatchOrganizationId: string): number {
  let closed = 0;
  for (const listing of bucket(dispatchOrganizationId)) {
    if (listing.status !== "open") continue;
    // An hour's grace: a pickup time that has just passed is still worth a call.
    if (new Date(listing.pickupAt).getTime() < Date.now() - 3_600_000) {
      listing.status = "expired";
      listing.closedAt = nowIso();
      listing.closeReason = "The pickup time went by.";
      closed += 1;
    }
  }
  return closed;
}

/* -------------------------------------------------------------------------- */
/* The mock sources                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Believable loads for a place and an equipment type.
 *
 * A stand-in, and named as one everywhere it surfaces. It exists so the parts
 * that ARE real — de-duplication, matching, ranking, draft grouping, standing
 * competing matches down — can be built and tested against something that
 * behaves like a market rather than against three hand-written rows.
 *
 * Deliberately imperfect: it returns loads that are too cheap, too far, the
 * wrong equipment and hazmat, because a matcher that has only ever seen good
 * loads has not been tested at all.
 */
interface Seedling {
  broker: string;
  mc?: string;
  mcAgeMonths?: number;
  credit?: number;
  daysToPay?: number;
  contact?: string;
  email?: string;
  phone?: string;
  to: [city: string, state: string];
  hours: number;
  equipment: string;
  rateCents: number;
  weight?: number;
  hazmat?: boolean;
  team?: boolean;
  commodity?: string;
  notes?: string;
}

const BROKERS: Record<string, Omit<Seedling, "to" | "hours" | "equipment" | "rateCents">> = {
  apex: { broker: "Apex Logistics", mc: "MC-612884", mcAgeMonths: 214, credit: 96, daysToPay: 21, contact: "Dana Wells", email: "dana@apexlog.example", phone: "+1 (312) 555-0110" },
  tandem: { broker: "Tandem Freight Partners", mc: "MC-908114", mcAgeMonths: 121, credit: 91, daysToPay: 30, contact: "Priya Raman", email: "priya@tandemfp.example", phone: "+1 (773) 555-0143" },
  keystone: { broker: "Keystone Brokerage", mc: "MC-771203", mcAgeMonths: 88, credit: 84, daysToPay: 35, contact: "Alan Pike", email: "alan@keystonebroker.example" },
  harbor: { broker: "Harbor Point Freight", mc: "MC-998217", mcAgeMonths: 41, credit: 72, daysToPay: 45, contact: "Gil Stanton", email: "gil@harborpoint.example" },
  meadowlark: { broker: "Meadowlark Transport Brokers", mc: "MC-1204880", mcAgeMonths: 4, credit: 61, contact: "Ray Vance", email: "ray@meadowlarkbrokers.example" },
  cedar: { broker: "Cedar Mill Supply", contact: "Gene Halloran", email: "gene@cedarmill.example" },
  ridgeline: { broker: "Ridgeline Logistics", mc: "MC-884012", mcAgeMonths: 160, credit: 93, daysToPay: 25, contact: "Dana Whitlock", email: "dana@ridgelinelog.example" },
  pacline: { broker: "Pacline Logistics", mc: "MC-660119", mcAgeMonths: 143, credit: 89, daysToPay: 28, contact: "Rhea Doss", email: "rhea@pacline.example" },
};

/**
 * Freight moves in regions, not in states.
 *
 * A truck in Gary, Indiana and one in Joliet, Illinois are sixty miles apart
 * and compete for exactly the same Chicago-area freight. Keying the sample
 * market on the truck's own state would mean those two never see a single load
 * in common — and the contention this whole module exists to handle (one
 * listing, several suitable trucks, one draft, one booking) would never arise.
 */
type Region = "midwest" | "northwest" | "mountain" | "northeast" | "southeast";

const REGION_OF: Record<string, Region> = {
  IL: "midwest", IN: "midwest", OH: "midwest", MI: "midwest", WI: "midwest",
  MO: "midwest", KY: "midwest", TN: "midwest",
  OR: "northwest", WA: "northwest", ID: "northwest",
  CO: "mountain", UT: "mountain", NM: "mountain", AZ: "mountain", WY: "mountain", NV: "mountain",
  NJ: "northeast", PA: "northeast", NY: "northeast", MA: "northeast", MD: "northeast",
  VA: "southeast", NC: "southeast", GA: "southeast",
};

/** Where freight is actually offered from, in each region. */
const REGION_PICKUPS: Record<Region, Array<[string, string]>> = {
  midwest: [["Chicago", "IL"], ["Joliet", "IL"], ["Gary", "IN"], ["Indianapolis", "IN"]],
  northwest: [["Portland", "OR"], ["Salem", "OR"], ["Vancouver", "WA"], ["Tacoma", "WA"]],
  mountain: [["Denver", "CO"], ["Greeley", "CO"], ["Colorado Springs", "CO"]],
  northeast: [["Newark", "NJ"], ["Allentown", "PA"], ["Baltimore", "MD"]],
  southeast: [["Richmond", "VA"], ["Norfolk", "VA"], ["Charlotte", "NC"]],
};

/** Lanes the sample market offers out of each region. */
const MARKET: Record<Region, Seedling[]> = {
  midwest: [
    { ...BROKERS.apex, to: ["Columbus", "OH"], hours: 8, equipment: "dry_van", rateCents: 118_000, weight: 34_000, commodity: "Packaged food" },
    { ...BROKERS.tandem, to: ["Nashville", "TN"], hours: 14, equipment: "dry_van", rateCents: 149_000, weight: 38_000, commodity: "Retail freight" },
    { ...BROKERS.keystone, to: ["Detroit", "MI"], hours: 6, equipment: "cargo_van", rateCents: 41_000, weight: 2_900, commodity: "Automotive parts" },
    { ...BROKERS.harbor, to: ["New York", "NY"], hours: 20, equipment: "dry_van", rateCents: 162_000, weight: 36_000, commodity: "General freight", notes: "Receiver is in Queens. Overnight parking is on the driver." },
    { ...BROKERS.meadowlark, to: ["St. Louis", "MO"], hours: 10, equipment: "dry_van", rateCents: 52_000, weight: 30_000, commodity: "Paper goods", notes: "Quick pay offered at 3%." },
    { ...BROKERS.apex, to: ["Milwaukee", "WI"], hours: 5, equipment: "sprinter", rateCents: 26_000, weight: 1_800, commodity: "Medical supplies" },
    { ...BROKERS.tandem, to: ["Memphis", "TN"], hours: 16, equipment: "reefer", rateCents: 178_000, weight: 41_000, commodity: "Frozen goods" },
    { ...BROKERS.keystone, to: ["Louisville", "KY"], hours: 9, equipment: "box_truck", rateCents: 58_000, weight: 9_200, commodity: "Store fixtures" },
    { ...BROKERS.harbor, to: ["Kansas City", "MO"], hours: 12, equipment: "flatbed", rateCents: 134_000, weight: 44_000, commodity: "Steel plate" },
    { ...BROKERS.apex, to: ["Cleveland", "OH"], hours: 7, equipment: "dry_van", rateCents: 96_000, weight: 32_000, commodity: "Packaging", hazmat: true, notes: "Hazmat class 3. Endorsement required." },
    { ...BROKERS.tandem, to: ["Toledo", "OH"], hours: 11, equipment: "flatbed", rateCents: 78_000, weight: 26_000, commodity: "Machinery" },
    { ...BROKERS.apex, to: ["Fort Wayne", "IN"], hours: 6, equipment: "cargo_van", rateCents: 34_000, weight: 2_100, commodity: "Spare parts" },
    { ...BROKERS.keystone, to: ["Madison", "WI"], hours: 13, equipment: "box_truck", rateCents: 67_000, weight: 8_100 },
    { ...BROKERS.tandem, to: ["Rockford", "IL"], hours: 9, equipment: "flatbed", rateCents: 41_000, weight: 18_000, commodity: "Pipe" },
    /*
     * ★ DEPTH IN THE SMALL EQUIPMENT ★
     * The midwest market had two cargo-van lanes and two box-truck lanes, which
     * was fine for one demo truck and not for ten: the fourth van to search
     * found everything already taken and the board showed an empty search
     * rather than a stage. A real board for this fleet has more of these than
     * anything else, because that is what a fleet of straight trucks and vans
     * hauls.
     */
    { ...BROKERS.meadowlark, to: ["Peoria", "IL"], hours: 7, equipment: "cargo_van", rateCents: 38_000, weight: 1_900, commodity: "Printed matter" },
    { ...BROKERS.harbor, to: ["Grand Rapids", "MI"], hours: 10, equipment: "cargo_van", rateCents: 64_000, weight: 2_400, commodity: "Lab supplies" },
    { ...BROKERS.keystone, to: ["Dayton", "OH"], hours: 8, equipment: "cargo_van", rateCents: 66_000, weight: 2_600, commodity: "Aerospace fasteners" },
    { ...BROKERS.apex, to: ["Springfield", "IL"], hours: 6, equipment: "box_truck", rateCents: 44_000, weight: 7_400, commodity: "Shop fittings" },
    { ...BROKERS.harbor, to: ["South Bend", "IN"], hours: 9, equipment: "box_truck", rateCents: 51_000, weight: 8_600, commodity: "Appliances" },
    { ...BROKERS.meadowlark, to: ["Cincinnati", "OH"], hours: 12, equipment: "box_truck", rateCents: 72_000, weight: 9_800, commodity: "Point-of-sale units" },
    { ...BROKERS.tandem, to: ["Davenport", "IA"], hours: 5, equipment: "sprinter", rateCents: 42_000, weight: 1_400, commodity: "Machine spares" },
    { ...BROKERS.keystone, to: ["Champaign", "IL"], hours: 7, equipment: "sprinter", rateCents: 34_000, weight: 1_600, commodity: "Lab equipment" },
    { ...BROKERS.apex, to: ["Peru", "IL"], hours: 8, equipment: "flatbed", rateCents: 46_000, weight: 16_000, commodity: "Structural steel" },
    { ...BROKERS.harbor, to: ["Lafayette", "IN"], hours: 6, equipment: "flatbed", rateCents: 39_000, weight: 14_500, commodity: "Pipe" },
    { ...BROKERS.tandem, to: ["Bloomington", "IL"], hours: 7, equipment: "cargo_van", rateCents: 36_000, weight: 2_200, commodity: "Dental supplies" },
    { ...BROKERS.meadowlark, to: ["Toledo", "OH"], hours: 9, equipment: "cargo_van", rateCents: 58_000, weight: 2_700, commodity: "Electronics" },
  ],
  northwest: [
    { ...BROKERS.pacline, to: ["Seattle", "WA"], hours: 7, equipment: "sprinter", rateCents: 47_000, weight: 2_200, commodity: "Electronics" },
    { ...BROKERS.cedar, to: ["Boise", "ID"], hours: 13, equipment: "box_truck", rateCents: 76_000, weight: 8_800, commodity: "Millwork" },
    { ...BROKERS.pacline, to: ["Sacramento", "CA"], hours: 18, equipment: "dry_van", rateCents: 142_000, weight: 35_000, commodity: "Beverages" },
    { ...BROKERS.meadowlark, to: ["Spokane", "WA"], hours: 11, equipment: "box_truck", rateCents: 31_000, weight: 6_100, commodity: "Retail", notes: "Rate is firm." },
    { ...BROKERS.cedar, to: ["Medford", "OR"], hours: 6, equipment: "sprinter", rateCents: 29_000, weight: 1_500 },
    { ...BROKERS.pacline, to: ["Reno", "NV"], hours: 15, equipment: "reefer", rateCents: 158_000, weight: 39_000, commodity: "Produce" },
    { ...BROKERS.cedar, to: ["Bend", "OR"], hours: 9, equipment: "flatbed", rateCents: 68_000, weight: 22_000, commodity: "Lumber" },
    { ...BROKERS.pacline, to: ["Vancouver", "WA"], hours: 4, equipment: "cargo_van", rateCents: 18_000, weight: 900, commodity: "Documents" },
    { ...BROKERS.cedar, to: ["Eugene", "OR"], hours: 8, equipment: "box_truck", rateCents: 39_000, weight: 7_200, commodity: "Cabinetry" },
    { ...BROKERS.pacline, to: ["Boise", "ID"], hours: 16, equipment: "dry_van", rateCents: 118_000, weight: 33_000, commodity: "Packaged food" },
    { ...BROKERS.meadowlark, to: ["Tacoma", "WA"], hours: 5, equipment: "cargo_van", rateCents: 21_000, weight: 1_700 },
  ],
  mountain: [
    { ...BROKERS.ridgeline, to: ["Salt Lake City", "UT"], hours: 10, equipment: "dry_van", rateCents: 128_000, weight: 33_000 },
    { ...BROKERS.ridgeline, to: ["Albuquerque", "NM"], hours: 9, equipment: "flatbed", rateCents: 88_000, weight: 27_000, commodity: "Pipe" },
    { ...BROKERS.harbor, to: ["Phoenix", "AZ"], hours: 20, equipment: "reefer", rateCents: 196_000, weight: 40_000, commodity: "Produce" },
    { ...BROKERS.meadowlark, to: ["Cheyenne", "WY"], hours: 5, equipment: "dry_van", rateCents: 34_000, weight: 28_000 },
    { ...BROKERS.ridgeline, to: ["Las Vegas", "NV"], hours: 14, equipment: "dry_van", rateCents: 144_000, weight: 31_000 },
    { ...BROKERS.apex, to: ["Pueblo", "CO"], hours: 4, equipment: "box_truck", rateCents: 26_000, weight: 6_800 },
  ],
  northeast: [
    { ...BROKERS.keystone, to: ["Boston", "MA"], hours: 9, equipment: "cargo_van", rateCents: 44_000, weight: 2_600 },
    { ...BROKERS.harbor, to: ["Pittsburgh", "PA"], hours: 11, equipment: "dry_van", rateCents: 92_000, weight: 33_000 },
    { ...BROKERS.apex, to: ["Richmond", "VA"], hours: 12, equipment: "dry_van", rateCents: 104_000, weight: 34_000 },
    { ...BROKERS.keystone, to: ["Philadelphia", "PA"], hours: 6, equipment: "cargo_van", rateCents: 27_000, weight: 1_900 },
    { ...BROKERS.apex, to: ["Raleigh", "NC"], hours: 10, equipment: "dry_van", rateCents: 88_000, weight: 32_000 },
    { ...BROKERS.tandem, to: ["Baltimore", "MD"], hours: 7, equipment: "box_truck", rateCents: 48_000, weight: 8_600 },
    { ...BROKERS.harbor, to: ["Cleveland", "OH"], hours: 15, equipment: "flatbed", rateCents: 118_000, weight: 30_000, commodity: "Structural steel" },
  ],
  southeast: [
    { ...BROKERS.harbor, to: ["Charlotte", "NC"], hours: 8, equipment: "box_truck", rateCents: 62_000, weight: 8_400 },
    { ...BROKERS.keystone, to: ["Baltimore", "MD"], hours: 7, equipment: "dry_van", rateCents: 84_000, weight: 31_000 },
    { ...BROKERS.apex, to: ["Atlanta", "GA"], hours: 16, equipment: "dry_van", rateCents: 154_000, weight: 37_000 },
    { ...BROKERS.tandem, to: ["Raleigh", "NC"], hours: 6, equipment: "cargo_van", rateCents: 32_000, weight: 2_300 },
    { ...BROKERS.meadowlark, to: ["Norfolk", "VA"], hours: 5, equipment: "flatbed", rateCents: 29_000, weight: 16_000 },
  ],
};

/**
 * Produce what a source would return for one search.
 *
 * `spread` is how many of the region's lanes this source happens to carry — two
 * sources looking at the same market return overlapping but not identical sets,
 * which is exactly the condition de-duplication has to survive.
 */
export function sampleListingsFor(
  originCity: string | undefined,
  originState: string | undefined,
  opts: { take?: number; skip?: number; rateDrift?: number } = {},
): RawListingInput[] {
  if (!originCity || !originState) return [];
  const region = REGION_OF[upperState(originState)];
  if (!region) return [];
  const lanes = MARKET[region];
  const pickups = REGION_PICKUPS[region];
  if (lanes.length === 0) return [];

  const take = opts.take ?? lanes.length;
  const skip = opts.skip ?? 0;
  const drift = opts.rateDrift ?? 0;

  return lanes.slice(skip, skip + take).map((lane, i) => {
    // The pickup city is a property of the LANE, not of whoever searched: two
    // trucks in the same region asking about the same lane must get the same
    // load, or the fingerprint differs and they each get their own copy.
    const index = (skip + i) % pickups.length;
    const [pickCity, pickState] = pickups[index];
    return {
    sourceReference: `${region}-${skip + i}`,
    brokerName: lane.broker,
    brokerMcNumber: lane.mc,
    brokerContactName: lane.contact,
    brokerEmail: lane.email,
    brokerPhone: lane.phone,
    originCity: pickCity,
    originState: pickState,
    destinationCity: lane.to[0],
    destinationState: lane.to[1],
    pickupAt: hoursFromNow(lane.hours),
    pickupWindowHours: 3,
    deliverBy: hoursFromNow(lane.hours + Math.max(8, Math.round(lane.rateCents / 9_000))),
    equipment: lane.equipment as RawListingInput["equipment"],
    weightLbs: lane.weight,
    commodity: lane.commodity,
    hazmat: lane.hazmat === true,
    teamRequired: lane.team === true,
    // Sources quote the same load slightly differently. That is the point.
    offeredRateCents: Math.round(lane.rateCents * (1 + drift)),
    notes: lane.notes,
    };
  });
}

/** Broker reputation the sample market knows about, for the checks to read. */
export function sampleBrokerFacts(name: string): {
  mcAgeMonths?: number; creditScore?: number; daysToPay?: number;
} {
  const key = normalizeBroker(name);
  for (const b of Object.values(BROKERS)) {
    if (normalizeBroker(b.broker) === key) {
      return { mcAgeMonths: b.mcAgeMonths, creditScore: b.credit, daysToPay: b.daysToPay };
    }
  }
  return {};
}

export async function listingsForAsync(dispatchOrganizationId: string): Promise<Listing[]> {
  await sleep(LATENCY_MS);
  return listingsFor(dispatchOrganizationId);
}
