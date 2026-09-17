import type {
  AcceptanceRun, EngagementType, Invitation, InvitationKind, PermissionKey,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE ACCESS SEAM ★
 *
 * Who was invited, on what terms, and what happens when they say yes.
 *
 * Invitations used to live in `src/features/access/mock-access.ts` — a
 * feature-local store that no other module could read and that no service
 * contract described. That was survivable while accepting one only changed a
 * status string. It stops being survivable the moment acceptance has to reach
 * the driver registry, the document store, the membership roster and Workforce,
 * because a feature writing across four module boundaries is exactly the shape
 * this codebase spent every previous milestone avoiding.
 *
 * ── WHAT THIS SERVICE DOES NOT DO ──────────────────────────────────────────
 *
 * It creates no person, no document and no engagement of its own. Every write
 * goes through the module that owns the record, by that module's own
 * create-or-resume call:
 *
 *   the person's profile     the driver registry's `createOrResumeProfile`,
 *                            keyed on the authenticated account
 *   the relationship         the driver module's own command
 *   document access          a LINK in the one document store — never a copy,
 *                            never a new document identity
 *   the workspace seat       the session's membership store
 *   the engagement           Workforce's own record, and only its
 *                            `driverProfileId` is written
 *
 * ── WHAT ACCEPTANCE GRANTS, EXACTLY ────────────────────────────────────────
 *
 *   ✓ the relationship the invitation describes, as `onboarding`
 *   ✓ ordinary document access the relationship needs, disclosed before the
 *     person confirms, and bounded by what they agreed to share
 *   ✓ the minimum driver-scoped seat that opens their own portal
 *
 *   ✗ general organization permissions. The seat carries the invitation's
 *     snapshot clamped to the driver preset, with `OWN_RECORDS_SCOPE`.
 *   ✗ SSN, bank details, drug and alcohol records, MVRs, background checks or
 *     any other restricted qualification category. Those have their own
 *     purpose-bound basis and acceptance is not one.
 *   ✗ a start date. Accepting is not being cleared to work. Only the
 *     authorized activation step sets `CarrierRelationship.startedAt`, and a
 *     carrier's asserted historical date is never replaced with today's.
 *
 * ── HOW READS ARE SCOPED (A6) ──────────────────────────────────────────────
 * Management reads take a `ServiceContext` and are scoped to
 * `invitation.organizationId`. The acceptance path is deliberately different:
 * the person accepting has no seat in that organization yet — that is the thing
 * they are being given — so it is authorised by the token plus proof that the
 * authenticated account is the addressee, never by a membership.
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab. `ServiceContext` is assembled in the
 * browser, so none of this is a security property: it proves the shape a real
 * API must meet. No invitation is emailed. There is no transaction across the
 * modules acceptance touches, and no uniqueness constraint that would survive
 * two tabs racing.
 */

export interface InvitationDraft {
  kind: InvitationKind;
  /** A preset name, or the custom role's name. Snapshotted onto the invitation. */
  roleName: string;
  customRoleId?: string;
  /** Driver invitations only. The carrier's decision, never the driver's. */
  engagementType?: EngagementType;
  recipientName: string;
  recipientEmail: string;
  /**
   * What the seat would carry. Snapshotted here so editing a role later cannot
   * silently re-scope an invitation somebody is about to accept.
   */
  permissions: PermissionKey[];
  scopedToCarrierName?: string;
  expiresAt: string | null;
  /**
   * The Workforce engagement this invitation is connecting, when the carrier
   * already recorded this person.
   *
   * Present for a migrated worker, absent for somebody genuinely new. It is
   * what makes acceptance a CONNECTION rather than a hiring: the engagement's
   * asserted start date, its history and its state are untouched, and only its
   * `driverProfileId` is filled in.
   */
  engagementId?: string;
}

/** What a link resolves to, and why, before anybody is asked to confirm. */
export type InvitationLookup =
  | { status: "not-found" }
  | { status: "revoked"; invitation: Invitation }
  | { status: "expired"; invitation: Invitation }
  /** Already finished, by this person or another. Nothing left to do. */
  | { status: "used"; invitation: Invitation }
  /** The recipient has no account yet. They make one and come back. */
  | { status: "needs-account"; invitation: Invitation }
  /** Signed in as somebody else. Never quietly attaches to the wrong account. */
  | { status: "wrong-recipient"; invitation: Invitation; signedInAs: string }
  | { status: "valid"; invitation: Invitation; signedInAs: string }
  /**
   * THIS person started accepting and something did not finish.
   *
   * The state that stops a half-finished acceptance locking somebody out of
   * their own retry. A run belonging to anybody else still reads `used`.
   */
  | { status: "resume"; invitation: Invitation; signedInAs: string; run: AcceptanceRun };

export interface LookUpOptions {
  /** True when the person has just come back through Sign Up or Sign In. */
  returningFromAuth: boolean;
}

/**
 * What the person is agreeing to, computed and shown BEFORE they confirm.
 *
 * Not a summary written by hand on a screen: the same values the acceptance
 * command will act on. A disclosure that could drift from what actually happens
 * is worse than none, because people believe it.
 */
export interface AcceptancePreview {
  invitation: Invitation;
  /** The seat, in the permissions it would actually carry. */
  permissions: PermissionKey[];
  /** Document requirement keys that would become visible to the carrier. */
  sharedDocumentKeys: string[];
  /** Restricted categories, listed so the screen can say they are NOT included. */
  withheldCategories: string[];
  /** True when this connects an engagement the carrier already recorded. */
  connectsExistingEngagement: boolean;
  /** The carrier's asserted start date, when it has one. Never changed here. */
  assertedStartDate?: string;
  limitation: string;
}

export interface AcceptInput {
  /**
   * The document requirement keys the person agreed to share.
   *
   * Their decision, passed explicitly. An acceptance command that derived this
   * from the carrier's requirements would be the carrier consenting on the
   * driver's behalf.
   */
  sharedDocumentKeys: string[];
  /** Needed only when they have no profile yet. Ignored when one is resumed. */
  licence?: {
    legalName: string;
    cdlNumber: string;
    cdlState: string;
    cdlExpiresAt: string;
  };
}

export type AcceptResult =
  /** Every applicable step done. The invitation now reads accepted. */
  | { status: "accepted"; run: AcceptanceRun }
  /** Some step did not finish. The run is kept and can be resumed. */
  | { status: "incomplete"; run: AcceptanceRun }
  | { status: "not-acceptable"; lookup: InvitationLookup }
  | { status: "licence-required" };

export interface AccessService {
  /* ---- management, by the organization that sent them ---- */
  list(ctx: ServiceContext): Promise<Invitation[]>;
  create(ctx: ServiceContext, draft: InvitationDraft): Promise<Invitation>;
  revoke(ctx: ServiceContext, invitationId: string): Promise<Invitation>;
  /**
   * Puts an expired invitation back in play and pushes the expiry out.
   *
   * Refuses one that has already been accepted. Re-opening a finished
   * invitation is how a second relationship gets created for somebody who
   * already has one.
   */
  resend(ctx: ServiceContext, invitationId: string): Promise<Invitation>;

  /* ---- acceptance, by the person the invitation names ---- */
  lookUp(token: string, options: LookUpOptions): Promise<InvitationLookup>;
  /** What accepting would do. Changes nothing. */
  preview(token: string, options: LookUpOptions): Promise<AcceptancePreview | null>;
  /**
   * Accepts, one canonical record at a time.
   *
   * IDEMPOTENT throughout: every step resumes what exists rather than making a
   * second one, so a retry after a partial failure completes what is missing
   * and repeats nothing.
   */
  accept(token: string, options: LookUpOptions, input: AcceptInput): Promise<AcceptResult>;
}
