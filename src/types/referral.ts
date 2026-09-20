import type { IsoDateTime } from "./common";

/**
 * ★ A REFERRAL IS AN INTRODUCTION. THAT IS THE WHOLE RECORD. ★
 *
 * Sam knows Alex, Sam thinks Northline should meet Alex, Sam says so. Antcolos
 * carries the message to both ends and records what each of them decided.
 *
 * ── WHAT A REFERRAL IS NOT ────────────────────────────────────────────────
 * Not an `Invitation`. Not a `Membership`. Not a `WorkforceEngagement`. Not a
 * job offer, an employment agreement, a `PermissionKey`, an `AppliedTemplate`,
 * a `CarrierRelationship`, or permission to read one document. None of those
 * follow from a referral being submitted, and none follow from it being
 * accepted either — see `CompanyReferralState` below, which says out loud what
 * "accepted" means and what it deliberately does not.
 *
 * The test for whether this module has stayed honest is structural rather than
 * cultural: there is no `PermissionKey` anywhere in this file, no membership
 * id, no role, no template, and the only canonical ids a referral carries are
 * the five in `Referral` — each of them written only once the module that OWNS
 * that record has made it.
 *
 * ── THE PROPOSED TITLE ────────────────────────────────────────────────────
 * `proposedTitle` is free text. "Driver", "Dispatcher", "Safety", "Accounting",
 * "Fleet Manager", "the guy who fixes the reefers" — all equally valid, because
 * it is the referrer's description of why they are making the introduction and
 * nothing branches on it. It is never matched against a permission template,
 * never mapped to an `InvitationKind`, and never written onto a Membership. If
 * the company goes forward, an authorized person chooses the real engagement
 * type, position and permissions through the canonical invitation flow, with
 * this string shown beside the form as CONTEXT and nothing more.
 *
 * ── TWO DECISIONS, NEVER ONE ──────────────────────────────────────────────
 * The candidate and the company answer separately, in either order, and
 * neither answer is the other's. A referral has no single `status` field for
 * exactly that reason: collapsing them is how "Northline said no" becomes
 * "Alex's account is gone".
 */

/* -------------------------------------------------------------------------- */
/* Resolving the target organization                                           */
/* -------------------------------------------------------------------------- */

/**
 * How the referrer named the company — kept as PROVENANCE, never as identity.
 *
 * A referral stores one `targetOrganizationId` and this record of what was
 * typed to reach it. The alternative — storing the name, the username and the
 * MC number side by side — gives an organization three identities that drift
 * apart the first time one of them is corrected, and leaves every downstream
 * reader guessing which one is the company.
 */
export type OrganizationLookupKind =
  /** The organization's verified Antcolos handle, e.g. `northline-freight`. */
  | "username"
  /** An MC number, where the organization has one. Carriers and brokers do. */
  | "mc_number"
  /** A name search that the referrer then picked a single result from. */
  | "name_search";

export interface OrganizationLookupProvenance {
  kind: OrganizationLookupKind;
  /** Exactly what the person typed, before normalization. Evidence, not a key. */
  submittedValue: string;
}

/**
 * What a lookup came back with. `ambiguous` and `unresolved` are ANSWERS, not
 * errors: a referral is never created against a guess.
 */
export type OrganizationResolution =
  | { status: "resolved"; organizationId: string; displayName: string; legalName: string; username?: string; mcNumber?: string }
  /** Several organizations match. The referrer picks; the product does not. */
  | { status: "ambiguous"; candidates: OrganizationSearchResult[] }
  | { status: "unresolved" }
  /**
   * Resolved, and the organization is not currently operating on Antcolos.
   *
   * Separated from `unresolved` because the sentence the referrer needs is
   * different, and because sending an introduction into a workspace nobody
   * opens is worse than saying so.
   */
  | { status: "inactive"; organizationId: string; displayName: string };

/** Public identity only. Never members, contacts, documents or relationships. */
export interface OrganizationSearchResult {
  organizationId: string;
  displayName: string;
  legalName: string;
  username?: string;
  dotNumber?: string;
  mcNumber?: string;
}

/* -------------------------------------------------------------------------- */
/* The three independent state axes                                            */
/* -------------------------------------------------------------------------- */

/**
 * The referral itself — the referrer's own act, and only that.
 *
 * `withdrawn` is the REFERRER taking the introduction back. `closed` is the
 * introduction being over: both sides have answered, or it ran out of road.
 * Neither says anything about what the candidate or the company decided.
 */
export type ReferralLifecycle = "submitted" | "withdrawn" | "closed";

export const REFERRAL_LIFECYCLE_LABEL: Record<ReferralLifecycle, string> = {
  submitted: "Submitted",
  withdrawn: "Withdrawn by referrer",
  closed: "Closed",
};

/**
 * What the referred person did about it.
 *
 * The first two are DERIVED from delivery evidence rather than stored: until
 * the person acts, the only truthful thing to say is where their email got to.
 * The last four are stored, because each is something a person actually did (or
 * a deadline that actually passed) and none can be re-derived afterwards.
 *
 * ★ `declined` AND `reported_unwanted` ARE NOT THE SAME STATE ★
 * "Thanks, not interested" and "I never asked to be contacted about jobs" need
 * different consequences: the second one opts the address out of future
 * referral email and raises an abuse report. A product that stored one value
 * for both would keep emailing the second kind of person.
 */
export type CandidateReferralState =
  | "email_pending"
  | "email_delivered"
  | "claimed"
  | "declined"
  | "reported_unwanted"
  | "expired";

export const CANDIDATE_STATE_LABEL: Record<CandidateReferralState, string> = {
  email_pending: "Email queued",
  email_delivered: "Email delivered",
  claimed: "Claimed their account",
  declined: "Declined the referral",
  reported_unwanted: "Reported as unwanted",
  expired: "Link expired unclaimed",
};

/**
 * What the company decided.
 *
 * ★ WHAT `accepted` MEANS, EXACTLY ★
 * "This company is interested in continuing with this person." That is the
 * entire content of the state. It creates no Membership, no permission, no
 * WorkforceEngagement, no employment status and no access to any document. It
 * unlocks one thing: an authorized person may now start the EXISTING invitation
 * and onboarding flow, prefilled, with every decision in that flow still to be
 * made by them.
 */
export type CompanyReferralState = "pending_review" | "accepted" | "rejected";

export const COMPANY_STATE_LABEL: Record<CompanyReferralState, string> = {
  pending_review: "Pending review",
  accepted: "Interested",
  rejected: "Not proceeding",
};

export const COMPANY_ACCEPT_MEANS =
  "Accepting records that this company is interested in continuing with this "
  + "person. It does not create a membership, a role, permissions, a workforce "
  + "engagement or employment, and it gives nobody access to their documents. "
  + "Someone authorized still has to send an invitation through the normal flow "
  + "and decide every one of those separately.";

/* -------------------------------------------------------------------------- */
/* Email delivery — evidence, not optimism                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where one email actually got to.
 *
 * `sent` means a provider accepted it. `delivered` means a provider told us it
 * landed, and is NEVER set by the thing that queued it — a frontend that wrote
 * `delivered` the moment it created a record would be inventing the one fact
 * the whole chain exists to establish. In this build nothing beyond `queued`
 * happens on its own; see `REFERRAL_EMAIL_LIMITATION`.
 */
export type ReferralEmailState = "queued" | "sent" | "delivered" | "bounced" | "failed";

export const REFERRAL_EMAIL_STATE_LABEL: Record<ReferralEmailState, string> = {
  queued: "Queued",
  sent: "Sent to provider",
  delivered: "Delivered (provider confirmed)",
  bounced: "Bounced",
  failed: "Failed",
};

export type ReferralEmailKind =
  /** The first one: you were referred, here is your link. */
  | "candidate_invite"
  /** A deliberate resend of the same introduction, after the cooldown. */
  | "candidate_resend";

export interface ReferralEmailRecord {
  id: string;
  kind: ReferralEmailKind;
  /** The address it was addressed to, normalized. */
  to: string;
  state: ReferralEmailState;
  queuedAt: IsoDateTime;
  sentAt?: IsoDateTime;
  /** Set ONLY from provider evidence. Absent is the honest default. */
  deliveredAt?: IsoDateTime;
  failedAt?: IsoDateTime;
  /** Provider's reason, when there is one. Plain text, never a stack trace. */
  failureReason?: string;
  /** The provider's own id, once a real provider exists to give one. */
  providerMessageId?: string;
}

export const REFERRAL_EMAIL_LIMITATION =
  "No email leaves this browser. A queued record is a record of INTENT: the "
  + "backend owns the transactional provider, the token secret, the send, and "
  + "the delivery webhook that is the only thing allowed to write `delivered` "
  + "or `bounced`.";

/* -------------------------------------------------------------------------- */
/* The secure claim link                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The candidate's single-use, expiring claim token.
 *
 * ███ THE VALUE IN `token` IS NOT A SECRET IN THIS BUILD ███
 * It is generated in the browser, held in memory and readable by anything on
 * the page. It exists to pin the SHAPE a backend must implement: opaque,
 * high-entropy, single-use, expiring, stored as a hash, and resolvable to
 * exactly one referral and no other.
 */
export interface ReferralClaimToken {
  token: string;
  expiresAt: IsoDateTime;
  /** Set when it was spent. A spent token never resolves again. */
  consumedAt?: IsoDateTime;
  /** Set when the candidate declined or reported through this link. */
  closedAt?: IsoDateTime;
}

/**
 * Why a claim link did not resolve. Every one is a REFUSAL, not a crash, and
 * they are separate because the sentence the person needs differs each time.
 *
 * ★ THEY ALL FAIL CLOSED ★
 * Nothing is created, connected or revealed on any of these paths. In
 * particular `wrong_recipient` never quietly re-points the referral at whoever
 * happens to be signed in — that is how a forwarded email becomes somebody
 * else's introduction.
 */
export type ReferralClaimRefusal =
  | "not_found"
  | "expired"
  | "already_claimed"
  | "withdrawn"
  | "closed"
  /** Somebody is signed in, and it is not the person this was addressed to. */
  | "wrong_recipient"
  /** Nobody is signed in. They create an account or sign in, then come back. */
  | "needs_account";

export const REFERRAL_CLAIM_REFUSAL_REASON: Record<ReferralClaimRefusal, string> = {
  not_found: "We don't recognise this link.",
  expired: "This link has expired. Ask the person who referred you to send a new one.",
  already_claimed: "This link has already been used.",
  withdrawn: "The person who referred you withdrew this introduction.",
  closed: "This introduction is closed.",
  wrong_recipient: "This introduction was addressed to somebody else.",
  needs_account: "Create an account or sign in, and we'll bring you back here.",
};

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export type ReferralEventKind =
  | "submitted"
  | "email_queued"
  | "email_state_changed"
  | "claimed"
  | "candidate_declined"
  | "reported_unwanted"
  | "withdrawn"
  | "company_accepted"
  | "company_rejected"
  | "invitation_started"
  | "engagement_connected"
  | "closed"
  | "resend_refused"
  | "claim_refused";

/**
 * Append-only. Nothing in this module edits or removes an event, because the
 * distinguishability the abuse rules depend on — withdrawn vs declined vs
 * rejected vs bounced vs reported — lives here as much as in the state fields.
 */
export interface ReferralEvent {
  id: string;
  at: IsoDateTime;
  kind: ReferralEventKind;
  summary: string;
  /** Who did it, when a person did. Absent for derivations and deliveries. */
  actorName?: string;
  /** Set when an organization member did it, for the company-side audit trail. */
  organizationId?: string;
}

/* -------------------------------------------------------------------------- */
/* What the referrer submitted about the person                                */
/* -------------------------------------------------------------------------- */

/**
 * Contact details AS SUBMITTED BY SOMEBODY ELSE.
 *
 * ★ NONE OF THIS IS A VERIFIED FACT ABOUT THE PERSON ★
 * A referrer typed it. It is evidence of an introduction and is never written
 * onto the candidate's `User`, their `DriverProfile`, or any permanent record —
 * a referrer cannot edit another person's profile, and this record is not a
 * back door to doing so. When the candidate claims the referral, their own
 * account's details stand; these stay here, unchanged, as what was submitted.
 *
 * Both a normalized and a submitted form are kept. Normalization is for
 * matching an existing invitation or opt-out; the submitted form is what the
 * company is shown, because showing somebody a "corrected" phone number they
 * never typed is how a wrong number becomes authoritative.
 */
export interface ReferralCandidateContact {
  fullName: string;
  /** Lower-cased and trimmed. Used for matching, never displayed as truth. */
  email: string;
  submittedEmail: string;
  /** Digits only, with a leading `+` where one was supplied. */
  phone: string;
  submittedPhone: string;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

export interface Referral {
  id: string;
  /** Short, printable, not the token. Safe on a page and in an email subject. */
  reference: string;

  /* -- Who made the introduction -------------------------------------------- */
  /** The permanent account. A referral is made by a PERSON, not by a seat:
   *  a referrer need not belong to the target organization, or to any. */
  referrerUserId: string;
  referrerNameSnapshot: string;

  /* -- Who it is about ------------------------------------------------------ */
  candidate: ReferralCandidateContact;
  /**
   * The candidate's Antcolos account — written ONLY after they securely claim
   * the link or sign in through it.
   *
   * Never inferred from a matching email address. An address matching an
   * account is not proof that the holder of that account asked to be referred,
   * and writing this from a match would let anybody attach a stranger's account
   * to an introduction by typing their address.
   */
  candidateUserId?: string;
  /** Free text. Never a role, never a permission, never an InvitationKind. */
  proposedTitle: string;
  note?: string;

  /* -- Which company -------------------------------------------------------- */
  targetOrganizationId: string;
  /** Snapshotted so a renamed organization does not rewrite old referrals. */
  targetOrganizationNameSnapshot: string;
  /** What was typed to find them. Provenance only; the id above is identity. */
  lookup: OrganizationLookupProvenance;

  /* -- The three axes ------------------------------------------------------- */
  lifecycle: ReferralLifecycle;
  withdrawnAt?: IsoDateTime;
  closedAt?: IsoDateTime;
  closedReason?: string;

  /**
   * The candidate's own answer, when they have given one.
   *
   * Stored only for the three things a person DOES. `email_pending`,
   * `email_delivered` and `expired` are derived from delivery evidence and the
   * clock — see `candidateStateOf`.
   */
  candidateDecision?: {
    state: "claimed" | "declined" | "reported_unwanted";
    at: IsoDateTime;
  };

  company: {
    state: CompanyReferralState;
    decidedAt?: IsoDateTime;
    /** The seat that decided. A company decision is made from inside the company. */
    decidedByMembershipId?: string;
    decidedByName?: string;
    /** The reviewer's own words. Never shown to the referrer or the candidate. */
    internalNote?: string;
  };

  claim: ReferralClaimToken;
  emails: ReferralEmailRecord[];

  /* -- Canonical ids, written only by the modules that own those records ---- */
  /**
   * The invitation the EXISTING access flow issued after acceptance.
   *
   * Written by the handoff once `services.access.create` has returned. There is
   * no second invitation flow in this module and no way to set this without one
   * having been issued.
   */
  resultingInvitationId?: string;
  /**
   * The Workforce engagement the canonical onboarding flow created or resumed.
   *
   * Connected rather than created here: if the organization already has a live
   * engagement for this person, that one is linked, because two engagements for
   * one person at one company is the duplicate this whole module avoids.
   */
  resultingEngagementId?: string;

  createdAt: IsoDateTime;
  events: ReferralEvent[];
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What the REFERRER is allowed to see about their own referral.
 *
 * Deliberately thin. The referrer learns that the introduction was made and
 * roughly where it got to — never the company's internal note, never who
 * inside the company looked at it, never whether the address already had an
 * Antcolos account, and never anything the candidate later told the company.
 */
export type ReferrerVisibleStatus =
  | "sent"
  | "company_reviewing"
  | "company_interested"
  | "company_passed"
  | "candidate_declined"
  | "withdrawn"
  | "closed";

export const REFERRER_STATUS_LABEL: Record<ReferrerVisibleStatus, string> = {
  sent: "Sent",
  company_reviewing: "Company reviewing",
  company_interested: "Company interested",
  company_passed: "Company passed",
  candidate_declined: "Candidate declined",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

export interface ReferrerReferralView {
  id: string;
  reference: string;
  candidateName: string;
  /** Masked. The referrer typed it, so they know it — but the list does not
   *  become a place to read back other people's contact details in bulk. */
  candidateEmailMasked: string;
  proposedTitle: string;
  targetOrganizationName: string;
  status: ReferrerVisibleStatus;
  submittedAt: IsoDateTime;
  /** True while the referrer may still take it back. */
  canWithdraw: boolean;
  /** Set when a resend is possible right now; absent explains itself below. */
  canResend: boolean;
  resendAvailableAt?: IsoDateTime;
}

/**
 * How much the company may know about the candidate's side.
 *
 * ★ MINIMUM PRIVACY-SAFE LEVEL ★
 * Three values, and the company gets no more. It does NOT learn whether the
 * address already belonged to an Antcolos account, what the person's account
 * says, that they declined a different company's referral, or anything about
 * their documents. "Not yet" covers pending, delivered and expired alike,
 * because the difference between them is the candidate's business.
 */
export type CandidateClaimVisibility = "not_yet" | "joined" | "declined";

export const CANDIDATE_CLAIM_VISIBILITY_LABEL: Record<CandidateClaimVisibility, string> = {
  not_yet: "Has not responded yet",
  joined: "Has an Antcolos account",
  declined: "Declined the introduction",
};

/** One row in the company's referral inbox. */
export interface CompanyReferralView {
  id: string;
  reference: string;
  referrerName: string;
  /** Submitted by the referrer. Evidence, not a verified profile fact. */
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  proposedTitle: string;
  note?: string;
  submittedAt: IsoDateTime;
  candidateClaim: CandidateClaimVisibility;
  company: Referral["company"];
  lifecycle: ReferralLifecycle;
  /** Set once the canonical invitation flow has issued one. */
  resultingInvitationId?: string;
  resultingEngagementId?: string;
  /** Company-visible history. Excludes nothing the company did; adds nothing
   *  about the candidate beyond the visibility level above. */
  events: ReferralEvent[];
  /** What the reviewer may do right now, given their permissions and the state. */
  canDecide: boolean;
  canStartInvitation: boolean;
}

/**
 * What the CANDIDATE sees when they open their link, before signing in.
 *
 * Everything here is something the referrer already told them by making the
 * introduction. Nothing about the company's decision is included, because the
 * candidate's account is theirs regardless of it and showing a rejection on
 * this page would make joining Antcolos look conditional on a company's mood.
 */
export interface CandidateReferralView {
  id: string;
  reference: string;
  referrerName: string;
  candidateName: string;
  targetOrganizationName: string;
  proposedTitle: string;
  note?: string;
  expiresAt: IsoDateTime;
  /** The sentence the page must not lose. */
  disclaimer: string;
}

export const CANDIDATE_DISCLAIMER =
  "Creating your Antcolos account is yours and permanent. It does not mean this "
  + "company has accepted you, hired you, or given you anything — they decide "
  + "separately, and your account stays yours either way.";

/* -------------------------------------------------------------------------- */
/* What the referrer is shown before anything is sent                          */
/* -------------------------------------------------------------------------- */

/**
 * The confirmation step, computed from the same values the submit command will
 * act on.
 *
 * Not a sentence somebody wrote on a screen. A disclosure that can drift from
 * what actually happens is worse than none, because people believe it.
 */
export interface ReferralDisclosure {
  /** Shown to the company, verbatim, exactly these fields. */
  sharedWithCompany: Array<{ label: string; value: string }>;
  /** Shown to the candidate in their email, exactly these fields. */
  sharedWithCandidate: Array<{ label: string; value: string }>;
  /** Stated plainly: what the company does NOT get. */
  notShared: string[];
  targetOrganizationName: string;
  limitation: string;
}

export const REFERRAL_DISCLOSURE_NOT_SHARED: readonly string[] = [
  "Your referral does not give the company access to this person's Antcolos profile.",
  "It does not share their documents, licence, medical card or any qualification record.",
  "It does not tell the company whether this email address already has an Antcolos account.",
  "It does not create a membership, a role, permissions or an employment record.",
];

/* -------------------------------------------------------------------------- */
/* Why a submission was refused                                                */
/* -------------------------------------------------------------------------- */

/**
 * Every refusal a submission can meet. Separate values because each one needs a
 * different sentence, and because a product that collapsed `duplicate_active`
 * into a generic failure would resend the email it just refused to resend.
 */
export type ReferralSubmitRefusal =
  | "not_authenticated"
  | "invalid_email"
  | "invalid_phone"
  | "missing_name"
  | "missing_title"
  | "organization_unresolved"
  | "organization_ambiguous"
  | "organization_inactive"
  /** An open referral for this candidate at this company already exists. */
  | "duplicate_active"
  /** The referrer has hit their per-hour or per-day cap. */
  | "rate_limited_referrer"
  /** This candidate has been referred too many times, by anybody. */
  | "rate_limited_recipient"
  /** This organization has received too many referrals in the window. */
  | "rate_limited_organization"
  /** The address asked not to receive referral email. Never revealed as such. */
  | "recipient_opted_out"
  /** Referring yourself is not an introduction. */
  | "self_referral";

export const REFERRAL_SUBMIT_REFUSAL_REASON: Record<ReferralSubmitRefusal, string> = {
  not_authenticated: "Sign in before referring somebody.",
  invalid_email: "That is not an email address.",
  invalid_phone: "That is not a phone number we can use.",
  missing_name: "Enter the person's full name.",
  missing_title: "Say what kind of work you are introducing them for.",
  organization_unresolved: "We could not find that company on Antcolos.",
  organization_ambiguous: "More than one company matches. Pick the right one.",
  organization_inactive: "That company is not currently taking referrals on Antcolos.",
  duplicate_active:
    "You have already referred this person to this company and it is still open.",
  rate_limited_referrer: "You have made a lot of referrals recently. Try again later.",
  rate_limited_recipient:
    "We can't send another introduction to this person right now.",
  rate_limited_organization:
    "This company has received a lot of referrals recently. Try again later.",
  // Deliberately the SAME sentence as the recipient rate limit. An opt-out that
  // announced itself would turn the referral form into a way of asking whether
  // somebody has opted out — which is a fact about them, not about the sender.
  recipient_opted_out: "We can't send another introduction to this person right now.",
  self_referral: "You cannot refer yourself.",
};

export const REFERRAL_LIMITATION =
  "Nothing here is persisted beyond this browser tab. The token is generated in "
  + "the browser and is not a secret; no email is sent; the rate limits count "
  + "only what this tab has seen; and every permission check happens on the same "
  + "side of the wire as the caller. This proves the SHAPE a backend must "
  + "implement — it is not one.";
