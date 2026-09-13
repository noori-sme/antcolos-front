"use client";

import type {
  CustomRole,
  EngagementType,
  Invitation,
  InvitationKind,
  InvitationStatus,
  OrganizationType,
  PermissionKey,
} from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Invitations, custom roles and their states live here in memory for the
 * browser session. Nothing is emailed, stored, authorized or enforced. No real
 * link is created: the "copy link" action copies a URL into this same demo.
 *
 * This is the only file in the access feature that invents data, so replacing
 * it against `src/lib/api/contracts/` is the whole integration job. The rules
 * that decide what MAY be granted are not here — they live in
 * `src/lib/permissions/`, because they are product rules, not fake data.
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
/* Invitations                                                                 */
/* -------------------------------------------------------------------------- */

function seedInvitations(): Invitation[] {
  const base = {
    organizationId: "org_northline",
    organizationName: "Northline Freight",
    organizationType: "CARRIER" as OrganizationType,
    recipientHasAccount: false,
  };
  return [
    {
      ...base,
      id: "inv_1", token: "INV-DRIVER", kind: "driver", roleName: "Driver",
      engagementType: "company_driver",
      recipientName: "Yusuf Demir", recipientEmail: "yusuf.demir@example.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(6), createdAt: daysAgo(1), status: "pending",
    },
    {
      ...base,
      id: "inv_2", token: "INV-EMPLOYEE", kind: "employee", roleName: "Employee",
      recipientName: "Bea Lindgren", recipientEmail: "sam@antcolos.com",
      recipientHasAccount: true,
      permissions: ["loads:view", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload", "compliance:view"],
      expiresAt: daysFromNow(9), createdAt: daysAgo(2), status: "pending",
    },
    {
      ...base,
      id: "inv_3", token: "INV-DISPATCHORG", kind: "dispatch_org", roleName: "Dispatch organization",
      recipientName: "Meridian Dispatch", recipientEmail: "admin@meridiandispatch.example",
      scopedToCarrierName: "Northline Freight",
      permissions: ["loads:view", "loads:create", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload"],
      expiresAt: daysFromNow(13), createdAt: daysAgo(3), status: "pending",
    },
    {
      ...base,
      id: "inv_4", token: "INV-CUSTOM", kind: "custom", roleName: "Night dispatcher",
      customRoleId: "role_nl_night",
      recipientName: "Priya Raman", recipientEmail: "priya@example.com",
      permissions: ["loads:view", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "documents:view", "documents:upload"],
      expiresAt: daysFromNow(4), createdAt: daysAgo(1), status: "pending",
    },
    {
      ...base,
      id: "inv_5", token: "INV-ACCEPTED", kind: "driver", roleName: "Driver",
      recipientName: "Tomas Reyes", recipientEmail: "tomas@example.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: null, createdAt: daysAgo(22), status: "accepted",
    },
    {
      ...base,
      id: "inv_6", token: "INV-EXPIRED", kind: "employee", roleName: "Employee",
      recipientName: "Karl Mensah", recipientEmail: "karl@example.com",
      permissions: ["loads:view", "documents:view"],
      expiresAt: daysAgo(4), createdAt: daysAgo(20), status: "expired",
    },
    {
      ...base,
      id: "inv_7", token: "INV-REVOKED", kind: "custom", roleName: "Billing clerk",
      customRoleId: "role_nl_billing",
      recipientName: "Dana Wells", recipientEmail: "dana@example.com",
      permissions: ["loads:view", "customers:view", "invoices:view", "invoices:create", "rates:view"],
      expiresAt: daysFromNow(2), createdAt: daysAgo(6), status: "revoked",
    },
    {
      ...base,
      id: "inv_10", token: "INV-OWNEROP", kind: "driver", roleName: "Driver",
      engagementType: "owner_operator",
      recipientName: "Marcus Hale", recipientEmail: "marcus.hale@example.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(11), createdAt: daysAgo(1), status: "pending",
    },
    {
      ...base,
      id: "inv_11", token: "INV-DRIVER-ACCT", kind: "driver", roleName: "Driver",
      engagementType: "company_driver",
      recipientName: "Sam Murtaza", recipientEmail: "sam@antcolos.com",
      recipientHasAccount: true,
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(12), createdAt: daysAgo(1), status: "pending",
    },
    {
      ...base,
      id: "inv_9", token: "INV-WRONGUSER", kind: "employee", roleName: "Employee",
      recipientName: "Karin Vogel", recipientEmail: "karin.vogel@example.com",
      recipientHasAccount: true,
      permissions: ["loads:view", "documents:view", "customers:view"],
      expiresAt: daysFromNow(8), createdAt: daysAgo(1), status: "pending",
    },
    {
      id: "inv_8", token: "INV-DISPATCHEMP", kind: "dispatcher", roleName: "Dispatcher",
      organizationId: "org_summit", organizationName: "Summit Dispatch",
      organizationType: "DISPATCH_AGENCY", recipientHasAccount: false,
      recipientName: "Owen Pratt", recipientEmail: "owen@example.com",
      permissions: ["loads:view", "loads:create", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload", "compliance:view"],
      expiresAt: daysFromNow(10), createdAt: daysAgo(1), status: "pending",
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* The in-memory store                                                         */
/* -------------------------------------------------------------------------- */

let ROLES: CustomRole[] = seedRoles();
let INVITATIONS: Invitation[] = seedInvitations();

/** Test hook. Never called by the UI. */
export function resetAccessMock() {
  ROLES = seedRoles();
  INVITATIONS = seedInvitations();
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

/* ---- invitations --------------------------------------------------------- */

export async function mockListInvitations(organizationId: string): Promise<Invitation[]> {
  await sleep(300);
  return INVITATIONS.filter((i) => i.organizationId === organizationId).map((i) => ({ ...i }));
}

export interface InvitationDraft {
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  kind: InvitationKind;
  roleName: string;
  customRoleId?: string;
  engagementType?: EngagementType;
  recipientName: string;
  recipientEmail: string;
  permissions: PermissionKey[];
  scopedToCarrierName?: string;
  expiresAt: string | null;
}

export async function mockCreateInvitation(draft: InvitationDraft): Promise<Invitation> {
  await sleep(LATENCY_MS);
  const invitation: Invitation = {
    ...draft,
    id: nextId("inv"),
    token: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    recipientName: draft.recipientName.trim(),
    recipientEmail: draft.recipientEmail.trim().toLowerCase(),
    permissions: [...draft.permissions],
    createdAt: iso(now()),
    status: "pending",
    recipientHasAccount: false,
  };
  INVITATIONS = [invitation, ...INVITATIONS];
  return { ...invitation };
}

async function setStatus(id: string, status: InvitationStatus): Promise<Invitation> {
  await sleep(LATENCY_MS);
  const index = INVITATIONS.findIndex((i) => i.id === id);
  if (index < 0) throw new Error(`No such invitation: ${id}`);
  const updated = { ...INVITATIONS[index], status };
  INVITATIONS = INVITATIONS.map((i) => (i.id === id ? updated : i));
  return { ...updated };
}

export function mockRevokeInvitation(id: string): Promise<Invitation> {
  return setStatus(id, "revoked");
}

/** Resending pushes the expiry out and puts an expired invitation back in play. */
export async function mockResendInvitation(id: string): Promise<Invitation> {
  await sleep(LATENCY_MS);
  const index = INVITATIONS.findIndex((i) => i.id === id);
  if (index < 0) throw new Error(`No such invitation: ${id}`);
  const updated: Invitation = {
    ...INVITATIONS[index],
    status: "pending",
    expiresAt: daysFromNow(7),
    createdAt: iso(now()),
  };
  INVITATIONS = INVITATIONS.map((i) => (i.id === id ? updated : i));
  return { ...updated };
}

/** The URL that goes in the email. Absolute so it can be pasted anywhere. */
export function invitationLink(token: string): string {
  const origin = typeof window === "undefined" ? "https://app.antcolos.com" : window.location.origin;
  return `${origin}/invitation/${token}`;
}

/* ---- acceptance ---------------------------------------------------------- */

/** The address the demo is signed in as. Drives the wrong-recipient state. */
export const DEMO_SIGNED_IN_EMAIL = "sam@antcolos.com";

export type InvitationLookup =
  | { status: "valid"; invitation: Invitation; signedInAs: string }
  | { status: "needs-account"; invitation: Invitation }
  | { status: "expired"; invitation: Invitation }
  | { status: "revoked"; invitation: Invitation }
  | { status: "used"; invitation: Invitation }
  | { status: "wrong-recipient"; invitation: Invitation; signedInAs: string }
  | { status: "not-found" };

/**
 * Resolves an invitation link.
 *
 * Who is signed in decides two of the states, so the mock works it out here
 * rather than making every caller model an account system:
 *
 *   - `returningFromAuth` means the person has just come back through Sign Up
 *     or Sign In carrying this invitation, so they are, by construction, the
 *     recipient. This is what proves the invitation survived the detour.
 *   - otherwise a recipient with an account is treated as already signed in as
 *     the demo user, which is what makes the wrong-recipient case reachable:
 *     an invitation addressed to one mailbox, opened by somebody else, must
 *     never quietly attach itself to the wrong account.
 *   - a recipient with no account is nobody yet, so the link asks them to make
 *     one first.
 */
export async function mockLookUpTeamInvitation(
  token: string,
  options: { returningFromAuth: boolean },
): Promise<InvitationLookup> {
  await sleep(LATENCY_MS);
  const invitation = INVITATIONS.find(
    (i) => i.token.toUpperCase() === token.trim().toUpperCase(),
  );
  if (!invitation) return { status: "not-found" };

  if (invitation.status === "revoked") return { status: "revoked", invitation };
  if (invitation.status === "accepted") return { status: "used", invitation };

  const expired =
    invitation.status === "expired" ||
    (invitation.expiresAt !== null && new Date(invitation.expiresAt) < now());
  if (expired) return { status: "expired", invitation };

  const signedInAs = options.returningFromAuth
    ? invitation.recipientEmail
    : invitation.recipientHasAccount
      ? DEMO_SIGNED_IN_EMAIL
      : null;

  if (signedInAs === null) return { status: "needs-account", invitation };
  if (signedInAs.toLowerCase() !== invitation.recipientEmail.toLowerCase()) {
    return { status: "wrong-recipient", invitation, signedInAs };
  }
  return { status: "valid", invitation, signedInAs };
}

export async function mockAcceptTeamInvitation(id: string): Promise<Invitation> {
  return setStatus(id, "accepted");
}
