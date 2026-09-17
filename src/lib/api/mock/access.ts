import {
  ACCEPTANCE_LIMITATION, RESTRICTED_QUALIFICATION_CATEGORIES,
  QUALIFICATION_CATEGORY_LABEL, acceptanceComplete,
  type AcceptanceRun, type AcceptanceStep, type AcceptanceStepKey,
  type Invitation, type PermissionKey,
} from "@/types";
import { OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import { driverRequirements } from "@/lib/documents/requirements";
import { MOCK_ORGANIZATIONS, MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import { grantMembership, liveMembershipFor } from "@/lib/session/membership-store";
import { isNewcomerSession } from "@/lib/session/scenarios";
import {
  createOrResumeProfile, profileForUser,
} from "./driver-registry";
import {
  liveRelationshipWith, mockCreateRelationship,
} from "@/features/driver/mock-driver";
import { appendAuditEvent } from "./audit";
import {
  ensureSeeded, invitationByToken, invitationById, invitationsForOrganization,
  nextInvitationId, nextInvitationToken, openInvitationFor, putInvitation, putRun,
  runFor, runsForInvitation,
} from "./access-store";
import { seedInvitations } from "./access-seed";
import { linkDriverProfileToEngagement } from "./workforce";
import { nowIso } from "./time";
import type { ServiceContext } from "../contracts/context";
import { PermissionDeniedError } from "../contracts/context";
import type {
  AcceptInput, AcceptancePreview, AccessService, InvitationDraft,
  InvitationLookup, LookUpOptions,
} from "../contracts/access";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Invitations, and what accepting one actually does.
 *
 * ★ THE SHAPE THAT MATTERS ★
 * Acceptance is a SEQUENCE of calls into modules that own their own records,
 * and this file makes none of those records itself. Read `runSteps` below: the
 * driver registry creates the profile, the driver module creates the
 * relationship, the document store adds links, the membership store grants the
 * seat, Workforce links its own engagement. This module records which of those
 * happened.
 *
 * ★ WHY A RUN, AND NOT A STATUS ★
 * There is no transaction across those five. The seat can fail after the
 * relationship succeeded. So the invitation's `accepted` status is a projection
 * of a COMPLETED run rather than a flag written first — because a flag written
 * first is what answers a returning person with "somebody has already accepted
 * this" and locks them out of finishing their own acceptance.
 *
 * ★ WHAT IS NEVER GRANTED ★
 * Every restricted qualification category. Not by a check inside a loop: the
 * only document keys that can travel are the ones the DRIVER passed in, and the
 * preview lists the withheld categories by name so the screen can say out loud
 * what is not included. A carrier that wants a drug and alcohol record asks for
 * it under its own purpose-bound basis, and acceptance is not one.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 260;

function db(): void {
  ensureSeeded(seedInvitations);
}

function required(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/** The signed-in person. From the session boundary, never a literal. */
function currentUser() {
  return isNewcomerSession() ? NEWCOMER_USER : MOCK_USER;
}

/* -------------------------------------------------------------------------- */
/* Status, projected                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What an invitation reads as right now.
 *
 * `accepted` is DERIVED from a completed run; `revoked` and `expired` are the
 * sender's own stored decisions. A run that started and did not finish leaves
 * the invitation `pending`, which is what keeps the door open for its owner.
 */
function projected(invitation: Invitation): Invitation {
  if (invitation.status === "revoked") return invitation;

  const completed = runsForInvitation(invitation.id).find((r) => r.completedAt);
  if (completed) {
    return { ...invitation, status: "accepted", acceptedAt: completed.acceptedAt };
  }
  const expired = invitation.status === "expired"
    || (invitation.expiresAt !== null && new Date(invitation.expiresAt) < new Date());
  return { ...invitation, status: expired ? "expired" : "pending", acceptedAt: undefined };
}

/* -------------------------------------------------------------------------- */
/* What acceptance would do                                                    */
/* -------------------------------------------------------------------------- */

const withheldCategoryLabels = () =>
  RESTRICTED_QUALIFICATION_CATEGORIES.map((c) => QUALIFICATION_CATEGORY_LABEL[c]);

/**
 * The seat a driver invitation produces.
 *
 * The invitation's OWN snapshot, narrowed further by what a driver seat may
 * ever carry. Two ceilings, and the second is the one that matters: an
 * invitation is written by a person who could hand out more than this, so
 * trusting its list alone would let a mis-typed invite open the workspace.
 *
 * Nothing here widens anything — it only ever removes.
 */
const DRIVER_SEAT_CEILING: readonly PermissionKey[] = [
  "loads:view", "loads:status:update",
  "documents:view", "documents:upload",
  "settlements:view",
  "proposals:view", "proposals:respond", "trips:execute",
];

function driverSeatPermissions(invitation: Invitation): PermissionKey[] {
  if (invitation.kind !== "driver") return [...invitation.permissions];
  const ceiling = new Set<PermissionKey>(DRIVER_SEAT_CEILING);
  return invitation.permissions.filter((k) => ceiling.has(k));
}

/* -------------------------------------------------------------------------- */
/* The steps                                                                   */
/* -------------------------------------------------------------------------- */

const step = (
  key: AcceptanceStepKey,
  state: AcceptanceStep["state"],
  detail: string,
  ref?: AcceptanceStep["ref"],
  failureReason?: string,
): AcceptanceStep => ({ key, state, detail, ref, failureReason });

interface StepContext {
  invitation: Invitation;
  userId: string;
  input: AcceptInput;
}

/**
 * Runs every step that is not already done, in an order where each prefix is a
 * safe place to stop.
 *
 * The seat is LAST on purpose. Stopping after the relationship leaves somebody
 * with an agreed relationship and no portal — visible, recoverable, and fixed
 * by accepting again. The reverse order would leave a seat with nothing behind
 * it, which looks finished and is not.
 */
async function runSteps(ctx: StepContext, previous?: AcceptanceRun): Promise<AcceptanceRun> {
  const done = new Map((previous?.steps ?? []).map((s) => [s.key, s]));
  const keep = (key: AcceptanceStepKey) => {
    const s = done.get(key);
    return s && (s.state === "done" || s.state === "not_applicable") ? s : undefined;
  };

  const steps: AcceptanceStep[] = [];
  const { invitation, userId, input } = ctx;

  /* ---- 1. The person's own permanent profile --------------------------- */
  let driverProfileId: string | undefined;
  const keptProfile = keep("driver_profile");
  if (keptProfile) {
    steps.push(keptProfile);
    driverProfileId = keptProfile.ref?.id;
  } else if (invitation.kind !== "driver") {
    steps.push(step("driver_profile", "not_applicable",
      "This invitation is not a driving one, so no driver profile is involved."));
  } else {
    const existing = profileForUser(userId);
    if (existing) {
      driverProfileId = existing.id;
      steps.push(step("driver_profile", "done",
        "You already had a driver profile, so it was used. You are never asked for your licence twice.",
        { kind: "driver_profile", id: existing.id }));
    } else if (!input.licence) {
      steps.push(step("driver_profile", "failed",
        "A driver profile is needed before a carrier can be connected.",
        undefined, "No licence details were supplied."));
    } else {
      const { profile } = createOrResumeProfile({ userId, ...input.licence, email: currentUser().email });
      driverProfileId = profile.id;
      steps.push(step("driver_profile", "done",
        "Your permanent driver profile was created. It belongs to you and follows you between carriers.",
        { kind: "driver_profile", id: profile.id }));
    }
  }

  /* ---- 2. The relationship. Created as onboarding, with NO start date --- */
  const keptRelationship = keep("carrier_relationship");
  if (keptRelationship) {
    steps.push(keptRelationship);
  } else if (!driverProfileId) {
    steps.push(step("carrier_relationship", "pending",
      "Waiting on your driver profile.", undefined, "The driver profile step did not finish."));
  } else {
    const before = liveRelationshipWith(driverProfileId, invitation.organizationId);
    const relationship = await mockCreateRelationship(driverProfileId, {
      carrierId: invitation.organizationId,
      carrierName: invitation.organizationName,
      engagementType: invitation.engagementType ?? "company_driver",
      roleName: invitation.roleName,
      permissions: invitation.permissions,
      sharedDocumentKeys: input.sharedDocumentKeys,
      invitedAt: invitation.createdAt,
    });
    steps.push(step("carrier_relationship", "done",
      before
        ? `You were already connected to ${invitation.organizationName}. Nothing was duplicated and no date was changed.`
        : `You are connected to ${invitation.organizationName}. They have not started you yet — that is their step, not this one.`,
      { kind: "carrier_relationship", id: relationship.id }));
  }

  /* ---- 3. Ordinary document access. Links, never copies ---------------- */
  const keptDocuments = keep("document_access");
  if (keptDocuments) {
    steps.push(keptDocuments);
  } else if (input.sharedDocumentKeys.length === 0) {
    steps.push(step("document_access", "done",
      "You shared nothing yet. You can share documents from your own file whenever you choose."));
  } else {
    // Performed by `mockCreateRelationship` above, through the document store's
    // own `addLink`. Recorded here so the person can see it happened and see
    // what it did NOT include.
    steps.push(step("document_access", "done",
      `${invitation.organizationName} can now see ${input.sharedDocumentKeys.length} of your documents. `
      + "Each is the same record you own, linked — not a copy — and their review is theirs, not yours."));
  }

  /* ---- 4. The seat. Last, because it is the recoverable one ------------ */
  const keptSeat = keep("workspace_membership");
  if (keptSeat) {
    steps.push(keptSeat);
  } else {
    const organization = MOCK_ORGANIZATIONS.find((o) => o.id === invitation.organizationId);
    if (!organization) {
      steps.push(step("workspace_membership", "failed",
        "A portal seat could not be created.",
        undefined, `Antcolos has no record of the organization ${invitation.organizationId}.`));
    } else {
      const scenario = isNewcomerSession() ? "newcomer" : "demo";
      const held = liveMembershipFor(scenario, userId, invitation.organizationId);
      const result = grantMembership({
        scenario,
        membership: held ?? {
          id: `mem_${invitation.id}_${userId}`,
          userId,
          organizationId: invitation.organizationId,
          status: "active",
          title: invitation.roleName,
          templateIds: [],
          // The invitation's own snapshot, clamped. Not a template, not an
          // owner seat, and nothing this module chose.
          grants: driverSeatPermissions(invitation),
          revocations: [],
          scope: OWN_RECORDS_SCOPE,
          driverProfileId,
          isOwner: false,
          joinedAt: nowIso(),
        },
        organization,
      });
      steps.push(step("workspace_membership", "done",
        result.status === "already_held"
          ? "You already had access to this workspace."
          : "Your driver portal is open. It shows your loads, your paperwork and your pay — and nothing else about this company.",
        { kind: "membership", id: result.membership.id }));
    }
  }

  /* ---- 5. The carrier's existing record of this person ----------------- */
  const keptLink = keep("engagement_link");
  if (keptLink) {
    steps.push(keptLink);
  } else if (!invitation.engagementId) {
    steps.push(step("engagement_link", "not_applicable",
      "This carrier had no earlier record of you to connect."));
  } else if (!driverProfileId) {
    steps.push(step("engagement_link", "pending",
      "Waiting on your driver profile.", undefined, "The driver profile step did not finish."));
  } else {
    const linked = linkDriverProfileToEngagement(
      invitation.engagementId, driverProfileId, invitation.organizationId,
    );
    steps.push(linked
      ? step("engagement_link", "done",
        "The record this carrier already had of you is now connected to your profile. "
        + "Their start date is theirs and was not changed.",
        { kind: "workforce_engagement", id: invitation.engagementId })
      : step("engagement_link", "failed",
        "The record this carrier had of you could not be connected.",
        undefined, "No matching engagement was found in this organization."));
  }

  const run: AcceptanceRun = {
    invitationId: invitation.id,
    userId,
    acceptedAt: previous?.acceptedAt ?? nowIso(),
    steps,
  };
  if (acceptanceComplete(run)) run.completedAt = nowIso();
  return putRun(run);
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockAccessService: AccessService = {
  async list(ctx) {
    await sleep(LATENCY_MS);
    required(ctx, "invitations:view");
    db();
    return invitationsForOrganization(ctx.organizationId).map(projected);
  },

  async create(ctx, draft: InvitationDraft) {
    await sleep(LATENCY_MS);
    required(ctx, "invitations:create");
    db();

    const email = draft.recipientEmail.trim().toLowerCase();
    // The frontend stand-in for a unique constraint. Two open invitations to
    // one person is two working links, and whichever is accepted second is how
    // a duplicate relationship gets made.
    const open = openInvitationFor(ctx.organizationId, email);
    if (open) return projected(open);

    const invitation: Invitation = {
      id: nextInvitationId(),
      token: nextInvitationToken(),
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      organizationType: ctx.workspaceKind === "carrier_organization" ? "CARRIER" : "DISPATCH_AGENCY",
      kind: draft.kind,
      roleName: draft.roleName,
      customRoleId: draft.customRoleId,
      engagementType: draft.engagementType,
      recipientName: draft.recipientName.trim(),
      recipientEmail: email,
      permissions: [...draft.permissions],
      scopedToCarrierName: draft.scopedToCarrierName,
      engagementId: draft.engagementId,
      expiresAt: draft.expiresAt,
      createdAt: nowIso(),
      status: "pending",
      recipientHasAccount: false,
    };
    putInvitation(invitation);
    audit(ctx, "access.member_invited", invitation,
      `${invitation.recipientName} invited as ${invitation.roleName}`);
    return projected(invitation);
  },

  async revoke(ctx, invitationId) {
    await sleep(LATENCY_MS);
    required(ctx, "invitations:revoke");
    const invitation = own(ctx, invitationId);
    const updated = putInvitation({ ...invitation, status: "revoked" });
    audit(ctx, "access.permission_revoked", updated,
      `Invitation to ${updated.recipientName} revoked`);
    return projected(updated);
  },

  async resend(ctx, invitationId) {
    await sleep(LATENCY_MS);
    required(ctx, "invitations:resend");
    const invitation = own(ctx, invitationId);

    // ★ THE ONE THAT USED TO CREATE DUPLICATES ★
    // Re-opening an accepted invitation made its link work again, and accepting
    // it a second time produced a second relationship with the same carrier.
    if (projected(invitation).status === "accepted") {
      throw new Error(
        `${invitation.recipientName} has already accepted this invitation. `
        + "Re-sending it would let them accept a second time; invite them again only if "
        + "the relationship has ended.",
      );
    }

    const d = new Date();
    d.setDate(d.getDate() + 7);
    const updated = putInvitation({
      ...invitation, status: "pending", expiresAt: d.toISOString(), createdAt: nowIso(),
    });
    return projected(updated);
  },

  async lookUp(token, options) {
    await sleep(LATENCY_MS);
    db();
    return resolve(token, options);
  },

  async preview(token, options) {
    await sleep(LATENCY_MS);
    db();
    const lookup = resolve(token, options);
    if (lookup.status !== "valid" && lookup.status !== "resume") return null;
    const invitation = lookup.invitation;
    const requirements = invitation.kind === "driver"
      ? driverRequirements(invitation.engagementType ?? "company_driver")
        .filter((r) => r.applicability === "required")
      : [];
    const preview: AcceptancePreview = {
      invitation,
      permissions: driverSeatPermissions(invitation),
      sharedDocumentKeys: requirements.map((r) => r.key),
      withheldCategories: withheldCategoryLabels(),
      connectsExistingEngagement: Boolean(invitation.engagementId),
      assertedStartDate: undefined,
      limitation: ACCEPTANCE_LIMITATION,
    };
    return preview;
  },

  async accept(token, options, input: AcceptInput) {
    await sleep(LATENCY_MS);
    db();
    const lookup = resolve(token, options);
    if (lookup.status !== "valid" && lookup.status !== "resume") {
      return { status: "not-acceptable", lookup };
    }
    const invitation = lookup.invitation;
    const userId = currentUser().id;

    if (invitation.kind === "driver" && !profileForUser(userId) && !input.licence) {
      return { status: "licence-required" };
    }

    const previous = runFor(invitation.id, userId);
    const run = await runSteps({ invitation, userId, input }, previous);
    if (run.completedAt) {
      auditJoined(invitation, userId);
      return { status: "accepted", run };
    }
    return { status: "incomplete", run };
  },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function own(ctx: ServiceContext, invitationId: string): Invitation {
  db();
  const invitation = invitationById(invitationId);
  // An invitation from another organization and one that does not exist answer
  // identically. A6's rule: naming an organization on a record is attribution.
  if (!invitation || invitation.organizationId !== ctx.organizationId) {
    throw new Error(`No such invitation: ${invitationId}`);
  }
  return invitation;
}

/**
 * Resolving a link, in the order the answers actually matter.
 *
 * `resume` comes BEFORE `used`, and only for the person whose run it is. An
 * incomplete run belonging to somebody else still reads `used`, so a re-sent
 * link cannot be finished by the wrong account.
 */
function resolve(token: string, options: LookUpOptions): InvitationLookup {
  const stored = invitationByToken(token);
  if (!stored) return { status: "not-found" };

  const invitation = projected(stored);
  if (invitation.status === "revoked") return { status: "revoked", invitation };

  const userId = currentUser().id;
  const signedInAs = options.returningFromAuth
    ? invitation.recipientEmail
    : invitation.recipientHasAccount
      ? currentUser().email
      : null;

  const mine = runFor(invitation.id, userId);
  if (mine && !mine.completedAt && signedInAs
    && signedInAs.toLowerCase() === invitation.recipientEmail.toLowerCase()) {
    return { status: "resume", invitation, signedInAs, run: mine };
  }

  if (invitation.status === "accepted") return { status: "used", invitation };
  if (invitation.status === "expired") return { status: "expired", invitation };
  if (signedInAs === null) return { status: "needs-account", invitation };
  if (signedInAs.toLowerCase() !== invitation.recipientEmail.toLowerCase()) {
    return { status: "wrong-recipient", invitation, signedInAs };
  }
  return { status: "valid", invitation, signedInAs };
}

function audit(
  ctx: ServiceContext,
  action: "access.member_invited" | "access.permission_revoked",
  invitation: Invitation,
  summary: string,
) {
  try {
    appendAuditEvent(ctx, {
      module: "access",
      action,
      sourceAction: action,
      entity: {
        kind: "invitation",
        id: invitation.id,
        label: `${invitation.recipientName} · ${invitation.roleName}`,
      },
      summary,
    });
  } catch {
    // An audit failure must not take the command with it.
  }
}

/**
 * The observed acceptance, in the one ledger.
 *
 * Recorded against the organization that sent the invitation, because that is
 * whose record it is. The actor is the person accepting — they have no seat in
 * that organization until this very sequence gives them one, which is why the
 * context is assembled here rather than taken from a caller.
 */
function auditJoined(invitation: Invitation, userId: string) {
  const user = currentUser();
  try {
    appendAuditEvent({
      organizationId: invitation.organizationId,
      organizationName: invitation.organizationName,
      workspaceKind: invitation.organizationType === "CARRIER"
        ? "carrier_organization" : "dispatch_organization",
      membershipId: `mem_${invitation.id}_${userId}`,
      permissions: new Set<PermissionKey>(),
      scope: OWN_RECORDS_SCOPE,
      actor: {
        userId,
        membershipId: `mem_${invitation.id}_${userId}`,
        displayNameSnapshot: user.displayName,
        source: "web",
      },
    }, {
      module: "access",
      action: "access.member_joined",
      sourceAction: "access.member_joined",
      entity: {
        kind: "invitation",
        id: invitation.id,
        label: `${invitation.recipientName} · ${invitation.roleName}`,
      },
      // The observed moment, and only ever this. Not a relationship start date.
      summary: `${invitation.recipientName} accepted their invitation`,
    });
  } catch {
    // As above.
  }
}
