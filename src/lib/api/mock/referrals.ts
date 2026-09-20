import {
  CANDIDATE_DISCLAIMER, COMPANY_ACCEPT_MEANS, REFERRAL_DISCLOSURE_NOT_SHARED,
  REFERRAL_LIMITATION, REFERRAL_CLAIM_REFUSAL_REASON, REFERRAL_SUBMIT_REFUSAL_REASON,
  type CandidateReferralView, type CompanyReferralView,
  type PermissionKey, type Referral, type ReferralClaimRefusal, type ReferralDisclosure,
  type ReferralEmailRecord, type ReferralEvent,
  type ReferrerReferralView,
} from "@/types";
import { OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import {
  candidateStateOf, candidateVisibilityFor, claimLinkLive, deliveryFailed, isDecidable,
  referrerStatusOf,
} from "@/lib/referrals/state";
import { maskEmail, normalizeEmail, normalizePhone } from "@/lib/referrals/normalize";
import { referralEmailContent } from "@/lib/referrals/email";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { membersOf } from "./membership-directory";
import {
  ensureSeeded as ensureWorkforceSeeded, liveEngagementFor,
} from "./workforce-store";
import { seedWorkforce } from "./workforce-seed";
import { resolveOrganizationReference, searchOrganizations } from "./organization-lookup";
import { appendAuditEvent } from "./audit";
import { seedReferrals } from "./referral-seed";
import {
  REFERRAL_LIMITS, WINDOW, abuseReports, appendEvent, ensureSeeded, hasOptedOut,
  nextClaimToken,
  nextEmailId, nextReference, nextReferralId, openReferralFor, optOut,
  organizationCount, putReferral, recipientCount, recordAbuseReport, referralById,
  referralByToken, referralsByReferrer, referralsForOrganization, referrerCount,
} from "./referral-store";
import { nowIso } from "./time";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import type {
  CompanyDecisionResult, ReferralClaimResult, ReferralDraft, ReferralHandoff,
  ReferralSubmitResult, ReferralsService, ReferringIdentity,
} from "../contracts/referrals";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * One person introducing another to a company, and the two separate answers
 * that follow.
 *
 * ★ READ WHAT THIS FILE DOES NOT IMPORT ★
 * No membership store. No permission template. No driver registry. No document
 * store. No invitation constructor. It imports the membership DIRECTORY once,
 * to ask whether a workspace has anybody in it, and the workforce STORE once,
 * to ask whether an engagement already exists — both reads, neither a write.
 * The one write outside this module's own store is an audit line, which every
 * module writes.
 *
 * That is the domain boundary made structural rather than promised: there is no
 * expression in this file that could create a seat, a permission, an engagement
 * or a document link, because nothing that creates one is in scope.
 *
 * ★ WHERE THE INVITATION COMES FROM ★
 * `handoff` returns prefill values. `services.access.create` — the canonical
 * command, from the existing screen, with its own `invitations:create` check
 * and its own grantable-permission clamp — creates the invitation. Then
 * `recordInvitation` writes the id back. There is no second invitation flow
 * here and no way to build one out of these methods.
 */

const LATENCY_MS = 140;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long a claim link lives. Long enough to find in a mailbox, not forever. */
const CLAIM_TTL_DAYS = 14;

const REVIEW: PermissionKey = "referrals:review";

/** Seeded on first read, exactly as the access store is. */
function db(): void {
  ensureSeeded(seedReferrals);
}

/**
 * Workforce's own store, seeded the way Workforce seeds it.
 *
 * Called only where this module READS an engagement, and it is a read: the
 * question "does this organization already have a live record for this person"
 * has to be answered before an invitation is sent, or the answer is a duplicate
 * engagement. Seeding through Workforce's own seed rather than keeping a view
 * of it is what stops this becoming a second workforce registry.
 */
function workforceDb(): void {
  ensureWorkforceSeeded(seedWorkforce);
}

function required(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

/* -------------------------------------------------------------------------- */
/* Is the target organization actually operating?                              */
/* -------------------------------------------------------------------------- */

/**
 * DERIVED, never stored.
 *
 * An organization is "active" when somebody active belongs to it. There is no
 * `Organization.active` flag and adding one would be a second source of truth
 * about a workspace's life, maintained by nobody. An empty workspace cannot
 * review a referral, so sending an introduction into it — and telling the
 * candidate by email that it went there — would be a promise nobody can keep.
 */
function organizationIsActive(organizationId: string): boolean {
  return membersOf(organizationId).some((m) => m.status === "active");
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

function referrerView(referral: Referral): ReferrerReferralView {
  const lastEmail = referral.emails[referral.emails.length - 1];
  const cooldownEnds = lastEmail
    ? new Date(new Date(lastEmail.queuedAt).getTime()
      + REFERRAL_LIMITS.resendCooldownHours * 3_600_000).toISOString()
    : undefined;
  const resendsUsed = referral.emails.filter((e) => e.kind === "candidate_resend").length;
  const cooldownPassed = cooldownEnds !== undefined
    && new Date(cooldownEnds).getTime() <= Date.now();

  return {
    id: referral.id,
    reference: referral.reference,
    candidateName: referral.candidate.fullName,
    // Masked even though the referrer typed it. A history screen is a list, and
    // a list of readable addresses is an export of other people's contacts.
    candidateEmailMasked: maskEmail(referral.candidate.email),
    proposedTitle: referral.proposedTitle,
    targetOrganizationName: referral.targetOrganizationNameSnapshot,
    status: referrerStatusOf(referral),
    submittedAt: referral.createdAt,
    canWithdraw: referral.lifecycle === "submitted"
      && referral.company.state === "pending_review",
    canResend: claimLinkLive(referral)
      && resendsUsed < REFERRAL_LIMITS.maxResends
      && cooldownPassed,
    resendAvailableAt: cooldownEnds,
  };
}

function companyView(referral: Referral, ctx: ServiceContext): CompanyReferralView {
  return {
    id: referral.id,
    reference: referral.reference,
    referrerName: referral.referrerNameSnapshot,
    candidateName: referral.candidate.fullName,
    // The SUBMITTED forms, not the normalized keys. Showing a company a phone
    // number the referrer never typed makes a normalization guess look like a
    // fact about the person.
    candidateEmail: referral.candidate.submittedEmail,
    candidatePhone: referral.candidate.submittedPhone,
    proposedTitle: referral.proposedTitle,
    note: referral.note,
    submittedAt: referral.createdAt,
    candidateClaim: candidateVisibilityFor(referral),
    company: { ...referral.company },
    lifecycle: referral.lifecycle,
    resultingInvitationId: referral.resultingInvitationId,
    resultingEngagementId: referral.resultingEngagementId,
    events: companyVisibleEvents(referral),
    canDecide: isDecidable(referral) && ctx.permissions.has(REVIEW),
    canStartInvitation: referral.company.state === "accepted"
      && referral.lifecycle !== "withdrawn"
      && referral.resultingInvitationId === undefined,
  };
}

/**
 * The history, minus the candidate's private business.
 *
 * The company sees everything the company did, plus the fact that the
 * introduction was made and whether the person is here yet. It does not see
 * email delivery events — whether a stranger's mailbox accepted a message is
 * not the company's record — and it never sees an abuse report, for the same
 * reason the visibility level collapses `reported_unwanted` into `declined`.
 */
function companyVisibleEvents(referral: Referral): ReferralEvent[] {
  const hidden = new Set(["email_queued", "email_state_changed", "reported_unwanted",
    "resend_refused", "claim_refused"]);
  return referral.events
    .filter((e) => !hidden.has(e.kind))
    .map((e) => (e.kind === "candidate_declined"
      ? { ...e, summary: "The person declined the introduction." }
      : { ...e }));
}

function candidateView(referral: Referral): CandidateReferralView {
  return {
    id: referral.id,
    reference: referral.reference,
    referrerName: referral.referrerNameSnapshot,
    candidateName: referral.candidate.fullName,
    targetOrganizationName: referral.targetOrganizationNameSnapshot,
    proposedTitle: referral.proposedTitle,
    note: referral.note,
    expiresAt: referral.claim.expiresAt,
    disclaimer: CANDIDATE_DISCLAIMER,
  };
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

type ReferralAuditAction =
  | "referrals.submitted" | "referrals.withdrawn" | "referrals.candidate_claimed"
  | "referrals.candidate_declined" | "referrals.reported_unwanted"
  | "referrals.interest_recorded" | "referrals.declined_by_company"
  | "referrals.invitation_started" | "referrals.email_delivery_failed";

/**
 * The introduction, in the ONE ledger, against the organization it was sent to.
 *
 * Recorded there because that is whose record it is — and because the referrer
 * frequently has no seat in that organization at all, which is exactly the
 * situation a ledger keyed on the actor's own workspace could not express. The
 * actor stays the person who acted; the partition stays the company.
 */
function auditFor(referral: Referral, actorName: string, userId: string): ServiceContext {
  return {
    organizationId: referral.targetOrganizationId,
    organizationName: referral.targetOrganizationNameSnapshot,
    workspaceKind: "carrier_organization",
    membershipId: `ref_${referral.id}`,
    permissions: new Set<PermissionKey>(),
    scope: OWN_RECORDS_SCOPE,
    actor: {
      userId,
      membershipId: `ref_${referral.id}`,
      displayNameSnapshot: actorName,
      source: "web",
    },
  };
}

function audit(
  ctx: ServiceContext,
  action: ReferralAuditAction,
  referral: Referral,
  summary: string,
  outcome: "succeeded" | "denied" | "failed" = "succeeded",
) {
  try {
    appendAuditEvent(ctx, {
      module: "referrals",
      action,
      sourceAction: action,
      outcome,
      entity: {
        kind: "referral",
        id: referral.id,
        // The candidate's NAME and the title. Not their address: an audit
        // summary is read far more widely than the inbox it came from.
        label: `${referral.candidate.fullName} · ${referral.proposedTitle}`,
      },
      summary,
    });
  } catch {
    // An audit failure must not take the command with it.
  }
}

/* -------------------------------------------------------------------------- */
/* The email, queued and nothing more                                          */
/* -------------------------------------------------------------------------- */

/**
 * ███ THIS QUEUES A RECORD. IT SENDS NOTHING. ███
 *
 * `queued` is the only state this function can produce, and that is the whole
 * point: a frontend that wrote `sent` would be asserting that a provider
 * accepted a message no provider has seen. Everything after `queued` arrives
 * through `recordDelivery`, which is the webhook's shape.
 */
function queueEmail(
  referral: Referral, kind: ReferralEmailRecord["kind"],
): Referral {
  const record: ReferralEmailRecord = {
    id: nextEmailId(),
    kind,
    to: referral.candidate.email,
    state: "queued",
    queuedAt: nowIso(),
  };
  const withEmail = { ...referral, emails: [...referral.emails, record] };
  return appendEvent(withEmail, {
    at: record.queuedAt,
    kind: "email_queued",
    summary: kind === "candidate_resend"
      ? "The introduction was queued to be sent again."
      : "The introduction was queued to be emailed to the person.",
  });
}

/* -------------------------------------------------------------------------- */
/* Submission                                                                  */
/* -------------------------------------------------------------------------- */

function refuse(
  refusal: keyof typeof REFERRAL_SUBMIT_REFUSAL_REASON,
  extra: Partial<Extract<ReferralSubmitResult, { status: "refused" }>> = {},
): ReferralSubmitResult {
  return {
    status: "refused",
    refusal,
    message: REFERRAL_SUBMIT_REFUSAL_REASON[refusal],
    ...extra,
  };
}

interface ValidatedDraft {
  fullName: string;
  email: ReturnType<typeof normalizeEmail>;
  phone: ReturnType<typeof normalizePhone>;
  proposedTitle: string;
  note?: string;
}

function validate(draft: ReferralDraft): ValidatedDraft | ReferralSubmitResult {
  const fullName = draft.candidateFullName.trim();
  if (!fullName) return refuse("missing_name");

  // Free text, and the ONLY check on it is that it is not empty. There is no
  // list of allowed titles, no mapping to a role and no normalization: the
  // moment a title had to be one of a set, it would be a role in everything but
  // name and something downstream would start reading it as one.
  const proposedTitle = draft.proposedTitle.trim();
  if (!proposedTitle) return refuse("missing_title");

  const email = normalizeEmail(draft.candidateEmail);
  if (!email.valid) return refuse("invalid_email");

  const phone = normalizePhone(draft.candidatePhone);
  if (!phone.valid) return refuse("invalid_phone");

  const note = draft.note?.trim() || undefined;
  return { fullName, email, phone, proposedTitle, note };
}

function resolveTarget(
  lookup: ReferralDraft["organizationLookup"],
): { organizationId: string; displayName: string } | ReferralSubmitResult {
  // A picked result is CONFIRMED rather than trusted: the id still goes through
  // the resolver, so a caller cannot submit an organization id that names
  // nothing, or one it made up.
  const resolution = lookup.organizationId
    ? resolveOrganizationReference("name_search", lookup.organizationId)
    : resolveOrganizationReference(lookup.kind, lookup.value);
  if (resolution.status === "unresolved") return refuse("organization_unresolved");
  if (resolution.status === "ambiguous") {
    return refuse("organization_ambiguous", { candidates: resolution.candidates });
  }
  if (resolution.status === "inactive") return refuse("organization_inactive");
  if (!organizationIsActive(resolution.organizationId)) {
    return refuse("organization_inactive");
  }
  return {
    organizationId: resolution.organizationId,
    displayName: resolution.displayName,
  };
}

/**
 * Every abuse control, in the order that leaks the least.
 *
 * The opt-out check is LAST among the recipient checks and returns the same
 * sentence as the recipient rate limit, so the refusal a sender sees cannot be
 * used to distinguish "this person opted out" from "this person was referred
 * recently" — both of which are facts about somebody else.
 */
function abuseChecks(
  identity: ReferringIdentity,
  email: string,
  organizationId: string,
): ReferralSubmitResult | null {
  if (email === identity.email.trim().toLowerCase()) return refuse("self_referral");

  if (referrerCount(identity.userId, WINDOW.hour) >= REFERRAL_LIMITS.referrerPerHour) {
    return refuse("rate_limited_referrer", { retryAt: iso(WINDOW.hour) });
  }
  if (referrerCount(identity.userId, WINDOW.day) >= REFERRAL_LIMITS.referrerPerDay) {
    return refuse("rate_limited_referrer", { retryAt: iso(WINDOW.day) });
  }
  if (organizationCount(organizationId, WINDOW.day) >= REFERRAL_LIMITS.organizationPerDay) {
    return refuse("rate_limited_organization", { retryAt: iso(WINDOW.day) });
  }
  if (recipientCount(email, WINDOW.day) >= REFERRAL_LIMITS.recipientPerDay) {
    return refuse("rate_limited_recipient", { retryAt: iso(WINDOW.day) });
  }
  if (recipientCount(email, WINDOW.week) >= REFERRAL_LIMITS.recipientPerWeek) {
    return refuse("rate_limited_recipient", { retryAt: iso(WINDOW.week) });
  }
  if (hasOptedOut(email)) return refuse("recipient_opted_out");
  return null;
}

/* -------------------------------------------------------------------------- */
/* Claim resolution                                                            */
/* -------------------------------------------------------------------------- */

function claimRefusal(
  referral: Referral | undefined,
): ReferralClaimRefusal | null {
  if (!referral) return "not_found";
  if (referral.lifecycle === "withdrawn") return "withdrawn";
  if (referral.claim.consumedAt) return "already_claimed";
  if (referral.candidateDecision) return "closed";
  if (referral.claim.closedAt) return "closed";
  if (new Date(referral.claim.expiresAt).getTime() <= Date.now()) return "expired";
  // A CLOSED referral whose link was never used still refuses: the handoff has
  // happened and the invitation, not this link, is what the person follows now.
  if (referral.lifecycle === "closed") return "closed";
  return null;
}

const refusedClaim = (refusal: ReferralClaimRefusal): ReferralClaimResult => ({
  status: "refused", refusal, message: REFERRAL_CLAIM_REFUSAL_REASON[refusal],
});

/**
 * Is this the person the introduction was addressed to?
 *
 * By EMAIL, exactly and case-insensitively, against the account that is signed
 * in. It never re-points the referral at whoever is holding the link, which is
 * what makes forwarding the email harmless. The candidate who already claimed
 * is matched by `candidateUserId` instead, so a later address change on their
 * account does not lock them out of their own referral.
 */
function isAddressee(referral: Referral, identity: ReferringIdentity): boolean {
  if (referral.candidateUserId) return referral.candidateUserId === identity.userId;
  return referral.candidate.email === identity.email.trim().toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockReferralsService: ReferralsService = {
  async searchOrganizations(query) {
    await sleep(LATENCY_MS);
    db();
    return searchOrganizations(query);
  },

  async resolveOrganization(kind, value) {
    await sleep(LATENCY_MS);
    db();
    const resolution = resolveOrganizationReference(kind, value);
    if (resolution.status !== "resolved") return resolution;
    if (organizationIsActive(resolution.organizationId)) return resolution;
    return {
      status: "inactive",
      organizationId: resolution.organizationId,
      displayName: resolution.displayName,
    };
  },

  async disclose(identity, draft) {
    await sleep(LATENCY_MS);
    db();
    const validated = validate(draft);
    if ("status" in validated) return null;
    const target = resolveTarget(draft.organizationLookup);
    if ("status" in target) return null;

    const disclosure: ReferralDisclosure = {
      targetOrganizationName: target.displayName,
      // Exactly the fields `companyView` returns. If one list grew and the
      // other did not, the confirmation would be a lie with a tidy layout.
      sharedWithCompany: [
        { label: "Your name", value: identity.displayName },
        { label: "Their name", value: validated.fullName },
        { label: "Their email", value: validated.email.submitted },
        { label: "Their phone", value: validated.phone.submitted },
        { label: "Proposed work", value: validated.proposedTitle },
        ...(validated.note ? [{ label: "Your note", value: validated.note }] : []),
      ],
      sharedWithCandidate: [
        { label: "Who referred them", value: identity.displayName },
        { label: "Which company", value: target.displayName },
        { label: "Proposed work", value: validated.proposedTitle },
        ...(validated.note ? [{ label: "Your note", value: validated.note }] : []),
        { label: "A secure link", value: "Expires in 14 days, usable once" },
      ],
      notShared: [...REFERRAL_DISCLOSURE_NOT_SHARED],
      limitation: REFERRAL_LIMITATION,
    };
    return disclosure;
  },

  async submit(identity, draft) {
    await sleep(LATENCY_MS);
    db();
    // ★ AUTHENTICATION FIRST, AND IT IS THE ONLY GATE ★
    // Any authenticated person may refer anybody to any company: the referrer
    // needs no membership in the target organization, and asking for one would
    // rule out the entire product statement.
    if (!identity?.userId) return refuse("not_authenticated");

    const validated = validate(draft);
    if ("status" in validated) return validated;

    const target = resolveTarget(draft.organizationLookup);
    if ("status" in target) return target;

    const blocked = abuseChecks(identity, validated.email.key, target.organizationId);
    if (blocked) return blocked;

    // The frontend stand-in for a unique constraint. IDEMPOTENT rather than an
    // error: the second press of a button that already worked returns the first
    // referral and queues NO second email.
    const open = openReferralFor(target.organizationId, validated.email.key);
    if (open) {
      return refuse("duplicate_active");
    }

    let referral: Referral = {
      id: nextReferralId(),
      reference: nextReference(),
      referrerUserId: identity.userId,
      referrerNameSnapshot: identity.displayName,
      candidate: {
        fullName: validated.fullName,
        email: validated.email.key,
        submittedEmail: validated.email.submitted,
        phone: validated.phone.key,
        submittedPhone: validated.phone.submitted,
      },
      // NOT set from an address match. An address matching an account is not
      // proof that its holder asked to be introduced to anybody.
      candidateUserId: undefined,
      proposedTitle: validated.proposedTitle,
      note: validated.note,
      targetOrganizationId: target.organizationId,
      targetOrganizationNameSnapshot: target.displayName,
      lookup: {
        kind: draft.organizationLookup.kind,
        submittedValue: draft.organizationLookup.value.trim(),
      },
      lifecycle: "submitted",
      company: { state: "pending_review" },
      claim: {
        token: nextClaimToken(),
        expiresAt: iso(CLAIM_TTL_DAYS * 24 * 3_600_000),
      },
      emails: [],
      createdAt: nowIso(),
      events: [],
    };

    referral = appendEvent(referral, {
      at: referral.createdAt,
      kind: "submitted",
      summary: `${identity.displayName} referred ${validated.fullName} to `
        + `${target.displayName} for ${validated.proposedTitle}.`,
      actorName: identity.displayName,
    });
    referral = queueEmail(referral, "candidate_invite");
    putReferral(referral);

    audit(
      auditFor(referral, identity.displayName, identity.userId),
      "referrals.submitted",
      referral,
      `${identity.displayName} referred ${validated.fullName} for `
      + `${validated.proposedTitle}. An introduction only: no membership, `
      + "permissions, engagement or document access were created.",
    );

    return { status: "submitted", referral, view: referrerView(referral) };
  },

  async myReferrals(identity) {
    await sleep(LATENCY_MS);
    db();
    if (!identity?.userId) return [];
    // Scoped to the account that made them. There is no filter a caller can
    // pass to widen this and no method that lists anybody else's.
    return referralsByReferrer(identity.userId).map(referrerView);
  },

  async withdraw(identity, referralId) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralById(referralId);
    // Only the referrer, and only while nothing has been decided. A foreign id
    // and a missing one answer identically.
    if (!referral || referral.referrerUserId !== identity.userId) return null;
    if (referral.lifecycle !== "submitted") return referrerView(referral);
    if (referral.company.state !== "pending_review") return referrerView(referral);

    const at = nowIso();
    let updated: Referral = {
      ...referral,
      lifecycle: "withdrawn",
      withdrawnAt: at,
      // The link stops working. The candidate's ACCOUNT, if they already made
      // one, is untouched — nothing here reaches a User.
      claim: { ...referral.claim, closedAt: at },
    };
    updated = appendEvent(updated, {
      at,
      kind: "withdrawn",
      summary: `${identity.displayName} withdrew this introduction.`,
      actorName: identity.displayName,
    });
    putReferral(updated);
    audit(
      auditFor(updated, identity.displayName, identity.userId),
      "referrals.withdrawn", updated,
      `${identity.displayName} withdrew the referral of ${updated.candidate.fullName}.`,
    );
    return referrerView(updated);
  },

  async resend(identity, referralId) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralById(referralId);
    if (!referral || referral.referrerUserId !== identity.userId) {
      return { status: "refused", message: "We can't resend that." };
    }
    const view = referrerView(referral);
    if (!view.canResend) {
      // ONE sentence for every reason, on purpose. "They opted out", "they
      // already declined" and "you are in the cooldown" are all facts about the
      // recipient, and a resend button that distinguished them would be a
      // probe.
      // The refusal is still recorded. A referrer who tries to resend eleven
      // times is exactly the pattern an abuse review comes looking for, and a
      // rule that refused silently would leave nothing to find.
      putReferral(appendEvent(referral, {
        at: nowIso(),
        kind: "resend_refused",
        summary: "A resend was refused by the sending rules.",
      }));
      return {
        status: "refused",
        message: "We can't send another introduction to this person right now.",
      };
    }
    if (hasOptedOut(referral.candidate.email)) {
      return {
        status: "refused",
        message: "We can't send another introduction to this person right now.",
      };
    }
    putReferral(queueEmail(referral, "candidate_resend"));
    return { status: "queued" };
  },

  /* ---- the company's side ---- */

  async companyInbox(ctx) {
    await sleep(LATENCY_MS);
    db();
    required(ctx, REVIEW);
    return referralsForOrganization(ctx.organizationId).map((r) => companyView(r, ctx));
  },

  async companyGet(ctx, referralId) {
    await sleep(LATENCY_MS);
    db();
    required(ctx, REVIEW);
    const referral = referralById(referralId);
    // ★ THE SAME BOUNDARY AS THE LIST ★
    // A referral belonging to another organization answers exactly as a
    // nonexistent one. Not "forbidden": a forbidden would confirm it exists,
    // and what exists is somebody's name, email and phone number.
    if (!referral || referral.targetOrganizationId !== ctx.organizationId) return null;
    return companyView(referral, ctx);
  },

  async accept(ctx, referralId, internalNote) {
    return decide(ctx, referralId, "accepted", internalNote);
  },

  async reject(ctx, referralId, internalNote) {
    return decide(ctx, referralId, "rejected", internalNote);
  },

  async handoff(ctx, referralId) {
    await sleep(LATENCY_MS);
    db();
    // Reading the handoff needs the review key; ACTING on it — creating the
    // invitation — needs `invitations:create`, checked by the access service
    // where the invitation is actually made.
    required(ctx, REVIEW);
    const referral = referralById(referralId);
    if (!referral || referral.targetOrganizationId !== ctx.organizationId) return null;
    if (referral.company.state !== "accepted") return null;

    // An engagement this organization ALREADY has for this person. Matched on
    // the claimed account first and only then on the submitted address, so an
    // unclaimed referral cannot attach itself to an existing worker by having
    // the right string typed into a form.
    workforceDb();
    const existing = liveEngagementFor(ctx.organizationId, {
      userId: referral.candidateUserId,
      email: referral.candidateUserId ? undefined : referral.candidate.email,
    });

    const handoff: ReferralHandoff = {
      referralId: referral.id,
      recipientName: referral.candidate.fullName,
      recipientEmail: referral.candidate.submittedEmail,
      proposedTitleContext: referral.proposedTitle,
      referrerName: referral.referrerNameSnapshot,
      note: referral.note,
      candidateHasAccount: referral.candidateUserId !== undefined,
      existingEngagementId: existing?.id,
      meaningOfAcceptance: COMPANY_ACCEPT_MEANS,
    };
    return handoff;
  },

  async recordInvitation(ctx, referralId, invitationId) {
    await sleep(LATENCY_MS);
    db();
    required(ctx, REVIEW);
    const referral = referralById(referralId);
    if (!referral || referral.targetOrganizationId !== ctx.organizationId) return null;
    // Idempotent. A second call with the same id changes nothing; a second call
    // with a DIFFERENT id is refused rather than overwriting, because a
    // referral that silently re-pointed at another invitation would lose the
    // link between what was accepted and what was sent.
    if (referral.resultingInvitationId) return companyView(referral, ctx);

    const at = nowIso();
    workforceDb();
    const existing = liveEngagementFor(ctx.organizationId, {
      userId: referral.candidateUserId,
      email: referral.candidateUserId ? undefined : referral.candidate.email,
    });

    let updated: Referral = {
      ...referral,
      resultingInvitationId: invitationId,
      // CONNECTED, not created. The id is written only when Workforce already
      // holds a live engagement for this person; this module has no way to make
      // one and does not want one.
      resultingEngagementId: existing?.id ?? referral.resultingEngagementId,
      lifecycle: "closed",
      closedAt: at,
      closedReason: "An invitation was sent through the normal invitation flow.",
    };
    updated = appendEvent(updated, {
      at,
      kind: "invitation_started",
      summary: "An invitation was sent through the normal invitation flow. "
        + "What happens next belongs to that invitation.",
      actorName: ctx.actor.displayNameSnapshot,
      organizationId: ctx.organizationId,
    });
    if (existing) {
      updated = appendEvent(updated, {
        at,
        kind: "engagement_connected",
        summary: "Connected to the workforce record this company already had "
          + "for this person, rather than starting a second one.",
        organizationId: ctx.organizationId,
      });
    }
    putReferral(updated);
    audit(ctx, "referrals.invitation_started", updated,
      `An invitation was issued to ${updated.candidate.fullName} from a referral.`);
    return companyView(updated, ctx);
  },

  /* ---- the candidate's side ---- */

  async lookUpClaim(token, identity) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralByToken(token);
    const refusal = claimRefusal(referral);
    if (refusal || !referral) {
      const r = refusal ?? "not_found";
      return { status: "refused", refusal: r, message: REFERRAL_CLAIM_REFUSAL_REASON[r] };
    }
    if (!identity) return { status: "needs-account", view: candidateView(referral) };
    if (!isAddressee(referral, identity)) {
      return {
        status: "refused",
        refusal: "wrong_recipient",
        message: REFERRAL_CLAIM_REFUSAL_REASON.wrong_recipient,
      };
    }
    return { status: "valid", view: candidateView(referral), signedInAs: identity.email };
  },

  async claim(token, identity) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralByToken(token);
    const refusal = claimRefusal(referral);
    if (refusal || !referral) return refusedClaim(refusal ?? "not_found");
    if (!identity?.userId) return refusedClaim("needs_account");
    // ★ FAILS CLOSED ★
    // A forwarded link, a shared mailbox, a guessed token: none of them attach
    // this referral to the account that happens to be signed in.
    if (!isAddressee(referral, identity)) return refusedClaim("wrong_recipient");

    const at = nowIso();
    let updated: Referral = {
      ...referral,
      // ★ THE EXISTING ACCOUNT IS CONNECTED, NEVER DUPLICATED ★
      // This module creates no User. `identity.userId` is whatever account the
      // person signed in with — new or years old — and connecting it is the
      // whole of what claiming does.
      candidateUserId: identity.userId,
      candidateDecision: { state: "claimed", at },
      claim: { ...referral.claim, consumedAt: at },
    };
    updated = appendEvent(updated, {
      at,
      kind: "claimed",
      summary: "The person connected their Antcolos account. "
        + "This says nothing about the company's decision.",
      actorName: identity.displayName,
    });
    putReferral(updated);
    audit(
      auditFor(updated, identity.displayName, identity.userId),
      "referrals.candidate_claimed", updated,
      `${updated.candidate.fullName} connected their Antcolos account from a referral. `
      + "No membership, permission or engagement follows from this.",
    );
    return { status: "claimed", referral: updated };
  },

  async decline(token, identity) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralByToken(token);
    const refusal = claimRefusal(referral);
    if (refusal || !referral) return refusedClaim(refusal ?? "not_found");
    // Signing in is not required to say no — but somebody who IS signed in and
    // is not the addressee still cannot decline on their behalf.
    if (identity && !isAddressee(referral, identity)) return refusedClaim("wrong_recipient");

    const at = nowIso();
    let updated: Referral = {
      ...referral,
      candidateDecision: { state: "declined", at },
      claim: { ...referral.claim, closedAt: at },
    };
    updated = appendEvent(updated, {
      at,
      kind: "candidate_declined",
      summary: "The person declined the introduction.",
    });
    putReferral(updated);
    audit(
      auditFor(updated, updated.candidate.fullName, identity?.userId ?? "anonymous"),
      "referrals.candidate_declined", updated,
      `${updated.candidate.fullName} declined the introduction.`,
    );
    return { status: "claimed", referral: updated };
  },

  async reportUnwanted(token, reason) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralByToken(token);
    // Deliberately more permissive than `claimRefusal`: somebody reporting
    // unwanted mail must be able to do it from an EXPIRED link too. The one
    // thing that stops a report is there being no such referral.
    if (!referral) return refusedClaim("not_found");
    if (referral.candidateDecision?.state === "reported_unwanted") {
      return { status: "claimed", referral };
    }

    const at = nowIso();
    let updated: Referral = {
      ...referral,
      candidateDecision: { state: "reported_unwanted", at },
      claim: { ...referral.claim, closedAt: at },
    };
    updated = appendEvent(updated, {
      at,
      kind: "reported_unwanted",
      summary: "The person reported this introduction as unwanted. "
        + "Their address will not receive referral email again.",
    });
    putReferral(updated);

    // The opt-out OUTLIVES the referral, and is keyed by address alone.
    optOut(updated.candidate.email, at);
    recordAbuseReport({
      referralId: updated.id,
      reportedEmail: updated.candidate.email,
      reason,
      at,
      referrerUserId: updated.referrerUserId,
      targetOrganizationId: updated.targetOrganizationId,
    });
    audit(
      auditFor(updated, updated.candidate.fullName, "anonymous"),
      "referrals.reported_unwanted", updated,
      "The person reported this introduction as unwanted and opted out of "
      + "referral email.",
    );
    return { status: "claimed", referral: updated };
  },

  async recordDelivery(referralId, emailId, state, detail) {
    await sleep(LATENCY_MS);
    db();
    const referral = referralById(referralId);
    if (!referral) return;
    const at = nowIso();
    const emails = referral.emails.map((e) => (e.id === emailId
      ? {
        ...e,
        state,
        sentAt: state === "sent" ? at : e.sentAt,
        deliveredAt: state === "delivered" ? at : e.deliveredAt,
        failedAt: state === "bounced" || state === "failed" ? at : e.failedAt,
        failureReason: state === "bounced" || state === "failed" ? detail : e.failureReason,
      }
      : e));
    let updated: Referral = { ...referral, emails };
    updated = appendEvent(updated, {
      at,
      kind: "email_state_changed",
      summary: `The introduction email is now "${state}".`
        + (detail ? ` ${detail}` : ""),
    });
    putReferral(updated);

    // A bounce is evidence about a MAILBOX, never an answer from a person, so
    // it changes no candidate state. It is worth a ledger line because an
    // address that always bounces is what a pattern of made-up referrals looks
    // like.
    if (deliveryFailed(updated)) {
      audit(
        auditFor(updated, "Antcolos", "system"),
        "referrals.email_delivery_failed", updated,
        `The introduction to ${updated.candidate.fullName} could not be delivered.`,
        "failed",
      );
    }
  },
};

/* -------------------------------------------------------------------------- */
/* The company decision, both ways                                             */
/* -------------------------------------------------------------------------- */

/**
 * ★ WHAT THIS FUNCTION WRITES, IN FULL ★
 *
 * `referral.company`, one history line, one audit line. That is the entire set
 * of writes, and it is the same set for `accepted` and for `rejected`.
 *
 * It does not call the membership store, the permission system, Workforce, the
 * driver registry, the document store or the access service. `accepted` unlocks
 * `handoff`, which returns strings.
 *
 * A rejection, in particular, does not touch the candidate's `User`, their
 * claim, their account or anything they hold. There is no code path from here
 * to a person's account at all.
 */
async function decide(
  ctx: ServiceContext,
  referralId: string,
  decision: "accepted" | "rejected",
  internalNote?: string,
): Promise<CompanyDecisionResult> {
  await sleep(LATENCY_MS);
  db();
  // ★ AUTHORIZATION BEFORE ANY READ OR WRITE ★
  // A caller without the key learns nothing, changes nothing and leaves no
  // referral state behind — the only trace is a ledger line, which is what a
  // refusal is for.
  if (!ctx.permissions.has(REVIEW)) {
    return {
      status: "refused",
      refusal: "not_permitted",
      message: "You do not have permission to decide referrals for this company.",
    };
  }

  const referral = referralById(referralId);
  // Cross-organization reads answer as missing. Identical to `companyGet`, on
  // purpose: a decide endpoint that said "forbidden" would be a way to probe
  // whether a person has been referred to a competitor.
  if (!referral || referral.targetOrganizationId !== ctx.organizationId) {
    return { status: "refused", refusal: "not_found", message: "No such referral." };
  }
  if (referral.lifecycle === "withdrawn") {
    return {
      status: "refused",
      refusal: "withdrawn",
      message: "The person who made this introduction withdrew it.",
    };
  }
  if (referral.company.state !== "pending_review") {
    return {
      status: "refused",
      refusal: "already_decided",
      message: `This referral was already marked "${referral.company.state}".`,
    };
  }

  const at = nowIso();
  let updated: Referral = {
    ...referral,
    company: {
      state: decision,
      decidedAt: at,
      decidedByMembershipId: ctx.membershipId,
      decidedByName: ctx.actor.displayNameSnapshot,
      internalNote,
    },
    // A REJECTION closes the introduction. A claim link that is still live
    // stays live: the person's account is independent of this decision, and
    // that independence is the whole reason the two axes are separate.
    ...(decision === "rejected"
      ? { lifecycle: "closed" as const, closedAt: at, closedReason: "The company passed." }
      : {}),
  };
  updated = appendEvent(updated, {
    at,
    kind: decision === "accepted" ? "company_accepted" : "company_rejected",
    summary: decision === "accepted"
      ? `${ctx.actor.displayNameSnapshot} recorded that this company is interested. `
        + "Nobody has been given a membership, permissions or an engagement."
      : `${ctx.actor.displayNameSnapshot} recorded that this company is not proceeding. `
        + "This person's Antcolos account is unaffected.",
    actorName: ctx.actor.displayNameSnapshot,
    organizationId: ctx.organizationId,
  });
  putReferral(updated);

  audit(
    ctx,
    decision === "accepted" ? "referrals.interest_recorded" : "referrals.declined_by_company",
    updated,
    decision === "accepted"
      ? `Recorded interest in ${updated.candidate.fullName}. No membership, permission, `
        + "engagement or document access was created."
      : `Declined the referral of ${updated.candidate.fullName}. Their Antcolos account `
        + "is unaffected.",
  );
  return { status: "decided", view: companyView(updated, ctx) };
}

/* -------------------------------------------------------------------------- */
/* Test and demo helpers                                                       */
/* -------------------------------------------------------------------------- */

/** The email that WOULD be sent, for a screen that shows it and for tests. */
export function referralEmailPreview(referral: Referral) {
  return referralEmailContent(referral);
}

/** Exposed for the abuse-report test. Never reachable from a screen. */
export { abuseReports };

/** Exposed so a test can assert what a candidate's state derives to. */
export { candidateStateOf };

/** Every organization the referral form can name. Public identity only. */
export const REFERRABLE_ORGANIZATIONS = MOCK_ORGANIZATIONS;
