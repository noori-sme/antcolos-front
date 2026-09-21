import type { Cents, IsoDateTime } from "./common";
import type { ActorRef } from "./user";

/**
 * FACTORING CHECK — is this broker one our factor will buy an invoice on?
 *
 * ███ THIS IS A FRONTEND CONTRACT AND A MOCK. IT IS NOT CONNECTED TO ANY
 * FACTORING COMPANY. ███
 *
 * Antcolos has no confirmed production API access from OTR, RTS or any other
 * factor. Nothing in this module calls one, and nothing in it may be read as a
 * factoring decision a factor actually made unless a person recorded one with
 * evidence. What this module IS: the provider-neutral shape a real adapter will
 * implement, and an honest mock behind it.
 *
 * ★ A FACTORING RESULT IS NOT A FACT ABOUT A BROKER ★
 *
 * This is the one idea the whole module is built to protect. "TQL is approved"
 * is not a sentence that can be true. What can be true is:
 *
 *   Northline Freight's factor, OTR, on account NL-4471, said on Tuesday at
 *   14:02 that it would fund up to $12,000 against MC-1142908, and that answer
 *   is good until Friday.
 *
 * Every one of those clauses is a field below, and none of them is optional
 * scaffolding. Take the carrier away and the result leaks between competitors
 * who use different factors and get different answers. Take the account away
 * and two factors' answers merge into one. Take the time away and last month's
 * approval reads as today's. Take the source away and a dispatcher's phone call
 * becomes indistinguishable from an API response nobody ever made.
 *
 * ★ WHAT IS DELIBERATELY ABSENT ★
 *
 * No credential of any kind. No provider username, no password, no portal
 * cookie, no bearer token, no API key — not on the connection, not on a check,
 * not in the import, not anywhere a type below can carry one. A carrier's
 * factoring portal login is not an Antcolos record, and a frontend mock that
 * held one would be a credential store with no encryption and no server.
 * See `FACTORING_FORBIDDEN_FIELDS`, which a test walks the whole domain model
 * against.
 *
 * Also absent: portal scraping, headless-browser automation and anything that
 * would work around a CAPTCHA. Those are excluded on purpose and permanently.
 */

/* -------------------------------------------------------------------------- */
/* Provider and connection                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which factoring company. Named rather than free text so an adapter can be
 * selected without matching on a display string somebody typed.
 */
export type FactoringProviderKind =
  | "otr"
  | "rts"
  | "triumph"
  | "apex"
  | "other";

export const FACTORING_PROVIDER_LABEL: Record<FactoringProviderKind, string> = {
  otr: "OTR Solutions",
  rts: "RTS Financial",
  triumph: "Triumph Financial",
  apex: "Apex Capital",
  other: "Other factoring company",
};

/**
 * HOW a carrier's answers reach Antcolos. This is the difference between "the
 * factor told us" and "somebody told us what the factor told them", and the UI
 * never flattens it.
 *
 *   mock_adapter  A deterministic local adapter. Development and tests only,
 *                 and labelled as such on every screen it reaches.
 *   import        An authorized debtor/credit export the carrier downloaded
 *                 from its own factor and brought here.
 *   email         A structured credit-check email, and a person recording what
 *                 came back.
 *   manual        A person checked — portal, phone — and wrote down the answer
 *                 with a reference.
 *   api           RESERVED. No factor has authorized Antcolos for an API, so a
 *                 connection in this mode is never presented as connected or
 *                 functional. It exists so the adapter seam is real.
 */
export type FactoringConnectionMode =
  | "mock_adapter"
  | "import"
  | "email"
  | "manual"
  | "api";

export const FACTORING_MODE_LABEL: Record<FactoringConnectionMode, string> = {
  mock_adapter: "Mock adapter (development)",
  import: "Authorized export import",
  email: "Credit-check email",
  manual: "Manual check",
  api: "Provider API",
};

export const FACTORING_MODE_DESCRIPTION: Record<FactoringConnectionMode, string> = {
  mock_adapter: "A deterministic local adapter. It answers instantly and it is not a factoring company.",
  import: "You download your debtor or credit list from your factor and bring it here. Antcolos never signs in for you.",
  email: "Antcolos prepares the credit-check email. A person sends it and records what comes back.",
  manual: "You check in your factor's portal or on the phone, and record the answer with a reference.",
  api: "Reserved for an authorized provider integration. No factor has authorized one, so nothing runs in this mode.",
};

/**
 * Whether a mode can produce an answer without a person.
 *
 * ★ ONLY TWO THINGS ARE AUTOMATIC, AND ONE OF THEM IS A MOCK ★
 * This map is what the search workflow reads to decide whether to run checks in
 * the background and hide the button, or to offer "Check with factoring". It is
 * not a preference — a mode that cannot answer on its own must never be dressed
 * up with an automatic-looking chip.
 */
export const FACTORING_MODE_IS_AUTOMATIC: Record<FactoringConnectionMode, boolean> = {
  mock_adapter: true,
  import: false,
  email: false,
  manual: false,
  api: true,
};

/**
 * Whether a mode is an AUTHORIZED LIVE PROVIDER INTEGRATION.
 *
 * Exactly one is, and Antcolos does not have it for anybody yet. The mock
 * adapter answers automatically and is still not live, which is why this is a
 * second map rather than a reuse of the one above.
 */
export const FACTORING_MODE_IS_LIVE_API: Record<FactoringConnectionMode, boolean> = {
  mock_adapter: false,
  import: false,
  email: false,
  manual: false,
  api: true,
};

export type FactoringConnectionStatus =
  /** Usable in the mode it declares. */
  | "connected"
  /** Configured but the provider side is not answering right now. */
  | "provider_unavailable"
  /** Nothing is set up for this carrier. */
  | "not_connected";

export const FACTORING_CONNECTION_STATUS_LABEL: Record<FactoringConnectionStatus, string> = {
  connected: "Connected",
  provider_unavailable: "Provider unavailable",
  not_connected: "Not connected",
};

/**
 * Where a fallback check goes when there is no authorized API.
 *
 * Addresses and links the CARRIER already has with its own factor. Antcolos
 * does not sign in to any of them — it prefills what it already knows and hands
 * the person the rest of the way.
 */
export interface FactoringFallbackConfig {
  /** The factor's credit-check mailbox, as the carrier was given it. */
  creditCheckEmail?: string;
  /** The factor's own portal. Opened by a person, in their own browser. */
  portalUrl?: string;
  /** The factor's credit desk. */
  phone?: string;
  /** Anything the carrier's own people need told, in their words. */
  instructions?: string;
}

/**
 * ONE carrier's relationship with ONE factoring account.
 *
 * The partition key is `carrierOrganizationId`, exactly as it is on
 * `CarrierPartyRelationship`: a factoring connection is a carrier's private
 * commercial arrangement and is never a global record about the provider.
 *
 * ★ NOTHING SECRET IS ON THIS RECORD ★
 * `accountReference` is the client number printed on the carrier's own
 * statements — an identifier, not an authenticator. There is no field for a
 * password because there is no circumstance in which this layer should hold
 * one. A real integration authenticates on the backend with provider-issued
 * credentials the browser never sees.
 */
export interface FactoringConnection {
  connectionId: string;
  /** THE partition key. A connection belongs to one carrier organization. */
  carrierOrganizationId: string;
  providerKind: FactoringProviderKind;
  /** Display name, snapshotted so a renamed provider does not rewrite history. */
  providerName: string;
  /** What the carrier calls this account, e.g. "OTR — main". */
  accountLabel: string;
  /** The factor's own client number. An identifier, never a credential. */
  accountReference?: string;
  mode: FactoringConnectionMode;
  status: FactoringConnectionStatus;
  fallback: FactoringFallbackConfig;
  /** Set by whoever connected it. */
  connectedBy?: ActorRef;
  connectedAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** When anything was last learned through this connection. */
  lastResultAt?: IsoDateTime;
  /** The newest committed import batch, when the carrier imports lists. */
  lastImportBatchId?: string;
}

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ★ TEN STATES, AND THE FOUR THAT MUST NEVER BECOME "REJECTED" ★
 *
 * `unknown`, `stale`, `not_connected` and `provider_unavailable` are all
 * "Antcolos does not have a current answer". Collapsing any of them into
 * `rejected` would put a refusal in a broker's file that no factor ever made,
 * and a dispatcher would stop calling a broker who was never turned down.
 * Collapsing them into `approved_*` is the opposite failure and worse.
 *
 * The three approvals are separate for the same reason: "the API said yes",
 * "your factor's spreadsheet said yes last Tuesday" and "Marta rang them and
 * wrote it down" are three different levels of evidence, and a booking screen
 * has to be able to say which one it is holding.
 */
export type FactoringDecision =
  /** An authorized provider API answered, just now. */
  | "approved_live"
  /** An authorized export the carrier imported carries the approval. */
  | "approved_imported"
  /** A person recorded an approval, with evidence and a reference. */
  | "approved_manual"
  /** Funded only if something is true — conditions are always carried. */
  | "conditional"
  /** The factor said no. Only ever from the factor, never derived. */
  | "rejected"
  /** Asked, not yet answered. An email is out, or a call is booked. */
  | "pending"
  /** Nobody has ever asked about this broker on this account. */
  | "unknown"
  /** There was an answer and it has expired. NOT a refusal. */
  | "stale"
  /** This carrier has no factoring connection at all. */
  | "not_connected"
  /** The connection exists and the provider side could not answer. */
  | "provider_unavailable";

export const FACTORING_DECISION_LABEL: Record<FactoringDecision, string> = {
  approved_live: "Approved",
  approved_imported: "Approved",
  approved_manual: "Approved",
  conditional: "Conditional",
  rejected: "Rejected",
  pending: "Factoring check pending",
  unknown: "Not checked",
  stale: "Recheck factoring",
  not_connected: "Factoring not connected",
  provider_unavailable: "Provider unavailable",
};

/** The one-word form for a dense row. */
export const FACTORING_DECISION_SHORT: Record<FactoringDecision, string> = {
  approved_live: "Approved",
  approved_imported: "Approved",
  approved_manual: "Approved",
  conditional: "Conditional",
  rejected: "Rejected",
  pending: "Pending",
  unknown: "Unknown",
  stale: "Stale",
  not_connected: "Not connected",
  provider_unavailable: "Unavailable",
};

export type FactoringTone = "success" | "warning" | "danger" | "info" | "neutral";

export const FACTORING_DECISION_TONE: Record<FactoringDecision, FactoringTone> = {
  approved_live: "success",
  approved_imported: "success",
  approved_manual: "success",
  conditional: "warning",
  rejected: "danger",
  pending: "info",
  unknown: "neutral",
  stale: "warning",
  not_connected: "neutral",
  provider_unavailable: "warning",
};

/**
 * The three approvals, as a set, so nothing anywhere re-derives "is this a
 * yes?" by string matching on a prefix.
 */
export const APPROVED_FACTORING_DECISIONS: readonly FactoringDecision[] = [
  "approved_live", "approved_imported", "approved_manual",
];

export function isFactoringApproved(decision: FactoringDecision): boolean {
  return APPROVED_FACTORING_DECISIONS.includes(decision);
}

/**
 * The four that mean "no current answer".
 *
 * Exported so a caller can assert the negative directly — `isFactoringUnknown`
 * reads better at a call site than four comparisons, and a test can prove none
 * of these is ever treated as an approval.
 */
export const NO_ANSWER_FACTORING_DECISIONS: readonly FactoringDecision[] = [
  "unknown", "stale", "not_connected", "provider_unavailable",
];

export function isFactoringUnanswered(decision: FactoringDecision): boolean {
  return NO_ANSWER_FACTORING_DECISIONS.includes(decision);
}

/* -------------------------------------------------------------------------- */
/* Where an answer came from                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The provenance of one answer. Kept on the result forever, because "approved"
 * with no source is a rumour.
 */
export type FactoringDecisionSource =
  /** An authorized provider API. Nothing in this build produces one. */
  | "live_api"
  /** The deterministic development adapter, labelled everywhere it shows. */
  | "mock_adapter"
  /** A row in an authorized debtor/credit export the carrier imported. */
  | "imported_list"
  /** A reply to a credit-check email, recorded by a person with the message. */
  | "recorded_email"
  /** A person read it in the factor's own portal and wrote down the reference. */
  | "manual_portal_check"
  /** A person rang the factor's credit desk. */
  | "phone_confirmation";

export const FACTORING_SOURCE_LABEL: Record<FactoringDecisionSource, string> = {
  live_api: "Live provider API",
  mock_adapter: "Mock adapter",
  imported_list: "Imported provider list",
  recorded_email: "Recorded email response",
  manual_portal_check: "Manual portal check",
  phone_confirmation: "Phone confirmation",
};

/** The short word a chip shows after the decision: "Approved · imported". */
export const FACTORING_SOURCE_SHORT: Record<FactoringDecisionSource, string> = {
  live_api: "live",
  mock_adapter: "mock",
  imported_list: "imported",
  recorded_email: "email",
  manual_portal_check: "portal",
  phone_confirmation: "phone",
};

/**
 * Whether a source is a live provider response.
 *
 * ONE source is, and Antcolos cannot produce it yet. The mock adapter is
 * automatic and is emphatically not live — which is the distinction a booking
 * screen has to state out loud when it says whether a recheck happened.
 */
export const FACTORING_SOURCE_IS_LIVE: Record<FactoringDecisionSource, boolean> = {
  live_api: true,
  mock_adapter: false,
  imported_list: false,
  recorded_email: false,
  manual_portal_check: false,
  phone_confirmation: false,
};

/** Evidence behind a recorded answer. A reference a human can go back to. */
export interface FactoringEvidence {
  kind: "email_message" | "document" | "import_batch" | "portal_reference" | "call_note";
  /** The message id, document id, batch id or the factor's own reference. */
  reference: string;
  /** What a person should expect to find there, in their words. */
  note?: string;
  /** A document in the Document Center, when the evidence was filed there. */
  documentId?: string;
}

/* -------------------------------------------------------------------------- */
/* The result                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ONE answer, from ONE factoring account, about ONE broker, for ONE carrier.
 *
 * Immutable once written. A newer answer SUPERSEDES an older one and points
 * back at it; nothing is edited and nothing is deleted, which is what makes a
 * corrected import auditable rather than merely applied.
 */
export interface BrokerFactorabilityCheck {
  checkId: string;
  /** THE partition key. Carrier A's answer is not Carrier B's. */
  carrierOrganizationId: string;
  /** Which factoring account answered. Two factors are two answers. */
  connectionId: string;
  providerKind: FactoringProviderKind;
  providerName: string;
  accountLabel: string;

  /** The canonical broker profile, when the MC resolved to one. */
  brokerPartyId?: string;
  /**
   * The MC as OBSERVED at check time, digits only.
   *
   * Kept even when `brokerPartyId` is set, because the profile's MC can be
   * corrected later and this result was about the number that was asked.
   */
  brokerMcNumber?: string;
  /** The name as it was given. Never authoritative on its own. */
  brokerNameObserved: string;

  /** Present ONLY when the caller supplied one. Never invented. */
  proposedAmountCents?: Cents;
  /** The opportunity this was asked for, when it was asked inside one. */
  dispatchCycleId?: string;
  listingId?: string;
  loadId?: string;

  decision: FactoringDecision;
  /**
   * The provider's own words for why.
   *
   * ★ NEVER WRITTEN BY ANTCOLOS ★ A rejection with a reason Antcolos composed
   * is a reason the factor did not give, and a carrier would take it to the
   * broker. Absent is the correct value when nobody said why.
   */
  reason?: string;
  /** What has to be true for a conditional approval. Always carried in full. */
  conditions?: string[];

  /**
   * ★ ONLY WHEN THE PROVIDER ACTUALLY SUPPLIED THEM ★
   * Absent means nobody said. It does NOT mean zero, and it does not mean
   * unlimited. Nothing in this module derives, estimates or defaults either.
   */
  creditLimitCents?: Cents;
  availableAmountCents?: Cents;

  source: FactoringDecisionSource;
  /** When the ANSWER was observed, not when the row was written. */
  checkedAt: IsoDateTime;
  /** When it stops being current. Absent only where a source gives no life. */
  expiresAt?: IsoDateTime;

  /** The person who recorded it, for every source but a live API. */
  recordedBy?: ActorRef;
  /** The organization whose person recorded it — a delegate is named as one. */
  recordedByOrganizationId: string;
  /** The provider's own id for the answer, when it gave one. */
  providerReference?: string;
  evidence?: FactoringEvidence;
  /** The import batch this row came out of. */
  batchId?: string;

  /** The answer this one replaces. History is kept, never overwritten. */
  supersedesCheckId?: string;
  /** Set on the older row when a newer one replaces it. */
  supersededByCheckId?: string;
  supersededAt?: IsoDateTime;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* What a screen reads                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The resolved answer, worked out AT READ TIME.
 *
 * ★ WHY EXPIRY IS NOT A JOB ★
 * An approval that ran out at 03:00 has to read as stale at 03:01, on a
 * frontend with no scheduler, no worker and no cron. So the stored decision
 * never changes and the RESOLVED one is derived on every read from
 * `checkedAt`, `expiresAt` and the clock. There is no window in which a screen
 * shows an approval that has already lapsed, because there is nothing that has
 * to have run.
 *
 * `recordedDecision` keeps what the factor actually said, so a stale row can
 * still say "this was approved on Tuesday" rather than losing it.
 */
export interface FactoringStatusView {
  carrierOrganizationId: string;
  /** The decision as of NOW. */
  decision: FactoringDecision;
  /** What was stored, before freshness and connection state were applied. */
  recordedDecision?: FactoringDecision;
  /** The underlying record, when there is one. */
  check?: BrokerFactorabilityCheck;

  /** Which factor answered, for the dispatcher who has two carriers open. */
  providerName?: string;
  accountLabel?: string;
  connectionMode?: FactoringConnectionMode;
  connectionStatus: FactoringConnectionStatus;
  /** True only for an authorized provider API. A mock adapter is false. */
  liveApi: boolean;
  /** True when the workflow checks in the background and shows no button. */
  automatic: boolean;

  source?: FactoringDecisionSource;
  checkedAt?: IsoDateTime;
  expiresAt?: IsoDateTime;
  /** True when a stored answer has run out. */
  stale: boolean;
  /** True when anybody has ever asked, whatever the answer was. */
  everChecked: boolean;
  /** True when the dispatcher should ask again before relying on this. */
  recheckRequired: boolean;
  /**
   * True when this surface should offer "Check with factoring".
   *
   * False when an authorized API exists — there the check runs by itself and a
   * button would imply a manual step that is not real. Also false when the
   * caller may not run one.
   */
  offersManualCheck: boolean;

  reason?: string;
  conditions: string[];
  /** Only ever what a provider supplied. */
  creditLimitCents?: Cents;
  availableAmountCents?: Cents;

  /** One sentence a chip's tooltip can show without any further reads. */
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What an organization does with each answer. Deliberately not "hide
 * everything risky" — a dispatcher who never sees the unknowns never checks
 * any of them.
 */
export type FactoringVisibility =
  /** Shown exactly like anything else. */
  | "show"
  /** Shown with the status marked. */
  | "warn"
  /** Shown, but never in the short list. */
  | "deprioritize"
  /** Not shown. Only ever because somebody chose it. */
  | "hide";

export const FACTORING_VISIBILITY_LABEL: Record<FactoringVisibility, string> = {
  show: "Show normally",
  warn: "Show with a warning",
  deprioritize: "Show, but never at the top",
  hide: "Hide from search",
};

/**
 * One carrier's factoring rules.
 *
 * ★ DEFAULTS NEVER HIDE ★ `unknown` defaults to `show` and nothing defaults to
 * `hide`. Hiding freight because nobody has looked it up yet is how a carrier
 * quietly loses half its market to a setting no one remembers choosing.
 */
export interface FactoringCheckPolicy {
  carrierOrganizationId: string;
  /** Booking requires a current approval. */
  requireApprovalToBook: boolean;
  /** A conditional approval may book, with its conditions on the screen. */
  conditionalMayBook: boolean;
  /** How long an answer stays current, when its source gives no expiry. */
  freshnessHours: number;
  /** Whether an authorized person may book past a block, with a reason. */
  allowOverride: boolean;
  /** Whether an unapproved opportunity may still go to a driver to look at. */
  allowDriverReviewBeforeApproval: boolean;
  rejected: FactoringVisibility;
  unknown: FactoringVisibility;
  stale: FactoringVisibility;
  updatedAt: IsoDateTime;
  updatedBy?: ActorRef;
}

/**
 * What a carrier starts with.
 *
 * ★ NOTHING HIDES, AND NOTHING BLOCKS, UNTIL SOMEBODY CHOOSES IT ★
 *
 * `requireApprovalToBook` is OFF by default, and that is a deliberate product
 * decision rather than timidity. Antcolos has no authorized API with any
 * factor: for most carriers the only answers here are ones a person went and
 * got. Defaulting a booking gate to ON would mean a carrier that has never
 * opened this screen finds its freight un-bookable because of a check the
 * product cannot yet perform on its own — and the fix a dispatcher would reach
 * for is the override, which would train everybody to override everything.
 *
 * Turning it on is one switch in Settings → Factoring, and a carrier that
 * factors every invoice should. Until then the answer is still computed, still
 * shown on every load and still carried into the booking confirmation; it
 * simply does not stop anybody.
 *
 * The visibility defaults follow the same rule: `unknown` shows normally and
 * nothing defaults to `hide`, because hiding freight nobody has looked up yet
 * is how a carrier quietly loses half its market to a setting no one chose.
 */
export const DEFAULT_FACTORING_POLICY: Omit<
  FactoringCheckPolicy, "carrierOrganizationId" | "updatedAt" | "updatedBy"
> = {
  requireApprovalToBook: false,
  conditionalMayBook: true,
  freshnessHours: 72,
  allowOverride: true,
  allowDriverReviewBeforeApproval: true,
  rejected: "warn",
  unknown: "show",
  stale: "warn",
};

/* -------------------------------------------------------------------------- */
/* The adapter seam                                                            */
/* -------------------------------------------------------------------------- */

/** What a check asks. Provider-neutral: no adapter gets anything else. */
export interface FactoringCheckRequest {
  carrierOrganizationId: string;
  connectionId: string;
  brokerNameObserved: string;
  /** Digits only. The only identifier a factor can actually answer on. */
  brokerMcNumber?: string;
  brokerPartyId?: string;
  /** Absent when the caller has no amount. Never a placeholder. */
  proposedAmountCents?: Cents;
  dispatchCycleId?: string;
  listingId?: string;
  loadId?: string;
}

/**
 * What an adapter returns. Note what it CANNOT return: an actor, an
 * organization, an evidence record or a check id. Those belong to the service
 * that called it, so an adapter cannot attribute an answer to a person.
 */
export interface FactoringAdapterOutcome {
  decision: FactoringDecision;
  /** The provider's words, when it gave any. */
  reason?: string;
  conditions?: string[];
  /** Only when the provider supplied them. */
  creditLimitCents?: Cents;
  availableAmountCents?: Cents;
  providerReference?: string;
  source: FactoringDecisionSource;
  checkedAt: IsoDateTime;
  expiresAt?: IsoDateTime;
}

/**
 * The seam a real provider integration implements.
 *
 * An adapter receives a request and returns an outcome. It is handed no
 * credential, because it is not the thing that authenticates: a production
 * adapter calls an Antcolos backend endpoint, and the backend holds the
 * provider's authorization. That is the whole reason this interface takes no
 * secret and has nowhere to put one.
 */
export interface FactoringProviderAdapter {
  readonly providerKind: FactoringProviderKind;
  readonly providerName: string;
  readonly mode: FactoringConnectionMode;
  /** True ONLY for an authorized provider API. */
  readonly liveApi: boolean;
  /** False for every mode where a person, not the adapter, produces an answer. */
  readonly canCheck: boolean;
  check(request: FactoringCheckRequest): Promise<FactoringAdapterOutcome>;
}

/* -------------------------------------------------------------------------- */
/* Recording a fallback answer                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Everything Antcolos already knows, handed to the person doing a fallback
 * check so they retype none of it.
 *
 * The prefill is READ-ONLY context. Nothing here is a decision, and building
 * one does not create a check.
 */
export interface FactoringFallbackPrefill {
  carrierOrganizationId: string;
  carrierName: string;
  /** The carrier's own MC, which the factor will ask for. */
  carrierMcNumber?: string;
  providerName: string;
  accountLabel: string;
  accountReference?: string;
  mode: FactoringConnectionMode;
  fallback: FactoringFallbackConfig;

  brokerName: string;
  brokerMcNumber?: string;
  brokerPartyId?: string;
  /** Whether the MC has been verified against the issuing authority. */
  brokerMcVerified: boolean;

  proposedAmountCents?: Cents;
  dispatchCycleId?: string;
  listingId?: string;
  laneLabel?: string;

  dispatcherName: string;
  dispatcherMembershipId: string;
  /** The answer already on file and how old it is, when there is one. */
  previous?: FactoringStatusView;
  /** A ready-to-send credit-check email, when the carrier uses that fallback. */
  emailDraft?: { to?: string; subject: string; body: string };
}

/** Recording what came back. */
export interface RecordFactoringResultInput {
  carrierOrganizationId: string;
  connectionId?: string;
  brokerNameObserved: string;
  brokerMcNumber?: string;
  brokerPartyId?: string;
  proposedAmountCents?: Cents;
  dispatchCycleId?: string;
  listingId?: string;
  loadId?: string;
  decision: FactoringDecision;
  source: FactoringDecisionSource;
  reason?: string;
  conditions?: string[];
  creditLimitCents?: Cents;
  availableAmountCents?: Cents;
  providerReference?: string;
  evidence?: FactoringEvidence;
  /** When the provider answered. Defaults to now. */
  checkedAt?: IsoDateTime;
  /** When it should stop being trusted. Defaults from the carrier's policy. */
  expiresAt?: IsoDateTime;
  /** Same key, same check. A double-tapped Save records one answer. */
  idempotencyKey?: string;
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One row of a factoring company's debtor/credit export, as it was given.
 *
 * Parsed upstream — this module takes rows, not a file — for the same reason
 * `ImportService` does: the matching and supersession rules are what need
 * testing, and a CSV parser in the way makes that harder without making it
 * truer.
 */
export interface FactoringImportRowInput {
  /** The row's own line number in the file, for a person going back to it. */
  lineNumber: number;
  debtorName: string;
  /** As printed. Normalized to digits on the way in. */
  mcNumber?: string;
  dotNumber?: string;
  /** The factor's own status word, e.g. "APPROVED", "DECLINED", "REVIEW". */
  statusText: string;
  creditLimitText?: string;
  availableText?: string;
  reason?: string;
  conditions?: string;
  effectiveDate?: string;
  expiryDate?: string;
}

export type FactoringImportRowState =
  /** Matched a canonical broker by verified MC. Ready to commit. */
  | "matched"
  /** No MC on the row. A name alone never attaches to a broker. */
  | "name_only"
  /** MC matched nothing this carrier's directory knows. */
  | "unmatched"
  /** The row disagrees with the record it matched, or with another row. */
  | "conflicted"
  /** The factor's status word is not one this parser recognises. */
  | "unreadable"
  /** Already committed by an earlier run of this exact batch. */
  | "already_committed";

export const FACTORING_IMPORT_ROW_LABEL: Record<FactoringImportRowState, string> = {
  matched: "Ready",
  name_only: "Needs review — no MC number",
  unmatched: "Needs review — MC not in your directory",
  conflicted: "Needs review — conflicts",
  unreadable: "Needs review — status not recognised",
  already_committed: "Already imported",
};

export interface FactoringImportRow {
  rowId: string;
  batchId: string;
  lineNumber: number;
  input: FactoringImportRowInput;
  state: FactoringImportRowState;
  /** Why it needs a person, in their words. Absent when it does not. */
  reviewReason?: string;
  /** Normalized MC, digits only. */
  mcNumber?: string;
  /** The canonical broker this row resolved to, when it did. */
  brokerPartyId?: string;
  brokerLegalName?: string;
  /** What the row's status word means in Antcolos terms. */
  decision?: FactoringDecision;
  creditLimitCents?: Cents;
  availableAmountCents?: Cents;
  expiresAt?: IsoDateTime;
  /** The check this row produced, once committed. */
  committedCheckId?: string;
  /** The check this row supersedes, worked out at preview time. */
  supersedesCheckId?: string;
}

export type FactoringImportBatchState = "preview" | "committed" | "partially_committed";

/**
 * One import of one export file.
 *
 * `contentHash` is what makes a re-import idempotent: the same file staged
 * twice resumes the same batch rather than making a second one, and rows it
 * already committed are reported `already_committed` and written again by
 * nothing.
 */
export interface FactoringImportBatch {
  batchId: string;
  carrierOrganizationId: string;
  connectionId: string;
  providerName: string;
  /** The file name, as the carrier's person saw it. */
  label: string;
  /** Derived from the rows. Same rows, same batch. */
  contentHash: string;
  state: FactoringImportBatchState;
  rowCount: number;
  stagedAt: IsoDateTime;
  stagedBy: ActorRef;
  committedAt?: IsoDateTime;
  committedBy?: ActorRef;
  /** How many rows have actually been written. Resumable from here. */
  committedRowCount: number;
}

export interface FactoringImportPreview {
  batch: FactoringImportBatch;
  rows: FactoringImportRow[];
  summary: {
    ready: number;
    needsReview: number;
    alreadyCommitted: number;
    /** Rows that will replace an existing answer, with its history kept. */
    supersedes: number;
  };
  /** True when this exact file was already staged. Nothing was added. */
  resumed: boolean;
}

export interface FactoringImportResult {
  batch: FactoringImportBatch;
  rows: FactoringImportRow[];
  committed: number;
  skipped: number;
  /** Checks written by this run, in row order. */
  checks: BrokerFactorabilityCheck[];
}

/* -------------------------------------------------------------------------- */
/* The booking gate                                                            */
/* -------------------------------------------------------------------------- */

export type FactoringBlockKind =
  | "rejected"
  | "no_current_result"
  | "conditions_unmet"
  | "not_connected";

export const FACTORING_BLOCK_LABEL: Record<FactoringBlockKind, string> = {
  rejected: "Your factor will not fund this broker",
  no_current_result: "There is no current factoring result",
  conditions_unmet: "The factoring approval has conditions",
  not_connected: "No factoring connection for this carrier",
};

/**
 * What the booking screen is told.
 *
 * `recheckNote` exists because the honest sentence changes with the mode, and a
 * booking confirmation that says "rechecked" when a person read a spreadsheet
 * last Tuesday is the exact lie this module was built to avoid.
 */
export interface FactoringBookingGate {
  status: FactoringStatusView;
  /**
   * Exactly what this gate was evaluated for.
   *
   * Carried so a confirmation screen can offer an override without re-deriving
   * the subject from whatever it happens to have on hand — which is how an
   * override ends up recorded against the wrong broker or, worse, the wrong
   * carrier.
   */
  subject: {
    carrierOrganizationId: string;
    brokerNameObserved: string;
    brokerMcNumber?: string;
    brokerPartyId?: string;
    proposedAmountCents?: Cents;
    dispatchCycleId?: string;
    listingId?: string;
  };
  /** True when the carrier's policy lets this booking proceed. */
  allowed: boolean;
  /** Why not, when not. */
  block?: { kind: FactoringBlockKind; detail: string };
  /** Conditions a conditional approval carries. Always shown, never summarised away. */
  conditions: string[];
  /** True when policy permits an authorized person to override. */
  overrideAvailable: boolean;
  /** An override already recorded for this cycle, when there is one. */
  override?: FactoringOverride;
  /** True only when a live adapter actually re-checked just now. */
  recheckedLive: boolean;
  /** The honest sentence about what did or did not happen. */
  recheckNote: string;
  /** Whether the carrier requires factoring at all. */
  policyRequiresApproval: boolean;
}

/**
 * An authorized person deciding to book anyway.
 *
 * Immutable, reason-bearing, and paired one-to-one with an audit event. The
 * reason is not optional anywhere in the path: the service refuses an empty one
 * rather than storing a blank.
 */
export interface FactoringOverride {
  overrideId: string;
  carrierOrganizationId: string;
  dispatchCycleId?: string;
  listingId?: string;
  /** The check that was overridden, when there was one to override. */
  checkId?: string;
  /** The decision at the moment of the override. */
  overriddenDecision: FactoringDecision;
  reason: string;
  actor: ActorRef;
  /** The organization whose person overrode — a delegate is named as one. */
  actingOrganizationId: string;
  /** The audit event this override wrote. One override, one event. */
  auditEventId: string;
  at: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Load Search filter                                                          */
/* -------------------------------------------------------------------------- */

export type FactoringFilterKey =
  | "all"
  | "approved"
  | "approved_conditional"
  | "rejected"
  | "pending_unknown"
  | "stale"
  | "not_checked";

export const FACTORING_FILTER_LABEL: Record<FactoringFilterKey, string> = {
  all: "Show all",
  approved: "Approved only",
  approved_conditional: "Approved + Conditional",
  rejected: "Rejected",
  pending_unknown: "Pending / Unknown",
  stale: "Stale",
  not_checked: "Not checked",
};

export const FACTORING_FILTER_ORDER: readonly FactoringFilterKey[] = [
  "all", "approved", "approved_conditional", "rejected",
  "pending_unknown", "stale", "not_checked",
];

/* -------------------------------------------------------------------------- */
/* What may never be stored                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE LIST A TEST WALKS THE WHOLE DOMAIN MODEL AGAINST ★
 *
 * No record this module produces may carry a field whose name contains any of
 * these. It is not a lint rule and not a convention: `tests/factoring-*` walks
 * every serialized connection, check, batch, policy and prefill and fails on a
 * hit, so a future field called `portalPassword` cannot be added quietly.
 *
 * The positive statement of the same rule: a carrier's factoring credentials
 * live with the carrier and its factor. If Antcolos ever runs a live check, the
 * BACKEND holds provider-issued authorization and the browser is handed an
 * answer, never a secret.
 */
export const FACTORING_FORBIDDEN_FIELDS: readonly string[] = [
  "password", "passcode", "secret", "token", "apikey", "api_key",
  "credential", "cookie", "session", "authorization", "bearer",
  "pin", "otp", "mfa", "login", "username",
];

/** The sentence every factoring surface is required to be able to say. */
export const FACTORING_MOCK_NOTICE =
  "Antcolos is not connected to a factoring company. Results here come from an "
  + "authorized import, a recorded provider response, a manual check or the "
  + "development adapter — never from a live factoring API.";

export const FACTORING_UNCHECKED_DRIVER_NOTICE =
  "Driver review allowed · Booking requires factoring approval";
