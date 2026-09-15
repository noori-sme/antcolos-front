import type { Cents, IsoDateTime } from "./common";
import type { EquipmentType } from "./load";

/**
 * Finding the next load, from the market back to one empty truck.
 *
 * Four things are kept deliberately apart here, and collapsing any two of them
 * is how this module would go wrong:
 *
 *   Listing   ONE canonical record per real load offered to the market. The
 *             same load posted on two boards, emailed by the broker and typed
 *             in by hand is still ONE listing with three sightings. Merging is
 *             by fingerprint, never by trusting a source's own id.
 *
 *   Match     One listing considered against ONE truck. A listing that suits
 *             three trucks produces three matches, each with its own checks,
 *             its own score and its own dispatch cycle — because "is this good
 *             for THIS truck" has three different answers.
 *
 *   Draft     One message per listing per CARRIER IDENTITY, covering every one
 *             of that carrier's matched trucks. Two trucks of the same carrier
 *             never produce two emails to the same broker; two different
 *             carriers legitimately do, because they are different businesses
 *             writing under their own authority.
 *
 *   Search    One session per dispatch cycle, recording which sources were
 *   session   actually searched and what each returned. It is the audit trail
 *             for "did anybody actually look for this truck?"
 *
 * Nothing here talks to a load board. Every source in this milestone is a mock
 * with an honest name and an honest connection state; the ingestion boundary is
 * built so a real collector — the browser extension planned for later — can
 * hand listings in without any of this changing.
 */

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where an opportunity came from.
 *
 * Load boards are one source among several and get no special treatment: a load
 * emailed by a broker you have worked with for ten years is worth more than a
 * board posting, not less, and the inbox has to be able to hold both.
 */
export type OpportunitySource =
  /** A public load board, read by the browser extension. */
  | "load_board"
  /** A broker emailed it. */
  | "email"
  /** A spreadsheet somebody exported and uploaded. */
  | "csv"
  /** A broker's or a TMS's own interface. */
  | "api"
  /** A standing relationship: they call, or send a list every morning. */
  | "broker_direct"
  /** Somebody typed it in. */
  | "manual";

export const SOURCE_LABEL: Record<OpportunitySource, string> = {
  load_board: "Load board",
  email: "Email",
  csv: "Spreadsheet",
  api: "Direct feed",
  broker_direct: "Broker relationship",
  manual: "Typed in",
};

/**
 * How a source physically reaches Antcolos.
 *
 * Kept apart from the source itself because it is the honest part: a load board
 * is a real source, and `browser_extension` is a connection that DOES NOT EXIST
 * YET. Saying so in the data means no screen can imply otherwise by accident.
 */
export type SourceConnection =
  /** Planned. The extension reads the board in the dispatcher's own browser. */
  | "browser_extension"
  /** Planned. A mailbox Antcolos watches. */
  | "email_inbox"
  | "csv_upload"
  | "api"
  | "manual_entry"
  /** A stand-in that produces believable listings so the rest can be built. */
  | "mock";

export const CONNECTION_LABEL: Record<SourceConnection, string> = {
  browser_extension: "Browser extension",
  email_inbox: "Watched mailbox",
  csv_upload: "Spreadsheet upload",
  api: "Direct feed",
  manual_entry: "Typed in",
  mock: "Sample data",
};

/** True for the connections that are not built. Screens must say so. */
export const CONNECTION_IS_PLANNED: Record<SourceConnection, boolean> = {
  browser_extension: true,
  email_inbox: true,
  csv_upload: true,
  api: true,
  manual_entry: false,
  mock: false,
};

/* -------------------------------------------------------------------------- */
/* Listing                                                                     */
/* -------------------------------------------------------------------------- */

export type ListingStatus =
  /** Still on offer as far as anybody here knows. */
  | "open"
  /** Somebody took it. Not necessarily us. */
  | "covered"
  /** Its pickup has passed. */
  | "expired"
  /** The broker pulled it. */
  | "withdrawn";

export const LISTING_STATUS_LABEL: Record<ListingStatus, string> = {
  open: "Open",
  covered: "Covered",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export interface ListingPlace {
  city: string;
  state: string;
  /** Rough coordinates, used for deadhead. Never presented as exact. */
  lat?: number;
  lon?: number;
}

/**
 * Who is offering the load.
 *
 * `mcAgeMonths` and `creditScore` are here because dispatchers genuinely check
 * them before spending an hour on a load: a three-week-old MC number with no
 * payment history is a different proposition from a twenty-year-old broker,
 * whatever the rate says.
 */
export interface ListingBroker {
  name: string;
  mcNumber?: string;
  /** How long the authority has existed. Absent when nobody has looked. */
  mcAgeMonths?: number;
  contactName?: string;
  email?: string;
  phone?: string;
  /** 0-100. Absent when unknown — which is not the same as bad. */
  creditScore?: number;
  /** Typical days to pay, where there is history. */
  daysToPay?: number;
  /** True when this workspace has moved freight for them before. */
  workedWithBefore?: boolean;
}

/** One time this listing was seen, and where. */
export interface ListingSighting {
  id: string;
  source: OpportunitySource;
  sourceName: string;
  connection: SourceConnection;
  observedAt: IsoDateTime;
  /** The source's own identifier, kept so a human can go back and look. */
  sourceReference?: string;
  /** The search session that saw it, when a session was running. */
  searchSessionId?: string;
  /** The rate this source quoted. Sources disagree, and that is worth keeping. */
  offeredRateCents?: Cents;
}

/**
 * ONE record per real load on the market.
 *
 * `fingerprint` is what makes that true. It is derived from the load itself —
 * lane, pickup day, equipment, broker — and never from a source's id, because
 * the whole problem is that two sources give the same load two different ids.
 * A second sighting of the same fingerprint folds in rather than creating a
 * second listing, and the sighting is kept so nobody loses where it came from.
 */
export interface Listing {
  /** Immutable UUID. Never a source's own reference. */
  listingId: string;
  /** Derived from the load. Two sources describing one load agree on this. */
  fingerprint: string;
  /** The organization whose inbox this is. Listings do not cross workspaces. */
  dispatchOrganizationId: string;

  /** Where it was FIRST seen. Later sightings are in `sightings`. */
  source: OpportunitySource;
  sourceName: string;
  connection: SourceConnection;
  sourceReference?: string;
  observedAt: IsoDateTime;
  /** Every time it has been seen, oldest first. Never rewritten. */
  sightings: ListingSighting[];

  broker: ListingBroker;
  origin: ListingPlace;
  destination: ListingPlace;
  pickupAt: IsoDateTime;
  /** How much slack there is on the pickup, when the source says. */
  pickupWindowHours?: number;
  deliverBy?: IsoDateTime;

  equipment: EquipmentType;
  weightLbs?: number;
  lengthFt?: number;
  commodity?: string;
  hazmat: boolean;
  teamRequired: boolean;

  loadedMiles: number;
  offeredRateCents?: Cents;
  /** Derived from the offer and the miles, so everybody rounds the same way. */
  ratePerMileCents?: Cents;

  notes?: string;
  status: ListingStatus;
  /** Set when the listing went to somebody — us or anybody else. */
  closedAt?: IsoDateTime;
  closeReason?: string;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Match                                                                       */
/* -------------------------------------------------------------------------- */

export type MatchStatus =
  /** Passes every hard check. A real candidate. */
  | "eligible"
  /** Fails at least one hard check. Kept, with the reason.  */
  | "ineligible"
  /** The dispatcher put it on the short list. */
  | "shortlisted"
  /** The dispatcher said no, with a reason. */
  | "dismissed"
  /** This truck got the load. Milestone 8 sets this. */
  | "booked"
  /** The listing went elsewhere, so this match cannot proceed. */
  | "closed_listing_gone";

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  eligible: "Eligible",
  ineligible: "Not eligible",
  shortlisted: "Short-listed",
  dismissed: "Dismissed",
  booked: "Booked",
  closed_listing_gone: "Gone",
};

/**
 * One dimension a listing is checked against for one truck.
 *
 * Every check reports an outcome AND a sentence, because "not eligible" on its
 * own is useless to a dispatcher deciding whether to argue with it. `unknown`
 * is a real outcome: a broker with no credit score recorded has not failed the
 * credit check, and treating those the same would quietly hide good loads.
 */
export interface MatchCheck {
  key: MatchCheckKey;
  label: string;
  outcome: MatchCheckOutcome;
  /** What was actually compared, in the operator's language. */
  detail: string;
  /** True when failing this check rules the load out rather than warning. */
  blocking: boolean;
}

export type MatchCheckOutcome = "pass" | "warn" | "fail" | "unknown";

export type MatchCheckKey =
  | "equipment"
  | "capacity"
  | "pickup_feasible"
  | "deadhead"
  | "rate"
  | "carrier_rule"
  | "driver_preference"
  | "hours_of_service"
  | "home_time"
  | "documents"
  | "operating_authority"
  | "broker_credit"
  | "mc_age"
  | "hazmat"
  | "profitability";

export const CHECK_LABEL: Record<MatchCheckKey, string> = {
  equipment: "Equipment",
  capacity: "Capacity",
  pickup_feasible: "Can make the pickup",
  deadhead: "Deadhead",
  rate: "Rate",
  carrier_rule: "Carrier rules",
  driver_preference: "Driver preferences",
  hours_of_service: "Hours of service",
  home_time: "Home time",
  documents: "Documents",
  operating_authority: "Operating authority",
  broker_credit: "Broker credit",
  mc_age: "MC age",
  hazmat: "Hazmat",
  profitability: "Profitability",
};

/* -------------------------------------------------------------------------- */
/* Ranking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What the ranking weighs.
 *
 * Kept to a handful on purpose. A dispatcher can hold six priorities in their
 * head and argue with them; twenty sliders is a model nobody trusts and nobody
 * adjusts.
 */
export type RankingFactorKey =
  | "rate"
  | "profit"
  | "deadhead"
  | "home_time"
  | "broker_quality"
  | "lane_preference";

export const FACTOR_LABEL: Record<RankingFactorKey, string> = {
  rate: "Rate per mile",
  profit: "Estimated profit",
  deadhead: "Short deadhead",
  home_time: "Gets them home",
  broker_quality: "Broker you can trust",
  lane_preference: "Lane they want",
};

export const FACTOR_DESCRIPTION: Record<RankingFactorKey, string> = {
  rate: "What it pays per loaded mile, against what this carrier will accept.",
  profit: "What is left after the empty miles and the fuel.",
  deadhead: "How far the truck runs empty to get to it.",
  home_time: "Whether it fits what the driver asked for.",
  broker_quality: "Credit, how long the MC has existed, and whether you have run for them.",
  lane_preference: "Whether it goes where the driver and carrier want to be.",
};

export interface ScoreComponent {
  key: RankingFactorKey;
  /** The dispatcher's weight for this factor, 0-100. */
  weight: number;
  /** How well this listing did on it, 0-100. */
  raw: number;
  /** The share of the final score this factor accounts for. */
  contribution: number;
  detail: string;
}

export interface MatchScore {
  /** 0-100. Comparable only against other matches ranked the same way. */
  total: number;
  components: ScoreComponent[];
}

/**
 * The weights a workspace ranks by.
 *
 * Three ways they can get here, and the screen says which: the shipped default,
 * a dispatcher moving a slider, or a suggestion from the learning that somebody
 * accepted. A suggestion is never applied on its own — a ranking that changes
 * under a dispatcher without being asked is a ranking they stop trusting.
 */
export interface RankingPreferences {
  organizationId: string;
  weights: Record<RankingFactorKey, number>;
  source: "default" | "adjusted" | "learned";
  updatedAt: IsoDateTime;
  updatedByName?: string;
}

/**
 * ★ WHAT A WORKSPACE HAS AGREED TO ABOUT CROSS-ORGANIZATION LEARNING ★
 *
 * TWO CHOICES, NOT ONE. Giving your decisions to the shared pool and taking a
 * suggestion out of it are different decisions carrying different risks, and a
 * single "learning on/off" switch forces a workspace that is happy to benefit
 * into also contributing — which is the one direction that cannot be undone.
 *
 * ███ FRONTEND ONLY ███
 * This is an in-memory record that lives as long as the tab. It is not a
 * durable consent record, it is not enforced against anything except this
 * app's own code path, and a real backend must enforce it server-side against
 * a caller who never runs this code at all.
 */
export interface LearningConsent {
  organizationId: string;
  /**
   * Whether this workspace's decisions may enter the shared pool.
   *
   * OFF until somebody with `organization:manage` turns it on, and that
   * default is the whole point: data that has left cannot be recalled, so the
   * safe default is the one that keeps it.
   */
  contribute: boolean;
  /**
   * Whether this workspace may be offered a suggestion derived from the pool.
   *
   * ON by default, and that is defensible only because of what the pool holds.
   * `sharedFields` is an equipment type, four rounded bands and a boolean; the
   * pool carries no organization id at all; and no suggestion is offered below
   * a minimum number of observations. Nothing a consumer can see names a
   * workspace, a user, a carrier, a truck, a driver, a load, a contract or a
   * credential. If that ever stops being true, this default is wrong.
   */
  consume: boolean;
  updatedAt: IsoDateTime;
  /** Absent while the workspace is still on the shipped defaults. */
  updatedByMembershipId?: string;
  updatedByName?: string;
}

/** Whether network learning is being used, and if not, why not. */
export type NetworkLearningAvailability =
  /** Consumption is on and the pool holds enough to speak. */
  | "available"
  /** The workspace has turned consumption off. No network suggestion is made. */
  | "consumption_disabled"
  /** Consumption is on, and the pool does not yet hold enough to say anything. */
  | "insufficient_evidence";

/** Which body of evidence produced a suggestion. Never both at once. */
export type LearningEvidenceSource =
  /** This workspace's own decisions. They never leave it. */
  | "local"
  /** The anonymised cross-organization pool. */
  | "network";

/**
 * What the ranking has learned, and exactly what leaves this workspace.
 *
 * Antcolos can get better at ranking by watching which loads dispatchers
 * actually pursue — but only if what crosses the boundary carries nothing that
 * identifies a workspace, a carrier, a broker contact or a person, and no
 * credential of any kind. Both lists are spelled out in the data rather than
 * described in a policy document, so a test can assert them and a dispatcher
 * can read them.
 *
 * Local and network evidence are reported SEPARATELY on purpose. "Antcolos
 * suggests this" and "the workspaces around you suggest this" are different
 * claims, and a summary that could not tell them apart would make the consent
 * switches below meaningless.
 */
export interface LearningSummary {
  /** What this workspace has agreed to. Always present, defaults included. */
  consent: LearningConsent;
  /**
   * Decisions this workspace has recorded. These never leave it, whatever
   * consent says, which is what keeps the ranking useful with contribution off.
   */
  localObservations: number;
  /**
   * How many of those were also contributed to the shared pool.
   *
   * Zero for every decision made while contribution was off, and it stays zero
   * for them afterwards: enabling contribution never reaches back.
   */
  contributedObservations: number;
  /** Observations across Antcolos. An aggregate count, joined to nothing. */
  networkObservations: number;
  /** Why network learning is or is not in use. */
  networkAvailability: NetworkLearningAvailability;
  /** Weights the learning would suggest. Never applied without a person. */
  suggested?: Record<RankingFactorKey, number>;
  /** Which evidence produced `suggested`. Absent when there is no suggestion. */
  suggestedFrom?: LearningEvidenceSource;
  lastLearnedAt?: IsoDateTime;
  /** Field names that leave the workspace, anonymised. */
  sharedFields: string[];
  /** Field names that never leave it, whatever happens. */
  withheldFields: string[];
  /**
   * What turning contribution off cannot undo, in the words a screen shows.
   *
   * Carried in the data rather than written into one component, because the
   * limitation is a property of the design and every surface that offers the
   * switch owes the reader the same sentence.
   */
  contributionHistoryNote: string;
}

/* -------------------------------------------------------------------------- */
/* The match record                                                            */
/* -------------------------------------------------------------------------- */

export type MatchAction =
  | "created"
  | "rescored"
  | "shortlisted"
  | "dismissed"
  | "restored"
  | "listing_closed"
  | "booked";

export interface MatchEvent {
  id: string;
  at: IsoDateTime;
  action: MatchAction;
  actorMembershipId?: string;
  actorName: string;
  note?: string;
}

export interface OpportunityMatch {
  matchId: string;
  listingId: string;
  /**
   * The dispatch cycle this belongs to — the MT Loop's own immutable id, under
   * the name the roadmap uses for it. One id from the truck going empty to the
   * load being delivered and released, and every later milestone hangs off it.
   */
  dispatchCycleId: string;
  truckId: string;
  truckUnit: string;
  carrierOrganizationId: string;
  carrierName: string;
  dispatchOrganizationId: string;

  status: MatchStatus;
  score: MatchScore;
  checks: MatchCheck[];

  deadheadMiles: number;
  loadedMiles: number;
  totalMiles: number;
  /** Rate over TOTAL miles, which is the number that actually pays the fuel. */
  allInRatePerMileCents?: Cents;
  estimatedProfitCents?: Cents;

  /** The session that turned it up, when one was running. */
  searchSessionId?: string;
  dismissReason?: string;
  createdAt: IsoDateTime;
  history: MatchEvent[];
}

/**
 * Where the driver's review of this match has got to.
 *
 * Carried as DATA on the row rather than read from a service while a screen
 * renders. A screen that asks a module "what is the state of this" mid-render
 * is asking something React cannot see, and a memoized component will happily
 * keep showing the answer from two minutes ago.
 */
export interface MatchDriverState {
  /** True when there is a driver on the truck to send anything to. */
  hasDriver: boolean;
  /** True when the carrier will not have it negotiated before the driver sees it. */
  reviewRequired: boolean;
  /** True when this may be sent right now. */
  canSend: boolean;
  status?: string;
  driverName?: string;
  /** Why the negotiation is waiting, or where the review got to. */
  note?: string;
}

/** A match with the listing it is about, for a screen that needs both. */
export interface MatchWithListing {
  match: OpportunityMatch;
  listing: Listing;
  /** The driver review on it, if the workspace runs them. */
  driver?: MatchDriverState;
  /** Present when a draft covers this match. */
  draftId?: string;
}

/* -------------------------------------------------------------------------- */
/* Search session                                                              */
/* -------------------------------------------------------------------------- */

export type SearchSessionStatus = "running" | "paused" | "closed";

export const SEARCH_STATUS_LABEL: Record<SearchSessionStatus, string> = {
  running: "Searching",
  paused: "Paused",
  closed: "Closed",
};

export type SearchSourceStatus =
  /** The connection is not built, so nothing was searched. */
  | "not_connected"
  | "searched"
  | "failed"
  | "skipped";

export interface SearchSourceRun {
  id: string;
  source: OpportunitySource;
  sourceName: string;
  connection: SourceConnection;
  status: SearchSourceStatus;
  searchedAt?: IsoDateTime;
  listingsReturned: number;
  /** How many were the same load already in the inbox. */
  duplicatesFolded: number;
  note?: string;
}

/**
 * What the search is looking for.
 *
 * Assembled from the truck, the carrier and the driver rather than typed in, so
 * a search cannot quietly disagree with the equipment it is for. A dispatcher
 * can widen it, and the session records that they did.
 */
export interface SearchCriteria {
  originCity?: string;
  originState?: string;
  availableAt?: IsoDateTime;
  equipment: EquipmentType;
  maxDeadheadMiles: number;
  minRatePerMileCents: number;
  maxWeightLbs?: number;
  hazmatAllowed: boolean;
  refusedStates: string[];
  /** Widened by hand, so the session can say the search was broadened. */
  widened?: boolean;
}

export type SearchSessionAction =
  | "started" | "paused" | "resumed" | "closed"
  | "source_searched" | "criteria_widened";

export interface SearchSessionEvent {
  id: string;
  at: IsoDateTime;
  action: SearchSessionAction;
  actorMembershipId?: string;
  actorName: string;
  note?: string;
}

export interface SearchSession {
  searchSessionId: string;
  /** The MT Loop this search is for. The same id the whole cycle uses. */
  dispatchCycleId: string;
  truckId: string;
  truckUnit: string;
  dispatchOrganizationId: string;
  carrierOrganizationId: string;
  carrierName: string;

  status: SearchSessionStatus;
  startedAt: IsoDateTime;
  startedByMembershipId: string;
  startedByName: string;
  pausedAt?: IsoDateTime;
  pauseReason?: string;
  closedAt?: IsoDateTime;
  closeReason?: string;

  criteria: SearchCriteria;
  sources: SearchSourceRun[];
  history: SearchSessionEvent[];

  counts: {
    listingsSeen: number;
    duplicatesFolded: number;
    matchesCreated: number;
    eligible: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Outreach drafts                                                             */
/* -------------------------------------------------------------------------- */

export type DraftStatus =
  /** Prepared. Waiting for a person to read it. */
  | "ready"
  /** A dispatcher has read it and said it may go. Sending is milestone 5. */
  | "approved"
  /** A dispatcher threw it away. */
  | "cancelled"
  /** The listing went elsewhere, so there is nothing to write about. */
  | "superseded";

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  ready: "Waiting for you",
  approved: "Approved to send",
  cancelled: "Cancelled",
  superseded: "No longer needed",
};

/**
 * One message, about one listing, from ONE carrier identity.
 *
 * The grouping is the point. A carrier with three trucks near a pickup has one
 * conversation with that broker, not three — sending three is how a dispatch
 * agency gets a carrier blacklisted. Two DIFFERENT carriers matched to the same
 * listing do get two drafts, because they are two businesses writing under
 * their own authority, and pretending otherwise would put one carrier's freight
 * under another's name.
 *
 * Nothing is ever sent from here. Approval means a person has read it; the
 * sending itself is milestone 5, and the draft says so.
 */
export interface OutreachDraft {
  draftId: string;
  listingId: string;
  dispatchOrganizationId: string;
  /** The carrier this message goes out AS. */
  carrierOrganizationId: string;
  carrierName: string;
  /** Every match this one message covers. Never fewer than one. */
  matchIds: string[];
  /** The cycles it covers, so each truck's page can find its own draft. */
  dispatchCycleIds: string[];
  /** The units named in the message, for the dispatcher to sanity-check. */
  truckUnits: string[];

  fromName: string;
  /** Absent when the carrier has no address recorded. The draft is blocked. */
  fromEmail?: string;
  toName?: string;
  toEmail?: string;
  subject: string;
  body: string;

  status: DraftStatus;
  /** Why it cannot go out, when it cannot. */
  blockedReason?: string;
  createdAt: IsoDateTime;
  reviewedAt?: IsoDateTime;
  reviewedByName?: string;
  supersededReason?: string;
}

/* -------------------------------------------------------------------------- */
/* The boundary an outside collector talks to                                  */
/* -------------------------------------------------------------------------- */

/**
 * What an outside collector hands Antcolos.
 *
 * This is the contract the planned browser extension will use, and the same one
 * a mailbox reader, a CSV upload, a broker feed and the manual-entry form use
 * today. Everything is optional except the handful of fields that make a load a
 * load, because a real board posting is frequently missing half of them and
 * refusing it outright would lose real freight.
 *
 * It carries NO identity of its own: the collector does not say which carrier
 * or which truck a listing is for. Antcolos decides that, from records the
 * collector cannot see. That is what keeps a browser extension — running inside
 * somebody's browser, on a page Antcolos does not control — from ever being
 * able to assert who a load belongs to.
 */
export interface RawListingInput {
  /** The source's own id, if it has one. Used for reference, never identity. */
  sourceReference?: string;
  brokerName: string;
  brokerMcNumber?: string;
  brokerContactName?: string;
  brokerEmail?: string;
  brokerPhone?: string;
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  pickupAt: IsoDateTime;
  pickupWindowHours?: number;
  deliverBy?: IsoDateTime;
  equipment: EquipmentType;
  weightLbs?: number;
  lengthFt?: number;
  commodity?: string;
  hazmat?: boolean;
  teamRequired?: boolean;
  loadedMiles?: number;
  offeredRateCents?: Cents;
  notes?: string;
}

/** What came of handing a batch in. */
export interface IngestResult {
  /** New listings created. */
  accepted: number;
  /** Sightings folded into a listing already in the inbox. */
  foldedIntoExisting: number;
  /** Entries that could not be read, with the reason. */
  rejected: Array<{ index: number; reason: string }>;
  listingIds: string[];
  /** Matches created across every truck the listings suit. */
  matchesCreated: number;
}

/**
 * Everything an outside collector needs to filter BEFORE sending anything back.
 *
 * The point of handing this out is volume: a board page has hundreds of rows and
 * the overwhelming majority are wrong for this truck. Filtering in the browser
 * means only plausible loads ever travel.
 *
 * What it deliberately does NOT contain is as important as what it does. There
 * is no carrier name, no MC number, no broker contact, no driver name, no
 * membership or organization id, no email address and no credential of any
 * kind. A collector can tell whether a load fits without being told whose truck
 * it is — and if the page it is running on were hostile, it would learn nothing
 * worth having.
 */
export interface CollectorFilterProfile {
  /** Opaque handle for sending results back. Not a carrier or truck id. */
  profileId: string;
  /** Which cycle the results belong to. Resolved server-side. */
  dispatchCycleRef: string;

  equipment: EquipmentType;
  maxWeightLbs?: number;
  maxLengthFt?: number;

  /** Where the truck goes empty, and when. A place, not a person. */
  originCity?: string;
  originState?: string;
  availableAt?: IsoDateTime;

  maxDeadheadMiles: number;
  minRatePerMileCents: number;
  /** States the load must not touch. From the carrier's rules. */
  refusedStates: string[];
  hazmatAllowed: boolean;
  teamAvailable: boolean;

  /** Broker bars, as numbers. No names. */
  minBrokerCreditScore?: number;
  minBrokerMcAgeMonths?: number;

  /** What the driver has left, as a number of hours. No name, no licence. */
  driverHoursRemaining?: number;
  /** When they have asked to be home. A time, not a reason. */
  homeByAt?: IsoDateTime;

  /** Spelled out so it can be shown to a dispatcher and asserted in a test. */
  omittedOnPurpose: string[];
  generatedAt: IsoDateTime;
}
