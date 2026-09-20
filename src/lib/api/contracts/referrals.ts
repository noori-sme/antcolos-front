import type {
  CandidateReferralView, CompanyReferralView, OrganizationLookupKind,
  OrganizationResolution, OrganizationSearchResult, Referral, ReferralClaimRefusal,
  ReferralDisclosure, ReferralEmailState, ReferrerReferralView, ReferralSubmitRefusal,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE REFERRAL SEAM ★
 *
 * One person introducing another person to a company. Nothing more.
 *
 * ── WHAT THIS SERVICE CANNOT DO, STRUCTURALLY ─────────────────────────────
 * Read the methods: not one of them takes or returns a `PermissionKey`, a
 * `Membership`, an `AppliedTemplate`, an `InvitationDraft`, a
 * `WorkforceEngagement`, a `DriverProfile` or a document id. There is no
 * `grant`, no `hire`, no `onboard` and no `createInvitation`. The one method
 * that reaches the invitation system — `handoff` — RETURNS the prefill values
 * and records the id afterwards; the invitation itself is created by
 * `services.access.create`, the canonical command, from a screen where an
 * authorized person confirms every field.
 *
 * ── THE TWO IDENTITIES THIS SERVICE TALKS TO ──────────────────────────────
 * Most of Antcolos is organization-scoped: every call carries a
 * `ServiceContext` and acts as a membership inside a workspace. Referrals are
 * deliberately not all like that, because the product statement is "ANY
 * authenticated user may refer somebody to ANY company", and a referrer who had
 * to be a member of the target company could not make that introduction.
 *
 * So there are three surfaces with three different authorizations:
 *
 *   REFERRER      `ReferringIdentity` — the permanent account, no organization.
 *                 Submitting, listing their own, withdrawing their own.
 *   COMPANY       `ServiceContext` + `referrals:review`, scoped to
 *                 `ctx.organizationId`. Reading the inbox, accepting,
 *                 rejecting, starting the handoff.
 *   CANDIDATE     the claim token, plus proof of who is signed in. Never a
 *                 membership: the whole point is that they belong to nothing
 *                 yet.
 *
 * ── HOW READS ARE SCOPED ──────────────────────────────────────────────────
 * A company read is scoped to `referral.targetOrganizationId === ctx.organizationId`
 * and to nothing else. Being NAMED on a referral — as the referrer, as the
 * candidate, as a company whose name happens to appear in a note — is
 * attribution, never a grant. `companyGet` applies the same rule as
 * `companyInbox`, so a direct id from another organization answers exactly as a
 * nonexistent one does.
 *
 * ── WHAT IS NEVER REVEALED ────────────────────────────────────────────────
 * Whether an email address or phone number already has an Antcolos account.
 * Not to the referrer, not to the company, not in a refusal message, and not by
 * timing or by the shape of a response. `REFERRAL_SUBMIT_REFUSAL_REASON` gives
 * `recipient_opted_out` and `rate_limited_recipient` the SAME sentence for
 * exactly this reason.
 *
 * ███ FRONTEND ONLY — SEE `REFERRAL_LIMITATION` ███
 * In-memory for the life of the tab. The tokens are generated in the browser
 * and are not secrets. No email is sent. The rate limits count what this tab
 * has seen and nothing else. Every check below happens on the same side of the
 * wire as its caller, so none of it is a security property — it is the SHAPE a
 * backend has to implement, written down precisely enough to implement against.
 */

/**
 * The person making, listing or withdrawing a referral.
 *
 * ███ SUPPLIED, NOT PROVEN ███
 * Exactly like `AcceptingIdentity` in the access contract, and for the same
 * reason: it comes from `useSession()`, which comes from a query parameter. A
 * backend DERIVES this from the session it issued and can verify, and never
 * from a body field, a header, or the claim token — the token proves which
 * referral, never who is holding it.
 */
export interface ReferringIdentity {
  userId: string;
  email: string;
  displayName: string;
}

/** What the referrer typed. The organization is a REFERENCE, resolved below. */
export interface ReferralDraft {
  candidateFullName: string;
  candidateEmail: string;
  candidatePhone: string;
  /** Free text. Never validated against a role, a template or a title list. */
  proposedTitle: string;
  note?: string;
  /**
   * How they named the company.
   *
   * ★ TWO FIELDS, BECAUSE THEY ARE TWO DIFFERENT THINGS ★
   * `value` is what the person TYPED and is kept as provenance, unchanged,
   * forever. `organizationId` is the single result they then PICKED, and is
   * what the referral is actually made against.
   *
   * Collapsing them — sending the id back as the typed value — loses the search
   * that found it, which is the one piece of evidence that explains a referral
   * somebody later says they did not mean to make. Sending only the typed value
   * would mean re-running a name search at submit time and hoping it still
   * returns exactly one result.
   *
   * When `organizationId` is absent the value is resolved on its own, which is
   * the username and MC-number case: those identify a company exactly, so there
   * is nothing to pick.
   */
  organizationLookup: {
    kind: OrganizationLookupKind;
    value: string;
    /** The result the person chose, when the lookup offered a choice. */
    organizationId?: string;
  };
}

export type ReferralSubmitResult =
  | { status: "submitted"; referral: Referral; view: ReferrerReferralView }
  | {
    status: "refused";
    refusal: ReferralSubmitRefusal;
    message: string;
    /** Only on `organization_ambiguous`: the choices, so the form can offer them. */
    candidates?: OrganizationSearchResult[];
    /** Only on a rate limit: when it lifts, so the screen can say. */
    retryAt?: string;
  };

/** Resolving a claim link, before anybody is asked to do anything. */
export type ReferralClaimLookup =
  | { status: "refused"; refusal: ReferralClaimRefusal; message: string }
  /** The link is good and nobody is signed in. They sign up and come back. */
  | { status: "needs-account"; view: CandidateReferralView }
  | { status: "valid"; view: CandidateReferralView; signedInAs: string };

export type ReferralClaimResult =
  | { status: "claimed"; referral: Referral }
  | { status: "refused"; refusal: ReferralClaimRefusal; message: string };

export type CompanyDecisionResult =
  | { status: "decided"; view: CompanyReferralView }
  | {
    status: "refused";
    refusal: "not_permitted" | "not_found" | "already_decided" | "withdrawn";
    message: string;
  };

/**
 * What the company reviewer is handed when they go on to invite somebody.
 *
 * PREFILL VALUES AND NOTHING ELSE. Notice what is absent: no permission set, no
 * template, no `InvitationKind`, no engagement type, no start date. Every one of
 * those is a decision the invitation flow asks an authorized person to make,
 * and pre-deciding any of them from a stranger's free-text title is precisely
 * how a referral would quietly become a hiring.
 *
 * `existingEngagementId` is the one thing that is more than a prefill: when the
 * organization already has a live engagement for this person, the invitation
 * must CONNECT it rather than start a second one, which is what the access
 * module's `InvitationDraft.engagementId` already does.
 */
export interface ReferralHandoff {
  referralId: string;
  recipientName: string;
  recipientEmail: string;
  /** Context for the person filling the form. Never written to a record. */
  proposedTitleContext: string;
  referrerName: string;
  note?: string;
  /** Present when the candidate has claimed. The invitation resolves the
   *  account itself; this is for the screen to say "they are already here". */
  candidateHasAccount: boolean;
  /** A live engagement this organization already has for this person. */
  existingEngagementId?: string;
  /** Said out loud on the screen, every time. */
  meaningOfAcceptance: string;
}

export interface ReferralsService {
  /* ---- finding the company, before anything is created ---- */
  /** Public identity only. Never members, documents or relationships. */
  searchOrganizations(query: string): Promise<OrganizationSearchResult[]>;
  /** One organization, or an honest refusal. Never a guess. */
  resolveOrganization(
    kind: OrganizationLookupKind, value: string,
  ): Promise<OrganizationResolution>;

  /* ---- the referrer's side ---- */
  /**
   * Exactly what will be shared, with whom, computed from the draft.
   *
   * The same values `submit` acts on, so the confirmation cannot drift from the
   * outcome. Returns null when the draft does not resolve to one organization —
   * there is nothing honest to show about a referral that cannot be made.
   */
  disclose(
    identity: ReferringIdentity, draft: ReferralDraft,
  ): Promise<ReferralDisclosure | null>;
  submit(
    identity: ReferringIdentity, draft: ReferralDraft,
  ): Promise<ReferralSubmitResult>;
  /** ONLY the referrals this account created. Never anybody else's. */
  myReferrals(identity: ReferringIdentity): Promise<ReferrerReferralView[]>;
  withdraw(
    identity: ReferringIdentity, referralId: string,
  ): Promise<ReferrerReferralView | null>;
  /**
   * Send the introduction again.
   *
   * Bounded by a cooldown and a hard cap, refused outright once the candidate
   * has answered, and refused for an address that opted out. "Resend" is the
   * single most abusable button in this module: without those rules it is a way
   * to email a stranger repeatedly using somebody else's product as the sender.
   */
  resend(
    identity: ReferringIdentity, referralId: string,
  ): Promise<{ status: "queued" } | { status: "refused"; message: string }>;

  /* ---- the company's side ---- */
  /** Scoped to `ctx.organizationId`. Requires `referrals:review`. */
  companyInbox(ctx: ServiceContext): Promise<CompanyReferralView[]>;
  /** Same scope rule as the list. A foreign id answers as a missing one. */
  companyGet(ctx: ServiceContext, referralId: string): Promise<CompanyReferralView | null>;
  /**
   * "We are interested." That is all it means and all it does.
   *
   * It creates no membership, no permission, no engagement, no relationship and
   * no document access, and the return value carries no such id.
   */
  accept(
    ctx: ServiceContext, referralId: string, internalNote?: string,
  ): Promise<CompanyDecisionResult>;
  reject(
    ctx: ServiceContext, referralId: string, internalNote?: string,
  ): Promise<CompanyDecisionResult>;
  /** Prefill values for the EXISTING invitation flow. Creates nothing. */
  handoff(ctx: ServiceContext, referralId: string): Promise<ReferralHandoff | null>;
  /**
   * Record that the canonical invitation flow issued one.
   *
   * Called AFTER `services.access.create` returned. It writes an id onto the
   * referral and closes it; it cannot create an invitation and does not try.
   */
  recordInvitation(
    ctx: ServiceContext, referralId: string, invitationId: string,
  ): Promise<CompanyReferralView | null>;

  /* ---- the candidate's side ---- */
  lookUpClaim(
    token: string, identity: ReferringIdentity | null,
  ): Promise<ReferralClaimLookup>;
  /** Connects the referral to the signed-in account. Creates no account. */
  claim(token: string, identity: ReferringIdentity): Promise<ReferralClaimResult>;
  /** "Thanks, no." Leaves their account, and everything else, alone. */
  decline(token: string, identity: ReferringIdentity | null): Promise<ReferralClaimResult>;
  /**
   * "I never asked to be contacted."
   *
   * Distinct from `decline` on purpose: it opts the address out of all future
   * referral email and records an abuse report. Available WITHOUT signing in,
   * because requiring an account before somebody can stop unwanted mail is
   * requiring them to join the thing that is mailing them.
   */
  reportUnwanted(token: string, reason?: string): Promise<ReferralClaimResult>;

  /* ---- delivery evidence ---- */
  /**
   * Record what the provider said about one email.
   *
   * ███ THE BACKEND'S WEBHOOK, MODELLED ███
   * In this build it is a test and demo hook and nothing calls it on its own.
   * On a server this is the delivery webhook, authenticated by provider
   * signature, and it is the ONLY thing permitted to write `delivered` or
   * `bounced` — the sender never writes its own delivery receipt.
   */
  recordDelivery(
    referralId: string, emailId: string, state: ReferralEmailState, detail?: string,
  ): Promise<void>;
}
