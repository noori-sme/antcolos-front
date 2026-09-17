import type { Invitation, OrganizationType, User } from "@/types";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE invitation store. One array, and there is no second one.
 *
 * It used to live in `src/features/access/mock-access.ts`, next to the screens
 * that read it, which was right while an invitation was a thing a screen
 * displayed and wrong the moment accepting one had to create a `Membership`, a
 * `DriverProfile` and a `CarrierRelationship`. A feature module cannot own a
 * record that three canonical registries depend on. So the record moved down
 * here and the feature module delegates — the same move PR-1 made for
 * `DriverProfile`, for the same reason.
 *
 * Custom roles did NOT move. They are a permission-authoring convenience that
 * nothing outside the access screens reads, and moving them would have been
 * churn rather than a boundary.
 *
 * ███ FRONTEND ONLY ███
 * In memory for the life of the tab. No persistence, no email, no link that
 * leaves this demo, and no uniqueness constraint that survives two tabs.
 */

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

let sequence = 0;
export function nextAccessId(prefix: string): string {
  return `${prefix}_${(sequence += 1).toString(36)}${Date.now().toString(36)}`;
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
 * returns nothing a sender did not already know — a carrier inviting
 * `sam@antcolos.com` learns that the invitation will not need a sign-up step,
 * not that Sam exists. There is deliberately no "find people" function here: a
 * carrier that could enumerate accounts could ask Antcolos who its competitor's
 * drivers are.
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
/* Seeds                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The demo's invitations, one per state worth looking at.
 *
 * `recipientHasAccount` and `recipientUserId` are DERIVED from the directory
 * rather than typed here, so a seed cannot claim an account that does not
 * exist — which is the same rule issuance follows, applied to the fixtures so
 * they cannot drift away from it.
 */
function seed(invitation: Omit<Invitation, "recipientHasAccount" | "recipientUserId">): Invitation {
  const account = accountForEmail(invitation.recipientEmail);
  return {
    ...invitation,
    recipientHasAccount: account !== undefined,
    recipientUserId: account?.id,
  };
}

function buildSeeds(): Invitation[] {
  const northline = {
    organizationId: "org_northline",
    organizationName: "Northline Freight",
    organizationType: "CARRIER" as OrganizationType,
    invitedByMembershipId: "mem_northline_owner",
    invitedByName: "Sam Murtaza",
  };
  return [
    seed({
      ...northline,
      id: "inv_1", token: "INV-DRIVER", kind: "driver", roleName: "Driver",
      engagementType: "company_driver",
      recipientName: "Yusuf Demir", recipientEmail: "yusuf.demir@example.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(6), createdAt: daysAgo(1), status: "pending",
    }),
    seed({
      ...northline,
      id: "inv_2", token: "INV-EMPLOYEE", kind: "employee", roleName: "Employee",
      recipientName: "Bea Lindgren", recipientEmail: "sam@antcolos.com",
      permissions: ["loads:view", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload", "compliance:view"],
      expiresAt: daysFromNow(9), createdAt: daysAgo(2), status: "pending",
    }),
    seed({
      ...northline,
      id: "inv_3", token: "INV-DISPATCHORG", kind: "dispatch_org", roleName: "Dispatch organization",
      recipientName: "Meridian Dispatch", recipientEmail: "admin@meridiandispatch.example",
      scopedToCarrierName: "Northline Freight",
      permissions: ["loads:view", "loads:create", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload"],
      expiresAt: daysFromNow(13), createdAt: daysAgo(3), status: "pending",
    }),
    seed({
      ...northline,
      id: "inv_4", token: "INV-CUSTOM", kind: "custom", roleName: "Night dispatcher",
      customRoleId: "role_nl_night",
      recipientName: "Priya Raman", recipientEmail: "priya@example.com",
      permissions: ["loads:view", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "documents:view", "documents:upload"],
      expiresAt: daysFromNow(4), createdAt: daysAgo(1), status: "pending",
    }),
    seed({
      ...northline,
      id: "inv_5", token: "INV-ACCEPTED", kind: "driver", roleName: "Driver",
      recipientName: "Tomas Reyes", recipientEmail: "tomas@example.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: null, createdAt: daysAgo(22), status: "accepted",
      acceptedAt: daysAgo(21), acceptedByUserId: "usr_tomas",
    }),
    seed({
      ...northline,
      id: "inv_6", token: "INV-EXPIRED", kind: "employee", roleName: "Employee",
      recipientName: "Karl Mensah", recipientEmail: "karl@example.com",
      permissions: ["loads:view", "documents:view"],
      expiresAt: daysAgo(4), createdAt: daysAgo(20), status: "expired",
    }),
    seed({
      ...northline,
      id: "inv_7", token: "INV-REVOKED", kind: "custom", roleName: "Billing clerk",
      customRoleId: "role_nl_billing",
      recipientName: "Dana Wells", recipientEmail: "dana@example.com",
      permissions: ["loads:view", "customers:view", "invoices:view", "invoices:create", "rates:view"],
      expiresAt: daysFromNow(2), createdAt: daysAgo(6), status: "revoked",
      revokedAt: daysAgo(3), revokedByName: "Sam Murtaza",
    }),
    seed({
      ...northline,
      id: "inv_10", token: "INV-OWNEROP", kind: "driver", roleName: "Driver",
      engagementType: "owner_operator",
      recipientName: "Marcus Hale", recipientEmail: "marcus.hale@example.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(11), createdAt: daysAgo(1), status: "pending",
    }),
    seed({
      ...northline,
      id: "inv_11", token: "INV-DRIVER-ACCT", kind: "driver", roleName: "Driver",
      engagementType: "company_driver",
      recipientName: "Sam Murtaza", recipientEmail: "sam@antcolos.com",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(12), createdAt: daysAgo(1), status: "pending",
    }),
    seed({
      ...northline,
      id: "inv_9", token: "INV-WRONGUSER", kind: "employee", roleName: "Employee",
      recipientName: "Karin Vogel", recipientEmail: "karin.vogel@example.com",
      permissions: ["loads:view", "documents:view", "customers:view"],
      expiresAt: daysFromNow(8), createdAt: daysAgo(1), status: "pending",
    }),
    /**
     * ★ THE WALKTHROUGH'S INVITATION ★
     * Addressed to the newcomer fixture — a real account that belongs to
     * nothing — so the whole arc can be walked in the preview without anybody
     * having to invent a second person. A driver, because the driver path is
     * the one that also creates a profile and an engagement.
     */
    seed({
      ...northline,
      id: "inv_12", token: "INV-NEWDRIVER", kind: "driver", roleName: "Driver",
      engagementType: "company_driver",
      recipientName: NEWCOMER_USER.displayName, recipientEmail: NEWCOMER_USER.email,
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(14), createdAt: daysAgo(1), status: "pending",
    }),
    /**
     * The office side of the same arc, also addressed to the newcomer.
     *
     * It carries `members:view` and `members:suspend`, which is what makes the
     * People screen — and therefore ending somebody's access — reachable by
     * pressing buttons rather than by a test reaching into a store. A carrier
     * office manager is exactly who holds those two in real life.
     */
    seed({
      ...northline,
      id: "inv_13", token: "INV-NEWEMPLOYEE", kind: "employee", roleName: "Office manager",
      recipientName: NEWCOMER_USER.displayName, recipientEmail: NEWCOMER_USER.email,
      permissions: [
        "loads:view", "drivers:view", "trucks:view", "documents:view",
        "members:view", "members:suspend", "invitations:view",
      ],
      expiresAt: daysFromNow(14), createdAt: daysAgo(1), status: "pending",
    }),
    seed({
      id: "inv_8", token: "INV-DISPATCHEMP", kind: "dispatcher", roleName: "Dispatcher",
      organizationId: "org_summit", organizationName: "Summit Dispatch",
      organizationType: "DISPATCH_AGENCY",
      invitedByMembershipId: "mem_summit_owner", invitedByName: "Sam Murtaza",
      recipientName: "Owen Pratt", recipientEmail: "owen@example.com",
      permissions: ["loads:view", "loads:create", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload", "compliance:view"],
      expiresAt: daysFromNow(10), createdAt: daysAgo(1), status: "pending",
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

let invitations: Invitation[] = buildSeeds();

/** Test hook. Never called by the UI. */
export function resetAccessStore() {
  invitations = buildSeeds();
  sequence = 0;
}

/** Everything, unscoped. Only the service may call this; it scopes. */
export function allInvitations(): readonly Invitation[] {
  return invitations;
}

export function invitationsForOrganization(organizationId: string): Invitation[] {
  return invitations
    .filter((i) => i.organizationId === organizationId)
    .map((i) => ({ ...i }));
}

/**
 * By token, case-insensitively, because people retype links.
 *
 * Returns the LIVE record rather than a copy: this is the store's own accessor
 * and the service needs the identity to write back. Everything that leaves the
 * service is copied.
 */
export function invitationByToken(token: string): Invitation | undefined {
  const wanted = token.trim().toUpperCase();
  return invitations.find((i) => i.token.toUpperCase() === wanted);
}

export function invitationById(id: string): Invitation | undefined {
  return invitations.find((i) => i.id === id);
}

export function addInvitation(invitation: Invitation): Invitation {
  invitations = [invitation, ...invitations];
  return invitation;
}

/** Applies a patch in place and hands back a copy. The only mutation path. */
export function patchInvitation(id: string, patch: Partial<Invitation>): Invitation | undefined {
  const found = invitations.find((i) => i.id === id);
  if (!found) return undefined;
  Object.assign(found, patch);
  return { ...found };
}

/* -------------------------------------------------------------------------- */
/* Expiry                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether an invitation has lapsed, DERIVED on read.
 *
 * ★ THERE IS NO SCHEDULER ★
 * Nothing runs at `expiresAt`, here or anywhere else in this build. So expiry
 * is a question asked at the moment somebody opens the link, rather than a
 * status something wrote. An invitation whose stored status still says
 * `pending` is expired the instant the date passes, because every caller asks
 * this and none reads `status` alone.
 */
export function invitationHasLapsed(invitation: Invitation, at: Date = now()): boolean {
  if (invitation.status === "expired") return true;
  if (invitation.expiresAt === null) return false;
  const deadline = Date.parse(invitation.expiresAt);
  if (Number.isNaN(deadline)) return false;
  return deadline <= at.getTime();
}

export const DEFAULT_INVITATION_DAYS = 14;
export { daysFromNow as invitationDaysFromNow, iso as invitationIso, now as invitationNow };
