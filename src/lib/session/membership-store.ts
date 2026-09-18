"use client";

import type { Membership, Organization } from "@/types";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS,
  NEWCOMER_MEMBERSHIPS, NEWCOMER_ORGANIZATIONS,
} from "./fixtures";
import type { SessionScenario } from "./scenarios";

/**
 * The seats this person holds, as something that can CHANGE while the tab is open.
 *
 * Until now the session read its memberships straight off a frozen fixture
 * array, with a comment saying "the fixture set never changes within a tab, so
 * there is nothing to notify". That was true right up until something could
 * grant a seat — and then it was the difference between a `Membership` record
 * existing and a person being able to use their portal. A driver who accepts a
 * carrier's invitation and is told to reload has not been let in.
 *
 * So this is the same shape `active-membership-store.ts` already uses for the
 * active membership id: an external store, read through `useSyncExternalStore`,
 * with a server snapshot that is stable and a client snapshot whose identity
 * changes only when the roster actually changes.
 *
 * ███ WHAT THIS IS NOT ███
 *
 * It is NOT a permission system. Nothing here reads, computes, widens or
 * clamps a `PermissionKey`. A membership carries applied templates — each one a
 * SNAPSHOT of what a template held when somebody applied it — plus grants and
 * revocations, exactly as a fixture one does, and `effectivePermissions` turns
 * those into permissions. A seat written here is subject to precisely the rules
 * a seeded seat is subject to, because it goes through precisely the same
 * function.
 *
 * It is NOT an authorization boundary either. `grantMembership` and
 * `updateMembershipAccess` are primitives: they write and notify. WHO may ask,
 * on what basis, and whether what they wrote is inside their own access is the
 * Access service's — see `src/lib/api/mock/access-templates.ts`, which does
 * every one of those checks and clamps the selection before calling in here.
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab, and reset by a reload. There is no
 * persistence, no server-side authorization, and no uniqueness constraint that
 * would survive two tabs racing: `grantMembership` checks for a live seat and
 * then writes, with the check and the write in one synchronous block, which
 * makes it safe against re-entry in ONE tab and proves nothing about two. The
 * backend owes this seam a durable unique index on (userId, organizationId)
 * where the seat is live.
 */

export interface SessionRoster {
  memberships: readonly Membership[];
  organizations: readonly Organization[];
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One roster per scenario, because the demo account and a newcomer are two
 * different people and a tab is only ever one of them.
 *
 * Snapshots are CACHED rather than rebuilt per call. `useSyncExternalStore`
 * re-reads the snapshot on every render and compares by identity, so a getter
 * that returned a fresh array each time would re-render forever.
 */
type Snapshots = Record<SessionScenario, SessionRoster>;

function seedFor(scenario: SessionScenario): SessionRoster {
  return scenario === "newcomer"
    ? { memberships: NEWCOMER_MEMBERSHIPS, organizations: NEWCOMER_ORGANIZATIONS }
    : { memberships: MOCK_MEMBERSHIPS, organizations: MOCK_ORGANIZATIONS };
}

function freshSnapshots(): Snapshots {
  return { demo: seedFor("demo"), newcomer: seedFor("newcomer") };
}

let snapshots: Snapshots = freshSnapshots();

/**
 * The SERVER snapshot, which must be stable for the life of the module.
 *
 * React calls it during server rendering and again during hydration, and throws
 * if the two are not identical. It is the seeded roster and never the granted
 * one: the server has no tab, so it cannot know about a seat granted in one.
 */
const serverSnapshots: Snapshots = freshSnapshots();

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Announce that the roster changed, from a store that is not this one.
 *
 * ★ WHY THIS IS EXPORTED ★
 * "Who is in this organization" is answered by two stores — this one holds the
 * seats this tab has, the mock membership directory holds the colleagues — but
 * there is only one QUESTION, so there is only one subscription. Without this,
 * a write to the directory changed the roster and notified nobody, and the
 * People screen sat there showing the answer from before it.
 *
 * It notifies. It does not write, and it has no opinion about what changed.
 */
export function notifyRosterChanged(): void {
  notify();
}

export function subscribeRoster(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function rosterSnapshot(scenario: SessionScenario): SessionRoster {
  return snapshots[scenario];
}

/** Stable across every call. See the note on `serverSnapshots`. */
export function rosterServerSnapshot(scenario: SessionScenario): SessionRoster {
  return serverSnapshots[scenario];
}

/** The live seat this person holds in an organization, if they hold one. */
export function liveMembershipFor(
  scenario: SessionScenario,
  userId: string,
  organizationId: string,
): Membership | undefined {
  return snapshots[scenario].memberships.find(
    (m) => m.userId === userId
      && m.organizationId === organizationId
      && m.status !== "left",
  );
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface GrantMembershipInput {
  scenario: SessionScenario;
  membership: Membership;
  /**
   * The organization the seat is in, when the roster does not already carry it.
   *
   * Required rather than looked up, because a seat in an organization the
   * session cannot resolve renders as a workspace with no name — and every
   * screen that switches organizations reads this list.
   */
  organization?: Organization;
}

export type GrantMembershipResult =
  | { status: "granted"; membership: Membership }
  /** A live seat already existed. Nothing was written. */
  | { status: "already_held"; membership: Membership };

/**
 * Adds a seat, or reports the one that is already there.
 *
 * IDEMPOTENT on `(userId, organizationId)` where the seat is live. A retry, a
 * double submit, or a second attempt after something later in a sequence failed
 * all produce ONE seat — which is the property a caller retrying a partly
 * finished grant depends on, and the reason the check and the write are in one
 * synchronous block with no `await` between them.
 *
 * It grants no permission of its own. What the seat can do is whatever
 * `effectivePermissions` makes of the templates, grants and revocations the
 * caller put on the membership, clamped by the rules that already exist.
 */
export function grantMembership(input: GrantMembershipInput): GrantMembershipResult {
  const { scenario, membership, organization } = input;
  const existing = liveMembershipFor(scenario, membership.userId, membership.organizationId);
  if (existing) return { status: "already_held", membership: existing };

  const current = snapshots[scenario];
  const organizations = organization
    && !current.organizations.some((o) => o.id === organization.id)
    ? [...current.organizations, organization]
    : current.organizations;

  snapshots = {
    ...snapshots,
    [scenario]: {
      memberships: [...current.memberships, membership],
      organizations,
    },
  };
  notify();
  return { status: "granted", membership };
}

/**
 * Changes a seat's status, the way access ending or being suspended would.
 *
 * No product code calls this. It exists because "a seat ends while somebody is
 * working in it" is the case that decides whether the session keeps handing out
 * permissions for a workspace the person no longer belongs to, and that case
 * has to be reachable before it can be tested. The real command — who may end
 * a seat, and what else ends with it — is the Access service's, and PR-2's.
 */
export function setMembershipStatus(
  scenario: SessionScenario,
  membershipId: string,
  status: Membership["status"],
): void {
  const current = snapshots[scenario];
  if (!current.memberships.some((m) => m.id === membershipId)) return;
  snapshots = {
    ...snapshots,
    [scenario]: {
      ...current,
      memberships: current.memberships.map((m) =>
        m.id === membershipId ? { ...m, status } : m),
    },
  };
  notify();
}

/**
 * Changes what a seat carries: its applied templates, and its person-specific
 * grants and revocations.
 *
 * ★ DELIBERATELY NARROW ★
 * Exactly three fields, and no others. A general `updateMembership` would let a
 * caller flip `isOwner`, move a seat to another organization, or resurrect a
 * status — three different ways to produce access nobody granted, from a
 * primitive whose whole job is to write what somebody already decided.
 *
 * It grants no permission of its own and checks no authority. WHO may change a
 * seat, and whether what they wrote is within their own access, is the Access
 * service's — see `src/lib/api/mock/access-templates.ts`, which clamps before
 * it ever reaches here.
 */
export interface MembershipAccessPatch {
  appliedTemplates?: Membership["appliedTemplates"];
  grants?: Membership["grants"];
  revocations?: Membership["revocations"];
}

export function updateMembershipAccess(
  scenario: SessionScenario,
  membershipId: string,
  patch: MembershipAccessPatch,
): Membership | undefined {
  const current = snapshots[scenario];
  const seat = current.memberships.find((m) => m.id === membershipId);
  if (!seat) return undefined;

  const next: Membership = {
    ...seat,
    appliedTemplates: patch.appliedTemplates
      ? patch.appliedTemplates.map((a) => ({ ...a, permissions: [...a.permissions] }))
      : seat.appliedTemplates,
    grants: patch.grants ? [...patch.grants] : seat.grants,
    revocations: patch.revocations ? [...patch.revocations] : seat.revocations,
  };

  snapshots = {
    ...snapshots,
    [scenario]: {
      ...current,
      memberships: current.memberships.map((m) => (m.id === membershipId ? next : m)),
    },
  };
  notify();
  return next;
}

/** Test hook. Never called by the UI. */
export function resetRoster() {
  snapshots = freshSnapshots();
  notify();
}
