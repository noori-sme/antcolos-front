import {
  ACCEPTANCE_LIMITATION, ACCEPTANCE_STEP_LABEL, RESTRICTED_QUALIFICATION_CATEGORIES,
  QUALIFICATION_CATEGORY_LABEL, acceptanceComplete,
  type AcceptanceRun, type AcceptanceStep, type AcceptanceStepKey,
  type Invitation, type Membership, type Organization, type PermissionKey, type User,
} from "@/types";
import { OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import { clampToGrantable, ungrantablePermissions } from "@/lib/permissions/grantable";
import { driverRequirements } from "@/lib/documents/requirements";
import { restrictedReason } from "@/lib/documents/catalog";
import { MOCK_ORGANIZATIONS, MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import {
  grantMembership, liveMembershipFor, rosterSnapshot, setMembershipStatus,
} from "@/lib/session/membership-store";
import { effectivePermissions } from "@/lib/permissions";
import { MOCK_TEMPLATES } from "@/lib/session/fixtures";
import { isNewcomerSession } from "@/lib/session/scenarios";
import {
  createOrResumeProfile, profileForUser,
} from "./driver-registry";
import {
  documentRequirements, liveRelationshipWith, mockCreateRelationship,
  mockShareDocumentsWithCarrier,
} from "@/features/driver/mock-driver";
import { appendAuditEvent } from "./audit";
import {
  accountById, accountForEmail, ensureSeeded, invitationByToken, invitationById,
  invitationsForOrganization,
  nextInvitationId, nextInvitationToken, openInvitationFor, putInvitation, putRun,
  runFor, runsForInvitation, withJoinedAudit,
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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  withheld?: AcceptanceStep["withheld"],
): AcceptanceStep => ({ key, state, detail, ref, failureReason, withheld });

interface StepContext {
  invitation: Invitation;
  userId: string;
  input: AcceptInput;
}

/**
 * ███ TEST SEAM — NEVER SET BY THE PRODUCT ███
 *
 * Makes one named step fail, so that interruption at each of the five points
 * can be proved rather than argued about. There is no other way to reach the
 * "the relationship succeeded and the seat did not" state on demand, and that
 * is precisely the state worth testing: it is the one where somebody could end
 * up with access to a workspace they are not connected to.
 *
 * Nothing in `src/features` or `src/app` calls this, and a fault is cleared by
 * resetting it to null — which the test helper does in `beforeEach`.
 */
let faultAt: AcceptanceStepKey | null = null;
let faultAtJoinedAudit = false;

const FAULT_REASON =
  "Injected failure (test only). In a real system this is where a network "
  + "call, a lock or a constraint would have refused.";

/**
 * Inert anywhere a browser exists.
 *
 * `window` is undefined in the two test runners (both configured
 * `environment: "node"`) and defined in every browser, including a devtools
 * console on a production build. So this seam cannot be armed from a page even
 * by somebody who found the symbol and called it.
 *
 * That is defence in depth and NOT a security property, and it would be
 * dishonest to present it as one: the entire mock runs in the browser, so
 * anybody able to call this could equally call `grantMembership` directly. The
 * reason a fault seam is not an escalation here is that there is no backend
 * behind any of it. The gate exists so the seam cannot be armed by accident —
 * by a stray import, a story, or a copied line — in the one place a real
 * person's session runs.
 */
const SEAM_AVAILABLE = typeof window === "undefined";

export function failAcceptanceStepForTests(key: AcceptanceStepKey | null): void {
  if (!SEAM_AVAILABLE) return;
  faultAt = key;
}

/**
 * The narrow window in step 6: the run is finished and the ledger refuses.
 *
 * Separate from the step seam because writing the audit line is not one of the
 * five steps — it is what makes the run count as complete.
 */
export function failJoinedAuditForTests(on: boolean): void {
  if (!SEAM_AVAILABLE) return;
  faultAtJoinedAudit = on;
}

/**
 * Runs every step that is not already done, in an order where each prefix is a
 * safe place to stop.
 *
 * ★ THE ACTUAL ORDER, WHICH IS THE ORDER IN THIS FUNCTION ★
 *   1  driver_profile        the person's own permanent profile
 *   2  carrier_relationship  the connection, as `onboarding`, with no start date
 *   3  document_access       the links the carrier reads through
 *   4  engagement_link       the carrier's existing record of this person
 *   5  workspace_membership  the seat
 *
 * The seat is last, and this comment used to say so while the code ran it
 * fourth. Everything before it is a record; the seat is the key to the door.
 * Stopping anywhere before the end therefore leaves somebody with records and
 * no portal — visible, recoverable, fixed by accepting again — and never a
 * portal with nothing behind it, which looks finished and is not.
 *
 * Completion is step 6, unnumbered because it creates no record of its own: the
 * ledger line. It is written BEFORE `completedAt` is set, so an acceptance can
 * never read as complete with nothing in the ledger to say it happened.
 */
async function runSteps(ctx: StepContext, previous?: AcceptanceRun): Promise<AcceptanceRun> {
  const done = new Map((previous?.steps ?? []).map((s) => [s.key, s]));
  const keep = (key: AcceptanceStepKey) => {
    const s = done.get(key);
    return s && (s.state === "done" || s.state === "not_applicable") ? s : undefined;
  };

  const steps: AcceptanceStep[] = [];
  const { invitation, userId, input } = ctx;
  const isDriverInvitation = invitation.kind === "driver";

  /**
   * A step is BLOCKED when what it depends on has not completed.
   *
   * Blocked is not failed and it is emphatically not done: the step was never
   * attempted, so nothing it would have created exists. That distinction is
   * what stops a portal seat being handed to somebody whose relationship never
   * got made — access arriving before the thing it is access to.
   */
  const blocked = (key: AcceptanceStepKey, on: string): AcceptanceStep =>
    step(key, "pending", `Waiting on ${on}.`, undefined,
      `The ${on} step did not finish, so this one was not attempted.`);

  /* ---- 1. The person's own permanent profile --------------------------- */
  let driverProfileId: string | undefined;
  const keptProfile = keep("driver_profile");
  if (keptProfile) {
    steps.push(keptProfile);
    driverProfileId = keptProfile.ref?.id;
  } else if (!isDriverInvitation) {
    steps.push(step("driver_profile", "not_applicable",
      "This invitation is not a driving one, so no driver profile is involved."));
  } else if (faultAt === "driver_profile") {
    steps.push(step("driver_profile", "failed", "Your driver profile could not be set up.",
      undefined, FAULT_REASON));
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
      const { profile } = createOrResumeProfile({
        userId, ...input.licence, email: currentUser().email,
      });
      driverProfileId = profile.id;
      steps.push(step("driver_profile", "done",
        "Your permanent driver profile was created. It belongs to you and follows you between carriers.",
        { kind: "driver_profile", id: profile.id }));
    }
  }

  /* ---- 2. The relationship. Created as onboarding, with NO start date --- */
  let relationshipReady = false;
  const keptRelationship = keep("carrier_relationship");
  if (keptRelationship) {
    steps.push(keptRelationship);
    relationshipReady = keptRelationship.state === "done";
  } else if (!isDriverInvitation) {
    // An employee, a dispatcher or a custom role has no driver–carrier
    // relationship at all. Marking this `pending` for them — as it once did —
    // left the run permanently unfinishable, so their invitation could never
    // read as accepted however many times they tried.
    steps.push(step("carrier_relationship", "not_applicable",
      "A driver–carrier relationship is a driving arrangement. This invitation is not one."));
    relationshipReady = true;
  } else if (!driverProfileId) {
    steps.push(blocked("carrier_relationship", "driver profile"));
  } else if (faultAt === "carrier_relationship") {
    steps.push(step("carrier_relationship", "failed",
      `Your connection to ${invitation.organizationName} could not be made.`,
      undefined, FAULT_REASON));
  } else {
    const before = liveRelationshipWith(driverProfileId, invitation.organizationId);
    const relationship = await mockCreateRelationship(driverProfileId, {
      carrierId: invitation.organizationId,
      carrierName: invitation.organizationName,
      engagementType: invitation.engagementType ?? "company_driver",
      roleName: invitation.roleName,
      permissions: invitation.permissions,
      // Deliberately empty. The consent the person gave is applied by the
      // document step below, which is the step that reports it. Passing the
      // keys here would attach the links inside this call, and the step named
      // "the documents you agreed to share" would be narrating somebody else's
      // write — done before it ran, and impossible to interrupt.
      sharedDocumentKeys: [],
      invitedAt: invitation.createdAt,
    });
    relationshipReady = true;
    steps.push(step("carrier_relationship", "done",
      before
        ? `You were already connected to ${invitation.organizationName}. Nothing was duplicated and no date was changed.`
        : `You are connected to ${invitation.organizationName}. They have not started you yet — that is their step, not this one.`,
      { kind: "carrier_relationship", id: relationship.id }));
  }

  /* ---- 3. Ordinary document access. THIS step grants it ---------------- */
  const keptDocuments = keep("document_access");
  if (keptDocuments) {
    steps.push(keptDocuments);
  } else if (!relationshipReady) {
    // It used to say "done" here regardless, which it could not have been: a
    // relationship that was never made shared nothing. A step reporting access
    // that does not exist is worse than one reporting none.
    steps.push(blocked("document_access", "connection to this carrier"));
  } else if (!isDriverInvitation || input.sharedDocumentKeys.length === 0) {
    steps.push(step("document_access", "done",
      "You shared nothing yet. You can share documents from your own file whenever you choose."));
  } else if (faultAt === "document_access") {
    steps.push(step("document_access", "failed",
      `The documents you chose could not be shared with ${invitation.organizationName}.`,
      undefined, FAULT_REASON));
  } else if (!driverProfileId) {
    steps.push(blocked("document_access", "driver profile"));
  } else {
    // ★ THE WRITE HAPPENS HERE ★
    // Through the driver module's own command, which goes on to the document
    // store's `addLink`. It used to happen inside `mockCreateRelationship`, so
    // this step wrote nothing and could not fail — which meant the one property
    // worth proving, that a carrier cannot read a document until the basis for
    // it exists, had no failure state to prove it against.
    // The command grants all the agreed links or none of them, and throws if
    // the store refuses. Caught HERE so a refusal becomes a failed step with a
    // reason rather than an exception out of an acceptance — and because the
    // step after this one reads the step list to decide whether to run.
    let shared: ReturnType<typeof mockShareDocumentsWithCarrier> | undefined;
    let refusal: string | undefined;
    try {
      shared = mockShareDocumentsWithCarrier(
        driverProfileId, invitation.organizationId, input.sharedDocumentKeys,
      );
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    /*
     * ★ SAY WHAT WAS HELD BACK, AND WHY ★
     *
     * The command narrows whatever it is handed to ORDINARY paperwork, so a
     * restricted category — a social security number, bank details, a state
     * driving record, a substance-testing record — never travels because
     * somebody joined. Silently sharing a shorter list than the one the person
     * just ticked is how people conclude the product lost their paperwork, so
     * the step names the difference.
     */
    const withheldKeys = shared
      ? input.sharedDocumentKeys.filter(
        (k) => !shared!.relationship.sharedDocumentKeys.includes(k))
      : [];
    /*
     * Labelled from the CHECKLIST, never from a global lookup.
     *
     * A carrier's own extra rows exist only on its checklist, so a global
     * lookup resolves the standard requirements and hands back a raw key —
     * `northline_employment_application` — for exactly the carrier-specific
     * ones. Nobody should ever be shown an internal key, least of all in the
     * sentence explaining what was withheld from them.
     */
    const checklist = documentRequirements(
      invitation.engagementType ?? "company_driver", invitation.organizationId,
    );
    const withheld = withheldKeys.map((key) => {
      const requirement = checklist.find((r) => r.key === key);
      return {
        key,
        label: requirement?.label ?? key,
        reason: requirement ? restrictedReason(requirement.typeKey) : undefined,
      };
    });
    const withheldNote = withheld.length === 0 ? "" : ` ${withheld.length} `
      + `${withheld.length === 1 ? "document was" : "documents were"} NOT shared, because `
      + "access to that kind is asked for separately, per document, for a stated reason: "
      + `${withheld.map((w) => w.label).join(", ")}.`;

    steps.push(shared && !refusal
      ? step("document_access", "done",
        `${invitation.organizationName} can now see ${shared.relationship.sharedDocumentKeys.length} `
        + "of your documents. Each is the same record you own, linked — not a copy — and their "
        + "review is theirs, not yours." + withheldNote,
        undefined, undefined, withheld.length > 0 ? withheld : undefined)
      : step("document_access", "failed",
        `The documents you chose could not be shared with ${invitation.organizationName}. `
        + "None of them was shared — not some of them.",
        undefined, refusal
          ?? "There is no live relationship with this carrier to share them under."));
  }

  /* ---- 4. The carrier's existing record of this person ----------------- */
  const keptLink = keep("engagement_link");
  if (keptLink) {
    steps.push(keptLink);
  } else if (!invitation.engagementId) {
    steps.push(step("engagement_link", "not_applicable",
      "This carrier had no earlier record of you to connect."));
  } else if (!driverProfileId) {
    steps.push(blocked("engagement_link", "driver profile"));
  } else if (faultAt === "engagement_link") {
    steps.push(step("engagement_link", "failed",
      "The record this carrier had of you could not be connected.",
      undefined, FAULT_REASON));
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

  /* ---- 5. The seat. GENUINELY last, and never ahead of what it opens --- */
  const keptSeat = keep("workspace_membership");

  /**
   * ★ THE SEAT WAITS ON EVERY STEP, NOT ON A LIST OF THEM ★
   *
   * Not "the relationship and the engagement" — ANY step before this one that
   * is not done and not inapplicable. Naming prerequisites individually is how
   * this went wrong twice already: the seat was granted with no relationship,
   * and then, once that was fixed by naming the relationship, it was still
   * granted when the document step failed and when the engagement link failed,
   * because neither was on the list. A seat is the key to the door and every
   * record before it is what the door opens onto, so the rule is the general
   * one and a new step added above is covered by it automatically.
   */
  const blocker = steps.find((x) => x.state !== "done" && x.state !== "not_applicable");

  if (keptSeat) {
    steps.push(keptSeat);
  } else if (blocker) {
    // Blocked, not attempted: nothing it would have created exists. The person
    // holds records and no portal — visible, recoverable, and honest — rather
    // than a portal standing on a record that was never made.
    steps.push(blocked("workspace_membership", ACCEPTANCE_STEP_LABEL[blocker.key].toLowerCase()));
  } else if (faultAt === "workspace_membership") {
    steps.push(step("workspace_membership", "failed", "A portal seat could not be created.",
      undefined, FAULT_REASON));
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
          // The invitation's own snapshot, narrowed. Not a template, not an
          // owner seat, and nothing this module chose for itself.
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

  const run: AcceptanceRun = {
    invitationId: invitation.id,
    userId,
    acceptedAt: previous?.acceptedAt ?? nowIso(),
    steps,
  };

  if (!acceptanceComplete(run)) return putRun(run);

  // Progress is banked BEFORE the ledger is asked, so a refusal below costs the
  // completion and not the four records already made.
  putRun(run);

  /**
   * ★ THE LEDGER LINE IS PART OF FINISHING, NOT A FOOTNOTE TO IT ★
   *
   * `completedAt` is set only after the line is in the ledger. The two used to
   * be the other way around and one of them swallowed its own exception, so a
   * ledger that refused produced a COMPLETED acceptance with no record that
   * anybody had joined — and, because a completed run reads as `used` rather
   * than `resume`, the person could never accept again to put it right. The
   * missing line was unrecoverable and nothing anywhere said it was missing.
   *
   * Now a refusal leaves the run incomplete: the same person resolves to
   * `resume`, Needs You raises it, and retrying writes the line and finishes.
   * The cost is honest and stated in the PR — an unavailable ledger blocks the
   * last inch of acceptance rather than quietly losing the evidence of it.
   *
   * Exactly-once and no-loss at the same time, because `withJoinedAudit` latches
   * only after the write returns, and the check, the write and the latch are one
   * synchronous block with no `await` in it. Two callers in one tab cannot both
   * win. Two BROWSERS still can — see the backend note below.
   */
  withJoinedAudit(invitation.id, userId, () => auditJoined(invitation, userId));
  run.completedAt = nowIso();
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
    if (!EMAIL.test(email)) throw new Error("That is not an email address.");

    // The engagement type decides a driver's paperwork and their pay, so it is
    // the carrier's to state and cannot be left for the driver to pick later.
    if (draft.kind === "driver" && !draft.engagementType) {
      throw new Error(
        "Say whether this driver is a company driver or an owner-operator. It decides "
        + "their paperwork and their pay, so the driver cannot choose it.",
      );
    }

    /*
     * ★ NOBODY HANDS OUT ACCESS THEY DO NOT HOLD ★
     *
     * Checked HERE rather than trusted from the picker, because the picker is a
     * convenience and this is the boundary. The refused keys are named: "some
     * of this is not yours to give" is unactionable. `clampToGrantable` runs
     * below as well — belt and braces — so a later caller that skipped this
     * check still cannot widen anything.
     *
     * The refusal is recorded. A refused attempt to hand out `permissions:manage`
     * is worth more six months later than the invitations that succeeded.
     */
    const ungrantable = ungrantablePermissions(draft.permissions, ctx.permissions);
    if (ungrantable.length > 0) {
      appendAuditEvent(ctx, {
        module: "access",
        action: "access.permission_denied",
        outcome: "denied",
        entity: { kind: "invitation", id: "new", label: email },
        summary: `Refused to invite ${email} with access the sender does not hold.`,
        permissionContext: { required: [...draft.permissions], missing: ungrantable },
      });
      throw new PermissionDeniedError(ungrantable);
    }
    // The frontend stand-in for a unique constraint. Two open invitations to
    // one person is two working links, and whichever is accepted second is how
    // a duplicate relationship gets made.
    const open = openInvitationFor(ctx.organizationId, email);
    if (open) return projected(open);

    const recipientAccount = accountForEmail(email);
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
      permissions: clampToGrantable(
        draft.permissions,
        ctx.permissions,
        ctx.workspaceKind === "carrier_organization" ? "CARRIER" : "DISPATCH_AGENCY",
      ),
      scopedToCarrierName: draft.scopedToCarrierName,
      engagementId: draft.engagementId,
      expiresAt: draft.expiresAt,
      createdAt: nowIso(),
      status: "pending",
      // DERIVED from the directory, never asserted by the sender: a carrier
      // that could type "this person is already on Antcolos" could use the
      // invitation form to find out who is.
      recipientHasAccount: recipientAccount !== undefined,
      recipientUserId: recipientAccount?.id,
      // An invitation is issued from INSIDE an organization, by a seat that
      // held the permission — never by a User in the abstract.
      invitedByMembershipId: ctx.membershipId,
      invitedByName: ctx.actor.displayNameSnapshot,
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
    // The ledger line is written inside `runSteps`, in the same synchronous
    // block that sets `completedAt`. Writing it here, after an `await`, is what
    // let three concurrent callers each write one.
    return run.completedAt ? { status: "accepted", run } : { status: "incomplete", run };
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

  // Connecting an ORGANIZATION is not this flow's to do. Refused before
  // anything else looks at it, so no part of the acceptance sequence can run
  // and grant the nearest thing it knows how to grant.
  if (invitation.kind === "dispatch_org") {
    return { status: "organization-invitation", invitation };
  }

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
/**
 * The one ledger line for one acceptance.
 *
 * It does NOT swallow its own exception any more. It used to, with the run
 * already marked complete — so the single most audit-worthy moment in this
 * module, somebody gaining access to a workspace, could go unrecorded with
 * nothing to show for it. A throw here is caught by nobody and leaves the run
 * unfinished on purpose; that is the recoverable state.
 */
function auditJoined(invitation: Invitation, userId: string) {
  const user = currentUser();
  if (faultAtJoinedAudit) {
    throw new Error(
      "Injected ledger failure (test only). In a real system this is where the "
      + "audit write would have refused.",
    );
  }
  {
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
  }
}

/* -------------------------------------------------------------------------- */
/* The roster, and taking a seat away                                          */
/* -------------------------------------------------------------------------- */

/**
 * ★ AN ACCESS FLOW THAT CAN ONLY ADD IS NOT REVIEWABLE ★
 *
 * "Acceptance produced a real seat" and "the seat is exactly what the
 * invitation said" are claims you can only check from the OTHER side — the
 * organization's roster, not the joiner's screen. And "removing access removes
 * access and nothing else" cannot be checked at all without somewhere to
 * remove it.
 *
 * Read through the membership store's own accessor, so this module keeps no
 * copy of the roster and cannot drift from it. A seat somebody LEFT is history
 * rather than access, and is not listed.
 */
export function rosterOf(organizationId: string): Membership[] {
  const seen = new Set<string>();
  const out: Membership[] = [];
  for (const scenario of ["demo", "newcomer"] as const) {
    for (const m of rosterSnapshot(scenario).memberships) {
      if (m.organizationId !== organizationId) continue;
      if (m.status === "left") continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** Which scenario roster a seat lives in. */
function scenarioOf(seat: Membership): "demo" | "newcomer" {
  return rosterSnapshot("newcomer").memberships.some((m) => m.id === seat.id)
    ? "newcomer" : "demo";
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

export type EndSeatResult =
  | { status: "ended"; membership: Membership }
  /** Already gone, or never here. Both are "nothing left to do". */
  | { status: "already_ended" }
  | { status: "refused"; refusal: "not_permitted" | "last_owner"; message: string };

/**
 * Ends somebody's seat in this organization.
 *
 * ★ AND NOTHING ELSE ★
 * The seat goes to `left`. The person's DriverProfile, their documents, their
 * seats in other organizations and their relationship history all stay exactly
 * as they were — they are theirs, not this carrier's, and an organization
 * removing somebody must not be able to reach into a life it does not own.
 *
 * Refuses to remove the last owner: a workspace nobody can administer is not a
 * state this product will create on somebody's behalf.
 */
export async function endSeat(
  ctx: ServiceContext,
  membershipId: string,
  reason: string,
): Promise<EndSeatResult> {
  await sleep(LATENCY_MS);
  if (!ctx.permissions.has("members:suspend")) {
    // Recorded. A refused attempt to remove somebody is worth reading later.
    appendAuditEvent(ctx, {
      module: "access",
      action: "access.permission_denied",
      outcome: "denied",
      entity: { kind: "membership", id: membershipId, label: membershipId },
      summary: "Refused to end a seat: no permission to remove members.",
      permissionContext: { required: ["members:suspend"], missing: ["members:suspend"] },
    });
    return {
      status: "refused", refusal: "not_permitted",
      message: "You do not have permission to remove people from this organization.",
    };
  }

  const roster = rosterOf(ctx.organizationId);
  const seat = roster.find((m) => m.id === membershipId);
  if (!seat) return { status: "already_ended" };
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

/** The same act, done to yourself. No permission is needed to stop working somewhere. */
export async function leaveOrganization(
  ctx: ServiceContext,
  reason = "Left the organization.",
): Promise<EndSeatResult> {
  await sleep(LATENCY_MS);
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
