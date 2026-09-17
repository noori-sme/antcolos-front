import type { Invitation, OrganizationType } from "@/types";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The invitation fixtures, moved here unchanged from the feature-local mock so
 * every state a reviewer needs to see is still one URL away.
 *
 * ★ WHAT IS NOT SEEDED ANY MORE ★
 * `INV-ACCEPTED` no longer carries `status: "accepted"` as a stored flag. Its
 * status is projected from a completed acceptance run, and there is no run for
 * it — so it seeds as `pending`. That is a deliberate consequence of making
 * "accepted" mean "somebody finished accepting" rather than "a field says so",
 * and inventing a fake run to preserve the old screenshot would be inventing
 * the very evidence the projection exists to require.
 */

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);

export function seedInvitations(): Invitation[] {
  const base = {
    organizationId: "org_northline",
    organizationName: "Northline Freight",
    organizationType: "CARRIER" as OrganizationType,
    recipientHasAccount: false,
    // An invitation is issued from inside an organization, by a SEAT that held
    // `invitations:create` — never by a User in the abstract. The name is
    // snapshotted so the record still reads after the sender is renamed.
    invitedByMembershipId: "mem_northline_owner",
    invitedByName: "Sam Murtaza",
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
      expiresAt: null, createdAt: daysAgo(22), status: "pending",
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
      ...base,
      // A person who belongs to nothing, invited by a carrier they have no
      // seat in. The only fixture that can demonstrate acceptance actually
      // GRANTING something: the demo account is already Northline's Owner, so
      // accepting a driver invitation there correctly changes nothing, which
      // makes it useless for showing what acceptance does. Pairs with
      // `?fixture=newcomer`.
      id: "inv_12", token: "INV-NEWCOMER", kind: "driver", roleName: "Driver",
      engagementType: "company_driver",
      recipientName: "Alex Rivera", recipientEmail: "alex.rivera@example.com",
      recipientHasAccount: true,
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(14), createdAt: daysAgo(1), status: "pending",
    },
    {
      ...base,
      // The other half of the migration case: an invitation that CONNECTS an
      // engagement this carrier already holds, rather than creating one. Its
      // acceptance writes the person's profile id onto that engagement and
      // touches nothing else about it — not its state, and above all not the
      // start date the carrier asserted. See `weng_nl_migrated_driver`.
      id: "inv_13", token: "INV-MIGRATED", kind: "driver", roleName: "Driver",
      engagementType: "owner_operator",
      recipientName: "Sam Murtaza", recipientEmail: "sam@antcolos.com",
      recipientHasAccount: true,
      engagementId: "weng_nl_migrated_driver",
      permissions: ["loads:view", "loads:status:update", "documents:view", "documents:upload", "settlements:view"],
      expiresAt: daysFromNow(21), createdAt: daysAgo(2), status: "pending",
    },
    {
      ...base,
      /*
       * An invitation that carries `members:view` and `members:suspend`.
       *
       * It is what makes the People screen reachable and ending a seat
       * something a person can press, so the browser suite can prove the whole
       * arc — join, look at the roster, put the seat down — without a single
       * test-only affordance. An office manager is exactly who holds those two
       * in real life.
       */
      id: "inv_14", token: "INV-NEWEMPLOYEE", kind: "employee", roleName: "Office manager",
      recipientName: "Alex Rivera", recipientEmail: "alex.rivera@example.com",
      permissions: [
        "loads:view", "drivers:view", "trucks:view", "documents:view",
        "members:view", "members:suspend", "invitations:view",
      ],
      expiresAt: daysFromNow(14), createdAt: daysAgo(1), status: "pending",
    },
    {
      id: "inv_8", token: "INV-DISPATCHEMP", kind: "dispatcher", roleName: "Dispatcher",
      organizationId: "org_summit", organizationName: "Summit Dispatch",
      organizationType: "DISPATCH_AGENCY", recipientHasAccount: false,
      invitedByMembershipId: "mem_summit_owner", invitedByName: "Dana Whitfield",
      recipientName: "Owen Pratt", recipientEmail: "owen@example.com",
      permissions: ["loads:view", "loads:create", "loads:edit", "loads:status:update", "dispatch:view", "loads:assign", "drivers:view", "trucks:view", "trailers:view", "customers:view", "documents:view", "documents:upload", "compliance:view"],
      expiresAt: daysFromNow(10), createdAt: daysAgo(1), status: "pending",
    },
  ];
}
