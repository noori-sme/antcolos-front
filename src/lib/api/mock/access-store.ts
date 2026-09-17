import type { AcceptanceRun, Invitation, User } from "@/types";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";

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

/**
 * Seeded on first read rather than on import, so a reset genuinely resets.
 *
 * `recipientHasAccount` and `recipientUserId` are DERIVED here rather than
 * typed in the fixtures, so a seed cannot claim an account that does not exist.
 * That is the same rule issuing follows, applied to the fixtures so they cannot
 * drift away from it.
 */
export function ensureSeeded(seed: () => Invitation[]) {
  if (state.seeded) return;
  state.seeded = true;
  state.invitations = seed().map((invitation) => {
    const account = accountForEmail(invitation.recipientEmail);
    return {
      ...invitation,
      recipientHasAccount: account !== undefined,
      recipientUserId: account?.id,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* The account directory                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Who has an Antcolos account, for the one question an invitation asks:
 * "does this address already belong to somebody?"
 *
 * ★ THIS IS A LOOKUP, NEVER A SEARCH ★
 * It answers only for an address somebody already typed as a recipient, and it
 * returns nothing the sender did not already know — a carrier inviting
 * `sam@antcolos.com` learns that the invitation will not need a sign-up step,
 * not that Sam exists. There is deliberately no "find people" function: a
 * carrier that could enumerate accounts could ask Antcolos who its
 * competitor's drivers are.
 */
const ACCOUNTS: readonly User[] = [MOCK_USER, NEWCOMER_USER];

/** The account behind a seat, for showing a person's name on a roster. */
export function accountById(userId: string): User | undefined {
  return ACCOUNTS.find((u) => u.id === userId);
}

export function accountForEmail(email: string): User | undefined {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return ACCOUNTS.find((u) => u.email.toLowerCase() === normalized);
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
 * Runs `write` at most once per `(invitationId, userId)` — and latches it only
 * when `write` returns.
 *
 * Two rules at once, and the order is the whole point:
 *
 *   NO DUPLICATE. Three tabs finishing the same acceptance all complete the
 *   same run, correctly, because every step resumes. But "Alex accepted their
 *   invitation" happened once and the ledger must say so once.
 *
 *   NO LOSS. The earlier version CLAIMED first and wrote second. A write that
 *   threw left the claim spent and the line unwritten, and since a completed
 *   run reads as `used` rather than `resume`, nothing could ever write it. That
 *   is a completed acceptance with no evidence it happened — the exact thing an
 *   access ledger exists to make impossible.
 *
 * Synchronous on purpose: the check, the write and the latch are one block with
 * no `await` between them, so two callers in one tab cannot both win and a
 * thrown write cannot be observed half-done. Two BROWSERS still can, which is
 * the backend's unique constraint to hold, not this module's to pretend about.
 *
 * A throw propagates. The caller must not mark the run complete.
 */
export function withJoinedAudit(
  invitationId: string, userId: string, write: () => void,
): void {
  const key = runKey(invitationId, userId);
  if (state.audited.has(key)) return;
  write();
  state.audited.add(key);
}

/** Test hook: has the one joined line been written for this acceptance? */
export function joinedAuditWritten(invitationId: string, userId: string): boolean {
  return state.audited.has(runKey(invitationId, userId));
}

/** Runs that started and did not finish. What Needs You is derived from. */
export function incompleteRuns(): AcceptanceRun[] {
  return Object.values(state.runs)
    .filter((r) => !r.completedAt)
    .map((r) => ({ ...r, steps: r.steps.map((s) => ({ ...s })) }));
}
