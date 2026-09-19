import type {
  CollectorFilterProfile, OpportunitySource, SearchCriteria, SearchSession,
  SearchSessionEvent, SearchSourceRun, SourceConnection,
} from "@/types";
import { ingestListings, sampleListingsFor } from "./listing-registry";
import { collectorFilterProfile, reconcileMatches, truckMatchContext } from "./opportunity-matching";
import { openLoopsFor, type MtLoopContext } from "./mt-loop";
// The shared simulated round trip. A seeder can suppress it; a person never does.
import { sleep } from "./latency";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * A search for one truck: started, paused, resumed, closed, and answerable for.
 *
 * The session exists to answer a question a dispatch manager actually asks on a
 * Friday afternoon: "did anybody actually look for that truck?" A truck sitting
 * empty for six hours with no session on its cycle is a different problem from
 * one with a session that has searched four sources and found nothing, and the
 * two need different conversations. So the session records which sources were
 * searched, when, what each returned, and how much of it was the same load
 * arriving twice.
 *
 * One running session per cycle. Two dispatchers searching the same truck at
 * once is not collaboration, it is duplicate outreach with extra steps.
 *
 * Nothing here talks to a real load board. Every source below is a mock with an
 * honest connection state, and the two that will one day be real — the browser
 * extension and a watched mailbox — report `not_connected` and say so, rather
 * than quietly returning nothing and looking like a market with no freight in
 * it.
 */

const LATENCY_MS = 340;

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

const sessionsByOrg = new Map<string, SearchSession[]>();

function bucket(organizationId: string): SearchSession[] {
  let rows = sessionsByOrg.get(organizationId);
  if (!rows) {
    rows = [];
    sessionsByOrg.set(organizationId, rows);
  }
  return rows;
}

/** Test hook. Never called by the UI. */
export function resetSearchSessions() {
  sessionsByOrg.clear();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* The sources a search runs against                                           */
/* -------------------------------------------------------------------------- */

interface SourceDefinition {
  key: string;
  source: OpportunitySource;
  sourceName: string;
  connection: SourceConnection;
  /** Which slice of the sample market this source happens to carry. */
  skip: number;
  take: number;
  /** How this source's quotes drift from the others. Sources disagree. */
  rateDrift: number;
}

/**
 * What a search looks at, and how honest each one is about itself.
 *
 * The two planned connections are listed rather than hidden. A dispatcher
 * looking at this list should be able to see at a glance that the load boards
 * are not wired up yet — that is a fact about the product, and burying it would
 * make the empty result look like the market rather than like the truth.
 *
 * The sample sources deliberately overlap: two of them carry some of the same
 * lanes, which is the condition de-duplication has to survive and the reason
 * the session reports `duplicatesFolded` at all.
 */
const SOURCES: SourceDefinition[] = [
  {
    key: "dat", source: "load_board", sourceName: "DAT",
    connection: "browser_extension", skip: 0, take: 0, rateDrift: 0,
  },
  {
    key: "truckstop", source: "load_board", sourceName: "Truckstop",
    connection: "browser_extension", skip: 0, take: 0, rateDrift: 0,
  },
  {
    key: "mailbox", source: "email", sourceName: "Watched mailbox",
    connection: "email_inbox", skip: 0, take: 0, rateDrift: 0,
  },
  // The three windows below cover the whole sample market between them AND
  // overlap in the middle. Both halves matter: gaps mean equipment types that
  // never appear at all, and the overlap is the only reason de-duplication has
  // anything to do.
  {
    key: "sample_board", source: "load_board", sourceName: "Sample board",
    connection: "mock", skip: 0, take: 9, rateDrift: 0,
  },
  {
    key: "sample_broker", source: "broker_direct", sourceName: "Brokers you work with",
    connection: "mock", skip: 5, take: 9, rateDrift: 0.04,
  },
  {
    key: "sample_email", source: "email", sourceName: "Sample broker emails",
    connection: "mock", skip: 2, take: 6, rateDrift: -0.03,
  },
];

/* -------------------------------------------------------------------------- */
/* Criteria                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What to look for, assembled from the truck rather than typed in.
 *
 * A dispatcher never enters the equipment: a search for a reefer against a
 * cargo van is not a search anybody meant to run, and letting it be typed makes
 * it possible. Widening is a separate, recorded act.
 */
function criteriaFor(profile: CollectorFilterProfile): SearchCriteria {
  return {
    originCity: profile.originCity,
    originState: profile.originState,
    availableAt: profile.availableAt,
    equipment: profile.equipment,
    maxDeadheadMiles: profile.maxDeadheadMiles,
    minRatePerMileCents: profile.minRatePerMileCents,
    maxWeightLbs: profile.maxWeightLbs,
    hazmatAllowed: profile.hazmatAllowed,
    refusedStates: profile.refusedStates,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

function maySearch(ctx: MtLoopContext): boolean {
  if (ctx.scope.loads === "assigned") return false;
  return ctx.permissions.has("loads:view") && ctx.permissions.has("trucks:view");
}

export function sessionsFor(ctx: MtLoopContext): SearchSession[] {
  if (!maySearch(ctx)) return [];
  return [...bucket(ctx.organizationId)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The live session for one cycle, if there is one. */
export function sessionForCycle(dispatchCycleId: string, ctx: MtLoopContext): SearchSession | undefined {
  if (!maySearch(ctx)) return undefined;
  return bucket(ctx.organizationId).find(
    (s) => s.dispatchCycleId === dispatchCycleId && s.status !== "closed",
  );
}

export function sessionById(searchSessionId: string, ctx: MtLoopContext): SearchSession | undefined {
  if (!maySearch(ctx)) return undefined;
  return bucket(ctx.organizationId).find((s) => s.searchSessionId === searchSessionId);
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export type SearchOutcome =
  | { status: "ok"; session: SearchSession }
  | { status: "already_running"; session: SearchSession }
  | { status: "no_cycle" }
  | { status: "not_permitted" }
  | { status: "needs_reason" };

function record(
  session: SearchSession,
  action: SearchSessionEvent["action"],
  ctx: MtLoopContext | undefined,
  note?: string,
) {
  session.history.push({
    id: rowId("sse"),
    at: nowIso(),
    action,
    actorMembershipId: ctx?.membershipId,
    actorName: ctx?.actor.displayNameSnapshot ?? "Antcolos",
    note,
  });
}

/**
 * Start looking for a load for one truck.
 *
 * The cycle has to be open: a search for a truck that is not empty is a search
 * for nothing. Starting it runs every connected source once, so a dispatcher
 * who presses the button gets an inbox rather than an empty screen and a
 * second button to press.
 */
export async function startSearch(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): Promise<SearchOutcome> {
  await sleep(LATENCY_MS);
  if (!maySearch(ctx)) return { status: "not_permitted" };

  /* ---- critical section: no awaits until the session is in the list ---- */
  const existing = sessionForCycle(dispatchCycleId, ctx);
  if (existing) return { status: "already_running", session: existing };

  const loop = openLoopsFor(ctx).find((l) => l.loopId === dispatchCycleId);
  if (!loop) return { status: "no_cycle" };

  const tc = truckMatchContext(loop, ctx);
  if (!tc) return { status: "no_cycle" };

  const profile = collectorFilterProfile(tc);
  const at = nowIso();

  const session: SearchSession = {
    searchSessionId: uuid(),
    dispatchCycleId,
    truckId: loop.truckId,
    truckUnit: loop.truckUnit,
    dispatchOrganizationId: ctx.organizationId,
    carrierOrganizationId: tc.carrier?.organizationId ?? ctx.organizationId,
    carrierName: tc.carrier?.displayName ?? "This carrier",
    status: "running",
    startedAt: at,
    startedByMembershipId: ctx.membershipId,
    startedByName: ctx.actor.displayNameSnapshot,
    criteria: criteriaFor(profile),
    sources: SOURCES.map((s) => ({
      id: rowId("ssr"),
      source: s.source,
      sourceName: s.sourceName,
      connection: s.connection,
      status: "not_connected",
      listingsReturned: 0,
      duplicatesFolded: 0,
    })),
    history: [],
    counts: { listingsSeen: 0, duplicatesFolded: 0, matchesCreated: 0, eligible: 0 },
  };
  bucket(ctx.organizationId).push(session);
  /* ---- end critical section ---- */

  record(session, "started", ctx, `Looking for a load out of ${profile.originCity ?? "wherever it ends up"}.`);
  runSources(session, ctx);
  return { status: "ok", session };
}

/**
 * Run every source once and fold what comes back into the inbox.
 *
 * The unconnected ones are marked and skipped with a note that says why. The
 * sample ones return overlapping slices of one market, so the second and third
 * both fold duplicates into listings the first already created — and the
 * session's counts show that happening, which is the only way a dispatcher can
 * tell the de-duplication is working rather than just believing it.
 */
function runSources(session: SearchSession, ctx: MtLoopContext): void {
  const at = nowIso();
  let seen = 0;
  let folded = 0;

  for (const run of session.sources) {
    const definition = SOURCES.find(
      (s) => s.sourceName === run.sourceName && s.connection === run.connection,
    );
    if (!definition) continue;

    if (definition.connection !== "mock" && definition.connection !== "manual_entry") {
      run.status = "not_connected";
      run.note = definition.connection === "browser_extension"
        ? "The browser extension is not built yet, so nothing was read from this board."
        : "No mailbox is connected yet, so nothing was read from it.";
      continue;
    }

    const raw = sampleListingsFor(session.criteria.originCity, session.criteria.originState, {
      skip: definition.skip,
      take: definition.take,
      rateDrift: definition.rateDrift,
    });

    const result = ingestListings(raw, ctx.organizationId, {
      source: definition.source,
      sourceName: definition.sourceName,
      connection: definition.connection,
      searchSessionId: session.searchSessionId,
    });

    run.status = "searched";
    run.searchedAt = at;
    run.listingsReturned = raw.length;
    run.duplicatesFolded = result.foldedIntoExisting;
    run.note = raw.length === 0
      ? "Nothing on this lane right now."
      : result.foldedIntoExisting > 0
        ? `${result.accepted} new, ${result.foldedIntoExisting} already in the inbox.`
        : `${result.accepted} new.`;

    seen += raw.length;
    folded += result.foldedIntoExisting;
    record(session, "source_searched", undefined, `${definition.sourceName}: ${run.note}`);
  }

  const created = reconcileMatches(ctx, session.searchSessionId);
  session.counts = {
    listingsSeen: session.counts.listingsSeen + seen,
    duplicatesFolded: session.counts.duplicatesFolded + folded,
    matchesCreated: session.counts.matchesCreated + created,
    eligible: 0,
  };
}

/**
 * Search again on a session that is already running.
 *
 * The market moves, and a dispatcher who has been on the phone for an hour
 * wants to know what has appeared since. Folding means a second pass over the
 * same market adds sightings rather than duplicates.
 */
export async function searchAgain(
  searchSessionId: string,
  ctx: MtLoopContext,
): Promise<SearchOutcome> {
  await sleep(LATENCY_MS);
  if (!maySearch(ctx)) return { status: "not_permitted" };
  const session = sessionById(searchSessionId, ctx);
  if (!session) return { status: "no_cycle" };
  if (session.status !== "running") return { status: "not_permitted" };

  runSources(session, ctx);
  return { status: "ok", session };
}

/**
 * Put the search down for a bit, with a reason.
 *
 * A pause is a decision — "the driver is not confirmed yet", "the carrier is
 * ringing me back" — and it always carries why, for the same reason an MT Loop
 * pause does: in two hours nobody remembers, and the reason is the only thing
 * that makes the pause defensible.
 */
export async function pauseSearch(
  searchSessionId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<SearchOutcome> {
  await sleep(LATENCY_MS);
  if (!maySearch(ctx)) return { status: "not_permitted" };
  if (!reason.trim()) return { status: "needs_reason" };
  const session = sessionById(searchSessionId, ctx);
  if (!session) return { status: "no_cycle" };
  if (session.status !== "running") return { status: "not_permitted" };

  session.status = "paused";
  session.pausedAt = nowIso();
  session.pauseReason = reason.trim();
  record(session, "paused", ctx, reason.trim());
  return { status: "ok", session };
}

export async function resumeSearch(
  searchSessionId: string,
  ctx: MtLoopContext,
): Promise<SearchOutcome> {
  await sleep(LATENCY_MS);
  if (!maySearch(ctx)) return { status: "not_permitted" };
  const session = sessionById(searchSessionId, ctx);
  if (!session) return { status: "no_cycle" };
  if (session.status !== "paused") return { status: "not_permitted" };

  session.status = "running";
  session.pausedAt = undefined;
  session.pauseReason = undefined;
  record(session, "resumed", ctx);
  runSources(session, ctx);
  return { status: "ok", session };
}

export async function closeSearch(
  searchSessionId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<SearchOutcome> {
  await sleep(LATENCY_MS);
  if (!maySearch(ctx)) return { status: "not_permitted" };
  if (!reason.trim()) return { status: "needs_reason" };
  const session = sessionById(searchSessionId, ctx);
  if (!session) return { status: "no_cycle" };
  if (session.status === "closed") return { status: "not_permitted" };

  session.status = "closed";
  session.closedAt = nowIso();
  session.closeReason = reason.trim();
  record(session, "closed", ctx, reason.trim());
  return { status: "ok", session };
}

/**
 * Widen the search, and say so on the record.
 *
 * Loosening the deadhead limit or the rate floor is a real decision with a cost
 * — it is how a dispatcher ends up running 200 empty miles for $1.60 — so the
 * session keeps that it happened, who did it, and by how much. The carrier's
 * own rules are NOT widened: a dispatcher may relax their own search, never a
 * carrier's policy.
 */
export async function widenSearch(
  searchSessionId: string,
  changes: { maxDeadheadMiles?: number; minRatePerMileCents?: number },
  ctx: MtLoopContext,
): Promise<SearchOutcome> {
  await sleep(LATENCY_MS);
  if (!maySearch(ctx)) return { status: "not_permitted" };
  const session = sessionById(searchSessionId, ctx);
  if (!session) return { status: "no_cycle" };
  if (session.status === "closed") return { status: "not_permitted" };

  const said: string[] = [];
  if (changes.maxDeadheadMiles !== undefined
    && changes.maxDeadheadMiles > session.criteria.maxDeadheadMiles) {
    said.push(`deadhead ${session.criteria.maxDeadheadMiles} → ${changes.maxDeadheadMiles} mi`);
    session.criteria.maxDeadheadMiles = changes.maxDeadheadMiles;
  }
  if (changes.minRatePerMileCents !== undefined
    && changes.minRatePerMileCents < session.criteria.minRatePerMileCents) {
    said.push(
      `rate floor $${(session.criteria.minRatePerMileCents / 100).toFixed(2)} → $${(changes.minRatePerMileCents / 100).toFixed(2)}`,
    );
    session.criteria.minRatePerMileCents = changes.minRatePerMileCents;
  }
  if (said.length === 0) return { status: "ok", session };

  session.criteria.widened = true;
  record(session, "criteria_widened", ctx, said.join(", ") + ".");
  runSources(session, ctx);
  return { status: "ok", session };
}

/** The profile an outside collector would be handed for this cycle. */
export function filterProfileForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): CollectorFilterProfile | undefined {
  if (!maySearch(ctx)) return undefined;
  const loop = openLoopsFor(ctx).find((l) => l.loopId === dispatchCycleId);
  if (!loop) return undefined;
  const tc = truckMatchContext(loop, ctx);
  return tc ? collectorFilterProfile(tc) : undefined;
}

/** The sources a search would run, for a screen that wants to show them cold. */
export function knownSources(): SearchSourceRun[] {
  return SOURCES.map((s) => ({
    id: s.key,
    source: s.source,
    sourceName: s.sourceName,
    connection: s.connection,
    status: s.connection === "mock" ? "searched" : "not_connected",
    listingsReturned: 0,
    duplicatesFolded: 0,
  }));
}
