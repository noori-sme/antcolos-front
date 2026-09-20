import type {
  Achievement, ProfileContribution, ProfileSectionVisibility, ProfileVisibility,
  ProfileView, ShareCard, UserProfile, Username,
} from "@/types";
import type { ProfileViewer } from "@/lib/profile/visibility";
import type { ServiceContext } from "./context";

/**
 * ★ THE PROFILE SEAM ★
 *
 * The permanent, organization-independent career record. This is the ONE
 * service in Antcolos whose reads do not take a `ServiceContext`, and the
 * exception is load-bearing rather than convenient.
 *
 * Every other service reads records that BELONG to an organization, so every
 * other service asks "who are you, in which organization, holding what
 * permissions". A profile belongs to a person. Its readers include a
 * signed-out stranger following a link and a link-preview crawler in a group
 * chat, neither of which is a membership in anything. Forcing a
 * `ServiceContext` on those reads would mean inventing an organization for
 * somebody who has none — and, worse, would create the first code path in the
 * product where an employer's permissions were in scope while a person's
 * private profile was being assembled.
 *
 * So reads take a `ProfileViewer`: an optional user id and nothing else. There
 * is no permission to pass, which is what makes "no carrier can unlock a
 * former driver's hidden sections" a property of the interface rather than a
 * promise in a comment.
 *
 * ── WHAT THIS SERVICE CANNOT DO ───────────────────────────────────────────
 *   • It cannot change a username. There is no input field for one, and
 *     `UsernameImmutableError` exists for the adapter that is asked anyway.
 *   • It cannot grant, read or imply a permission. No method takes or returns
 *     a `PermissionKey`.
 *   • It cannot write a metric. `recordContribution` appends a measured row;
 *     totals are folded from rows on every read and are never stored.
 *   • It cannot award a comparative badge. `recordContribution` returns the
 *     badges a person's OWN rows earned; "Top Dispatcher Q3" is decided
 *     elsewhere and arrives as a conferred record.
 *   • It cannot delete history. A workplace association is ended, never
 *     removed, and a contribution is reversed, never edited.
 *
 * ── HOW WRITES ARE SCOPED ─────────────────────────────────────────────────
 * Two different scopes, on purpose. Everything a PERSON writes about
 * themselves takes a `ProfileViewer` and is refused unless the viewer is the
 * profile's owner. `recordContribution` — the one write a person does not
 * make — takes a `ServiceContext`, because a unit of work is always posted BY
 * an organization for work done IN it, and the row is stamped with that
 * organization exactly as a `FactScope` is.
 *
 * ── THE HTTP MAPPING TAQI IMPLEMENTS ──────────────────────────────────────
 *   initialize              POST   /v1/profile
 *   getOwn                  GET    /v1/profile/me
 *   getByUsername           GET    /v1/profiles/{username}
 *   update                  PATCH  /v1/profile
 *   setVisibility           PUT    /v1/profile/visibility
 *   uploadAvatar            POST   /v1/profile/avatar            (multipart)
 *   removeAvatar            DELETE /v1/profile/avatar
 *   listWorkplaces          GET    /v1/profiles/{username}/workplaces
 *   recordContribution      POST   /v1/profiles/{userId}/contributions
 *   shareCard               GET    /v1/profiles/{username}/share-card
 *
 * ███ FRONTEND ONLY ███
 * Username uniqueness, avatar storage and scanning, rate limiting on public
 * reads, and the ranking that decides a conferred award are all the backend's.
 * See `docs/permanent-user-profile.md`.
 */

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class ProfileNotFoundError extends Error {
  constructor(readonly handle: string) {
    super(`No profile for ${handle}`);
    this.name = "ProfileNotFoundError";
  }
}

/**
 * Refusing to edit somebody else's profile.
 *
 * Distinct from `PermissionDeniedError` on purpose: that one names the
 * permission a membership was missing, and there is no permission that would
 * have made this allowed.
 */
export class NotProfileOwnerError extends Error {
  constructor() {
    super("A profile can only be edited by the person it belongs to.");
    this.name = "NotProfileOwnerError";
  }
}

export class UsernameImmutableError extends Error {
  constructor(readonly username: Username) {
    super(
      `@${username} was chosen once and cannot be changed. `
      + "Every share card, mention and profile link ever published points at it.",
    );
    this.name = "UsernameImmutableError";
  }
}

export class ProfileAlreadyInitializedError extends Error {
  constructor(readonly username: Username) {
    super(`@${username} already has a profile. Initialization happens once.`);
    this.name = "ProfileAlreadyInitializedError";
  }
}

/** A field the person typed that the service will not store as given. */
export class ProfileInputError extends Error {
  constructor(readonly field: "fullName" | "headline" | "bio" | "location" | "links", reason: string) {
    super(reason);
    this.name = "ProfileInputError";
  }
}

export class AvatarRejectedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "AvatarRejectedError";
  }
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Creating the permanent record, once, between signup and role selection.
 *
 * The username is NOT here. It was decided during signup and is read from the
 * account — passing it would imply it were negotiable at this step, and it is
 * the one thing that never is.
 *
 * Everything except `fullName` is optional, because the step is skippable. A
 * skipped step still creates the record: a person with no avatar has a
 * profile, and `completedAt` is what says the setup was finished.
 */
export interface InitializeProfileInput {
  fullName: string;
  /**
   * ███ MOCK SEAM — a real adapter IGNORES this ███
   *
   * The handle chosen during signup. Over HTTP it is read from the
   * authenticated account and passing it can never claim a handle; the mock
   * accepts it only because it has no account table to read it from. The
   * adapter still refuses a handle somebody else holds.
   */
  username?: Username;
  headline?: string;
  bio?: string;
  location?: string;
  /** From `uploadAvatar`, when the person did not skip it. */
  avatarUrl?: string;
  /** False when the person chose "Skip for now". Leaves `completedAt` unset. */
  completed?: boolean;
}

/** The four things a person wrote about themselves, and nothing else. */
export interface UpdateProfileInput {
  fullName?: string;
  headline?: string;
  bio?: string;
  location?: string;
  links?: Array<{ label: string; url: string }>;
}

export interface VisibilityInput {
  visibility: ProfileVisibility;
  sections: ProfileSectionVisibility;
}

/**
 * An avatar, as the SERVICE sees it.
 *
 * Deliberately not a `File`: the seam has to be implementable by an HTTP
 * adapter that posts multipart form data and by a mock that holds a data URL,
 * and neither should have to know about the other's transport.
 */
export interface AvatarUploadInput {
  /** One of `AVATAR_ACCEPTED_TYPES`. Re-checked by the adapter, never trusted. */
  contentType: string;
  byteLength: number;
  /** The encoded image. A data URL in the mock; a multipart part over HTTP. */
  data: string;
}

/**
 * A measured unit of work, posted by the module that owns the record it came
 * from.
 *
 * `userId` rather than "the caller", because the person who dispatched a load
 * is not the person whose nightly job posts the row.
 */
export interface RecordContributionInput {
  userId: string;
  capacity: ProfileContribution["capacity"];
  kind: ProfileContribution["kind"];
  value: number;
  occurredAt: string;
  lane?: { origin: string; destination: string };
  sourceRef?: { kind: string; id: string };
}

/**
 * What posting work answers with: the row, and any badge that row earned.
 *
 * ★ THIS IS THE MILESTONE TRIGGER ★
 * There is no separate "evaluate milestones" job and no stored badge table to
 * fall behind. Badges are recomputed from the ledger before and after the
 * append, and the difference is what is new — so a milestone is reached at the
 * moment the work is recorded, by the same call that recorded it, or not at
 * all.
 */
export interface ContributionResult {
  contribution: ProfileContribution;
  /** Badges this row earned. Empty on almost every call, which is correct. */
  unlocked: Achievement[];
}

export interface ShareCardRequest {
  username: Username;
  /** Absent for the profile card; a badge key for an achievement card. */
  achievementKey?: string;
  /** Where the card's links point. Passed in — the service has no origin. */
  origin: string;
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export interface ProfileService {
  /** Step 2 of signup. Creates the permanent record tied to the username. */
  initialize(viewer: ProfileViewer, input: InitializeProfileInput): Promise<UserProfile>;

  /** The signed-in person's own profile, with every section visible to them. */
  getOwn(viewer: ProfileViewer): Promise<ProfileView | null>;

  /**
   * A profile by handle, as THIS viewer is allowed to see it.
   *
   * Answers null for a handle nobody holds AND for a profile this viewer may
   * not read. One answer for both, deliberately: distinguishing them turns a
   * list of guessed handles into a directory of who works in freight.
   */
  getByUsername(viewer: ProfileViewer | null, username: Username): Promise<ProfileView | null>;

  update(viewer: ProfileViewer, input: UpdateProfileInput): Promise<UserProfile>;

  setVisibility(viewer: ProfileViewer, input: VisibilityInput): Promise<UserProfile>;

  uploadAvatar(viewer: ProfileViewer, input: AvatarUploadInput): Promise<{ avatarUrl: string }>;

  removeAvatar(viewer: ProfileViewer): Promise<UserProfile>;

  /** The employment timeline on its own, for a viewer allowed to see it. */
  listWorkplaces(viewer: ProfileViewer | null, username: Username): Promise<ProfileView["workplaces"]>;

  /**
   * Post a unit of work. Organization-scoped, unlike every read here.
   *
   * The adapter stamps the calling organization onto the row; a caller cannot
   * claim work was done somewhere it was not, for the same reason an actor
   * cannot forge `actingOrganizationId`.
   */
  recordContribution(ctx: ServiceContext, input: RecordContributionInput): Promise<ContributionResult>;

  /**
   * The card a link preview renders. Null for a profile that is not public —
   * a crawler is not a signed-in reader.
   */
  shareCard(request: ShareCardRequest): Promise<ShareCard | null>;
}
