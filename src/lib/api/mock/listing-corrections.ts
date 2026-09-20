import type {
  Listing, LoadFactCorrection, LoadFactCorrectionSource, LoadFactKey,
} from "@/types";
import type { MtLoopContext } from "./mt-loop";
import { sleep } from "./latency";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * What a broker told us on the phone that the load board got wrong.
 *
 * ★ WHY THIS IS NOT AN EDIT ★
 * The obvious implementation is to write 30,000 over the 40,000 on the listing
 * and move on. That destroys the two things anybody will want later: what the
 * board actually published, and who said otherwise. A listing is a record of a
 * source's posting; a dispatcher on a call with a broker is a different source
 * entirely, and conflating them is how a load ends up with a weight nobody can
 * account for.
 *
 * So a correction is its own row, holding both values and the person who heard
 * the second one — and `effectiveListing` is the only thing any screen or
 * service downstream is allowed to read. That is what makes the correction a
 * single source of truth rather than a note somebody made.
 */

const LATENCY_MS = 140;

/** Per organization. Corrections do not cross workspaces, like listings. */
const byOrg = new Map<string, LoadFactCorrection[]>();
let seq = 0;

function bucket(organizationId: string): LoadFactCorrection[] {
  let rows = byOrg.get(organizationId);
  if (!rows) { rows = []; byOrg.set(organizationId, rows); }
  return rows;
}

export function resetListingCorrections() {
  byOrg.clear();
  seq = 0;
}

function mayRead(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

/**
 * Who may correct a load fact.
 *
 * The same permission as booking one, on purpose: a correction becomes what the
 * driver is told and what the rate confirmation is checked against, so it is a
 * dispatch decision and not a piece of note-taking.
 */
function mayWrite(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:create") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Every correction on this listing for this cycle, newest first, history included. */
export function correctionHistory(
  listingId: string,
  dispatchCycleId: string,
  ctx: MtLoopContext,
): LoadFactCorrection[] {
  if (!mayRead(ctx)) return [];
  return bucket(ctx.organizationId)
    .filter((c) => c.listingId === listingId && c.dispatchCycleId === dispatchCycleId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** The corrections in force: one per fact, the newest that has not been replaced. */
export function correctionsInForce(
  listingId: string,
  dispatchCycleId: string,
  ctx: MtLoopContext,
): Partial<Record<LoadFactKey, LoadFactCorrection>> {
  const out: Partial<Record<LoadFactKey, LoadFactCorrection>> = {};
  for (const c of correctionHistory(listingId, dispatchCycleId, ctx)) {
    if (c.supersededByCorrectionId) continue;
    out[c.key] ??= c;
  }
  return out;
}

/**
 * The listing as it actually is, once the broker has corrected it.
 *
 * ★ EVERYTHING DOWNSTREAM READS THIS, AND NOTHING READS THE RAW LISTING ★
 * The driver is told this. The rate confirmation is checked against this. A
 * screen that reached past it for `listing.weightLbs` would quietly send a
 * driver to a dock for a weight a broker already told us was wrong.
 *
 * The returned object is a COPY. The stored listing is untouched, and
 * `correctedKeys` says which values are not the board's, so a screen can show
 * both rather than silently presenting ours as theirs.
 */
export function effectiveListing(
  listing: Listing,
  dispatchCycleId: string | undefined,
  ctx: MtLoopContext,
): { listing: Listing; correctedKeys: LoadFactKey[] } {
  if (!dispatchCycleId) return { listing, correctedKeys: [] };
  const inForce = correctionsInForce(listing.listingId, dispatchCycleId, ctx);
  const keys = Object.keys(inForce) as LoadFactKey[];
  if (keys.length === 0) return { listing, correctedKeys: [] };

  const next: Listing = {
    ...listing,
    origin: { ...listing.origin },
    destination: { ...listing.destination },
    broker: { ...listing.broker },
  };

  for (const key of keys) {
    const c = inForce[key];
    if (!c) continue;
    switch (key) {
      case "weight_lbs":
        if (c.numericValue !== undefined) next.weightLbs = c.numericValue;
        break;
      case "commodity":
        next.commodity = c.correctedValue;
        break;
      case "pickup_at":
        next.pickupAt = c.correctedValue;
        break;
      case "deliver_by":
        next.deliverBy = c.correctedValue;
        break;
      case "loaded_miles":
        if (c.numericValue !== undefined) next.loadedMiles = c.numericValue;
        break;
      case "rate_cents":
        if (c.numericValue !== undefined) next.offeredRateCents = c.numericValue;
        break;
    }
  }
  return { listing: next, correctedKeys: keys };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface RecordCorrectionInput {
  listingId: string;
  dispatchCycleId: string;
  key: LoadFactKey;
  /** What the board said. Passed in, because only the caller has the listing. */
  listingValue?: string;
  correctedValue: string;
  numericValue?: number;
  source: LoadFactCorrectionSource;
  note?: string;
}

export type CorrectionOutcome =
  | { status: "ok"; correction: LoadFactCorrection }
  | { status: "not_permitted" }
  | { status: "needs_reason" };

export async function recordCorrection(
  input: RecordCorrectionInput,
  ctx: MtLoopContext,
): Promise<CorrectionOutcome> {
  await sleep(LATENCY_MS);
  return recordCorrectionSync(input, ctx);
}

export function recordCorrectionSync(
  input: RecordCorrectionInput,
  ctx: MtLoopContext,
): CorrectionOutcome {
  if (!mayWrite(ctx)) return { status: "not_permitted" };
  if (!input.correctedValue.trim()) return { status: "needs_reason" };

  const rows = bucket(ctx.organizationId);
  const correction: LoadFactCorrection = {
    correctionId: `cor_${(++seq).toString(36)}${Date.now().toString(36)}`,
    organizationId: ctx.organizationId,
    dispatchCycleId: input.dispatchCycleId,
    listingId: input.listingId,
    key: input.key,
    listingValue: input.listingValue,
    correctedValue: input.correctedValue.trim(),
    numericValue: input.numericValue,
    source: input.source,
    byName: ctx.actor.displayNameSnapshot,
    byMembershipId: ctx.membershipId,
    at: new Date().toISOString(),
    note: input.note?.trim() || undefined,
  };

  /*
   * ★ SUPERSEDED, NOT REPLACED ★
   * A broker who says 30,000 and then 34,000 has told us two things, and both
   * are part of the story of what happened on this load. The older row stays
   * and points at the one that took over.
   */
  for (const row of rows) {
    if (row.listingId !== correction.listingId) continue;
    if (row.dispatchCycleId !== correction.dispatchCycleId) continue;
    if (row.key !== correction.key) continue;
    if (row.supersededByCorrectionId) continue;
    row.supersededByCorrectionId = correction.correctionId;
  }

  rows.push(correction);
  return { status: "ok", correction };
}
