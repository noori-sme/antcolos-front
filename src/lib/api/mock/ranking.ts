import type {
  LearningSummary, Listing, NetworkLearningAvailability, OpportunityMatch,
  RankingFactorKey, RankingPreferences,
} from "@/types";
import {
  LEARNING_ALLOWED_KEYS, LEARNING_DATA_USE_NOTE, LEARNING_DATA_USE_POLICY,
} from "@/config/learning";
import type { ServiceContext } from "../contracts/context";
import { appendAuditEvent } from "./audit";

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
 * ★ AND IT CROSSES THROUGH ONE ALLOWLIST, OR NOT AT ALL ★
 * Learning is a platform function, not a per-workspace feature, so there is no
 * toggle and no consent dialog to hide behind. That puts the entire weight on
 * the boundary, and the boundary is `src/config/learning.ts`: an exhaustive,
 * versioned list of the derived fields that may travel. Every contribution is
 * PROJECTED through that list before it is stored, so a field nobody thought
 * about is dropped rather than leaked — adding one is a deliberate edit to the
 * policy, and forgetting to edit it fails closed.
 *
 * A workspace's own decisions are kept in `observations` and never leave it,
 * which is what lets the ranking learn for one carrier from that carrier alone.
 * They are also subtracted from the pool before it is read, so a workspace never
 * receives its own contributions back as though they were the market's opinion.
 *
 * ── ACCEPTED PRODUCT DECISIONS THIS FILE IMPLEMENTS ───────────────────────
 * Settled, not open, and recorded here so the next reader does not relitigate
 * them from the code:
 *
 *   • Local learning is ALWAYS on. A workspace learns from itself regardless.
 *   • Contributing the allowlisted derived signals is part of the service and
 *     is not a setting. What makes that defensible is not a promise but the
 *     projection below, the absent organization id, the minimum-evidence floor
 *     and the self-subtraction — and if any of those stops holding, the
 *     mandatory posture is wrong and must change with it.
 *   • Consumption of eligible network learning is part of the service too.
 *   • No model is trained, scored or served. The derivation is arithmetic a
 *     person could do on paper, and the policy says so in the same words.
 *
 * ── WHAT THE BACKEND MUST OWN AS POLICY ───────────────────────────────────
 * DURABLE DELETION, RETENTION, and what a withdrawal request can actually
 * reach. A row carrying no organization id cannot be found and removed per
 * workspace — that is the price of it being anonymous, and it is stated on
 * screen rather than left for somebody to discover. Whether anonymous
 * contributions are kept forever or expire on a schedule is a decision with
 * legal weight and belongs to the backend and to the privacy terms. The policy
 * lists what production launch requires before any of this runs for real:
 * accurate Terms of Service, a Privacy Notice, retention rules and legal
 * review. Nothing here is a substitute for any of them, and nothing here
 * claims that a free service carries lighter obligations than a paid one.
 *
 * It must also own the UNIQUE CONSTRAINT that makes one decision one row. Here
 * that is a `Map` keyed by `(organizationId, matchId)` inside one tab, which is
 * a contract rather than a guarantee: two tabs, two devices or a retried request
 * under a real backend would each get their own. The backend needs
 * `UNIQUE (organization_id, match_id)` on the workspace-side decision table, and
 * the pool row reached through the contribution token that table holds — never
 * by writing an organization id onto the pool to make the constraint easier.
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
 * Put the ranking and both pools back to their shipped state.
 *
 * The workspace-side index goes with them. A reset that emptied the pool but
 * kept the index would leave a workspace believing it had already contributed
 * rows that are no longer there, and its own contributions would then fail to
 * be subtracted from anybody's.
 */
export function resetRanking() {
  preferences.clear();
  observations.length = 0;
  byDecision.clear();
  network.length = 0;
  engagedPolicyVersions.clear();
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
 * The ONLY fields that leave a workspace, in a person's words.
 *
 * DERIVED from `src/config/learning.ts` rather than restated here, because two
 * lists of what may travel is one list too many and the drift between them
 * would be exactly the kind nobody notices. The policy is the source; these are
 * its labels.
 */
export const SHARED_FIELDS: readonly string[] =
  LEARNING_DATA_USE_POLICY.allowed.map((f) => `${f.label} — ${f.derivation}`);

/**
 * What never leaves, whatever happens.
 *
 * The allowlist above is what ENFORCES this — anything absent from it is
 * dropped at the boundary. These categories are written out anyway, because
 * "we only send what we listed" is a claim somebody can check and an absence is
 * not something a reader can see.
 */
export const WITHHELD_FIELDS: readonly string[] =
  LEARNING_DATA_USE_POLICY.prohibited.map((f) => `${f.label} — ${f.reason}`);

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
  /**
   * The policy era this row was gathered under.
   *
   * Identical for every workspace contributing in the same period, so it
   * separates eras rather than contributors — and it is what stops a later,
   * wider allowlist from silently re-licensing rows collected under a narrower
   * one. Rows carry the terms they were gathered on.
   */
  policyVersion: number;
}

/** Every workspace's own decisions, kept per workspace and never joined to the pool. */
const observations: LocalObservation[] = [];
/**
 * decision key -> the one row that decision owns.
 *
 * The same shape `meter-ledger.ts` uses for `byIdempotencyKey`, and for the same
 * reason: a retried contribution must write once. See `decisionKey` below.
 */
const byDecision = new Map<string, LocalObservation>();
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
 * ★ WHAT COUNTS AS ONE DECISION ★
 *
 * One MATCH — one load offered to one truck's cycle — is one opinion, however
 * many times somebody presses the button.
 *
 * `matchId` is the identity, because it is the stable one that already exists:
 * an immutable id minted once when the match is formed, unchanged by
 * short-listing, dismissing or restoring it. Nothing new had to be invented and
 * nothing about the organization goes anywhere near the pool.
 *
 * This matters more than a tidy count. `shortlistMatch` does not refuse a match
 * that is already short-listed, so a double-click, a retried command or a
 * replayed action reaches here again — and before this existed, twelve clicks
 * on ONE load produced twelve local rows and twelve pool rows, each with its own
 * unlinkable token. That is enough to clear the minimum-evidence floor from a
 * single decision, and another workspace would then have consumed it as the
 * market's opinion. The floor is only worth having if the rows under it are
 * distinct loads.
 *
 * A change of mind REPLACES the row rather than adding one, so a mis-click that
 * is immediately corrected leaves the right opinion rather than both.
 *
 * Note what is deliberately NOT de-duplicated: the match's own history still
 * records every press. Those are acts a person took and the record of acts
 * should be complete. This is a corpus of opinions, and one load is one opinion.
 *
 * ███ FRONTEND ONLY ███
 * A `Map` in one tab. The backend needs a real unique constraint — see the note
 * on `decisionKey`.
 */
function decisionKey(organizationId: string, match: OpportunityMatch): string {
  // Scoped by organization so two workspaces looking at the same load each keep
  // their own opinion. The key never reaches the pool; it lives only in the
  // workspace-side index, next to the organization id it already holds.
  return `${organizationId}:${match.matchId}`;
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
  ctx: ServiceContext,
  match: OpportunityMatch,
  listing: Listing,
  pursued: boolean,
): void {
  const organizationId = ctx.organizationId;
  const key = decisionKey(organizationId, match);
  const observation = anonymize(match, listing, pursued);
  const existing = byDecision.get(key);

  if (existing) {
    // Seen before. The opinion may have changed — somebody short-listed a load
    // and then thought better of it — so the row is REPLACED, never joined by a
    // second one. One match has not become two loads.
    existing.observation = observation;
    existing.at = nowIso();

    const pooled = existing.contributionId
      ? network.find((o) => o.contributionId === existing.contributionId)
      : undefined;
    if (pooled) {
      // Corrected in place, under the token it already has, so a change of mind
      // does not add a row. Projected again, because a correction is a write
      // and every write goes through the allowlist.
      Object.assign(pooled, allowlisted(observation));
      return;
    }

    existing.contributed = true;
    existing.contributionId = contribute(ctx, observation);
    return;
  }

  const row: LocalObservation = {
    organizationId, at: nowIso(), observation, contributed: true,
    contributionId: contribute(ctx, observation),
  };
  observations.push(row);
  byDecision.set(key, row);
}

/**
 * ★ THE ONE DOOR, AND THE ALLOWLIST ACROSS IT ★
 *
 * Every row that reaches the pool is BUILT by copying the keys the policy
 * names, rather than by copying the observation and trusting whoever wrote it
 * to have left the wrong things out. The difference is what happens to a field
 * somebody adds later without thinking: under a denylist it travels, under this
 * it is dropped. Forgetting to update the policy fails closed.
 *
 * Exported so a test can hand it a shape carrying a carrier name and a phone
 * number and assert that neither comes out — which is the entire point of it
 * existing, and is not observable from the happy path, where `anonymize` is
 * already producing exactly the allowlisted keys.
 */
export function allowlisted(observation: AnonymizedObservation): Record<string, unknown> {
  const source = observation as unknown as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const allowedKey of LEARNING_ALLOWED_KEYS) {
    if (allowedKey in source) projected[allowedKey] = source[allowedKey];
  }
  return projected;
}

/**
 * Put one observation in the pool and return the token the workspace keeps.
 *
 * The token and the policy version are added AFTER the projection rather than
 * being trusted to survive it, because both are the pool's own bookkeeping
 * rather than anything the caller supplied. Both are allowlisted, and both are
 * described in the policy in the same words a screen shows.
 */
function contribute(ctx: ServiceContext, observation: AnonymizedObservation): string {
  recordPolicyEngagement(ctx);
  const contributionId = newContributionId();
  network.push({
    ...allowlisted(observation),
    contributionId,
    policyVersion: LEARNING_DATA_USE_POLICY.version,
  } as PooledObservation);
  return contributionId;
}

/**
 * ★ THE WORKSPACE CAN SEE THAT THIS HAPPENS, AND ON WHAT TERMS ★
 *
 * Nobody opts in, so the ledger is where a workspace finds out. The FIRST time
 * an organization contributes under a given policy version, one event is
 * appended saying so and naming the version. Once per organization per version:
 * an event per decision would bury the ledger, and never saying it at all would
 * make a mandatory behaviour an invisible one.
 *
 * It reuses `organization.settings_changed` with this module's own verb in
 * `sourceAction` — the organization's data-use posture is part of its record —
 * so no new audit action is minted and there is no second log.
 */
const engagedPolicyVersions = new Set<string>();

function recordPolicyEngagement(ctx: ServiceContext): void {
  const marker = `${ctx.organizationId}:${LEARNING_DATA_USE_POLICY.version}`;
  if (engagedPolicyVersions.has(marker)) return;
  engagedPolicyVersions.add(marker);

  appendAuditEvent(ctx, {
    module: "organization",
    action: "organization.settings_changed",
    sourceAction: "learning.policy_engaged",
    entity: {
      kind: "organization",
      id: ctx.organizationId,
      label: ctx.organizationName,
      href: "/settings/learning",
    },
    source: "system",
    summary: `This workspace began contributing derived ranking signals to network learning under data-use policy v${LEARNING_DATA_USE_POLICY.version}. ${LEARNING_DATA_USE_POLICY.allowed.length} derived fields may travel; nothing that identifies a workspace, a person or a company may.`,
    changes: [{
      field: "learning.policyVersion",
      label: "Network learning data-use policy",
      after: LEARNING_DATA_USE_POLICY.version,
    }],
  });
}

/**
 * How many decisions the learning wants before it says anything at all.
 *
 * Read from the policy rather than kept here, so the floor a screen describes
 * and the floor the code applies cannot drift apart. An opinion formed from
 * four data points is noise wearing a suggestion's clothes, and for the pool it
 * is also what keeps a suggestion about the market rather than about whoever
 * happens to have contributed.
 */
const MINIMUM_OBSERVATIONS = LEARNING_DATA_USE_POLICY.minimumObservations;

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
 * ★ LOCAL FIRST, AND NEVER THE WORKSPACE'S OWN ECHO ★
 * A workspace's own decisions are better evidence about that workspace than
 * anybody else's, so they are tried first. The pool is the fallback, with this
 * workspace's own contributions subtracted from it, and it speaks only once
 * there is enough left to be about the market. When neither produces anything
 * the summary says so rather than returning a quiet nothing.
 */
export function learningFor(organizationId: string): LearningSummary {
  const mine = observations.filter((o) => o.organizationId === organizationId);

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

  const networkAvailability: NetworkLearningAvailability =
    fromOthers.length < MINIMUM_OBSERVATIONS ? "insufficient_evidence" : "available";

  const summary: LearningSummary = {
    policyVersion: LEARNING_DATA_USE_POLICY.version,
    localObservations: mine.length,
    contributedObservations: mine.filter((o) => o.contributed).length,
    // Other workspaces' rows only. Reporting the whole pool would make a
    // workspace that had just filled it look as though there were something
    // there for it to learn from.
    networkObservations: fromOthers.length,
    networkAvailability,
    sharedFields: [...SHARED_FIELDS],
    withheldFields: [...WITHHELD_FIELDS],
    dataUseNote: LEARNING_DATA_USE_NOTE,
  };

  const base = rankingPreferences(organizationId).weights;

  const local = suggestFrom(mine.map((o) => o.observation), base);
  if (local) {
    summary.suggested = local;
    summary.suggestedFrom = "local";
    summary.lastLearnedAt = nowIso();
    return summary;
  }

  // Too little from other workspaces to speak. It says so rather than guessing.
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
