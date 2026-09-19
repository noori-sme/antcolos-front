import type {
  CarrierView, DraftStatus, Listing, OpportunityMatch, OutreachDraft,
} from "@/types";
import { carrierViewSync } from "./carrier-registry";
import { listingById } from "./listing-registry";
import { allMatches, rankMatches } from "./opportunity-matching";
import { truckContextFrom } from "./truck-registry";
import type { MtLoopContext } from "./mt-loop";
// The shared simulated round trip. A seeder can suppress it; a person never does.
import { sleep } from "./latency";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Drafting the first message to a broker — and only drafting it.
 *
 * NOTHING IS SENT FROM HERE. No mail is delivered, no address is contacted, and
 * "approved" means one thing only: a person has read it and said it may go.
 * Sending is milestone 5, and every screen that shows a draft says so.
 *
 * The grouping rule is the whole reason this is its own service rather than a
 * field on a match:
 *
 *   ONE draft per LISTING per CARRIER IDENTITY.
 *
 * A carrier with three trucks near one pickup has ONE conversation with that
 * broker. Three emails from three units of the same carrier is how a dispatch
 * agency gets its carrier blacklisted, and it is exactly what a naive
 * per-match draft would produce. So the draft covers every one of that
 * carrier's matched trucks and offers them together — which is also what a
 * dispatcher would actually write.
 *
 * Two DIFFERENT carriers matched to one listing do get two drafts, because they
 * are two businesses writing under their own authority. Merging those would put
 * one carrier's freight under another's name, which is worse than a duplicate.
 *
 * The identity is the carrier's own — its legal name and its recorded dispatch
 * address — never the dispatch agency's. A draft for a carrier with no address
 * on file is created anyway, BLOCKED, and says what is missing, because the
 * dispatcher needs to know the gap exists rather than wonder where the draft
 * went.
 */

const LATENCY_MS = 240;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const draftsByOrg = new Map<string, OutreachDraft[]>();

function bucket(organizationId: string): OutreachDraft[] {
  let rows = draftsByOrg.get(organizationId);
  if (!rows) {
    rows = [];
    draftsByOrg.set(organizationId, rows);
  }
  return rows;
}

/** Test hook. Never called by the UI. */
export function resetDrafts() {
  draftsByOrg.clear();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Composing                                                                   */
/* -------------------------------------------------------------------------- */

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

const money = (cents?: number) =>
  cents === undefined ? "your rate" : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * The message itself.
 *
 * Written as a dispatcher would write it: what we have, where it is, when it is
 * free, and one question. It names every unit being offered in one paragraph
 * rather than repeating the pitch per truck, and it never states a rate as
 * agreed — negotiation is milestone 6 and this message has not had one.
 */
function compose(
  listing: Listing,
  carrier: CarrierView,
  matches: OpportunityMatch[],
): { subject: string; body: string } {
  const lane = `${listing.origin.city}, ${listing.origin.state} → ${listing.destination.city}, ${listing.destination.state}`;
  const reference = listing.sourceReference ? ` (ref ${listing.sourceReference})` : "";
  const greeting = listing.broker.contactName ? `Hi ${listing.broker.contactName},` : "Hello,";

  const trucks = matches
    .slice()
    .sort((a, b) => a.deadheadMiles - b.deadheadMiles)
    .map((m) => {
      const distance = m.deadheadMiles > 0 ? `${m.deadheadMiles} miles out` : "right there";
      return `  • Unit ${m.truckUnit} — ${distance}`;
    });

  const only = matches.length === 1;
  const opening = only
    ? `we have a truck empty near ${listing.origin.city} and I would like to cover your ${lane} load${reference}.`
    : `we have ${matches.length} trucks empty near ${listing.origin.city} and I would like to cover your ${lane} load${reference}.`;

  const timing = `Picking up ${when(listing.pickupAt)}${listing.deliverBy ? `, delivering by ${when(listing.deliverBy)}` : ""}.`;

  const body = [
    greeting,
    "",
    `This is ${carrier.displayName}${carrier.mcNumber ? ` (${carrier.mcNumber})` : ""} — ${opening}`,
    "",
    timing,
    "",
    only ? "The truck:" : "The trucks:",
    ...trucks,
    "",
    listing.offeredRateCents !== undefined
      ? `You have it posted at ${money(listing.offeredRateCents)}. Is that still where it is, and is the load still available?`
      : "Is the load still available, and what are you paying on it?",
    "",
    "Happy to send over our packet and insurance whenever you need it.",
    "",
    "Thanks,",
    carrier.contacts.find((c) => c.isPrimary)?.name ?? carrier.displayName,
    carrier.displayName,
    carrier.contacts.find((c) => c.isPrimary)?.phone ?? "",
  ].filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");

  const subject = only
    ? `${carrier.displayName} — truck available for ${lane}`
    : `${carrier.displayName} — ${matches.length} trucks available for ${lane}`;

  return { subject, body };
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

/** The statuses a draft should exist for. Dismissed work gets no email. */
const DRAFTABLE = new Set<OpportunityMatch["status"]>(["eligible", "shortlisted"]);

/**
 * How many listings get a draft prepared, per truck.
 *
 * Drafts are prepared for the TOP opportunities, not for everything: a
 * dispatcher with forty prepared emails reads none of them, and the value of a
 * prepared draft is that it is worth reading.
 */
const DRAFT_TOP_N = 4;

/**
 * Bring the drafts in line with the matches.
 *
 * Runs on every read of the inbox. Three things happen, and the third is the
 * one that matters:
 *
 *   1. A listing in the top few for some truck, with no draft for that truck's
 *      carrier, gets one.
 *   2. A draft that already exists is re-grouped in place, so a second truck of
 *      the same carrier joins the SAME message rather than starting another.
 *   3. A draft whose listing has gone, or whose matches have all been dismissed,
 *      is superseded with a reason rather than silently deleted.
 *
 * A draft a person has already read is never rewritten under them. Re-grouping
 * an approved draft would change what they approved after they approved it.
 */
export function reconcileDrafts(ctx: MtLoopContext): number {
  const rows = bucket(ctx.organizationId);
  const truckCtx = truckContextFrom(ctx);
  const everything = allMatches(ctx);
  let created = 0;

  /* ---- Which (listing, carrier) pairs deserve a draft right now ---- */
  const wanted = new Map<string, OpportunityMatch[]>();

  // Top N per TRUCK, so every truck gets its best few considered rather than
  // one busy truck's loads crowding out a quieter truck's only option.
  const byTruck = new Map<string, typeof everything>();
  for (const row of everything) {
    if (!DRAFTABLE.has(row.match.status)) continue;
    if (row.listing.status !== "open") continue;
    byTruck.set(row.match.truckId, [...(byTruck.get(row.match.truckId) ?? []), row]);
  }

  for (const rowsForTruck of byTruck.values()) {
    for (const row of rankMatches(rowsForTruck).slice(0, DRAFT_TOP_N)) {
      wanted.set(`${row.match.listingId}::${row.match.carrierOrganizationId}`, []);
    }
  }

  // Having decided a message is worth writing, it offers EVERY truck of that
  // carrier that could take the load — not just the ones that happened to make
  // a top-N cut. If you are ringing the broker anyway, you offer what you have,
  // and the alternative is a second email later for the truck you left out.
  for (const [key] of wanted) {
    const [listingId, carrierOrganizationId] = key.split("::");
    wanted.set(
      key,
      everything
        .filter((r) => DRAFTABLE.has(r.match.status)
          && r.listing.status === "open"
          && r.match.listingId === listingId
          && r.match.carrierOrganizationId === carrierOrganizationId)
        .map((r) => r.match),
    );
  }

  /* ---- Create or re-group ---- */
  for (const [key, matches] of wanted) {
    const [listingId, carrierOrganizationId] = key.split("::");
    const listing = listingById(ctx.organizationId, listingId);
    if (!listing) continue;
    const carrier = carrierViewSync(carrierOrganizationId, truckCtx);
    if (!carrier) continue;

    const existing = rows.find(
      (d) => d.listingId === listingId
        && d.carrierOrganizationId === carrierOrganizationId
        && d.status !== "cancelled",
    );

    if (existing) {
      // Never rewrite what somebody has already read and approved.
      if (existing.status !== "ready") continue;
      const sameSet = existing.matchIds.length === matches.length
        && matches.every((m) => existing.matchIds.includes(m.matchId));
      if (sameSet) continue;
      applyGrouping(existing, listing, carrier, matches);
      continue;
    }

    const draft = create(ctx.organizationId, listing, carrier, matches);
    rows.push(draft);
    created += 1;
  }

  /* ---- Supersede the ones with nothing left to say ---- */
  for (const draft of rows) {
    if (draft.status === "cancelled" || draft.status === "superseded") continue;
    const key = `${draft.listingId}::${draft.carrierOrganizationId}`;
    if (wanted.has(key)) continue;

    const listing = listingById(ctx.organizationId, draft.listingId);
    draft.status = "superseded";
    draft.supersededReason = listing && listing.status !== "open"
      ? `The load is ${listing.status}. ${listing.closeReason ?? ""}`.trim()
      : "No truck is on this load any more.";
  }

  return created;
}

function create(
  organizationId: string,
  listing: Listing,
  carrier: CarrierView,
  matches: OpportunityMatch[],
): OutreachDraft {
  const draft: OutreachDraft = {
    draftId: rowId("draft"),
    listingId: listing.listingId,
    dispatchOrganizationId: organizationId,
    carrierOrganizationId: carrier.organizationId,
    carrierName: carrier.displayName,
    matchIds: [],
    dispatchCycleIds: [],
    truckUnits: [],
    fromName: carrier.displayName,
    fromEmail: undefined,
    toName: listing.broker.contactName,
    toEmail: listing.broker.email,
    subject: "",
    body: "",
    status: "ready",
    createdAt: nowIso(),
  };
  applyGrouping(draft, listing, carrier, matches);
  return draft;
}

/**
 * Point a draft at exactly this set of matches, and re-say what it says.
 *
 * Separated out because it is used twice — creating and re-grouping — and
 * getting the two out of step is how a draft ends up naming two trucks in its
 * body and covering three in its data.
 */
function applyGrouping(
  draft: OutreachDraft,
  listing: Listing,
  carrier: CarrierView,
  matches: OpportunityMatch[],
) {
  const ordered = [...matches].sort((a, b) => a.deadheadMiles - b.deadheadMiles);
  draft.matchIds = ordered.map((m) => m.matchId);
  draft.dispatchCycleIds = [...new Set(ordered.map((m) => m.dispatchCycleId))];
  draft.truckUnits = ordered.map((m) => m.truckUnit);

  // The identity is the CARRIER's, always. A dispatch agency writing to a
  // broker about a carrier's truck writes as that carrier, under that carrier's
  // authority — never as itself, and never from its own address.
  const from = carrier.contacts.find((c) => c.isPrimary && c.email)
    ?? carrier.contacts.find((c) => c.email);
  draft.fromName = carrier.displayName;
  draft.fromEmail = from?.email;

  draft.toName = listing.broker.contactName;
  draft.toEmail = listing.broker.email;

  const composed = compose(listing, carrier, ordered);
  draft.subject = composed.subject;
  draft.body = composed.body;

  draft.blockedReason = blockedReason(draft, carrier);
}

/** Why this draft could not go out, even once somebody approves it. */
function blockedReason(draft: OutreachDraft, carrier: CarrierView): string | undefined {
  if (!draft.fromEmail) {
    return `${carrier.displayName} has no email address recorded, so there is nothing to send this from.`;
  }
  if (!draft.toEmail) {
    return "The broker's email address is not recorded on this listing. A phone call is the only way in.";
  }
  if (!carrier.canHaul) {
    return `${carrier.displayName} cannot legally haul right now, so nothing should be offered to a broker under their name.`;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

function mayRead(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

export function draftsFor(ctx: MtLoopContext): OutreachDraft[] {
  if (!mayRead(ctx)) return [];
  const order: Record<DraftStatus, number> = {
    ready: 0, approved: 1, superseded: 2, cancelled: 3,
  };
  return [...bucket(ctx.organizationId)].sort(
    (a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt),
  );
}

/** The drafts that cover one cycle, for that truck's own page. */
export function draftsForCycle(dispatchCycleId: string, ctx: MtLoopContext): OutreachDraft[] {
  return draftsFor(ctx).filter((d) => d.dispatchCycleIds.includes(dispatchCycleId));
}

export function draftById(draftId: string, ctx: MtLoopContext): OutreachDraft | undefined {
  if (!mayRead(ctx)) return undefined;
  return bucket(ctx.organizationId).find((d) => d.draftId === draftId);
}

/** Which draft, if any, covers a given match. */
export function draftIdForMatch(matchId: string, ctx: MtLoopContext): string | undefined {
  return bucket(ctx.organizationId).find(
    (d) => d.matchIds.includes(matchId) && d.status !== "cancelled" && d.status !== "superseded",
  )?.draftId;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export type DraftOutcome =
  | { status: "ok"; draft: OutreachDraft }
  | { status: "not_found" }
  | { status: "not_permitted" }
  | { status: "blocked"; reason: string };

/**
 * A person has read it and says it may go.
 *
 * This does NOT send it. It cannot: there is no mail transport in this
 * milestone and the draft says so. What approval does is record that a human
 * read the thing before it went anywhere — which is the guarantee the whole
 * feature is built to keep.
 */
export async function approveDraft(draftId: string, ctx: MtLoopContext): Promise<DraftOutcome> {
  await sleep(LATENCY_MS);
  if (!mayRead(ctx)) return { status: "not_permitted" };
  const draft = draftById(draftId, ctx);
  if (!draft) return { status: "not_found" };
  if (draft.status !== "ready") return { status: "not_permitted" };
  if (draft.blockedReason) return { status: "blocked", reason: draft.blockedReason };

  draft.status = "approved";
  draft.reviewedAt = nowIso();
  draft.reviewedByName = ctx.actor.displayNameSnapshot;
  return { status: "ok", draft };
}

export async function cancelDraft(draftId: string, ctx: MtLoopContext): Promise<DraftOutcome> {
  await sleep(LATENCY_MS);
  if (!mayRead(ctx)) return { status: "not_permitted" };
  const draft = draftById(draftId, ctx);
  if (!draft) return { status: "not_found" };
  if (draft.status === "superseded") return { status: "not_permitted" };

  draft.status = "cancelled";
  draft.reviewedAt = nowIso();
  draft.reviewedByName = ctx.actor.displayNameSnapshot;
  return { status: "ok", draft };
}

/** Edit the message before approving it. Only while nobody has approved it. */
export async function editDraft(
  draftId: string,
  changes: { subject?: string; body?: string },
  ctx: MtLoopContext,
): Promise<DraftOutcome> {
  await sleep(LATENCY_MS);
  if (!mayRead(ctx)) return { status: "not_permitted" };
  const draft = draftById(draftId, ctx);
  if (!draft) return { status: "not_found" };
  if (draft.status !== "ready") return { status: "not_permitted" };

  if (changes.subject !== undefined) draft.subject = changes.subject;
  if (changes.body !== undefined) draft.body = changes.body;
  return { status: "ok", draft };
}

/**
 * Stand every draft about one listing down.
 *
 * Called when the listing is taken — by us or by anybody. A draft about a load
 * that is gone is worse than no draft: somebody eventually reads it, approves
 * it, and in milestone 5 it goes out.
 */
export function supersedeDraftsForListing(
  organizationId: string,
  listingId: string,
  reason: string,
): string[] {
  const out: string[] = [];
  for (const draft of bucket(organizationId)) {
    if (draft.listingId !== listingId) continue;
    if (draft.status === "cancelled" || draft.status === "superseded") continue;
    draft.status = "superseded";
    draft.supersededReason = reason;
    out.push(draft.draftId);
  }
  return out;
}
