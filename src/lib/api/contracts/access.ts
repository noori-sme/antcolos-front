import type {
  CarrierRelationship, EngagementType, Invitation, InvitationKind,
  InvitationRefusal, Membership, PermissionKey,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * ★ THE ACCESS SEAM ★
 *
 * Who may be in an organization, on what basis, and how they got there.
 *
 * PR-1 built a `Membership` the session can observe and a `DriverProfile` with
 * one writer, and said of `grantMembership`: *"it writes a seat and notifies;
 * it decides nothing. WHO may ask for one, on what basis, and what else must be
 * true first is the Access service's, and the Access service does not exist
 * yet."* This is that service.
 *
 * ── THE ASYMMETRY THAT SHAPES THIS FILE ────────────────────────────────────
 *
 * Every other service in this folder takes a `ServiceContext`, because
 * "a request is always made *as a membership, inside an organization*".
 * Issuance is exactly that: a seat holding `invitations:create` offers access
 * to the organization it is already in.
 *
 * ACCEPTANCE CANNOT BE. The person accepting holds no seat in that
 * organization — the seat is the thing being created. So acceptance is
 * authorized on a different axis: the signed-in ACCOUNT, matched against the
 * account the invitation names. That is not a weaker check, it is the only
 * check that means anything here, and writing it down as a distinct input type
 * is what stops somebody quietly passing an organization id instead.
 *
 * ── WHAT THIS SERVICE DELIBERATELY DOES NOT DO ─────────────────────────────
 *
 * It does not grant DISPATCH REACH. A carrier letting an outside organization
 * work its freight is a per-truck `TruckDispatchAccess`, issued from the truck
 * it concerns by a membership holding `trucks:relationships:manage`, and every
 * read and write behind it is authorized by `dispatch-delegation.ts`. An
 * invitation of kind `dispatch_org` puts PEOPLE in a workspace; it hands over
 * no truck, and this service has no method that could. Two doors to the same
 * reach is how a delegation boundary stops meaning anything.
 *
 * It does not decide anybody's PERMISSIONS either. The invitation carries a
 * snapshot, clamped at issue time to what the sender could grant, and
 * `effectivePermissions` turns the resulting membership into a permission set
 * exactly as it does for a seeded one.
 */

/* -------------------------------------------------------------------------- */
/* Issuing                                                                     */
/* -------------------------------------------------------------------------- */

export interface IssueInvitationInput {
  kind: InvitationKind;
  /** The role as it reads today. Snapshotted: later edits do not re-scope it. */
  roleName: string;
  customRoleId?: string;
  /** Driver invitations only. The carrier's decision, never the driver's. */
  engagementType?: EngagementType;
  recipientName: string;
  recipientEmail: string;
  permissions: readonly PermissionKey[];
  scopedToCarrierName?: string;
  /** Null means it never expires. Omitted means the default window. */
  expiresInDays?: number | null;
}

export type IssueInvitationRefusal =
  /** The sender does not hold `invitations:create` in this organization. */
  | "not_permitted"
  /** They tried to hand out access they do not hold themselves. */
  | "permissions_exceed_granter"
  /** A driver invitation with no engagement type, or a malformed address. */
  | "invalid";

export type IssueInvitationResult =
  | { status: "issued"; invitation: Invitation }
  | { status: "refused"; refusal: IssueInvitationRefusal; message: string;
      /** Set for `permissions_exceed_granter`: exactly which keys. */
      ungrantable?: PermissionKey[] };

/* -------------------------------------------------------------------------- */
/* Who is accepting                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The signed-in account, from the session boundary.
 *
 * Deliberately NOT a `ServiceContext`: see the note at the top. It is also
 * deliberately not a bag of optional fields — an acceptance with no identity is
 * expressed as `null`, so "nobody is signed in" is a state the caller has to
 * handle rather than an empty string that compares equal to something.
 */
export interface AcceptingIdentity {
  userId: string;
  email: string;
  displayName: string;
  /**
   * Which fixture roster this tab is running on.
   *
   * A mock-only concern that exists because the membership store keeps one
   * roster per scenario. Passed IN rather than read here, so this module never
   * reaches for a browser API and stays testable on the node runner.
   */
  scenario: "demo" | "newcomer";
}

/* -------------------------------------------------------------------------- */
/* Resolving a link                                                            */
/* -------------------------------------------------------------------------- */

export type InvitationResolution =
  /** Everything checks out. This person may accept this invitation. */
  | { status: "ready"; invitation: Invitation }
  /**
   * Already accepted BY THIS PERSON. Not a failure — the idempotent answer,
   * carrying the seat they already hold so the screen can show it.
   */
  | { status: "already_accepted"; invitation: Invitation; membershipId?: string }
  | { status: "refused"; refusal: InvitationRefusal; message: string;
      /** Present whenever the invitation itself was found. */
      invitation?: Invitation;
      /** For `wrong_recipient`: the address actually signed in. */
      signedInAs?: string };

/* -------------------------------------------------------------------------- */
/* Accepting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One checklist row, in the words the person is shown.
 *
 * Both lists below are rows rather than keys on purpose. A requirement key is
 * an internal identifier — `northline_employment_application` — and a screen
 * that printed one would be showing somebody a database column and calling it
 * paperwork. Carrier-specific rows are exactly the ones a global label lookup
 * cannot resolve, so the answer travels with the decision instead.
 */
export interface DocumentRow {
  key: string;
  label: string;
  /** For a withheld row: why its category is never handed over in bulk. */
  reason?: string;
}

export interface AcceptanceOutcome {
  invitation: Invitation;
  /** The seat. Observable in the session the moment this returns. */
  membership: Membership;
  /**
   * The driver engagement, for a driver invitation.
   *
   * Carries `acceptedAt` and NO `startedAt`: accepting is not starting. See
   * `CarrierRelationship` in `@/types/driver-profile`.
   */
  relationship?: CarrierRelationship;
  /** The permanent profile, reused if the person already had one. */
  driverProfileId?: string;
  driverProfileResumed?: boolean;
  /** What the person agreed to share. Ordinary paperwork only. */
  sharedDocuments: DocumentRow[];
  /**
   * The restricted paperwork deliberately NOT shared.
   *
   * Carried as rows rather than keys because a screen has to NAME them and say
   * why: a person who has just read a checklist and then sees a shorter shared
   * list needs to be told the difference was on purpose. A bare requirement key
   * is not something to show anybody.
   */
  withheldDocuments: DocumentRow[];
  /** True when this call created the seat; false when it already existed. */
  created: boolean;
}

export type AcceptInvitationResult =
  | { status: "accepted"; outcome: AcceptanceOutcome }
  /** Idempotent replay. Identical outcome; nothing was written a second time. */
  | { status: "already_accepted"; outcome: AcceptanceOutcome }
  | { status: "refused"; refusal: InvitationRefusal; message: string };

/* -------------------------------------------------------------------------- */
/* Ending a seat                                                               */
/* -------------------------------------------------------------------------- */

export type EndSeatResult =
  | { status: "ended"; membership: Membership }
  /** Idempotent: it was already gone. A success, not a failure. */
  | { status: "already_ended" }
  | { status: "refused"; refusal: "not_permitted" | "not_found" | "last_owner"; message: string };

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export interface AccessService {
  /** Offers access to the organization in `ctx`. Requires `invitations:create`. */
  issue(ctx: ServiceContext, input: IssueInvitationInput): Promise<IssueInvitationResult>;

  /** This organization's invitations. Requires `invitations:view`. */
  list(ctx: ServiceContext): Promise<Invitation[]>;

  /** Takes one back. Requires `invitations:revoke`. Idempotent. */
  revoke(ctx: ServiceContext, invitationId: string, reason?: string): Promise<Invitation>;

  /**
   * What this link means for whoever is holding it.
   *
   * Takes the identity rather than a context, and takes `null` for nobody
   * signed in. Never throws for a bad token: an unknown link is a refusal with
   * a sentence, because the person reading it mistyped something.
   */
  resolve(token: string, identity: AcceptingIdentity | null): Promise<InvitationResolution>;

  /**
   * Accepts, as the person the invitation names.
   *
   * IDEMPOTENT on the invitation: a retry, a double click, or a link opened
   * twice produces ONE seat, ONE relationship, ONE profile and ONE audit entry.
   */
  accept(token: string, identity: AcceptingIdentity): Promise<AcceptInvitationResult>;

  /**
   * Ends somebody's seat. Requires `members:suspend` in the organization.
   *
   * Ends ACCESS and nothing else: the person, their profile, their documents
   * and their other organizations are untouched.
   */
  endSeat(ctx: ServiceContext, membershipId: string, reason: string): Promise<EndSeatResult>;
}
