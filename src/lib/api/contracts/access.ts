import type {
  AcceptanceRun, CarrierRelationship, EngagementType, Invitation, InvitationKind,
  Membership, PermissionKey, User,
} from "@/types";
import type { DriverSharingPlan } from "@/features/driver/mock-driver";
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
  /** The recipient already turned it down. Not the same as the sender revoking. */
  | { status: "declined"; invitation: Invitation }
  | { status: "expired"; invitation: Invitation }
  /** Already finished, by this person or another. Nothing left to do. */
  | { status: "used"; invitation: Invitation }
  /** The recipient has no account yet. They make one and come back. */
  | { status: "needs-account"; invitation: Invitation }
  /**
   * An invitation that would connect a whole ORGANIZATION, not a person.
   *
   * Refused outright rather than accepted as something adjacent. A dispatch
   * agency working a carrier's freight is an arrangement between two
   * organizations with its own scope, its own end date and its own per-truck
   * delegation — not a seat handed to whoever opened the link. Quietly
   * granting the nearest thing this flow knows how to grant would be granting
   * reach nobody agreed to.
   */
  | { status: "organization-invitation"; invitation: Invitation }
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

/**
 * Who is asking — supplied, never worked out.
 *
 * ███ IN THIS BUILD IT IS A SIMULATION, NOT AN AUTHENTICATED IDENTITY ███
 *
 * Follow it down and it is still a URL:
 *
 *   acceptance-screen.tsx  →  useSession().user
 *   SessionProvider        →  scenario === "newcomer" ? NEWCOMER_USER : MOCK_USER
 *   readSessionScenario()  →  `?fixture=` on the address bar, or sessionStorage
 *
 * So anybody can be anybody by editing the query string, and every check
 * downstream — the addressee match, a resume that belongs to one person, the
 * refusal to let somebody decline another's invitation — is a statement about a
 * value the caller chose. None of it is a security property. What it is worth
 * is the SHAPE: it pins where identity must come from, so a server has
 * something exact to implement.
 *
 * It is still a real improvement on what it replaced. `{ returningFromAuth }`
 * meant "somebody arrived carrying this link, so assume they are the
 * addressee" — one boolean, set from `?signedin=1`, standing in for a person —
 * and forwarding an invitation email was a way to give away a seat. The
 * service also reached into `@/lib/session/scenarios` itself, which put a
 * window read underneath an API-layer module. Identity being an explicit input
 * is what makes these rules testable at all; it is not what makes them
 * enforced.
 *
 * ★ WHAT THE BACKEND MUST DO INSTEAD ★
 * On every one of these calls the server DERIVES the acting identity from the
 * authenticated session it issued and can verify — never from a body field, a
 * query parameter, a header the client sets, or the invitation token itself.
 * The token proves which invitation, never who is holding it.
 */
export interface AcceptingIdentity {
  userId: string;
  email: string;
  displayName: string;
  /**
   * Which fixture roster this tab runs on.
   *
   * A mock-only concern: the membership store keeps one roster per scenario.
   * Passed in for the same reason as the rest of this.
   */
  scenario: "demo" | "newcomer";
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
  /**
   * What this ONE decision actually covers, itemised — which documents the
   * person already holds and at which version, which required ones they have
   * not uploaded (and which the carrier therefore does NOT receive), and which
   * restricted records are not part of it at all.
   *
   * Shown BEFORE anybody agrees. A single consent is only one decision if the
   * person can see its extent; without this it is a blank cheque with a tidy
   * sentence on it.
   */
  plan: DriverSharingPlan | null;
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
  | { status: "licence-required" }
  /**
   * A caller named a restricted qualification category.
   *
   * Refused outright and FIRST, rather than narrowed quietly: somebody asking
   * for a drug and alcohol result should be told no, not watch four steps
   * succeed while a fifth hands over nothing. A carrier that wants one asks for
   * it under its own purpose-bound basis; saying yes to an invitation is not
   * that basis.
   */
  | { status: "restricted-category"; categories: string[] };

export interface RosterEntry {
  membership: Membership;
  /** The person behind the seat, when Antcolos knows them. A lookup, never a search. */
  account?: User;
  /** Derived through `effectivePermissions`. No screen computes a permission. */
  permissions: PermissionKey[];
  /** Their live driving relationships with this organization, if any. */
  relationships: CarrierRelationship[];
}

export type EndSeatResult =
  | { status: "ended"; membership: Membership }
  /** Already gone, or never here. Both are "nothing left to do". */
  | { status: "already_ended" }
  | { status: "refused"; refusal: "not_permitted" | "last_owner"; message: string };

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
  lookUp(token: string, identity: AcceptingIdentity | null): Promise<InvitationLookup>;
  /** What accepting would do. Changes nothing. */
  preview(token: string, identity: AcceptingIdentity): Promise<AcceptancePreview | null>;
  /**
   * The recipient turning it down.
   *
   * Their refusal, which is not the sender's `revoke`: the record has to say
   * which of the two happened, or a carrier cannot tell "we withdrew it" from
   * "they said no". Only the person the invitation names may do it, and it
   * creates nothing.
   */
  decline(token: string, identity: AcceptingIdentity): Promise<Invitation | null>;

  /* ---- the roster, from the organization's side ---- */
  /**
   * Who is actually in this organization, with what each seat carries.
   *
   * On the SERVICE rather than exported from a mock module, because a screen
   * reaching into `@/lib/api/mock/*` is the thing the contracts layer exists to
   * prevent: it binds the page to the mock and skips the `ServiceContext` every
   * other read goes through.
   */
  roster(ctx: ServiceContext): Promise<RosterEntry[]>;
  endSeat(ctx: ServiceContext, membershipId: string, reason: string): Promise<EndSeatResult>;
  /** The same act, done to yourself. No permission is needed to stop working somewhere. */
  leaveOrganization(ctx: ServiceContext, reason?: string): Promise<EndSeatResult>;
  /**
   * Accepts, one canonical record at a time.
   *
   * IDEMPOTENT throughout: every step resumes what exists rather than making a
   * second one, so a retry after a partial failure completes what is missing
   * and repeats nothing.
   */
  accept(
    token: string, identity: AcceptingIdentity, input: AcceptInput,
  ): Promise<AcceptResult>;
}
