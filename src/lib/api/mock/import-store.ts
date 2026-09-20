import type {
  ClaimResolution, ImportBatch, ImportClaim, ImportRun,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The import store: what a carrier told us, what we concluded, and how far a
 * commit got.
 *
 * A LEAF, like the document store, the workforce store and the access store. It
 * imports no registry, so every registry can read it without a cycle, and it
 * enforces nothing — permissions and organization scope live one layer up where
 * the caller's context exists.
 *
 * ★ WHAT IS NOT IN HERE ★
 * No person, no truck, no relationship, no membership and no document. Deleting
 * this store would lose the paperwork of an import in progress and not one
 * canonical fact — which is the property that keeps an import candidate from
 * quietly becoming a second registry of people and equipment.
 *
 * ★ THREE TABLES, THREE LIFETIMES ★
 * Claims are written once and never rewritten: they are evidence. Resolutions
 * are replaced wholesale on every plan, because the registries move underneath
 * them. Runs accumulate results. Keeping them apart is what lets a re-plan
 * happen without touching what the carrier actually said.
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab. A backend owes this seam persistence and a
 * unique constraint on `(organizationId, contentKey)` for claims.
 */

interface StoreState {
  batches: ImportBatch[];
  claims: ImportClaim[];
  /** Keyed by claim id. One current resolution per claim. */
  resolutions: Record<string, ClaimResolution>;
  runs: ImportRun[];
}

function emptyState(): StoreState {
  return { batches: [], claims: [], resolutions: {}, runs: [] };
}

let state: StoreState = emptyState();
let seq = 0;

/** Test hook. Never called by the UI. */
export function resetImportStore() {
  state = emptyState();
  seq = 0;
}

export function nextImportId(prefix: string): string {
  return `${prefix}_${(seq += 1).toString(36)}${Date.now().toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Batches                                                                     */
/* -------------------------------------------------------------------------- */

export function batchesForOrganization(organizationId: string): ImportBatch[] {
  return state.batches.filter((b) => b.organizationId === organizationId).map((b) => ({ ...b }));
}

export function batchById(id: string): ImportBatch | undefined {
  const found = state.batches.find((b) => b.id === id);
  return found ? { ...found } : undefined;
}

/**
 * The same file uploaded twice is the same batch.
 *
 * The frontend stand-in for a unique constraint on
 * `(organizationId, contentKey)`. Without it, a nervous second upload produces
 * a second batch of the same fifty people — and each one matches the records
 * the first one created, so the duplicates are invisible until somebody counts.
 */
export function batchByContentKey(
  organizationId: string, contentKey: string,
): ImportBatch | undefined {
  const found = state.batches.find(
    (b) => b.organizationId === organizationId && b.contentKey === contentKey,
  );
  return found ? { ...found } : undefined;
}

export function putBatch(batch: ImportBatch): ImportBatch {
  const i = state.batches.findIndex((b) => b.id === batch.id);
  state.batches = i >= 0
    ? state.batches.map((b) => (b.id === batch.id ? batch : b))
    : [batch, ...state.batches];
  return { ...batch };
}

/* -------------------------------------------------------------------------- */
/* Claims — written once                                                       */
/* -------------------------------------------------------------------------- */

export function claimsForBatch(batchId: string): ImportClaim[] {
  return state.claims
    .filter((c) => c.batchId === batchId)
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((c) => ({ ...c }));
}

export function claimById(id: string): ImportClaim | undefined {
  const found = state.claims.find((c) => c.id === id);
  return found ? { ...found } : undefined;
}

export function claimByContentKey(
  organizationId: string, contentKey: string,
): ImportClaim | undefined {
  const found = state.claims.find(
    (c) => c.organizationId === organizationId && c.contentKey === contentKey,
  );
  return found ? { ...found } : undefined;
}

/**
 * Adds a claim, or returns the one that already says the same thing.
 *
 * A claim is EVIDENCE, so it is never updated: re-importing a row that already
 * exists returns the original rather than writing a second one with a newer
 * `receivedAt`. Correcting what a carrier asserted is a correction ON the
 * assertion, which keeps the original readable — not a quiet overwrite.
 */
export function addClaim(claim: ImportClaim): ImportClaim {
  const existing = claimByContentKey(claim.organizationId, claim.contentKey);
  if (existing) return existing;
  state.claims = [...state.claims, claim];
  return { ...claim };
}

/* -------------------------------------------------------------------------- */
/* Resolutions — replaced on every plan                                        */
/* -------------------------------------------------------------------------- */

export function resolutionFor(claimId: string): ClaimResolution | undefined {
  const found = state.resolutions[claimId];
  return found ? { ...found, candidates: found.candidates.map((c) => ({ ...c })) } : undefined;
}

/**
 * Replaces a claim's resolution, KEEPING any decision a person already made.
 *
 * Re-planning must not throw away a human answer. Somebody who resolved an
 * ambiguous row on Tuesday should not be asked again on Wednesday because the
 * registry gained an unrelated record and the ranking shifted.
 */
export function putResolution(resolution: ClaimResolution): ClaimResolution {
  const previous = state.resolutions[resolution.claimId];
  const merged: ClaimResolution = {
    ...resolution,
    decision: resolution.decision ?? previous?.decision,
  };
  state.resolutions[resolution.claimId] = merged;
  return { ...merged, candidates: merged.candidates.map((c) => ({ ...c })) };
}

export function resolutionsForBatch(batchId: string): ClaimResolution[] {
  return claimsForBatch(batchId)
    .map((c) => resolutionFor(c.id))
    .filter((r): r is ClaimResolution => Boolean(r));
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                        */
/* -------------------------------------------------------------------------- */

export function runForBatch(batchId: string): ImportRun | undefined {
  const found = state.runs.find((r) => r.batchId === batchId);
  return found ? { ...found, results: found.results.map((x) => ({ ...x })) } : undefined;
}

export function putRun(run: ImportRun): ImportRun {
  const i = state.runs.findIndex((r) => r.id === run.id);
  state.runs = i >= 0 ? state.runs.map((r) => (r.id === run.id ? run : r)) : [run, ...state.runs];
  return { ...run, results: run.results.map((x) => ({ ...x })) };
}

/** Claims still waiting on a person. What Needs You is derived from. */
export function undecidedClaims(): Array<{ claim: ImportClaim; resolution: ClaimResolution }> {
  const out: Array<{ claim: ImportClaim; resolution: ClaimResolution }> = [];
  for (const claim of state.claims) {
    const resolution = state.resolutions[claim.id];
    if (!resolution) continue;
    if (resolution.outcome !== "needs_decision" || resolution.decision) continue;
    out.push({ claim: { ...claim }, resolution: { ...resolution } });
  }
  return out;
}
