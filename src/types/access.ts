import type { EngagementType } from "./driver-profile";
import type { OrganizationType, PermissionKey } from "./permission";

/**
 * What kind of thing is being invited. The kinds differ per organization type:
 * a carrier can invite a whole dispatch organization, a dispatch organization
 * invites its own dispatchers.
 */
export type InvitationKind =
  | "driver"
  | "dispatch_org"
  | "employee"
  | "dispatcher"
  | "custom";

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

/**
 * Why an invitation could not be resolved or accepted.
 *
 * Every one of these is a REFUSAL, not an error: the link was real and the
 * answer is no. They are separated because the person on the other end needs a
 * different sentence for each, and because a product that collapsed
 * `wrong_recipient` into `not_found` would be a product where an invitation
 * quietly attaches itself to whoever happens to be signed in.
 */
export type InvitationRefusal =
  /** No invitation with this token. Also the answer for a mistyped link. */
  | "not_found"
  /** The carrier took it back. */
  | "revoked"
  /** Past `expiresAt`. Derived on read — nothing runs at the expiry instant. */
  | "expired"
  /** Nobody is signed in, so there is no person to tie the seat to. */
  | "needs_account"
  /** Somebody is signed in, and it is not who this was addressed to. */
  | "wrong_recipient"
  /** Already accepted, by a different account. Never re-pointed at this one. */
  | "already_accepted_by_other"
  /** The organization it names no longer resolves. */
  | "unknown_organization"
  /**
   * A whole-organization arrangement, which is not a seat.
   *
   * Inviting a dispatch ORGANIZATION is not the same act as putting a person
   * in a workspace, and it is not this flow's to perform: a carrier letting an
   * outside organization work its freight does it per truck, from the truck,
   * as a `TruckDispatchAccess`. Accepting one here would be a second door to
   * the same reach with none of the checks behind it.
   */
  | "organization_invitation_unsupported"
  /**
   * A driver invitation, a person with no `DriverProfile` yet, and no licence
   * details supplied. Not a failure — the next step.
   */
  | "needs_driver_profile";

export const INVITATION_REFUSAL_REASON: Record<InvitationRefusal, string> = {
  not_found: "We don't recognise this invitation link.",
  revoked: "This invitation was withdrawn by the organization that sent it.",
  expired: "This invitation is past its expiry date.",
  needs_account: "Sign in or create an account before accepting this invitation.",
  wrong_recipient: "This invitation was addressed to somebody else.",
  already_accepted_by_other: "This invitation has already been used by another account.",
  unknown_organization: "The organization that sent this invitation is no longer reachable.",
  organization_invitation_unsupported:
    "This invitation connects two organizations rather than adding a person. The carrier grants that from the truck it concerns.",
  needs_driver_profile: "Set up your driver profile to finish accepting this invitation.",
};

export interface Invitation {
  id: string;
  /** What the invitation link carries. */
  token: string;
  organizationId: string;
  /** Snapshotted so a renamed organization does not rewrite old invitations. */
  organizationName: string;
  organizationType: OrganizationType;
  kind: InvitationKind;
  /** The role as it read when sent — a preset name, or the custom role's name. */
  roleName: string;
  customRoleId?: string;
  /**
   * Driver invitations only. The carrier decides whether this is a company
   * driver or an owner-operator — it sets the paperwork and the pay, so it is
   * not the driver's to choose, and the acceptance screen shows it read-only.
   */
  engagementType?: EngagementType;
  recipientName: string;
  recipientEmail: string;
  /** Snapshotted too: editing a role later must not silently re-scope a
   *  pending invitation someone is about to accept. */
  permissions: PermissionKey[];
  /**
   * Dispatch-organization invitations only. Everything granted applies to this
   * carrier relationship and nothing else — the dispatch organization's other
   * carrier clients are unaffected.
   */
  scopedToCarrierName?: string;
  expiresAt: string | null;
  createdAt: string;
  status: InvitationStatus;
  /**
   * Whether the address already has an Antcolos account.
   *
   * DERIVED at issue time from the account directory, never typed by the
   * sender: a carrier that could assert "this person is already on Antcolos"
   * could use the invitation form to probe who is.
   */
  recipientHasAccount: boolean;
  /**
   * The account this was addressed to, when the address resolved to one.
   *
   * Absent for somebody who has no account yet — they are nobody in particular
   * until they make one, and the address is all the invitation can name.
   */
  recipientUserId?: string;

  /* -- Who issued it, and under what authority --------------------------- */

  /**
   * The membership that issued it. Never the User: an invitation is issued
   * from INSIDE an organization, by a seat that held `invitations:create`.
   */
  invitedByMembershipId: string;
  /** Snapshotted, so the record still reads after the sender is renamed. */
  invitedByName: string;

  /* -- What happened to it ------------------------------------------------ */

  /**
   * When it was accepted, and by whom.
   *
   * `acceptedAt` is a fact about the INVITATION — somebody opened the link and
   * said yes at this moment. It is deliberately not the same date as any
   * relationship's `startedAt`: see `CarrierRelationship` in ./driver-profile.
   */
  acceptedAt?: string;
  acceptedByUserId?: string;
  /** The seat acceptance produced. What makes a repeat acceptance idempotent. */
  acceptedMembershipId?: string;
  revokedAt?: string;
  revokedByName?: string;
}

export interface CustomRole {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** Archived roles keep working for whoever holds them, but cannot be given out. */
  archived: boolean;
  /** How many current members hold this role. Blocks deletion when above zero. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
