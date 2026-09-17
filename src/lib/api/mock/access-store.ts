import type { AcceptanceRun, Invitation } from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The access store: invitations, and each person's attempt to accept one.
 *
 * A LEAF, like the document store, the workforce store and the setup store. It
 * imports no registry, so every registry can read it without a cycle, and it
 * enforces nothing — permissions and organization scope live one layer up where
 * the caller's context exists.
 *
 * ★ WHAT IS NOT IN HERE ★
 * No person, no relationship, no membership and no document. An invitation is
 * an offer; an `AcceptanceRun` is a record of which canonical calls have been
 * made and which have not. Deleting this store would lose the offers and the
 * progress of an unfinished acceptance, and not one canonical fact — which is
 * the property that keeps it from becoming a second registry.
 *
 * ★ THE STATUS IS A PROJECTION ★
 * `Invitation.status` is stored for `pending`, `revoked` and `expired`, which
 * are the sender's business. `accepted` is not stored: it is computed from a
 * COMPLETED run. That inversion is the whole reason a half-finished acceptance
 * cannot lock somebody out of their own retry — the old design wrote the status
 * first, and an invitation that already read "accepted" answered a returning
 * person with "somebody has already accepted this".
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab. A backend owes this seam persistence and
 * a unique constraint on `(invitationId, userId)` for runs.
 */

interface StoreState {
  invitations: Invitation[];
  /** Keyed `${invitationId}:${userId}`. One run per person per invitation. */
  runs: Record<string, AcceptanceRun>;
  /** Acceptances whose "joined" audit line has already been written. */
  audited: Set<string>;
  seeded: boolean;
}

function emptyState(): StoreState {
  return { invitations: [], runs: {}, audited: new Set(), seeded: false };
}

let state: StoreState = emptyState();
let seq = 0;

/** Test hook. Never called by the UI. */
export function resetAccessStore() {
  state = emptyState();
  seq = 0;
}

export function nextInvitationId(): string {
  return `inv_${(seq += 1).toString(36)}${Date.now().toString(36)}`;
}

export function nextInvitationToken(): string {
  return `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/** Seeded on first read rather than on import, so a reset genuinely resets. */
export function ensureSeeded(seed: () => Invitation[]) {
  if (state.seeded) return;
  state.seeded = true;
  state.invitations = seed();
}

/* -------------------------------------------------------------------------- */
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

export function invitationsForOrganization(organizationId: string): Invitation[] {
  return state.invitations
    .filter((i) => i.organizationId === organizationId)
    .map((i) => ({ ...i }));
}

export function invitationById(id: string): Invitation | undefined {
  const found = state.invitations.find((i) => i.id === id);
  return found ? { ...found } : undefined;
}

export function invitationByToken(token: string): Invitation | undefined {
  const wanted = token.trim().toUpperCase();
  const found = state.invitations.find((i) => i.token.toUpperCase() === wanted);
  return found ? { ...found } : undefined;
}

export function putInvitation(invitation: Invitation): Invitation {
  const i = state.invitations.findIndex((x) => x.id === invitation.id);
  state.invitations = i >= 0
    ? state.invitations.map((x) => (x.id === invitation.id ? invitation : x))
    : [invitation, ...state.invitations];
  return { ...invitation };
}

/**
 * A live invitation already addressed to this mailbox from this organization.
 *
 * The frontend stand-in for a unique constraint on
 * `(organizationId, recipientEmail)` where the invitation is still open. Two
 * invitations to the same person is not a second offer — it is two links that
 * both work, and whichever is accepted second produces the duplicate
 * relationship this module exists to prevent.
 */
export function openInvitationFor(
  organizationId: string, recipientEmail: string,
): Invitation | undefined {
  const wanted = recipientEmail.trim().toLowerCase();
  const found = state.invitations.find(
    (i) => i.organizationId === organizationId
      && i.recipientEmail.toLowerCase() === wanted
      && i.status === "pending",
  );
  return found ? { ...found } : undefined;
}

/* -------------------------------------------------------------------------- */
/* Acceptance runs                                                             */
/* -------------------------------------------------------------------------- */

const runKey = (invitationId: string, userId: string) => `${invitationId}:${userId}`;

export function runFor(invitationId: string, userId: string): AcceptanceRun | undefined {
  const found = state.runs[runKey(invitationId, userId)];
  return found ? { ...found, steps: found.steps.map((s) => ({ ...s })) } : undefined;
}

/** Every run against one invitation, whoever it belongs to. */
export function runsForInvitation(invitationId: string): AcceptanceRun[] {
  return Object.values(state.runs)
    .filter((r) => r.invitationId === invitationId)
    .map((r) => ({ ...r, steps: r.steps.map((s) => ({ ...s })) }));
}

export function putRun(run: AcceptanceRun): AcceptanceRun {
  state.runs[runKey(run.invitationId, run.userId)] = run;
  return { ...run, steps: run.steps.map((s) => ({ ...s })) };
}

/**
 * Claims the right to write the one "joined" audit line for this acceptance.
 *
 * Returns true exactly once per `(invitationId, userId)`, and false to every
 * caller after. Three tabs finishing the same acceptance together all complete
 * the same run — correctly, because every step resumes — but "Alex accepted
 * their invitation" happened once and the ledger must say so once.
 *
 * Synchronous on purpose: the check and the set are one block with no `await`
 * between them, so two callers in one tab cannot both win. Two BROWSERS still
 * can, which is the backend's unique constraint to hold, not this module's to
 * pretend about.
 */
export function claimJoinedAudit(invitationId: string, userId: string): boolean {
  const key = runKey(invitationId, userId);
  if (state.audited.has(key)) return false;
  state.audited.add(key);
  return true;
}

/** Runs that started and did not finish. What Needs You is derived from. */
export function incompleteRuns(): AcceptanceRun[] {
  return Object.values(state.runs)
    .filter((r) => !r.completedAt)
    .map((r) => ({ ...r, steps: r.steps.map((s) => ({ ...s })) }));
}
