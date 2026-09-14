import type {
  CarrierView, CollectorFilterProfile, DriverView, FleetTruck, Listing,
  MatchCheck, MatchCheckKey, MatchCheckOutcome, MatchEvent, MtLoop,
  OpportunityMatch, MatchWithListing,
} from "@/types";
import { CHECK_LABEL } from "@/types";
import {
  closeListing, expireStaleListings, listingById, listingsFor, milesBetween,
  sampleBrokerFacts,
} from "./listing-registry";
import { carrierForTruckSync } from "./carrier-registry";
import { driverViewSync } from "./driver-registry";
import { fleetSync, truckContextFrom } from "./truck-registry";
import { openLoopsFor, type MtLoopContext } from "./mt-loop";
import { mockStore } from "./store";
import { observeDecision, rankingPreferences, scoreMatch, type ScoringInput } from "./ranking";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Turning listings into candidates for one particular truck.
 *
 * A listing is a fact about the market. A MATCH is an opinion about one truck,
 * and the same listing produces a different opinion for every truck it is
 * considered against — different deadhead, different carrier rules, a different
 * driver with different hours and a different idea of when they want to be
 * home. That is why a match is its own record with its own checks rather than a
 * flag on the listing.
 *
 * Every check reports an outcome AND a sentence, and `unknown` is a real
 * outcome distinct from `fail`. A broker with no credit score recorded has not
 * failed the credit check; treating those the same would quietly bury perfectly
 * good freight from brokers nobody has got round to looking up.
 *
 * Ineligible matches are KEPT. A dispatcher who is told "nothing suits this
 * truck" learns nothing; one who is told "eleven loads, and here is the one
 * thing wrong with each" can go and fix the thing — raise the deadhead limit,
 * chase the medical card, ring the carrier about the authority.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 280;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

function uuid(): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const matchesByOrg = new Map<string, OpportunityMatch[]>();

function bucket(dispatchOrganizationId: string): OpportunityMatch[] {
  let rows = matchesByOrg.get(dispatchOrganizationId);
  if (!rows) {
    rows = [];
    matchesByOrg.set(dispatchOrganizationId, rows);
  }
  return rows;
}

/** Test hook. Never called by the UI. */
export function resetMatches() {
  matchesByOrg.clear();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* What one truck brings to the comparison                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything about one truck that a listing gets compared against.
 *
 * Assembled once per truck from the registries — never passed in by a caller —
 * so a match cannot be computed against a truck the caller has invented, and so
 * the carrier's rules, the driver's preferences and the vehicle's paperwork are
 * all the real ones.
 */
export interface TruckMatchContext {
  loop: MtLoop;
  truck: FleetTruck;
  carrier?: CarrierView;
  driver?: DriverView;
  /** Capacity, from the vehicle's own specification. */
  maxWeightLbs?: number;
  minRatePerMileCents: number;
  maxDeadheadMiles: number;
  refusedStates: string[];
  hazmatAllowed: boolean;
  driverConsentRequired: boolean;
  /** Vehicle paperwork problems that stop a dispatch. */
  blockingDocumentProblem?: string;
}

/**
 * Have we actually moved freight for this broker before?
 *
 * Read from the workspace's own customer records rather than invented. It is
 * the single most useful thing a dispatcher knows about a broker — a name you
 * have been paid by twice is worth more than a credit score you looked up — and
 * leaving it permanently unknown would make "broker you can trust" a factor
 * that never does any work.
 *
 * Matched on a normalised name for the same reason listings are: the customer
 * record says "Apex Logistics" and the board posting says "APEX LOGISTICS LLC".
 */
function workedWithBefore(brokerName: string, organizationId: string): boolean {
  const wanted = normalizeName(brokerName);
  return mockStore.org(organizationId).customers.some(
    (c) => normalizeName(c.name) === wanted,
  );
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|lp|llp)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A carrier rule's number, when the carrier has set one. */
function ruleNumber(carrier: CarrierView | undefined, kind: string): number | undefined {
  return carrier?.rules.find((r) => r.kind === kind)?.numberValue;
}

function ruleList(carrier: CarrierView | undefined, kind: string): string[] {
  return carrier?.rules.find((r) => r.kind === kind)?.listValue ?? [];
}

const hasRule = (carrier: CarrierView | undefined, kind: string) =>
  carrier?.rules.some((r) => r.kind === kind) === true;

export function truckMatchContext(loop: MtLoop, ctx: MtLoopContext): TruckMatchContext | undefined {
  const truckCtx = truckContextFrom(ctx);
  const truck = fleetSync(truckCtx).find((t) => t.truckId === loop.truckId);
  if (!truck) return undefined;

  const carrier = carrierForTruckSync(loop.truckId, truckCtx);
  const driver = loop.driverProfileId
    ? driverViewSync(loop.driverProfileId, truckCtx, carrier?.organizationId)
    : undefined;

  // The carrier's floor wins over the truck relationship's, when it is higher:
  // the carrier setting a policy is a stronger statement than a default on a
  // relationship row, and taking the lower of the two would undercut them.
  const carrierFloor = ruleNumber(carrier, "minimum_rate_per_mile");
  const carrierDeadhead = ruleNumber(carrier, "max_deadhead_miles");

  // The operating parameters on a truck relationship belong to the CARRIER that
  // holds it. A dispatch workspace holds no such relationship, so `FleetTruck`
  // hands it a fallback default — and taking that as fact is how a search for a
  // carrier who allows 75 empty miles ends up looking for 30. When the viewer
  // is not the operating carrier, the carrier's own rule is the only real
  // number, and the relationship default is ignored entirely.
  const isDispatchWorkspace = truck.carrierOrganizationId !== undefined;
  const minRate = isDispatchWorkspace
    ? (carrierFloor ?? truck.minimumRatePerMileCents)
    : Math.max(truck.minimumRatePerMileCents, carrierFloor ?? 0);
  const maxDeadhead = isDispatchWorkspace
    ? (carrierDeadhead ?? truck.maxDeadheadMiles)
    : Math.min(
      truck.maxDeadheadMiles || Number.MAX_SAFE_INTEGER,
      carrierDeadhead ?? Number.MAX_SAFE_INTEGER,
    );

  return {
    loop,
    truck,
    carrier,
    driver,
    maxWeightLbs: ruleNumber(carrier, "max_weight_lbs"),
    minRatePerMileCents: minRate,
    maxDeadheadMiles: maxDeadhead,
    refusedStates: ruleList(carrier, "refused_states"),
    hazmatAllowed: !hasRule(carrier, "no_hazmat"),
    driverConsentRequired: hasRule(carrier, "driver_consent_required"),
    blockingDocumentProblem: loop.blockOrigin === "system" ? loop.blockReason : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The filter profile an outside collector gets                                */
/* -------------------------------------------------------------------------- */

/**
 * What a collector may know, so it can throw away the obvious misses itself.
 *
 * A load board page has hundreds of rows and nearly all of them are wrong for
 * this truck. Filtering in the browser means only plausible loads ever travel,
 * which is the difference between an extension that is useful and one that
 * floods the inbox.
 *
 * Every field here is a number, a date, a state code or an equipment type.
 * There is no carrier name, no MC number, no broker, no driver name, no truck
 * identifier, no organization or membership id, no email and no credential. If
 * the page the extension is running on were hostile, this is all it could take,
 * and none of it is worth taking.
 */
export function collectorFilterProfile(tc: TruckMatchContext): CollectorFilterProfile {
  const driver = tc.driver;
  const homeState = driver?.availability.homeTerminal?.split(",").pop()?.trim();

  return {
    // An opaque handle, not the truck id: a collector that leaks this leaks a
    // random string, and results come back through it without ever naming the
    // vehicle or its carrier.
    profileId: `cfp_${tc.loop.loopId.slice(0, 8)}`,
    dispatchCycleRef: tc.loop.loopId,

    equipment: mapEquipment(tc.truck.equipment),
    maxWeightLbs: tc.maxWeightLbs,

    originCity: tc.loop.expectedEmptyCity,
    originState: tc.loop.expectedEmptyState,
    availableAt: tc.loop.expectedEmptyAt,

    maxDeadheadMiles: Number.isFinite(tc.maxDeadheadMiles) ? tc.maxDeadheadMiles : 250,
    minRatePerMileCents: tc.minRatePerMileCents,
    refusedStates: tc.refusedStates,
    hazmatAllowed: tc.hazmatAllowed && driver?.preferences.endorsements?.includes("Hazmat") === true,
    teamAvailable: driver?.preferences.runsTeam === true,

    minBrokerCreditScore: undefined,
    minBrokerMcAgeMonths: undefined,

    driverHoursRemaining: hoursRemaining(driver),
    homeByAt: undefined,

    omittedOnPurpose: [
      "carrier name, MC and DOT numbers",
      "broker names and contacts",
      "driver name, licence and phone",
      "truck, trailer and unit identifiers",
      "organization and membership ids",
      "any email address",
      "any credential or token",
    ],
    generatedAt: nowIso(),
    // `homeState` is deliberately not sent; it narrows a fleet to a region and
    // buys the filter almost nothing a deadhead limit does not already buy.
    ...(homeState ? {} : {}),
  };
}

/** A rough hours figure from the driver's own note. Never computed as fact. */
function hoursRemaining(driver?: DriverView): number | undefined {
  const note = driver?.availability.hoursNote;
  if (!note) return undefined;
  const match = /(\d+)\s*h/i.exec(note);
  return match ? Number(match[1]) : undefined;
}

/** Truck equipment and load equipment are two vocabularies. Bridge them. */
function mapEquipment(truck: FleetTruck["equipment"]): Listing["equipment"] {
  switch (truck) {
    case "cargo_van": return "cargo_van";
    case "sprinter_van": return "sprinter";
    case "box_truck": return "box_truck";
    case "hotshot": return "flatbed";
    case "tractor": return "dry_van";
  }
}

/** What a truck can legitimately take, beyond its nominal type. */
function equipmentFits(truck: FleetTruck["equipment"], listing: Listing["equipment"]): boolean {
  const fits: Record<FleetTruck["equipment"], Listing["equipment"][]> = {
    cargo_van: ["cargo_van"],
    sprinter_van: ["cargo_van", "sprinter"],
    box_truck: ["cargo_van", "sprinter", "box_truck"],
    hotshot: ["flatbed"],
    // A tractor takes whatever its trailer is rated for. Which trailer is
    // actually on it is checked separately, as its own honest question.
    tractor: ["dry_van", "reefer", "flatbed"],
  };
  return fits[truck].includes(listing);
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                      */
/* -------------------------------------------------------------------------- */

const check = (
  key: MatchCheckKey,
  outcome: MatchCheckOutcome,
  detail: string,
  blocking = true,
): MatchCheck => ({ key, label: CHECK_LABEL[key], outcome, detail, blocking });

/**
 * Every dimension, for one listing against one truck.
 *
 * The order is the order a dispatcher would think in: can it physically take
 * it, can it get there, is it worth doing, and is anybody going to get paid.
 */
export function evaluateChecks(listing: Listing, tc: TruckMatchContext): MatchCheck[] {
  const out: MatchCheck[] = [];
  const deadhead = milesBetween(
    { city: tc.loop.expectedEmptyCity ?? "", state: tc.loop.expectedEmptyState ?? "" },
    listing.origin,
  );

  /* ---- Can it physically take it ---- */
  out.push(
    equipmentFits(tc.truck.equipment, listing.equipment)
      ? check("equipment", "pass", `${listing.equipment.replace(/_/g, " ")} suits a ${tc.truck.equipment.replace(/_/g, " ")}.`)
      : check("equipment", "fail", `Needs ${listing.equipment.replace(/_/g, " ")}; this is a ${tc.truck.equipment.replace(/_/g, " ")}.`),
  );

  const capacity = tc.truck.equipment === "tractor" ? tc.maxWeightLbs : truckPayload(tc);
  if (listing.weightLbs === undefined) {
    out.push(check("capacity", "unknown", "No weight posted.", false));
  } else if (capacity === undefined) {
    out.push(check("capacity", "unknown", `${listing.weightLbs.toLocaleString()} lb, and no capacity recorded for this truck.`, false));
  } else if (listing.weightLbs > capacity) {
    out.push(check("capacity", "fail", `${listing.weightLbs.toLocaleString()} lb against a limit of ${capacity.toLocaleString()} lb.`));
  } else {
    out.push(check("capacity", "pass", `${listing.weightLbs.toLocaleString()} lb of ${capacity.toLocaleString()} lb.`));
  }

  out.push(
    listing.hazmat && !tc.hazmatAllowed
      ? check("hazmat", "fail", "Hazmat, and this carrier does not run it.")
      : listing.hazmat
        ? check("hazmat", tc.driver?.preferences.endorsements?.includes("Hazmat")
          ? "pass" : "fail",
          tc.driver?.preferences.endorsements?.includes("Hazmat")
            ? "Hazmat, and the driver holds the endorsement."
            : "Hazmat, and the driver does not hold the endorsement.")
        : check("hazmat", "pass", "Not hazmat.", false),
  );

  /* ---- Can it get there ---- */
  if (deadhead === undefined) {
    out.push(check("deadhead", "unknown", "Cannot work out the empty miles: the truck's location is not recorded.", false));
  } else if (deadhead > tc.maxDeadheadMiles) {
    out.push(check("deadhead", "fail", `${deadhead} empty miles against a limit of ${tc.maxDeadheadMiles}.`));
  } else {
    out.push(check("deadhead", "pass", `${deadhead} empty miles, within ${tc.maxDeadheadMiles}.`));
  }

  const emptyAt = tc.loop.expectedEmptyAt ? new Date(tc.loop.expectedEmptyAt).getTime() : undefined;
  const pickup = new Date(listing.pickupAt).getTime();
  if (emptyAt === undefined) {
    out.push(check("pickup_feasible", "unknown", "No empty time recorded, so nobody can say whether it makes the pickup.", false));
  } else {
    // About fifty miles an hour once you allow for stopping and traffic.
    const driveHours = (deadhead ?? 0) / 50;
    const slackHours = (pickup - emptyAt) / 3_600_000 - driveHours;
    if (slackHours < 0) {
      out.push(check("pickup_feasible", "fail", `Would miss the pickup by about ${Math.round(-slackHours)}h.`));
    } else if (slackHours < 2) {
      out.push(check("pickup_feasible", "warn", `Only about ${Math.round(slackHours)}h to spare. Tight.`, false));
    } else {
      out.push(check("pickup_feasible", "pass", `About ${Math.round(slackHours)}h to spare.`, false));
    }
  }

  const hours = hoursRemaining(tc.driver);
  if (hours === undefined) {
    out.push(check("hours_of_service", "unknown", "No hours recorded for the driver.", false));
  } else {
    const needed = ((deadhead ?? 0) + listing.loadedMiles) / 50;
    out.push(
      needed > hours + 11
        ? check("hours_of_service", "warn", `About ${Math.round(needed)}h of driving against ${hours}h left today. Needs a reset on the way.`, false)
        : check("hours_of_service", "pass", `About ${Math.round(needed)}h of driving; ${hours}h left today.`, false),
    );
  }

  /* ---- Is it worth doing ---- */
  const totalMiles = (deadhead ?? 0) + listing.loadedMiles;
  const allIn = listing.offeredRateCents !== undefined && totalMiles > 0
    ? Math.round(listing.offeredRateCents / totalMiles)
    : undefined;

  if (listing.ratePerMileCents === undefined) {
    out.push(check("rate", "unknown", "No rate posted. Worth a call to find out.", false));
  } else if (listing.ratePerMileCents < tc.minRatePerMileCents) {
    out.push(check("rate", "fail", `$${(listing.ratePerMileCents / 100).toFixed(2)}/mi against a floor of $${(tc.minRatePerMileCents / 100).toFixed(2)}.`));
  } else {
    out.push(check("rate", "pass", `$${(listing.ratePerMileCents / 100).toFixed(2)}/mi, over the $${(tc.minRatePerMileCents / 100).toFixed(2)} floor.`));
  }

  const profit = estimateProfit(listing, deadhead ?? 0);
  if (profit === undefined) {
    out.push(check("profitability", "unknown", "Not enough posted to work out what is left.", false));
  } else if (profit < 0) {
    out.push(check("profitability", "fail", `Loses about $${Math.abs(Math.round(profit / 100))} once the empty miles and fuel are paid.`));
  } else if (profit < 25_000) {
    out.push(check("profitability", "warn", `About $${Math.round(profit / 100)} left. Thin.`, false));
  } else {
    out.push(check("profitability", "pass", `About $${Math.round(profit / 100)} left after the empty miles and fuel.`, false));
  }

  /* ---- Carrier and driver rules ---- */
  const refused = tc.refusedStates.filter(
    (s) => s === listing.destination.state || s === listing.origin.state,
  );
  out.push(
    refused.length
      ? check("carrier_rule", "fail", `${tc.carrier?.displayName ?? "This carrier"} does not run ${refused.join(", ")}.`)
      : check("carrier_rule", "pass", `Nothing in ${tc.carrier?.displayName ?? "the carrier"}'s rules stops it.`),
  );

  const avoid = tc.driver?.preferences.avoidStates ?? [];
  const prefers = tc.driver?.preferences.preferredStates ?? [];
  if (avoid.includes(listing.destination.state)) {
    // A preference is not a rule: it warns, it never rules a load out.
    out.push(check("driver_preference", "warn", `${tc.driver?.legalName ?? "The driver"} asked not to run ${listing.destination.state}.`, false));
  } else if (prefers.includes(listing.destination.state)) {
    out.push(check("driver_preference", "pass", `${listing.destination.state} is where they want to run.`, false));
  } else {
    out.push(check("driver_preference", "unknown", "Nothing recorded either way.", false));
  }

  const homeBy = tc.driver?.preferences.homeBy;
  out.push(
    homeBy
      ? check("home_time", "warn", `${homeBy}. Check the delivery against that.`, false)
      : check("home_time", "unknown", "Nothing recorded about home time.", false),
  );

  /* ---- Can anybody actually run it ---- */
  out.push(
    tc.carrier === undefined
      ? check("operating_authority", "unknown", "The carrier's record is not visible to this workspace.", false)
      : tc.carrier.canHaul
        ? check("operating_authority", "pass", `${tc.carrier.displayName}'s authority is active.`)
        : check("operating_authority", "fail", `${tc.carrier.displayName} cannot legally haul right now.`),
  );

  out.push(
    tc.blockingDocumentProblem
      ? check("documents", "fail", tc.blockingDocumentProblem)
      : check("documents", "pass", "Nothing on the truck's paperwork stops it."),
  );

  /* ---- Is anybody going to get paid ---- */
  const facts = sampleBrokerFacts(listing.broker.name);
  const credit = listing.broker.creditScore ?? facts.creditScore;
  const mcAge = listing.broker.mcAgeMonths ?? facts.mcAgeMonths;
  const creditFloor = tc.carrier?.rules.find((r) => r.kind === "broker_credit_minimum");

  if (credit === undefined) {
    out.push(check("broker_credit", "unknown", "Nobody has looked this broker up.", false));
  } else if (creditFloor?.numberValue !== undefined && credit < creditFloor.numberValue) {
    out.push(check(
      "broker_credit",
      creditFloor.blocking ? "fail" : "warn",
      `Credit ${credit}, under ${tc.carrier?.displayName}'s bar of ${creditFloor.numberValue}.`,
      creditFloor.blocking,
    ));
  } else if (credit < 70) {
    out.push(check("broker_credit", "warn", `Credit ${credit}. Ask for quick pay or a partial up front.`, false));
  } else {
    const known = workedWithBefore(listing.broker.name, tc.truck.organizationId);
    out.push(check(
      "broker_credit",
      "pass",
      `Credit ${credit}${facts.daysToPay ? `, pays in about ${facts.daysToPay} days` : ""}${known ? ". You have run for them before" : ""}.`,
      false,
    ));
  }

  if (mcAge === undefined) {
    out.push(check("mc_age", "unknown", "No MC number to check.", false));
  } else if (mcAge < 6) {
    out.push(check("mc_age", "warn", `MC is only ${mcAge} months old. Very new. Worth a credit check before you commit.`, false));
  } else {
    out.push(check("mc_age", "pass", `MC has been going ${Math.round(mcAge / 12)} years.`, false));
  }

  void allIn;
  return out;
}

function truckPayload(tc: TruckMatchContext): number | undefined {
  // The registry's FleetTruck does not carry the specification, so the carrier's
  // own weight rule is the only limit this workspace can see. Saying "unknown"
  // is better than inventing a number for a vehicle nobody measured.
  return tc.maxWeightLbs;
}

/**
 * What is left after the empty miles and the fuel.
 *
 * A deliberately simple model — a flat cost per mile — and it says so wherever
 * it surfaces. Real costing is a settlements question, and pretending to it
 * here would put a number in front of a dispatcher that nobody can reconcile.
 */
const COST_PER_MILE_CENTS = 78;

export function estimateProfit(listing: Listing, deadheadMiles: number): number | undefined {
  if (listing.offeredRateCents === undefined) return undefined;
  const total = listing.loadedMiles + deadheadMiles;
  if (total <= 0) return undefined;
  return Math.round(listing.offeredRateCents - total * COST_PER_MILE_CENTS);
}

/** True when nothing that blocks a dispatch has failed. */
export function isEligible(checks: MatchCheck[]): boolean {
  return !checks.some((c) => c.blocking && c.outcome === "fail");
}

/** The reasons a match is not eligible, in the order a person would say them. */
export function blockingReasons(checks: MatchCheck[]): MatchCheck[] {
  return checks.filter((c) => c.blocking && c.outcome === "fail");
}

/* -------------------------------------------------------------------------- */
/* Building matches                                                            */
/* -------------------------------------------------------------------------- */

function buildMatch(
  listing: Listing,
  tc: TruckMatchContext,
  ctx: MtLoopContext,
  searchSessionId: string | undefined,
): OpportunityMatch {
  const deadhead = milesBetween(
    { city: tc.loop.expectedEmptyCity ?? "", state: tc.loop.expectedEmptyState ?? "" },
    listing.origin,
  ) ?? 0;
  const checks = evaluateChecks(listing, tc);
  const totalMiles = deadhead + listing.loadedMiles;
  const allIn = listing.offeredRateCents !== undefined && totalMiles > 0
    ? Math.round(listing.offeredRateCents / totalMiles)
    : undefined;
  const profit = estimateProfit(listing, deadhead);
  const facts = sampleBrokerFacts(listing.broker.name);

  const scoring: ScoringInput = {
    listing,
    deadheadMiles: deadhead,
    loadedMiles: listing.loadedMiles,
    allInRatePerMileCents: allIn,
    estimatedProfitCents: profit,
    minRatePerMileCents: tc.minRatePerMileCents,
    maxDeadheadMiles: Number.isFinite(tc.maxDeadheadMiles) ? tc.maxDeadheadMiles : 250,
    preferredStates: tc.driver?.preferences.preferredStates,
    avoidStates: tc.driver?.preferences.avoidStates,
    homeState: tc.driver?.availability.homeTerminal?.split(",").pop()?.trim(),
    brokerCreditScore: listing.broker.creditScore ?? facts.creditScore,
    brokerMcAgeMonths: listing.broker.mcAgeMonths ?? facts.mcAgeMonths,
    workedWithBefore: listing.broker.workedWithBefore
      ?? workedWithBefore(listing.broker.name, ctx.organizationId),
  };

  const score = scoreMatch(scoring, rankingPreferences(ctx.organizationId).weights);
  const at = nowIso();
  const eligible = isEligible(checks);

  const event: MatchEvent = {
    id: rowId("me"),
    at,
    action: "created",
    actorName: "Antcolos",
    note: eligible
      ? undefined
      : blockingReasons(checks).map((c) => c.detail).join(" "),
  };

  return {
    matchId: uuid(),
    listingId: listing.listingId,
    dispatchCycleId: tc.loop.loopId,
    truckId: tc.truck.truckId,
    truckUnit: tc.truck.unit,
    carrierOrganizationId: tc.carrier?.organizationId ?? ctx.organizationId,
    carrierName: tc.carrier?.displayName ?? "This carrier",
    dispatchOrganizationId: ctx.organizationId,
    status: eligible ? "eligible" : "ineligible",
    score,
    checks,
    deadheadMiles: deadhead,
    loadedMiles: listing.loadedMiles,
    totalMiles,
    allInRatePerMileCents: allIn,
    estimatedProfitCents: profit,
    searchSessionId,
    createdAt: at,
    history: [event],
  };
}

/**
 * Make sure every open listing has been considered against every open cycle.
 *
 * Idempotent by (listing, truck): running it twice does not produce two matches
 * for one pair, which is what stops the inbox from doubling every time somebody
 * opens a page. A match that already exists is RESCORED rather than rebuilt, so
 * a dispatcher's short-listing survives a weight change.
 */
export function reconcileMatches(ctx: MtLoopContext, searchSessionId?: string): number {
  expireStaleListings(ctx.organizationId);
  const rows = bucket(ctx.organizationId);
  const listings = listingsFor(ctx.organizationId);
  const loops = openLoopsFor(ctx);
  const weights = rankingPreferences(ctx.organizationId).weights;
  let created = 0;

  for (const loop of loops) {
    const tc = truckMatchContext(loop, ctx);
    if (!tc) continue;

    for (const listing of listings) {
      const existing = rows.find(
        (m) => m.listingId === listing.listingId && m.truckId === loop.truckId,
      );

      /* ---- A listing that has gone stands its matches down ---- */
      if (listing.status !== "open") {
        if (existing && existing.status !== "closed_listing_gone" && existing.status !== "booked") {
          existing.status = "closed_listing_gone";
          existing.history.push({
            id: rowId("me"), at: nowIso(), action: "listing_closed",
            actorName: "Antcolos",
            note: listing.closeReason ?? `The listing is ${listing.status}.`,
          });
        }
        continue;
      }

      if (!existing) {
        rows.push(buildMatch(listing, tc, ctx, searchSessionId));
        created += 1;
        continue;
      }

      // Rescore in place. A dispatcher's decision is theirs and survives.
      if (existing.status === "eligible" || existing.status === "ineligible"
        || existing.status === "shortlisted") {
        const rebuilt = buildMatch(listing, tc, ctx, existing.searchSessionId);
        const scoreChanged = Math.abs(rebuilt.score.total - existing.score.total) >= 1;
        existing.score = rebuilt.score;
        existing.checks = rebuilt.checks;
        existing.deadheadMiles = rebuilt.deadheadMiles;
        existing.totalMiles = rebuilt.totalMiles;
        existing.allInRatePerMileCents = rebuilt.allInRatePerMileCents;
        existing.estimatedProfitCents = rebuilt.estimatedProfitCents;
        if (existing.status !== "shortlisted") {
          existing.status = isEligible(rebuilt.checks) ? "eligible" : "ineligible";
        }
        if (scoreChanged) {
          existing.history.push({
            id: rowId("me"), at: nowIso(), action: "rescored", actorName: "Antcolos",
          });
        }
      }
    }
  }

  void weights;
  return created;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Best first, then the rest — every one of them, with its reasons. */
export function rankMatches(rows: MatchWithListing[]): MatchWithListing[] {
  const rank = (r: MatchWithListing) => {
    const s = r.match.status;
    if (s === "booked") return 0;
    if (s === "shortlisted") return 1;
    if (s === "eligible") return 2;
    if (s === "ineligible") return 3;
    if (s === "dismissed") return 4;
    return 5;
  };
  return [...rows].sort((a, b) => {
    const byStatus = rank(a) - rank(b);
    if (byStatus !== 0) return byStatus;
    return b.match.score.total - a.match.score.total;
  });
}

/** Every match for one dispatch cycle, ranked. */
export function matchesForCycle(dispatchCycleId: string, ctx: MtLoopContext): MatchWithListing[] {
  const rows = bucket(ctx.organizationId).filter((m) => m.dispatchCycleId === dispatchCycleId);
  return rankMatches(withListings(rows, ctx.organizationId));
}

/** Every match in the workspace, ranked. The inbox's own list. */
export function allMatches(ctx: MtLoopContext): MatchWithListing[] {
  return rankMatches(withListings(bucket(ctx.organizationId), ctx.organizationId));
}

function withListings(rows: OpportunityMatch[], organizationId: string): MatchWithListing[] {
  const out: MatchWithListing[] = [];
  for (const match of rows) {
    const listing = listingById(organizationId, match.listingId);
    if (listing) out.push({ match, listing });
  }
  return out;
}

export function matchById(matchId: string, ctx: MtLoopContext): OpportunityMatch | undefined {
  return bucket(ctx.organizationId).find((m) => m.matchId === matchId);
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

export type MatchOutcome =
  | { status: "ok"; match: OpportunityMatch }
  | { status: "not_found" }
  | { status: "not_permitted" }
  | { status: "needs_reason" };

function mayAct(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

/** Put a match on the short list, and tell the learning it was pursued. */
export async function shortlistMatch(matchId: string, ctx: MtLoopContext): Promise<MatchOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const match = matchById(matchId, ctx);
  if (!match) return { status: "not_found" };
  if (match.status === "booked" || match.status === "closed_listing_gone") {
    return { status: "not_permitted" };
  }

  match.status = "shortlisted";
  match.history.push({
    id: rowId("me"), at: nowIso(), action: "shortlisted",
    actorMembershipId: ctx.membershipId, actorName: ctx.actor.displayNameSnapshot,
  });

  const listing = listingById(ctx.organizationId, match.listingId);
  if (listing) observeDecision(ctx.organizationId, match, listing, true);
  return { status: "ok", match };
}

/** Throw a match away, with a reason, and tell the learning it was dropped. */
export async function dismissMatch(
  matchId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<MatchOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };
  if (!reason.trim()) return { status: "needs_reason" };
  const match = matchById(matchId, ctx);
  if (!match) return { status: "not_found" };
  if (match.status === "booked") return { status: "not_permitted" };

  match.status = "dismissed";
  match.dismissReason = reason.trim();
  match.history.push({
    id: rowId("me"), at: nowIso(), action: "dismissed",
    actorMembershipId: ctx.membershipId, actorName: ctx.actor.displayNameSnapshot,
    note: reason.trim(),
  });

  const listing = listingById(ctx.organizationId, match.listingId);
  if (listing) observeDecision(ctx.organizationId, match, listing, false);
  return { status: "ok", match };
}

export async function restoreMatch(matchId: string, ctx: MtLoopContext): Promise<MatchOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const match = matchById(matchId, ctx);
  if (!match) return { status: "not_found" };
  if (match.status !== "dismissed") return { status: "not_permitted" };

  match.status = isEligible(match.checks) ? "eligible" : "ineligible";
  match.dismissReason = undefined;
  match.history.push({
    id: rowId("me"), at: nowIso(), action: "restored",
    actorMembershipId: ctx.membershipId, actorName: ctx.actor.displayNameSnapshot,
  });
  return { status: "ok", match };
}

/* -------------------------------------------------------------------------- */
/* Booking, and standing the competition down                                  */
/* -------------------------------------------------------------------------- */

export interface BookingOutcome {
  status: "ok" | "not_found" | "not_permitted" | "listing_gone";
  match?: OpportunityMatch;
  /** Matches for the same listing that were stood down. */
  closedMatchIds: string[];
}

/**
 * One truck got the load, so nothing else can have it.
 *
 * A listing is one real load: the moment it is taken, every other match on it
 * is dead, and a dispatcher must not be able to spend the afternoon working a
 * load that is already gone — or worse, email a broker about a load their own
 * colleague booked an hour ago.
 *
 * Booking itself is milestone 8. This is the mechanism it will call, built and
 * tested now because the matches it has to stand down are built now, and
 * because standing them down is the part that is easy to get wrong later.
 */
export function bookMatch(
  matchId: string,
  ctx: MtLoopContext,
  actorName: string,
): BookingOutcome {
  if (!mayAct(ctx)) return { status: "not_permitted", closedMatchIds: [] };
  const rows = bucket(ctx.organizationId);
  const winner = rows.find((m) => m.matchId === matchId);
  if (!winner) return { status: "not_found", closedMatchIds: [] };

  const listing = listingById(ctx.organizationId, winner.listingId);
  if (!listing || listing.status !== "open") {
    return { status: "listing_gone", match: winner, closedMatchIds: [] };
  }

  const at = nowIso();
  winner.status = "booked";
  winner.history.push({
    id: rowId("me"), at, action: "booked",
    actorMembershipId: ctx.membershipId, actorName,
  });

  closeListing(ctx.organizationId, listing.listingId, "covered", `Booked on unit ${winner.truckUnit}.`);

  const closedMatchIds: string[] = [];
  for (const other of rows) {
    if (other.listingId !== winner.listingId) continue;
    if (other.matchId === winner.matchId) continue;
    if (other.status === "closed_listing_gone" || other.status === "booked") continue;
    other.status = "closed_listing_gone";
    other.history.push({
      id: rowId("me"), at, action: "listing_closed", actorName: "Antcolos",
      note: `Unit ${winner.truckUnit} got this load.`,
    });
    closedMatchIds.push(other.matchId);
  }

  return { status: "ok", match: winner, closedMatchIds };
}

/**
 * The listing went to somebody else entirely.
 *
 * Exactly the same standing-down, for the far more common case: the broker
 * covered it, or it came off the board. Nothing of ours was booked.
 */
export function listingTakenElsewhere(
  listingId: string,
  ctx: MtLoopContext,
  reason: string,
): string[] {
  const listing = listingById(ctx.organizationId, listingId);
  if (!listing) return [];
  closeListing(ctx.organizationId, listingId, "covered", reason);

  const at = nowIso();
  const closed: string[] = [];
  for (const match of bucket(ctx.organizationId)) {
    if (match.listingId !== listingId) continue;
    if (match.status === "closed_listing_gone" || match.status === "booked") continue;
    match.status = "closed_listing_gone";
    match.history.push({
      id: rowId("me"), at, action: "listing_closed", actorName: "Antcolos", note: reason,
    });
    closed.push(match.matchId);
  }
  return closed;
}
