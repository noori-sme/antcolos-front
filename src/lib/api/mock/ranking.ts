import type {
  LearningConsent, LearningSummary, Listing, NetworkLearningAvailability,
  OpportunityMatch, PermissionKey, RankingFactorKey, RankingPreferences,
} from "@/types";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import { appendAuditEvent, recordPermissionDenied } from "./audit";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * How opportunities are ordered, and what Antcolos is allowed to learn from it.
 *
 * Two things live here and they are kept strictly apart.
 *
 * The WEIGHTS are the dispatcher's. They ship with a sensible default, a person
 * can move them, and the screen always says which of the two is in force. That
 * matters more than the algorithm: a ranking somebody cannot argue with is a
 * ranking they stop reading, and a dispatcher who cannot say "I care about
 * getting him home more than the rate" will go back to sorting by rate in a
 * spreadsheet.
 *
 * The LEARNING is Antcolos's, and it is deliberately hobbled. It watches which
 * loads dispatchers actually pursue and which they throw away, and it turns
 * that into a SUGGESTION — never an adjustment. Weights do not move under a
 * person without them pressing something. A ranking that quietly drifts is the
 * fastest way to lose the trust the first paragraph is about.
 *
 * What crosses the Antcolos boundary is spelled out in `SHARED_FIELDS` and
 * `WITHHELD_FIELDS` below, in the data rather than in a policy document, so a
 * test can assert it and a dispatcher can read it. The short version: a shape of
 * a load and a yes or no. No workspace, no carrier, no broker, no person, no
 * address, no credential — and nothing that could be joined back to any of them.
 *
 * ★ AND IT CROSSES ONLY IF THE WORKSPACE SAID SO ★
 * Anonymising well is not the same as being allowed to send it. Contribution to
 * the shared pool is OFF until somebody with `organization:manage` turns it on,
 * and `observeDecision` is the one door — there is no queue, no buffer and no
 * second writer, so a decision refused today cannot be swept up tomorrow.
 * Consumption is a separate switch, because benefiting and contributing are
 * separate decisions and only one of them is irreversible.
 *
 * A workspace's own decisions are kept regardless, in `observations`, and never
 * leave it. That is what lets the ranking go on learning for a carrier that
 * shares nothing at all. They are also subtracted from the pool before it is
 * read, so a workspace never receives its own contributions back as though they
 * were the market's opinion.
 *
 * ── ACCEPTED PRODUCT DECISIONS THIS FILE IMPLEMENTS ───────────────────────
 * Settled, not open, and recorded here so the next reader does not relitigate
 * them from the code:
 *
 *   • Contribution and consumption are SEPARATE choices. Giving and benefiting
 *     carry different risks and only one of them is irreversible.
 *   • Contribution is OFF by default. Consumption may stay on by default only
 *     while nothing a consumer sees can identify a source organization, user,
 *     carrier, truck, driver, load, contract or credential — which is what the
 *     banding, the absent organization id, the minimum-evidence floor and the
 *     self-subtraction above are all for. If any of that stops holding, the
 *     consumption default is wrong and must change with it.
 *   • Consent integrity comes BEFORE any learning built on top of it.
 *
 * ── WHAT THE BACKEND MUST OWN AS POLICY ───────────────────────────────────
 * Three things this file cannot provide and must not be read as providing:
 * DURABLE DELETION, RETENTION, and CONSENT WITHDRAWAL as an enforceable
 * lifecycle. Turning contribution off here stops the next write; it does not
 * expire, erase or age out anything already pooled, and the pool is anonymous
 * precisely so that there is nothing in it to erase by workspace. Whether
 * anonymous contributions are retained forever, expire on a schedule, or are
 * purged wholesale on withdrawal is a policy decision with legal weight, and it
 * belongs to the backend and to whoever writes the privacy terms — not here.
 */

const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Weights                                                                     */
/* -------------------------------------------------------------------------- */

export const FACTOR_KEYS: RankingFactorKey[] = [
  "rate", "profit", "deadhead", "home_time", "broker_quality", "lane_preference",
];

/**
 * What Antcolos ranks by until somebody says otherwise.
 *
 * Rate and profit lead because that is what a dispatcher is paid on; deadhead
 * is close behind because empty miles are the cost nobody bills for. Home time
 * is weighted lower than it deserves on purpose — it is the one most likely to
 * be adjusted UP by a carrier that keeps its drivers, and a default that is
 * already high leaves them nothing to say.
 */
const DEFAULT_WEIGHTS: Record<RankingFactorKey, number> = {
  rate: 85,
  profit: 80,
  deadhead: 70,
  home_time: 45,
  broker_quality: 55,
  lane_preference: 35,
};

const preferences = new Map<string, RankingPreferences>();

/**
 * Put the ranking, the consent and both pools back to their shipped state.
 *
 * Consent is cleared along with the pools, so a fresh world is one where no
 * workspace has agreed to anything and the shared pool is empty. That pairing
 * matters: a reset that emptied the pool but left a workspace consenting, or
 * kept rows contributed by a workspace whose consent had just been wiped, would
 * leave observations behind that nobody can show a decision for.
 */
export function resetRanking() {
  preferences.clear();
  consent.clear();
  observations.length = 0;
  network.length = 0;
}

export function rankingPreferences(organizationId: string): RankingPreferences {
  let found = preferences.get(organizationId);
  if (!found) {
    found = {
      organizationId,
      weights: { ...DEFAULT_WEIGHTS },
      source: "default",
      updatedAt: nowIso(),
    };
    preferences.set(organizationId, found);
  }
  return found;
}

/**
 * Move one weight.
 *
 * Clamped rather than rejected: a dispatcher dragging a slider to the end means
 * "as much as this goes", and an error message at that moment is useless.
 */
export function setRankingWeight(
  organizationId: string,
  key: RankingFactorKey,
  value: number,
  byName: string,
): RankingPreferences {
  const current = rankingPreferences(organizationId);
  const next: RankingPreferences = {
    ...current,
    weights: { ...current.weights, [key]: Math.max(0, Math.min(100, Math.round(value))) },
    source: "adjusted",
    updatedAt: nowIso(),
    updatedByName: byName,
  };
  preferences.set(organizationId, next);
  return next;
}

export function resetRankingWeights(organizationId: string, byName: string): RankingPreferences {
  const next: RankingPreferences = {
    organizationId,
    weights: { ...DEFAULT_WEIGHTS },
    source: "default",
    updatedAt: nowIso(),
    updatedByName: byName,
  };
  preferences.set(organizationId, next);
  return next;
}

/** Take the learning's suggestion. Only ever called by a person pressing it. */
export function applySuggestedWeights(
  organizationId: string,
  byName: string,
): RankingPreferences | undefined {
  const suggested = learningFor(organizationId).suggested;
  if (!suggested) return undefined;
  const next: RankingPreferences = {
    organizationId,
    weights: { ...suggested },
    source: "learned",
    updatedAt: nowIso(),
    updatedByName: byName,
  };
  preferences.set(organizationId, next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScoringInput {
  listing: Listing;
  deadheadMiles: number;
  loadedMiles: number;
  allInRatePerMileCents?: number;
  estimatedProfitCents?: number;
  /** The carrier's own floor, so "good rate" means good FOR THIS CARRIER. */
  minRatePerMileCents: number;
  maxDeadheadMiles: number;
  /** Where the driver wants to be, if they have said. */
  preferredStates?: string[];
  avoidStates?: string[];
  /** When they have asked to be home by. */
  homeByAt?: string;
  homeState?: string;
  brokerCreditScore?: number;
  brokerMcAgeMonths?: number;
  workedWithBefore?: boolean;
}

/** 0-100 for one factor, with a sentence a dispatcher can argue with. */
interface RawFactor {
  raw: number;
  detail: string;
}

function rateFactor(i: ScoringInput): RawFactor {
  const rpm = i.listing.ratePerMileCents;
  if (rpm === undefined) return { raw: 40, detail: "No rate posted, so this is a guess." };
  const floor = i.minRatePerMileCents;
  // Everything is measured against what THIS carrier will accept, not a market
  // average: $2.00 is a good day for one carrier and a refusal for another.
  const ratio = rpm / Math.max(1, floor);
  const raw = Math.max(0, Math.min(100, Math.round((ratio - 0.8) * 125)));
  return {
    raw,
    detail: `$${(rpm / 100).toFixed(2)}/mi against a floor of $${(floor / 100).toFixed(2)}.`,
  };
}

function profitFactor(i: ScoringInput): RawFactor {
  if (i.estimatedProfitCents === undefined) {
    return { raw: 40, detail: "Not enough posted to estimate what is left." };
  }
  // A day's work is worth having at roughly $700 clear; scale around that.
  const raw = Math.max(0, Math.min(100, Math.round((i.estimatedProfitCents / 70_000) * 60)));
  return {
    raw,
    detail: `About $${Math.round(i.estimatedProfitCents / 100).toLocaleString()} left after the empty miles and fuel.`,
  };
}

function deadheadFactor(i: ScoringInput): RawFactor {
  const limit = Math.max(1, i.maxDeadheadMiles);
  const raw = Math.max(0, Math.min(100, Math.round(100 - (i.deadheadMiles / limit) * 90)));
  return {
    raw,
    detail: `${i.deadheadMiles} empty miles against a limit of ${limit}.`,
  };
}

function homeTimeFactor(i: ScoringInput): RawFactor {
  const dest = i.listing.destination.state;
  if (i.homeState && dest === i.homeState) {
    return { raw: 95, detail: `Delivers in ${dest}, which is where they are based.` };
  }
  if (i.homeByAt) {
    const deliver = i.listing.deliverBy ?? i.listing.pickupAt;
    const slack = (new Date(i.homeByAt).getTime() - new Date(deliver).getTime()) / 3_600_000;
    if (slack >= 0) return { raw: 75, detail: `Delivers with about ${Math.round(slack)}h to spare before they want to be home.` };
    return { raw: 15, detail: `Delivers about ${Math.round(-slack)}h after they asked to be home.` };
  }
  return { raw: 50, detail: "Nothing recorded about when they want to be home." };
}

function brokerFactor(i: ScoringInput): RawFactor {
  const parts: string[] = [];
  let raw = 50;
  if (i.brokerCreditScore !== undefined) {
    raw = i.brokerCreditScore;
    parts.push(`credit ${i.brokerCreditScore}`);
  }
  if (i.brokerMcAgeMonths !== undefined) {
    // A very young MC number is a real risk however good the score looks.
    if (i.brokerMcAgeMonths < 6) {
      raw = Math.min(raw, 30);
      parts.push(`MC only ${i.brokerMcAgeMonths} months old`);
    } else {
      parts.push(`MC ${Math.round(i.brokerMcAgeMonths / 12)} years old`);
    }
  }
  if (i.workedWithBefore) {
    raw = Math.min(100, raw + 15);
    parts.push("you have run for them before");
  }
  return {
    raw: Math.max(0, Math.min(100, Math.round(raw))),
    detail: parts.length ? parts.join(", ") + "." : "Nothing known about this broker.",
  };
}

function laneFactor(i: ScoringInput): RawFactor {
  const dest = i.listing.destination.state;
  if (i.avoidStates?.includes(dest)) {
    return { raw: 5, detail: `Goes to ${dest}, which they asked to avoid.` };
  }
  if (i.preferredStates?.includes(dest)) {
    return { raw: 95, detail: `Goes to ${dest}, which is where they want to run.` };
  }
  if (i.preferredStates?.length) {
    return { raw: 40, detail: `Goes to ${dest}; they prefer ${i.preferredStates.join(", ")}.` };
  }
  return { raw: 50, detail: "No lane preference recorded." };
}

const FACTOR_FN: Record<RankingFactorKey, (i: ScoringInput) => RawFactor> = {
  rate: rateFactor,
  profit: profitFactor,
  deadhead: deadheadFactor,
  home_time: homeTimeFactor,
  broker_quality: brokerFactor,
  lane_preference: laneFactor,
};

/**
 * Score one match, showing its working.
 *
 * The components come back with it on purpose. "87" tells a dispatcher nothing;
 * "87, and it is 87 because the rate is strong and the deadhead is short but it
 * does not get him home" is something they can act on — or disagree with, and
 * then go and move a slider.
 */
export function scoreMatch(
  input: ScoringInput,
  weights: Record<RankingFactorKey, number>,
): OpportunityMatch["score"] {
  const totalWeight = FACTOR_KEYS.reduce((sum, k) => sum + weights[k], 0);
  const components = FACTOR_KEYS.map((key) => {
    const { raw, detail } = FACTOR_FN[key](input);
    const weight = weights[key];
    const contribution = totalWeight === 0 ? 0 : (raw * weight) / totalWeight;
    return { key, weight, raw, contribution: Math.round(contribution * 10) / 10, detail };
  });
  const total = Math.round(components.reduce((sum, c) => sum + c.contribution, 0));
  return { total: Math.max(0, Math.min(100, total)), components };
}

/* -------------------------------------------------------------------------- */
/* Learning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY fields that leave a workspace.
 *
 * Every one is a shape, a band or a boolean. None of them names anything, and
 * no combination of them identifies a workspace, a carrier, a broker or a
 * person — which is the test that actually matters, not the field count.
 */
export const SHARED_FIELDS = [
  "equipment type",
  "loaded-mile band (rounded to 100)",
  "deadhead band (rounded to 25)",
  "rate-per-mile band (rounded to 10 cents)",
  "broker credit band (rounded to 10)",
  "broker MC age band (under 6 months / 6-24 / over 24)",
  "whether the dispatcher pursued it",
  "a one-time token, unique to that single row, that only the contributing workspace can match",
] as const;

/**
 * What never leaves, whatever happens.
 *
 * Written out rather than implied by omission, because "we only send what we
 * listed" is a claim somebody can check and "we don't send anything sensitive"
 * is not.
 */
export const WITHHELD_FIELDS = [
  "workspace and organization ids",
  "carrier name, MC and DOT numbers",
  "broker name, contact and email",
  "driver name, licence and contact",
  "truck and trailer identifiers",
  "origin and destination cities",
  "exact rates and exact mileage",
  "any credential, token or password",
] as const;

/**
 * The honest limit of switching contribution off, in the words a screen shows.
 *
 * It is carried in the summary rather than written into one component because
 * every surface that offers the switch owes the reader the same sentence, and
 * because the limitation is a property of the design rather than of the UI: the
 * pool holds no organization id by choice, so there is nothing in it to look up
 * and remove by workspace. Anonymity and recall are the same trade seen from
 * two sides, and claiming both would be the one dishonest thing this module
 * could say.
 */
export const CONTRIBUTION_HISTORY_NOTE =
  "Turning contribution off stops every future contribution immediately. It cannot recall what has already been shared: the pool deliberately holds no organization id, so there is nothing in it to find and delete by workspace. That is the trade for it being anonymous in the first place. Durable deletion, how long anonymous contributions are kept, and what withdrawing consent removes are backend policy, and this build decides none of them.";

/**
 * One anonymised decision.
 *
 * Named for the SHAPE rather than for the pool, because the same shape is kept
 * twice for two different reasons: once inside the workspace that made the
 * decision, where it always stays, and once in the shared pool, but only where
 * the workspace has agreed to it. Calling it a "network observation" made the
 * second look like the only use, which is how a workspace that shares nothing
 * ended up with nothing to learn from either.
 */
interface AnonymizedObservation {
  equipment: string;
  loadedMileBand: number;
  deadheadBand: number;
  ratePerMileBand: number;
  creditBand?: number;
  mcAgeBand: "new" | "young" | "established" | "unknown";
  pursued: boolean;
}

/**
 * One workspace's own decision. NEVER leaves the workspace.
 *
 * It carries the organization id, which is exactly why it is kept apart from
 * the pool below and copied into it rather than shared by reference: the two
 * arrays must never be able to become the same object.
 */
interface LocalObservation {
  organizationId: string;
  at: string;
  observation: AnonymizedObservation;
  /** Whether this one was also contributed. False for every refused decision. */
  contributed: boolean;
  /**
   * The token of the pool row this decision produced, when it produced one.
   *
   * Held HERE and nowhere else. It is what lets this workspace subtract its own
   * contributions from the pool without the pool knowing whose they are.
   */
  contributionId?: string;
}

/**
 * One row as it sits in the shared pool.
 *
 * ★ WHY THERE IS A TOKEN, AND WHY IT IS NOT AN ORGANIZATION ID ★
 * A workspace must not be handed its own contributions back as though they were
 * the market's opinion — that is a workspace learning from itself with an extra
 * step, and it is worst exactly when the workspace has too little evidence to
 * learn from directly, which is the moment it falls through to the pool.
 *
 * Telling its rows apart needs SOMETHING on the row. `contributionId` is the
 * smallest thing that works: a fresh random token, unique to one row, which
 * groups nothing and links nothing. Two rows from the same workspace share no
 * part of it, so holding the whole pool tells you nothing about who contributed
 * what — you cannot even count the contributors. The mapping from token to
 * workspace exists only inside the workspace that made it, in `observations`
 * below, and is what `learningFor` subtracts.
 *
 * A per-ORGANIZATION token would be a pseudonymous organization id and would be
 * exactly the thing this module refuses to store. A per-ROW token is not, and
 * the difference is the whole reason this is safe.
 */
interface PooledObservation extends AnonymizedObservation {
  contributionId: string;
}

/** Every workspace's own decisions, kept per workspace and never joined to the pool. */
const observations: LocalObservation[] = [];
/** The anonymised pool. Deliberately holds no organization id at all. */
const network: PooledObservation[] = [];

let contributionSeq = 0;

/**
 * A fresh token for one contributed row.
 *
 * Deliberately not derived from the organization, the time, the decision or the
 * row's position: anything derived would be something the pool could be mined
 * for. Nothing parses it and only equality is ever used.
 */
function newContributionId(): string {
  contributionSeq += 1;
  return `obs_${contributionSeq.toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/* -------------------------------------------------------------------------- */
/* Consent                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The shipped defaults, and why they are not the same on both switches.
 *
 * `contribute: false` because sharing cannot be undone. `consume: true` because
 * taking a suggestion out of the pool cannot identify anybody: what comes back
 * is a set of weights derived from bands, over a pool with no organization id,
 * and only once there are enough observations for the answer to be about the
 * market rather than about one workspace.
 *
 * Both are frontend defaults over an in-memory map. Neither is a durable
 * consent record and neither is enforced against anything but this code path.
 */
const DEFAULT_CONTRIBUTE = false;
const DEFAULT_CONSUME = true;

/** The permission that may change a workspace's consent. Nothing weaker. */
export const LEARNING_CONSENT_PERMISSION: PermissionKey = "organization:manage";

const consent = new Map<string, LearningConsent>();

/**
 * What this workspace has agreed to.
 *
 * Reads default rather than throwing for a workspace that has never been asked,
 * because "nobody has decided yet" and "they decided no" have the same safe
 * answer for contribution and a screen has to be able to render both.
 */
export function learningConsent(organizationId: string): LearningConsent {
  let found = consent.get(organizationId);
  if (!found) {
    found = {
      organizationId,
      contribute: DEFAULT_CONTRIBUTE,
      consume: DEFAULT_CONSUME,
      updatedAt: nowIso(),
    };
    consent.set(organizationId, found);
  }
  return found;
}

/** The subset a person may change. Identity and timestamps are not editable. */
export interface LearningConsentPatch {
  contribute?: boolean;
  consume?: boolean;
}

/**
 * Change this workspace's consent.
 *
 * Three properties are worth stating because tests assert each of them:
 *
 *  1. **It writes only the caller's own organization.** There is no
 *     organization parameter — the id comes from the `ServiceContext` — so
 *     there is no shape of this call that changes somebody else's consent.
 *  2. **It is idempotent.** Sending the same values again changes nothing and
 *     records nothing. A consent history full of lines where nothing moved is
 *     a consent history nobody reads.
 *  3. **A change is written to the ONE audit ledger**, as an
 *     `organization.settings_changed` event carrying this module's own key in
 *     `sourceAction`. There is no second log, here or anywhere.
 *
 * ███ FRONTEND ONLY ███
 * The permission check below makes the UI behave correctly and proves the shape
 * the real API must meet. It is not authorization: a caller who does not run
 * this function is not stopped by it.
 */
export function setLearningConsent(
  ctx: ServiceContext,
  patch: LearningConsentPatch,
): LearningConsent {
  const required: PermissionKey[] = [LEARNING_CONSENT_PERMISSION];
  const entity = {
    kind: "organization" as const,
    id: ctx.organizationId,
    label: ctx.organizationName,
    href: "/settings/learning",
  };

  if (!ctx.permissions.has(LEARNING_CONSENT_PERMISSION)) {
    // A refusal is the most audit-worthy thing a permission system does, so it
    // is recorded before the throw rather than lost with it.
    recordPermissionDenied(ctx, {
      entity,
      summary: `Tried to change cross-organization learning for ${ctx.organizationName}.`,
      required,
    });
    throw new PermissionDeniedError(required);
  }

  const current = learningConsent(ctx.organizationId);
  const contribute = patch.contribute ?? current.contribute;
  const consume = patch.consume ?? current.consume;
  if (contribute === current.contribute && consume === current.consume) return current;

  const next: LearningConsent = {
    organizationId: ctx.organizationId,
    contribute,
    consume,
    updatedAt: nowIso(),
    updatedByMembershipId: ctx.membershipId,
    updatedByName: ctx.actor.displayNameSnapshot,
  };
  consent.set(ctx.organizationId, next);

  const changes = [
    current.contribute === contribute ? null : {
      field: "learning.contribute",
      label: "Contribute decisions to cross-organization learning",
      before: current.contribute,
      after: contribute,
    },
    current.consume === consume ? null : {
      field: "learning.consume",
      label: "Use cross-organization learning suggestions",
      before: current.consume,
      after: consume,
    },
  ].filter((c) => c !== null);

  appendAuditEvent(ctx, {
    module: "organization",
    action: "organization.settings_changed",
    // The module's own verb, kept verbatim beside the shared action so a filter
    // on the ledger can find consent changes without a new action being minted.
    sourceAction: "learning.consent_changed",
    entity,
    summary: changes
      .map((c) => `${c.label}: ${c.before ? "on" : "off"} to ${c.after ? "on" : "off"}.`)
      .join(" "),
    changes,
  });

  return next;
}

const band = (n: number, to: number) => Math.round(n / to) * to;

/**
 * Turn a decision into the anonymised shape, and nothing else.
 *
 * Exported so a test can hand it a match full of names and assert that none of
 * them come out the other side. That test is the point of this function.
 */
export function anonymize(
  match: OpportunityMatch,
  listing: Listing,
  pursued: boolean,
): AnonymizedObservation {
  const age = listing.broker.mcAgeMonths;
  return {
    equipment: listing.equipment,
    loadedMileBand: band(match.loadedMiles, 100),
    deadheadBand: band(match.deadheadMiles, 25),
    ratePerMileBand: band(match.allInRatePerMileCents ?? 0, 10),
    creditBand: listing.broker.creditScore === undefined
      ? undefined
      : band(listing.broker.creditScore, 10),
    mcAgeBand: age === undefined ? "unknown" : age < 6 ? "new" : age <= 24 ? "young" : "established",
    pursued,
  };
}

/**
 * Record that a dispatcher pursued a load, or threw it away.
 *
 * Called from the match service when somebody short-lists or dismisses.
 *
 * ★ THE ONE DOOR TO THE SHARED POOL ★
 * The workspace always keeps its own decision, because that record never leaves
 * it and is what the ranking learns from locally. The pool gets a COPY, and
 * only when this organization has explicitly enabled contribution. Nothing is
 * queued, buffered or written anywhere else for later, so a decision refused
 * while contribution was off cannot be swept into the pool when it is turned
 * on: there is nowhere for it to have been waiting.
 */
export function observeDecision(
  organizationId: string,
  match: OpportunityMatch,
  listing: Listing,
  pursued: boolean,
): void {
  const observation = anonymize(match, listing, pursued);
  const contributed = learningConsent(organizationId).contribute;

  if (!contributed) {
    observations.push({ organizationId, at: nowIso(), observation, contributed: false });
    return;
  }

  // A copy, not the same object. The local row knows which workspace it came
  // from; the pool must never be able to reach it. The token travels with the
  // copy and is remembered locally, which is the only place the two meet.
  const contributionId = newContributionId();
  observations.push({
    organizationId, at: nowIso(), observation, contributed: true, contributionId,
  });
  network.push({ ...observation, contributionId });
}

/**
 * How many decisions the learning wants before it says anything at all.
 *
 * An opinion formed from four data points is noise wearing a suggestion's
 * clothes, and for the pool it is also the floor that keeps a suggestion about
 * the market rather than about whoever happens to have contributed.
 */
const MINIMUM_OBSERVATIONS = 8;

/**
 * Derive a suggestion from one body of evidence, or decline to.
 *
 * The same arithmetic for local and network evidence on purpose: "what this
 * workspace chases" and "what workspaces chase" are the same question asked of
 * different rows, and two implementations would eventually disagree about it.
 */
function suggestFrom(
  rows: readonly AnonymizedObservation[],
  base: Record<RankingFactorKey, number>,
): Record<RankingFactorKey, number> | undefined {
  if (rows.length < MINIMUM_OBSERVATIONS) return undefined;

  const pursued = rows.filter((o) => o.pursued);
  const dropped = rows.filter((o) => !o.pursued);
  if (pursued.length === 0 || dropped.length === 0) return undefined;

  const mean = (
    subset: readonly AnonymizedObservation[],
    pick: (o: AnonymizedObservation) => number,
  ) => subset.reduce((s, o) => s + pick(o), 0) / subset.length;

  const next = { ...base };

  // Pursued loads pay better than dismissed ones → rate is doing real work.
  const rateGap = mean(pursued, (o) => o.ratePerMileBand) - mean(dropped, (o) => o.ratePerMileBand);
  next.rate = clampWeight(base.rate + Math.sign(rateGap) * Math.min(20, Math.abs(rateGap) / 2));

  // Pursued loads run fewer empty miles → deadhead is doing real work.
  const deadGap = mean(dropped, (o) => o.deadheadBand) - mean(pursued, (o) => o.deadheadBand);
  next.deadhead = clampWeight(base.deadhead + Math.sign(deadGap) * Math.min(20, Math.abs(deadGap) / 4));

  // Pursued loads come from better-established brokers → broker quality matters.
  const scoreOf = (o: AnonymizedObservation) =>
    (o.creditBand ?? 50) + (o.mcAgeBand === "established" ? 15 : o.mcAgeBand === "new" ? -25 : 0);
  const brokerGap = mean(pursued, scoreOf) - mean(dropped, scoreOf);
  next.broker_quality = clampWeight(base.broker_quality + Math.sign(brokerGap) * Math.min(20, Math.abs(brokerGap) / 2));

  return next;
}

/**
 * What the learning would suggest, how much it is standing on, and where it
 * came from.
 *
 * ★ LOCAL FIRST, AND NETWORK ONLY BY CONSENT ★
 * A workspace's own decisions are better evidence about that workspace than
 * anybody else's, so they are tried first and they are available whatever
 * consent says. The pool is the fallback, and it is reachable only when this
 * workspace has left consumption on AND there is enough in it to speak. When
 * neither produces anything the summary says which of the two reasons applies
 * rather than returning a quiet nothing.
 */
export function learningFor(organizationId: string): LearningSummary {
  const mine = observations.filter((o) => o.organizationId === organizationId);
  const agreed = learningConsent(organizationId);

  // ★ A WORKSPACE NEVER LEARNS FROM ITSELF THROUGH THE POOL ★
  // Its own contributions are subtracted before anything is counted or derived,
  // so "what the market thinks" is never partly its own echo. This matters most
  // in the case that looks harmless: a workspace with too little of its own
  // evidence to learn from directly is exactly the one that falls through to
  // the pool, and exactly the one whose own rows would dominate a thin pool.
  const ownContributions = new Set(
    mine.map((o) => o.contributionId).filter((id): id is string => id !== undefined),
  );
  const fromOthers = network.filter((o) => !ownContributions.has(o.contributionId));

  const networkAvailability: NetworkLearningAvailability = !agreed.consume
    ? "consumption_disabled"
    : fromOthers.length < MINIMUM_OBSERVATIONS
      ? "insufficient_evidence"
      : "available";

  const summary: LearningSummary = {
    consent: agreed,
    localObservations: mine.length,
    contributedObservations: mine.filter((o) => o.contributed).length,
    // Other workspaces' rows only. Reporting the whole pool would make a
    // workspace that had just filled it look as though there were something
    // there for it to learn from.
    networkObservations: fromOthers.length,
    networkAvailability,
    sharedFields: [...SHARED_FIELDS],
    withheldFields: [...WITHHELD_FIELDS],
    contributionHistoryNote: CONTRIBUTION_HISTORY_NOTE,
  };

  const base = rankingPreferences(organizationId).weights;

  const local = suggestFrom(mine.map((o) => o.observation), base);
  if (local) {
    summary.suggested = local;
    summary.suggestedFrom = "local";
    summary.lastLearnedAt = nowIso();
    return summary;
  }

  // Consumption off means no network-derived suggestion, full stop — not a
  // weaker one, not a quieter one.
  if (networkAvailability !== "available") return summary;

  const fromNetwork = suggestFrom(fromOthers, base);
  if (fromNetwork) {
    summary.suggested = fromNetwork;
    summary.suggestedFrom = "network";
    summary.lastLearnedAt = nowIso();
  }
  return summary;
}

const clampWeight = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Test hook: the anonymised pool, so a test can inspect what would be shared. */
export function networkPoolForTests(): ReadonlyArray<Readonly<PooledObservation>> {
  return network;
}

/**
 * Test hook: one workspace's own decisions, which never leave it.
 *
 * Separate from the pool hook because the whole point of the split is that a
 * test can prove a decision is in one and not the other.
 */
export function localPoolForTests(
  organizationId: string,
): ReadonlyArray<Readonly<LocalObservation>> {
  return observations.filter((o) => o.organizationId === organizationId);
}
