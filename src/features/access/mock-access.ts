"use client";

import type { CustomRole, Invitation, PermissionKey } from "@/types";
import {
  invitationsForOrganization, patchInvitation, resetAccessStore,
} from "@/lib/api/mock/access-store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * CUSTOM ROLES live here in memory for the browser session. Nothing is stored,
 * authorized or enforced.
 *
 * ★ INVITATIONS NO LONGER DO ★
 *
 * This module used to hold the invitation array, its seeds, its state
 * transitions and the whole of acceptance. That was right while an invitation
 * was something a screen displayed, and wrong the moment saying yes to one had
 * to create a `Membership`, reuse a `DriverProfile` and open a
 * `CarrierRelationship`. A feature module cannot own a record that three
 * canonical registries depend on.
 *
 * So the record moved to `@/lib/api/mock/access-store` and every decision to
 * `@/lib/api/mock/access-service` — the same move PR-1 made for
 * `DriverProfile`, for the same reason. What is left here delegates.
 *
 * Custom roles stayed. Nothing outside these screens reads one, so moving them
 * would have been churn rather than a boundary.
 *
 * The rules that decide what MAY be granted are in `src/lib/permissions/`,
 * because they are product rules, not fake data.
 */

const LATENCY_MS = 650;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Custom roles                                                                */
/* -------------------------------------------------------------------------- */

function seedRoles(): CustomRole[] {
  return [
    {
      id: "role_nl_night",
      organizationId: "org_northline",
      name: "Night dispatcher",
      description: "Covers the overnight desk. Can move freight but never sees rates.",
      permissions: [
        "loads:view", "loads:edit", "loads:status:update", "dispatch:view",
        "loads:assign", "drivers:view", "trucks:view", "trailers:view",
        "documents:view", "documents:upload",
      ],
      archived: false,
      memberCount: 3,
      createdAt: daysAgo(64),
      updatedAt: daysAgo(12),
    },
    {
      id: "role_nl_billing",
      organizationId: "org_northline",
      name: "Billing clerk",
      description: "Raises and sends invoices. No dispatch, no driver pay.",
      permissions: [
        "loads:view", "customers:view", "documents:view", "documents:download",
        "invoices:view", "invoices:create", "invoices:edit", "invoices:send",
        "rates:view",
      ],
      archived: false,
      memberCount: 1,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
    },
    {
      id: "role_nl_seasonal",
      organizationId: "org_northline",
      name: "Seasonal helper",
      description: "Kept for the winter surge. Nobody holds it right now.",
      permissions: ["loads:view", "documents:view", "documents:upload"],
      archived: false,
      memberCount: 0,
      createdAt: daysAgo(210),
      updatedAt: daysAgo(180),
    },
    {
      id: "role_nl_retired",
      organizationId: "org_northline",
      name: "Old warehouse role",
      description: "Replaced by Employee. Archived so it cannot be handed out again.",
      permissions: ["loads:view", "documents:view"],
      archived: true,
      memberCount: 0,
      createdAt: daysAgo(400),
      updatedAt: daysAgo(150),
    },
    {
      id: "role_sm_billing",
      organizationId: "org_summit",
      name: "Client billing",
      description: "Invoices the carriers we dispatch for.",
      permissions: ["loads:view", "customers:view", "invoices:view", "invoices:create"],
      archived: false,
      memberCount: 2,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(9),
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* The in-memory store                                                         */
/* -------------------------------------------------------------------------- */

let ROLES: CustomRole[] = seedRoles();

/** Test hook. Never called by the UI. Resets the invitation store too. */
export function resetAccessMock() {
  ROLES = seedRoles();
  resetAccessStore();
  sequence = 0;
}

/* ---- roles --------------------------------------------------------------- */

export async function mockListRoles(organizationId: string): Promise<CustomRole[]> {
  await sleep(300);
  return ROLES.filter((r) => r.organizationId === organizationId).map((r) => ({ ...r }));
}

export interface RoleDraft {
  name: string;
  description: string;
  permissions: PermissionKey[];
}

export async function mockCreateRole(
  organizationId: string,
  draft: RoleDraft,
): Promise<CustomRole> {
  await sleep(LATENCY_MS);
  const role: CustomRole = {
    id: nextId("role"),
    organizationId,
    name: draft.name.trim(),
    description: draft.description.trim(),
    permissions: [...draft.permissions],
    archived: false,
    memberCount: 0,
    createdAt: iso(now()),
    updatedAt: iso(now()),
  };
  ROLES = [role, ...ROLES];
  return { ...role };
}

export async function mockUpdateRole(id: string, draft: RoleDraft): Promise<CustomRole> {
  await sleep(LATENCY_MS);
  const index = ROLES.findIndex((r) => r.id === id);
  if (index < 0) throw new Error(`No such role: ${id}`);
  const updated: CustomRole = {
    ...ROLES[index],
    name: draft.name.trim(),
    description: draft.description.trim(),
    permissions: [...draft.permissions],
    updatedAt: iso(now()),
  };
  ROLES = ROLES.map((r) => (r.id === id ? updated : r));
  return { ...updated };
}

export async function mockDuplicateRole(id: string): Promise<CustomRole> {
  await sleep(LATENCY_MS);
  const source = ROLES.find((r) => r.id === id);
  if (!source) throw new Error(`No such role: ${id}`);
  const copy: CustomRole = {
    ...source,
    id: nextId("role"),
    name: `${source.name} (copy)`.slice(0, 40),
    // A copy starts with nobody in it, whatever the original's headcount.
    memberCount: 0,
    archived: false,
    createdAt: iso(now()),
    updatedAt: iso(now()),
  };
  ROLES = [copy, ...ROLES];
  return { ...copy };
}

export async function mockSetRoleArchived(id: string, archived: boolean): Promise<CustomRole> {
  await sleep(LATENCY_MS);
  const index = ROLES.findIndex((r) => r.id === id);
  if (index < 0) throw new Error(`No such role: ${id}`);
  const updated = { ...ROLES[index], archived, updatedAt: iso(now()) };
  ROLES = ROLES.map((r) => (r.id === id ? updated : r));
  return { ...updated };
}

export type DeleteRoleResult =
  | { status: "deleted" }
  | { status: "blocked"; memberCount: number };

/**
 * Deleting a role that people hold would silently strip their access, so it is
 * refused and the caller is told how many members are in the way. Archiving is
 * the safe alternative and is always available.
 */
export async function mockDeleteRole(id: string): Promise<DeleteRoleResult> {
  await sleep(LATENCY_MS);
  const role = ROLES.find((r) => r.id === id);
  if (!role) throw new Error(`No such role: ${id}`);
  if (role.memberCount > 0) return { status: "blocked", memberCount: role.memberCount };
  ROLES = ROLES.filter((r) => r.id !== id);
  return { status: "deleted" };
}

/* ---- invitations: delegated --------------------------------------------- */

/**
 * The organization's invitations, unscoped and unauthorized.
 *
 * Kept as a plain store read because that is what it always was. The SCREENS
 * go through `listInvitations` on the Access service, which requires
 * `invitations:view`; this remains for the behaviour-guard tests that only
 * want to see whether anything moved.
 */
export async function mockListInvitations(organizationId: string): Promise<Invitation[]> {
  await sleep(300);
  return invitationsForOrganization(organizationId);
}

/**
 * Resending pushes the expiry out and puts an expired invitation back in play.
 *
 * Still here rather than on the service because it grants nothing: it changes
 * the invitation's own dates and nobody's access.
 */
export async function mockResendInvitation(id: string): Promise<Invitation> {
  await sleep(LATENCY_MS);
  const updated = patchInvitation(id, {
    status: "pending",
    expiresAt: daysFromNow(7),
    createdAt: iso(now()),
    revokedAt: undefined,
    revokedByName: undefined,
  });
  if (!updated) throw new Error(`No such invitation: ${id}`);
  return updated;
}

/** The URL that goes in the email. Absolute so it can be pasted anywhere. */
export function invitationLink(token: string): string {
  const origin = typeof window === "undefined" ? "https://app.antcolos.com" : window.location.origin;
  return `${origin}/invitation/${token}`;
}
