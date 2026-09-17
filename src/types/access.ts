import type { IsoDateTime } from "./common";
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
  /**
   * The Workforce engagement this invitation connects, when there is one.
   *
   * Present when the carrier already recorded this person — a migrated worker
   * being given an account. It is what makes acceptance a CONNECTION rather
   * than a hiring: only the engagement's `driverProfileId` is filled in, and
   * its asserted start date, its state and its history are untouched.
   */
  engagementId?: string;
  expiresAt: string | null;
  createdAt: string;
  status: InvitationStatus;
  /**
   * When the recipient accepted. OBSERVED, and only ever this.
   *
   * ★ NOT A START DATE ★
   * Accepting an invitation is the person saying yes. It is not the carrier
   * saying they may work, and it is not the day the working relationship
   * became effective — a driver who accepts on Tuesday may be activated on
   * Friday, or never. `CarrierRelationship.startedAt` answers that question and
   * only the activation step sets it. Reading this as a start date is how a
   * migrated workforce ends up looking like it was all hired the afternoon
   * somebody sent the invitations.
   */
  acceptedAt?: IsoDateTime;
  /**
   * Whether the address already has an Antcolos account.
   *
   * DERIVED at issue time from the account directory, never typed by the
   * sender: a carrier that could assert "this person is already on Antcolos"
   * could use the invitation form to probe who is. In the mock it also drives
   * whether acceptance detours through Sign Up.
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

  /** Who accepted it. The `acceptedAt` moment is declared above. */
  acceptedByUserId?: string;
  /** The seat acceptance produced. What makes a repeat acceptance idempotent. */
  acceptedMembershipId?: string;
  revokedAt?: string;
  revokedByName?: string;
}

/* -------------------------------------------------------------------------- */
/* Accepting one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What accepting an invitation actually does, one canonical record at a time.
 *
 * Five different things, owned by five different modules, and the whole point
 * of listing them separately is that NONE of them implies another. **They are
 * written in this order, and the order is load-bearing** — the seat is last
 * because everything before it is a record and the seat is the key to the door:
 *
 *   driver_profile        the person's own permanent profile. Theirs, not this
 *                         carrier's, and resumed rather than remade.
 *   carrier_relationship  the driver's operational relationship with this
 *                         carrier. Created as `onboarding`, never `active`, and
 *                         with NO start date.
 *   document_access       ordinary documents the relationship needs, and only
 *                         the ones the driver agreed to share. Never a
 *                         restricted qualification category. This step GRANTS
 *                         the access it reports — the links are written here.
 *   engagement_link       when the carrier already recorded them in Workforce,
 *                         their profile id is written onto that engagement. The
 *                         engagement's own dates are untouched.
 *   workspace_membership  the smallest seat that lets them open their portal.
 *                         Never general organization permissions. LAST, so a
 *                         seat never exists behind an unfinished acceptance.
 */
export type AcceptanceStepKey =
  | "driver_profile"
  | "carrier_relationship"
  | "document_access"
  | "engagement_link"
  | "workspace_membership";

export const ACCEPTANCE_STEP_LABEL: Record<AcceptanceStepKey, string> = {
  driver_profile: "Your driver profile",
  carrier_relationship: "Your relationship with this carrier",
  document_access: "The documents you agreed to share",
  workspace_membership: "Access to your driver portal",
  engagement_link: "The record this carrier already had of you",
};

export type AcceptanceStepState =
  /** Not attempted yet, or attempted and not finished. */
  | "pending"
  | "done"
  /** Tried and refused. Kept, with the reason, and retryable. */
  | "failed"
  /** The step does not apply to this invitation, and says why. */
  | "not_applicable";

export interface AcceptanceStep {
  key: AcceptanceStepKey;
  state: AcceptanceStepState;
  /** What happened, in the person's own language. Always populated. */
  detail: string;
  /** The canonical record this step reached, when it reached one. */
  ref?: { kind: string; id: string };
  /** Set on `failed`. Plain language, never a stack trace. */
  failureReason?: string;
  /**
   * Paperwork this step deliberately did NOT hand over, and why.
   *
   * Only `document_access` sets it. A shorter list than the one somebody just
   * ticked, with no explanation, is how people conclude the product lost their
   * documents — so what was withheld is carried rather than dropped, and the
   * screen names it.
   */
  withheld?: Array<{ key: string; label: string; reason?: string }>;
}

/**
 * One person's attempt to accept one invitation.
 *
 * ★ WHY THIS EXISTS ★
 * Acceptance touches four modules one at a time and there is no transaction
 * across them. If the seat fails after the relationship succeeded, the person
 * must be able to come back and finish — and the invitation must not have
 * already flipped to "accepted" and locked them out of their own retry, which
 * is exactly what a status-first design does.
 *
 * So the run is the record, and the invitation's `accepted` status is a
 * PROJECTION of it. Keyed by `(invitationId, userId)`: a re-sent link cannot be
 * completed by somebody else's half-finished run.
 */
export interface AcceptanceRun {
  invitationId: string;
  /** The authenticated person. The run is theirs and nobody else's. */
  userId: string;
  /** Observed: the moment they said yes. Never a relationship start date. */
  acceptedAt: IsoDateTime;
  /** Set only when every applicable step is done. */
  completedAt?: IsoDateTime;
  steps: AcceptanceStep[];
}

/** Whether every applicable step finished. */
export function acceptanceComplete(run: AcceptanceRun): boolean {
  return run.steps.every((s) => s.state === "done" || s.state === "not_applicable");
}

/** The steps still owed, for the screen that has to explain itself. */
export function acceptanceOutstanding(run: AcceptanceRun): AcceptanceStep[] {
  return run.steps.filter((s) => s.state === "pending" || s.state === "failed");
}

export const ACCEPTANCE_LIMITATION =
  "Each record is created through the module that owns it, one at a time. There "
  + "is no transaction across them: a step that failed left the ones before it in "
  + "place, and accepting again finishes what is missing rather than repeating "
  + "what is done. Nothing here is persisted beyond this browser tab, no "
  + "invitation was emailed, and none of these checks is a security property.";

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
