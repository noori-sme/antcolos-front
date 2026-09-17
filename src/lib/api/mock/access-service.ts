import type {
  Invitation, Membership, Organization, PermissionKey, User,
} from "@/types";
import { INVITATION_REFUSAL_REASON } from "@/types";
import { ordinaryDocumentKeys, splitByRestriction } from "@/lib/documents/requirements";
import { effectivePermissions } from "@/lib/permissions/effective";
import { ungrantablePermissions, clampToGrantable } from "@/lib/permissions/grantable";
import { DEFAULT_SCOPE, OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import {
  MOCK_ORGANIZATIONS, MOCK_TEMPLATES,
} from "@/lib/session/fixtures";
import {
  grantMembership, liveMembershipFor, rosterSnapshot, setMembershipStatus,
} from "@/lib/session/membership-store";
import { documentRequirements } from "@/features/driver/mock-driver";
import { workspaceKindOf } from "@/types";
import {
  PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AcceptInvitationResult, AcceptanceOutcome, AcceptingIdentity, EndSeatResult,
  InvitationResolution, IssueInvitationInput, IssueInvitationResult,
} from "../contracts/access";
import { appendAuditEvent, recordPermissionDenied } from "./audit";
import {
  accountById, accountForEmail, addInvitation, allInvitations, DEFAULT_INVITATION_DAYS,
  invitationByToken, invitationById, invitationHasLapsed,
  invitationsForOrganization, nextAccessId, patchInvitation,
} from "./access-store";
import {
  createOrResumeProfile, createOrResumeRelationship, profileForUser,
  relationshipsForProfile,
} from "./driver-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * ★ THE ACCESS SERVICE ★
 *
 * The thing PR-1 named and deliberately did not build. It answers the question
 * `grantMembership` refuses to: who may have a seat here, on what basis, and
 * what else must be true first.
 *
 * ── FOUR QUESTIONS, AND ANSWERING THREE IS HOW THIS LEAKS ──────────────────
 *
 *  1. WHO IS ISSUING?    A membership, inside the organization, holding
 *                        `invitations:create`. Never a User, never a caller-
 *                        supplied organization id.
 *  2. MAY THEY GRANT     `ungrantablePermissions` — nobody hands out access
 *     THIS MUCH?         they do not hold. Without this, `permissions:manage`
 *                        silently becomes every permission.
 *  3. WHO IS ACCEPTING?  The signed-in ACCOUNT, matched against the account
 *                        the invitation names. Not whoever opened the link.
 *  4. WHAT DOES SAYING   A seat, a profile REUSED not duplicated, an engagement
 *     YES ACTUALLY DO?   with an accepted date and no start date, and ordinary
 *                        document access — never restricted categories.
 *
 * ── WHAT THIS SERVICE HAS NO METHOD FOR ────────────────────────────────────
 *
 * Granting dispatch reach. A carrier letting another organization work its
 * freight is a per-truck `TruckDispatchAccess`, issued from the truck by a
 * membership holding `trucks:relationships:manage`, and every read behind it
 * runs through `dispatch-delegation.ts`. There is no function here that mints
 * one, which is why an invitation of kind `dispatch_org` is refused outright
 * rather than quietly doing something adjacent.
 *
 * ███ FRONTEND ONLY ███
 * Every check here runs in the browser against in-memory state that a reload
 * clears. It is the SHAPE a real API must implement, not a security property:
 * anybody who can edit client state can grant themselves anything. The backend
 * owes every one of these checks again, server-side.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 200;
const wait = () =>
  LATENCY_MS ? new Promise<void>((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve();

function organizationById(id: string): Organization | undefined {
  return MOCK_ORGANIZATIONS.find((o) => o.id === id);
}

function refusal(code: keyof typeof INVITATION_REFUSAL_REASON) {
  return { message: INVITATION_REFUSAL_REASON[code] };
}

/* -------------------------------------------------------------------------- */
/* Issuing                                                                     */
/* -------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Offers access to the organization in `ctx`.
 *
 * Two refusals and they are not the same thing. `not_permitted` means the
 * sender may not invite at all; `permissions_exceed_granter` means they may,
 * but not THAT — and it names the exact keys, because "some of this is not
 * yours to give" is unactionable.
 *
 * Both are recorded. A refused attempt to hand out `permissions:manage` is
 * more worth reading six months later than the invitations that succeeded.
 */
export async function issueInvitation(
  ctx: ServiceContext,
  input: IssueInvitationInput,
): Promise<IssueInvitationResult> {
  await wait();

  if (!ctx.permissions.has("invitations:create")) {
    recordPermissionDenied(ctx, {
      required: ["invitations:create"],
      entity: { kind: "invitation", id: "new", label: input.recipientEmail.trim() },
      summary: `Refused to invite ${input.recipientEmail.trim()}: no permission to invite.`,
    });
    return {
      status: "refused",
      refusal: "not_permitted",
      message: "You do not have permission to invite people to this organization.",
    };
  }

  const organization = organizationById(ctx.organizationId);
  if (!organization) {
    return { status: "refused", refusal: "invalid", message: "This organization is not reachable." };
  }

  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!EMAIL.test(recipientEmail)) {
    return { status: "refused", refusal: "invalid", message: "That is not an email address." };
  }
  if (input.kind === "driver" && !input.engagementType) {
    return {
      status: "refused",
      refusal: "invalid",
      message: "Say whether this driver is a company driver or an owner-operator. It decides their paperwork and their pay, so the driver cannot choose it.",
    };
  }

  /*
   * ★ NOBODY HANDS OUT ACCESS THEY DO NOT HOLD ★
   * Checked here rather than trusted from the picker, because the picker is a
   * convenience and this is the boundary. `clampToGrantable` runs afterwards
   * too — belt and braces — so a future caller that skipped the check still
   * cannot widen anything.
   */
  const ungrantable = ungrantablePermissions(input.permissions, ctx.permissions);
  if (ungrantable.length > 0) {
    appendAuditEvent(ctx, {
      module: "access",
      action: "access.permission_denied",
      outcome: "denied",
      entity: { kind: "invitation", id: "new", label: recipientEmail },
      summary: `Refused to invite ${recipientEmail} with access the sender does not hold.`,
      permissionContext: { required: [...input.permissions], missing: ungrantable },
    });
    return {
      status: "refused",
      refusal: "permissions_exceed_granter",
      message: "You cannot give somebody access you do not have yourself.",
      ungrantable,
    };
  }

  /* --- from here, nothing awaits ---------------------------------------- */

  const account = accountForEmail(recipientEmail);
  const days = input.expiresInDays === undefined ? DEFAULT_INVITATION_DAYS : input.expiresInDays;
  const createdAt = nowIso();

  const invitation: Invitation = {
    id: nextAccessId("inv"),
    token: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    organizationId: organization.id,
    organizationName: organization.displayName,
    organizationType: organization.type,
    kind: input.kind,
    roleName: input.roleName.trim(),
    customRoleId: input.customRoleId,
    engagementType: input.engagementType,
    recipientName: input.recipientName.trim(),
    recipientEmail,
    permissions: clampToGrantable(input.permissions, ctx.permissions, organization.type),
    scopedToCarrierName: input.scopedToCarrierName,
    expiresAt: days === null ? null : isoInDays(days),
    createdAt,
    status: "pending",
    // DERIVED, never asserted by the sender. See `accountForEmail`.
    recipientHasAccount: account !== undefined,
    recipientUserId: account?.id,
    invitedByMembershipId: ctx.membershipId,
    invitedByName: ctx.actor.displayNameSnapshot,
  };

  addInvitation(invitation);

  appendAuditEvent(ctx, {
    module: "access",
    action: "access.member_invited",
    entity: { kind: "invitation", id: invitation.id, label: invitation.recipientName },
    relatedEntities: account
      ? [{ kind: "user", id: account.id, label: account.displayName }]
      : undefined,
    summary: `Invited ${invitation.recipientName} (${recipientEmail}) as ${invitation.roleName}.`,
    changes: [
      { field: "role", before: null, after: invitation.roleName },
      { field: "permissionCount", before: null, after: invitation.permissions.length },
      { field: "kind", before: null, after: invitation.kind },
    ],
  });

  return { status: "issued", invitation: { ...invitation } };
}

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function listInvitations(ctx: ServiceContext): Promise<Invitation[]> {
  await wait();
  if (!ctx.permissions.has("invitations:view")) {
    throw new PermissionDeniedError(["invitations:view"]);
  }
  return invitationsForOrganization(ctx.organizationId);
}

/**
 * Takes an invitation back. Idempotent — revoking twice leaves one revocation.
 *
 * Scoped to the caller's organization: an invitation belonging to somebody else
 * answers "not found" rather than "forbidden", which would confirm it exists.
 */
export async function revokeInvitation(
  ctx: ServiceContext,
  invitationId: string,
  reason = "Withdrawn by the organization.",
): Promise<Invitation> {
  await wait();
  if (!ctx.permissions.has("invitations:revoke")) {
    throw new PermissionDeniedError(["invitations:revoke"]);
  }
  const found = invitationById(invitationId);
  if (!found || found.organizationId !== ctx.organizationId) {
    throw new Error(`No such invitation: ${invitationId}`);
  }
  if (found.status === "revoked") return { ...found };

  const updated = patchInvitation(invitationId, {
    status: "revoked",
    revokedAt: nowIso(),
    revokedByName: ctx.actor.displayNameSnapshot,
  })!;

  appendAuditEvent(ctx, {
    module: "access",
    action: "access.permission_revoked",
    sourceAction: "access.invitation_revoked",
    entity: { kind: "invitation", id: updated.id, label: updated.recipientName },
    summary: `Withdrew the invitation to ${updated.recipientName}. ${reason}`,
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Resolving a link                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What this link means for whoever is holding it.
 *
 * ★ THE LINE THAT TIES AN INVITATION TO A PERSON ★
 * An invitation is addressed to an account, and opening the link does not make
 * the opener that account. So the match is on identity — the resolved
 * `recipientUserId` when there is one, the address otherwise — and a mismatch
 * is `wrong_recipient` rather than a quiet attach. Without this, forwarding an
 * invitation email would be a way to give somebody else your seat.
 */
export async function resolveInvitation(
  token: string,
  identity: AcceptingIdentity | null,
): Promise<InvitationResolution> {
  await wait();
  const invitation = invitationByToken(token);
  if (!invitation) {
    return { status: "refused", refusal: "not_found", ...refusal("not_found") };
  }
  const copy = { ...invitation };

  if (invitation.status === "revoked") {
    return { status: "refused", refusal: "revoked", invitation: copy, ...refusal("revoked") };
  }
  // Derived, not read off `status`: nothing runs at the expiry instant.
  if (invitationHasLapsed(invitation)) {
    return { status: "refused", refusal: "expired", invitation: copy, ...refusal("expired") };
  }
  if (!organizationById(invitation.organizationId)) {
    return {
      status: "refused", refusal: "unknown_organization", invitation: copy,
      ...refusal("unknown_organization"),
    };
  }
  if (invitation.kind === "dispatch_org") {
    return {
      status: "refused", refusal: "organization_invitation_unsupported", invitation: copy,
      ...refusal("organization_invitation_unsupported"),
    };
  }
  if (!identity) {
    return { status: "refused", refusal: "needs_account", invitation: copy, ...refusal("needs_account") };
  }

  const addressedToThisAccount = invitation.recipientUserId
    ? invitation.recipientUserId === identity.userId
    : invitation.recipientEmail.toLowerCase() === identity.email.trim().toLowerCase();

  if (invitation.status === "accepted") {
    // Accepted by this very person is the IDEMPOTENT answer, not a failure.
    if (invitation.acceptedByUserId === identity.userId) {
      return {
        status: "already_accepted",
        invitation: copy,
        membershipId: invitation.acceptedMembershipId,
      };
    }
    return {
      status: "refused", refusal: "already_accepted_by_other", invitation: copy,
      ...refusal("already_accepted_by_other"),
    };
  }

  if (!addressedToThisAccount) {
    return {
      status: "refused", refusal: "wrong_recipient", invitation: copy,
      signedInAs: identity.email,
      ...refusal("wrong_recipient"),
    };
  }

  return { status: "ready", invitation: copy };
}

/* -------------------------------------------------------------------------- */
/* Accepting                                                                   */
/* -------------------------------------------------------------------------- */

/** The licence details a brand-new driver supplies while accepting. */
export interface DriverIdentityInput {
  legalName: string;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
  phone?: string;
}

export interface AcceptOptions {
  /**
   * Supplied only when the accepter is a driver with no profile yet.
   *
   * A person who ALREADY has a profile never reaches this: their existing
   * record is the answer and anything typed here is ignored, because a resume
   * must never overwrite a licence on file.
   */
  driverIdentity?: DriverIdentityInput;
}

/**
 * ★ ACCEPTING, ONCE, AS THE PERSON IT WAS ADDRESSED TO ★
 *
 * IDEMPOTENT on the invitation. A retry, a double-click, a link opened in two
 * tabs, or a resume after something later in the sequence failed all converge
 * on ONE seat, ONE profile, ONE engagement and ONE audit entry. Three separate
 * idempotencies carry that, and none of them is this function's: the seat's is
 * `grantMembership`'s, the profile's is `createOrResumeProfile`'s and the
 * engagement's is `createOrResumeRelationship`'s. This function adds only the
 * fourth — it stamps the invitation once and reads it back afterwards.
 *
 * ORDER MATTERS. The profile comes first, because a seat that pointed at a
 * profile which then failed to exist would be a driver membership with no
 * driver. The invitation is stamped LAST, so a failure part-way through leaves
 * the invitation open and the whole thing safely repeatable.
 */
export async function acceptInvitation(
  token: string,
  identity: AcceptingIdentity,
  options: AcceptOptions = {},
): Promise<AcceptInvitationResult> {
  const resolution = await resolveInvitation(token, identity);

  if (resolution.status === "refused") {
    return { status: "refused", refusal: resolution.refusal, message: resolution.message };
  }

  const invitation = invitationByToken(token)!;
  const organization = organizationById(invitation.organizationId)!;

  if (resolution.status === "already_accepted") {
    const replay = replayOutcome(invitation, identity, organization);
    return replay
      ? { status: "already_accepted", outcome: replay }
      : { status: "refused", refusal: "not_found", ...refusal("not_found") };
  }

  const isDriver = invitation.kind === "driver";
  const existingProfile = isDriver ? profileForUser(identity.userId) : undefined;

  if (isDriver && !existingProfile && !options.driverIdentity) {
    return {
      status: "refused", refusal: "needs_driver_profile",
      ...refusal("needs_driver_profile"),
    };
  }

  /* --- from here, nothing awaits ---------------------------------------- */

  const at = nowIso();

  /* 1 · The person. Reused when they have one, created when they do not, and
   *     never duplicated: `createOrResumeProfile` is keyed on the account and
   *     resumes first, always. */
  let driverProfileId: string | undefined;
  let driverProfileResumed: boolean | undefined;
  if (isDriver) {
    const source = options.driverIdentity;
    const result = createOrResumeProfile({
      userId: identity.userId,
      legalName: existingProfile?.legalName ?? source!.legalName,
      email: identity.email,
      phone: source?.phone,
      cdlNumber: existingProfile?.cdlNumber ?? source!.cdlNumber,
      cdlState: existingProfile?.cdlState ?? source!.cdlState,
      cdlExpiresAt: existingProfile?.cdlExpiresAt ?? source!.cdlExpiresAt,
    });
    driverProfileId = result.profile.id;
    driverProfileResumed = result.resumed;
  }

  /* 2 · The seat. Permissions are the invitation's snapshot — already clamped
   *     at issue time to what the sender could grant — and `effectivePermissions`
   *     turns them into a permission set exactly as it does for a seeded seat. */
  const membership: Membership = {
    id: nextAccessId("mem"),
    userId: identity.userId,
    organizationId: organization.id,
    status: "active",
    title: invitation.roleName,
    templateIds: [],
    grants: [...invitation.permissions],
    revocations: [],
    scope: isDriver ? OWN_RECORDS_SCOPE : DEFAULT_SCOPE,
    driverProfileId,
    isOwner: false,
    joinedAt: at,
  };
  const granted = grantMembership({
    scenario: identity.scenario,
    membership,
    organization,
  });
  const seat = granted.membership;
  const created = granted.status === "granted";

  /* 3 · The engagement, for a driver. `acceptedAt` and NO `startedAt`. */
  const share = isDriver
    ? documentShareDecision(invitation)
    : { shared: [] as string[], withheld: [] as string[] };

  let relationship;
  if (isDriver && driverProfileId) {
    const outcome = createOrResumeRelationship({
      driverProfileId,
      carrierId: organization.id,
      carrierName: organization.displayName,
      engagementType: invitation.engagementType ?? "company_driver",
      roleName: invitation.roleName,
      permissions: invitation.permissions,
      sharedDocumentKeys: share.shared,
      // The carrier offered on the invitation's OWN date, not today.
      invitedAt: invitation.createdAt,
      acceptedAt: at,
    });
    relationship = outcome.relationship;
  }

  /* 4 · Stamp the invitation. Last, so a failure above leaves it repeatable. */
  patchInvitation(invitation.id, {
    status: "accepted",
    acceptedAt: at,
    acceptedByUserId: identity.userId,
    acceptedMembershipId: seat.id,
  });

  /* 5 · The record. In the joining organization's ledger, because it is their
   *     roster that changed — written as the person who joined, which is what
   *     the actor on the event is for. */
  const ctx = acceptanceContext(seat, organization, identity);
  if (created) {
    appendAuditEvent(ctx, {
      module: "access",
      action: "access.member_joined",
      entity: { kind: "membership", id: seat.id, label: identity.displayName },
      relatedEntities: [
        { kind: "invitation", id: invitation.id, label: invitation.roleName },
        { kind: "user", id: identity.userId, label: identity.displayName },
      ],
      summary: `${identity.displayName} accepted the invitation and joined as ${invitation.roleName}.`,
      changes: [
        { field: "role", before: null, after: invitation.roleName },
        { field: "permissionCount", before: null, after: invitation.permissions.length },
      ],
    });

    if (relationship) {
      appendAuditEvent(ctx, {
        module: "workforce",
        action: "workforce.engagement_created",
        entity: {
          kind: "workforce_engagement", id: relationship.id, label: identity.displayName,
        },
        relatedEntities: [
          { kind: "driver", id: relationship.driverProfileId, label: identity.displayName },
        ],
        summary:
          `${identity.displayName} accepted a ${invitation.engagementType === "owner_operator" ? "owner-operator" : "company driver"} engagement. `
          + "Accepted, not yet started — no start date has been recorded.",
        changes: [
          { field: "status", before: null, after: relationship.status },
          { field: "acceptedAt", before: null, after: relationship.acceptedAt ?? null },
          // Recorded as absent ON PURPOSE. Somebody reading this later should
          // be able to see that no start date was invented, not merely that
          // none is there.
          { field: "startedAt", before: null, after: null },
          { field: "documentsShared", before: null, after: share.shared.length },
          { field: "documentsWithheldAsRestricted", before: null, after: share.withheld.length },
        ],
      });
    }
  }

  return {
    status: "accepted",
    outcome: {
      invitation: { ...invitationByToken(token)! },
      membership: seat,
      relationship,
      driverProfileId,
      driverProfileResumed,
      sharedDocumentKeys: share.shared,
      withheldDocumentKeys: share.withheld,
      created,
    },
  };
}

/**
 * ★ WHAT ACCEPTING HANDS OVER, AND WHAT IT NEVER DOES ★
 *
 * The required, ORDINARY paperwork on this carrier's checklist. Not the
 * optional rows — "optional" means the person may choose, and a bulk consent
 * that swept them in would be choosing for them. And not, under any
 * circumstances, a restricted category: a social security number, bank
 * details, a state driving record, a substance-testing record. Access to one of
 * those is its own decision, per document, for a stated reason, by somebody
 * holding the permission for it — never a side effect of somebody joining.
 *
 * The withheld list is returned rather than dropped so the screen can SAY what
 * was held back. A shorter list than the checklist it just showed, with no
 * explanation, is how people conclude the product lost their paperwork.
 */
function documentShareDecision(invitation: Invitation): { shared: string[]; withheld: string[] } {
  const requirements = documentRequirements(
    invitation.engagementType ?? "company_driver",
    invitation.organizationId,
  );
  const { restricted } = splitByRestriction(requirements);
  return {
    shared: ordinaryDocumentKeys(requirements),
    withheld: restricted.map((r) => r.key),
  };
}

/** Rebuilds the outcome of an acceptance that already happened. Writes nothing. */
function replayOutcome(
  invitation: Invitation,
  identity: AcceptingIdentity,
  organization: Organization,
): AcceptanceOutcome | undefined {
  const seat = liveMembershipFor(identity.scenario, identity.userId, organization.id);
  if (!seat) return undefined;
  const profile = profileForUser(identity.userId);
  const relationship = profile
    ? relationshipsForProfile(profile.id).find(
      (r) => r.carrierId === organization.id && r.status !== "ended",
    )
    : undefined;
  const share = invitation.kind === "driver"
    ? documentShareDecision(invitation)
    : { shared: [], withheld: [] };
  return {
    invitation: { ...invitation },
    membership: seat,
    relationship,
    driverProfileId: relationship ? profile?.id : undefined,
    driverProfileResumed: true,
    sharedDocumentKeys: relationship?.sharedDocumentKeys ?? share.shared,
    withheldDocumentKeys: share.withheld,
    created: false,
  };
}

/**
 * The context the acceptance is recorded under.
 *
 * Built from the seat that was just created, in the organization that was just
 * joined — which is the honest answer to "as whom?". It is not a back door:
 * `appendAuditEvent` requires no permission by design (a service that needed
 * one to write down a refusal would lose exactly the events somebody came
 * looking for), and nothing else in this module reads a permission off it.
 */
function acceptanceContext(
  membership: Membership,
  organization: Organization,
  identity: AcceptingIdentity,
): ServiceContext {
  return {
    organizationId: organization.id,
    organizationName: organization.displayName,
    workspaceKind: workspaceKindOf(organization),
    membershipId: membership.id,
    permissions: effectivePermissions(membership, organization, MOCK_TEMPLATES),
    scope: membership.scope,
    driverProfileId: membership.driverProfileId,
    actor: {
      userId: identity.userId,
      membershipId: membership.id,
      displayNameSnapshot: identity.displayName,
      source: "web",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Ending a seat                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Ends somebody's access to this organization.
 *
 * ★ ENDS ACCESS, AND NOTHING ELSE ★
 * Not the person, not their `DriverProfile`, not the documents they own, not
 * their seat anywhere else, and NOT the working relationship — a driver whose
 * portal access is removed may still be this carrier's driver, and deciding
 * otherwise is Workforce's call through `endCarrierRelationship`, made
 * deliberately rather than as a side effect of a click on an access screen.
 *
 * IDEMPOTENT. Ending a seat that is already gone answers `already_ended` and
 * changes nothing.
 *
 * Refuses to remove the last owner: a workspace nobody can administer is not a
 * state anybody chose, and it cannot be undone from inside the product.
 */
export async function endSeat(
  ctx: ServiceContext,
  membershipId: string,
  reason: string,
): Promise<EndSeatResult> {
  await wait();
  if (!ctx.permissions.has("members:suspend")) {
    recordPermissionDenied(ctx, {
      required: ["members:suspend"],
      entity: { kind: "membership", id: membershipId, label: membershipId },
      summary: "Refused to end a seat: no permission to remove members.",
    });
    return {
      status: "refused", refusal: "not_permitted",
      message: "You do not have permission to remove people from this organization.",
    };
  }

  const roster = rosterOf(ctx.organizationId);
  const seat = roster.find((m) => m.id === membershipId);
  if (!seat) {
    // Already gone, or never here. Both are "nothing left to do".
    return { status: "already_ended" };
  }
  if (seat.isOwner && roster.filter((m) => m.isOwner).length === 1) {
    return {
      status: "refused", refusal: "last_owner",
      message: "This is the only owner. Make somebody else an owner first.",
    };
  }

  setMembershipStatus(scenarioOf(seat), membershipId, "left");

  appendAuditEvent(ctx, {
    module: "access",
    action: "access.permission_revoked",
    sourceAction: "access.seat_ended",
    entity: { kind: "membership", id: seat.id, label: seat.title ?? seat.userId },
    relatedEntities: [{ kind: "user", id: seat.userId, label: seat.userId }],
    summary: `Ended access for ${seat.title ?? seat.userId}. ${reason}`,
    changes: [{ field: "status", before: seat.status, after: "left" }],
  });

  return { status: "ended", membership: { ...seat, status: "left" } };
}

/**
 * ★ LEAVING IS NOT THE SAME COMMAND AS BEING REMOVED ★
 *
 * Ending somebody else's access needs `members:suspend`, because it is power
 * over another person. Ending your OWN needs nothing: a workspace you cannot
 * walk out of is not a workspace you agreed to be in, and requiring a
 * permission to leave would mean an organization could grant you a seat you
 * could never put down.
 *
 * Everything else is identical to `endSeat`, including the last-owner refusal —
 * leaving a workspace with nobody who can administer it cannot be undone from
 * inside the product, so it is refused whether you are removing yourself or
 * somebody else.
 */
export async function leaveOrganization(
  ctx: ServiceContext,
  reason = "Left the organization.",
): Promise<EndSeatResult> {
  await wait();

  const roster = rosterOf(ctx.organizationId);
  const seat = roster.find((m) => m.id === ctx.membershipId);
  if (!seat) return { status: "already_ended" };

  if (seat.isOwner && roster.filter((m) => m.isOwner).length === 1) {
    return {
      status: "refused", refusal: "last_owner",
      message: "You are the only owner. Make somebody else an owner before you leave.",
    };
  }

  setMembershipStatus(scenarioOf(seat), seat.id, "left");

  appendAuditEvent(ctx, {
    module: "access",
    action: "access.permission_revoked",
    sourceAction: "access.seat_left",
    entity: { kind: "membership", id: seat.id, label: ctx.actor.displayNameSnapshot },
    summary: `${ctx.actor.displayNameSnapshot} left ${ctx.organizationName}. ${reason}`,
    changes: [{ field: "status", before: seat.status, after: "left" }],
  });

  return { status: "ended", membership: { ...seat, status: "left" } };
}

/* -------------------------------------------------------------------------- */
/* Roster reads                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Who is in this organization, across both fixture rosters.
 *
 * ★ THERE IS NO SECOND ROSTER ★
 * This reads the membership store PR-1 built and nothing else. It exists
 * because the store is keyed by scenario — one tab is one person — while an
 * organization's member list is a fact about the organization, not about whose
 * tab is open. Merging the two scenario rosters here is a MOCK artefact of one
 * browser session holding one signed-in user; a real backend has one roster and
 * this function is a `WHERE organization_id = ?`.
 */
export function rosterOf(organizationId: string): Membership[] {
  const seen = new Set<string>();
  const out: Membership[] = [];
  for (const scenario of ["demo", "newcomer"] as const) {
    for (const m of rosterFor(scenario)) {
      if (m.organizationId !== organizationId) continue;
      if (m.status === "left") continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

function rosterFor(scenario: "demo" | "newcomer"): readonly Membership[] {
  // Read through the store's own accessor, so this module keeps no copy of the
  // roster and cannot drift from it.
  return rosterSnapshot(scenario).memberships;
}

/** Which scenario roster a seat lives in. */
function scenarioOf(seat: Membership): "demo" | "newcomer" {
  return rosterFor("newcomer").some((m) => m.id === seat.id) ? "newcomer" : "demo";
}

export function invitationsUnscopedForTests(): readonly Invitation[] {
  return allInvitations();
}

export function accountDirectoryLookup(email: string): User | undefined {
  return accountForEmail(email);
}

/** The person behind a seat. A lookup by id, never a search. */
export function accountOfSeat(userId: string): User | undefined {
  return accountById(userId);
}

export function permissionsOfSeat(
  membership: Membership,
  organization: Organization,
): ReadonlySet<PermissionKey> {
  return effectivePermissions(membership, organization, MOCK_TEMPLATES);
}
