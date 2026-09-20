import {
  type Achievement, type ProfileContribution, type ProfileView, type ShareCard,
  type UserProfile,
} from "@/types";
import { evaluateAchievements } from "@/lib/profile/achievements";
import { validateAvatar } from "@/lib/profile/avatar";
import {
  validateBio, validateHeadline, validateLink, validateLocation,
} from "@/lib/profile/fields";
import { achievementShareCard, profileShareCard } from "@/lib/profile/share";
import { buildProfileView } from "@/lib/profile/view";
import {
  DEFAULT_SECTIONS, isShareable, type ProfileViewer,
} from "@/lib/profile/visibility";
import { validateFullName, validateUsername } from "@/features/auth/rules";
import type {
  AvatarUploadInput, ContributionResult, InitializeProfileInput,
  RecordContributionInput, ShareCardRequest, UpdateProfileInput, VisibilityInput,
  ProfileService,
} from "../contracts/profile";
import {
  AvatarRejectedError, NotProfileOwnerError, ProfileAlreadyInitializedError,
  ProfileInputError, ProfileNotFoundError, UsernameImmutableError,
} from "../contracts/profile";
import type { ServiceContext } from "../contracts/context";
import {
  appendContribution, clearAvatar, nextContributionId, profileByUsername,
  profileForUser, putAvatar, putProfile, recordsForUser, usernameTaken,
} from "./profile-store";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * THE profile service.
 *
 * Worth reading for what it refuses to do:
 *
 *   • It never changes a username. `update` has no field for one, and the one
 *     path that could be asked — initializing a second time — refuses.
 *   • It never reads a permission. There is no `ServiceContext` on any read,
 *     so there is no code path where an employer's permission set is in scope
 *     while somebody's private profile is being assembled.
 *   • It never stores a metric or a badge. Both are folded from the ledger on
 *     every read, by the same pure functions the server-rendered share card
 *     uses.
 *   • It never tells a stranger that a private profile exists.
 *
 * ★ WHY READS DO NOT TAKE A ServiceContext ★
 * Every other mock service in this folder takes one, because every other
 * record belongs to an organization. A profile belongs to a person, and its
 * readers include somebody who is signed out. See the long note on
 * `contracts/profile.ts`.
 *
 * ███ FRONTEND ONLY ███
 * Username uniqueness, durable avatar storage and scanning, rate limiting on
 * public reads, and the ranking behind a conferred award are the backend's.
 */

const LATENCY_MS = process.env.ANTCOLOS_TEST ? 0 : 180;
const wait = () =>
  LATENCY_MS ? new Promise<void>((r) => setTimeout(r, LATENCY_MS)) : Promise.resolve();

/** The one place "is this person allowed to edit this record" is decided. */
function ownProfileOrRefuse(viewer: ProfileViewer): UserProfile {
  if (!viewer.userId) throw new NotProfileOwnerError();
  const profile = profileForUser(viewer.userId);
  if (!profile) throw new ProfileNotFoundError(viewer.userId);
  return profile;
}

/**
 * The same field rules the form applies, applied again where they are the rule.
 *
 * A screen checking its own inputs is a courtesy; this is the boundary. A
 * caller that skipped the form gets the same answer.
 */
function checkFields(input: {
  headline?: string; bio?: string; location?: string;
  links?: Array<{ label: string; url: string }>;
}) {
  const headline = input.headline !== undefined && validateHeadline(input.headline);
  if (headline) throw new ProfileInputError("headline", headline);
  const bio = input.bio !== undefined && validateBio(input.bio);
  if (bio) throw new ProfileInputError("bio", bio);
  const location = input.location !== undefined && validateLocation(input.location);
  if (location) throw new ProfileInputError("location", location);
  for (const link of input.links ?? []) {
    const problem = validateLink(link.url);
    if (problem) throw new ProfileInputError("links", problem);
  }
}

/** Trimmed, or absent. An empty headline is no headline, not an empty string. */
const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

function keysOf(achievements: readonly Achievement[]): Set<string> {
  return new Set(achievements.map((a) => a.key));
}

export const mockProfileService: ProfileService = {
  /* ---------------------------------------------------------------------- */
  /* Initialization — signup step 2                                          */
  /* ---------------------------------------------------------------------- */

  async initialize(viewer, input: InitializeProfileInput) {
    await wait();
    if (!viewer.userId) throw new NotProfileOwnerError();

    const nameProblem = validateFullName(input.fullName);
    if (nameProblem) throw new ProfileInputError("fullName", nameProblem);
    checkFields(input);

    const existing = profileForUser(viewer.userId);

    // Already finished once. Initialization is not an edit, and pretending it
    // is would be the one way a username could quietly change.
    if (existing?.completedAt) throw new ProfileAlreadyInitializedError(existing.username);

    const username = existing?.username ?? input.username?.trim().toLowerCase();
    if (!username || validateUsername(username)) {
      throw new ProfileNotFoundError(input.username ?? viewer.userId);
    }
    if (!existing && usernameTaken(username)) throw new UsernameImmutableError(username);

    const at = nowIso();
    const profile: UserProfile = {
      // The record may already exist from account creation — in which case its
      // joined date and handle are what they always were.
      joinedAt: existing?.joinedAt ?? at,
      verifications: existing?.verifications ?? [],
      links: existing?.links ?? [],
      visibility: existing?.visibility ?? "public",
      sections: existing?.sections ?? { ...DEFAULT_SECTIONS },
      userId: viewer.userId,
      username,
      fullName: input.fullName.trim(),
      headline: text(input.headline),
      bio: text(input.bio),
      location: text(input.location),
      // Skipping the avatar leaves the record without one. It does not leave
      // the person without a record.
      avatarUrl: input.avatarUrl ?? existing?.avatarUrl,
      completedAt: input.completed === false ? undefined : at,
      updatedAt: at,
    };
    putProfile(profile);
    return profile;
  },

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                   */
  /* ---------------------------------------------------------------------- */

  async getOwn(viewer) {
    await wait();
    if (!viewer.userId) return null;
    const records = recordsForUser(viewer.userId);
    return records ? buildProfileView(records, viewer, nowIso()) : null;
  },

  async getByUsername(viewer, username) {
    await wait();
    const profile = profileByUsername(username.trim().toLowerCase());
    if (!profile) return null;
    const records = recordsForUser(profile.userId);
    if (!records) return null;
    // Null for "no such handle" and for "not yours to read" alike. Telling
    // them apart is what turns guessed handles into a directory of who works
    // in freight.
    return buildProfileView(records, viewer, nowIso());
  },

  async listWorkplaces(viewer, username) {
    const view = await this.getByUsername(viewer, username);
    return view?.workplaces;
  },

  /* ---------------------------------------------------------------------- */
  /* Edits — owner only, always                                              */
  /* ---------------------------------------------------------------------- */

  async update(viewer, input: UpdateProfileInput) {
    await wait();
    const profile = ownProfileOrRefuse(viewer);

    if (input.fullName !== undefined) {
      const problem = validateFullName(input.fullName);
      if (problem) throw new ProfileInputError("fullName", problem);
    }
    checkFields(input);

    const next: UserProfile = {
      ...profile,
      fullName: input.fullName?.trim() ?? profile.fullName,
      headline: input.headline === undefined ? profile.headline : text(input.headline),
      bio: input.bio === undefined ? profile.bio : text(input.bio),
      location: input.location === undefined ? profile.location : text(input.location),
      links: input.links ?? profile.links,
      updatedAt: nowIso(),
    };
    putProfile(next);
    return next;
  },

  async setVisibility(viewer, input: VisibilityInput) {
    await wait();
    const profile = ownProfileOrRefuse(viewer);
    const next: UserProfile = {
      ...profile,
      visibility: input.visibility,
      sections: { ...input.sections },
      updatedAt: nowIso(),
    };
    putProfile(next);
    return next;
  },

  /* ---------------------------------------------------------------------- */
  /* Avatar                                                                  */
  /* ---------------------------------------------------------------------- */

  async uploadAvatar(viewer, input: AvatarUploadInput) {
    await wait();
    const profile = ownProfileOrRefuse(viewer);
    // Checked again here even though the picker checked it: the picker is a
    // convenience and the service is the rule. A real adapter checks a third
    // time, on the server, because neither of these two is evidence.
    const problem = validateAvatar({ type: input.contentType, size: input.byteLength });
    if (problem) throw new AvatarRejectedError(problem);

    const avatarUrl = putAvatar(profile.userId, input.contentType, input.data);
    putProfile({ ...profile, avatarUrl, updatedAt: nowIso() });
    return { avatarUrl };
  },

  async removeAvatar(viewer) {
    await wait();
    const profile = ownProfileOrRefuse(viewer);
    clearAvatar(profile.userId);
    const next: UserProfile = { ...profile, avatarUrl: undefined, updatedAt: nowIso() };
    putProfile(next);
    return next;
  },

  /* ---------------------------------------------------------------------- */
  /* Work, and the milestones it triggers                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * ★ THE MILESTONE TRIGGER ★
   *
   * Badges are evaluated before and after the row is appended, and the
   * difference is what is new. There is no nightly job to fall behind and no
   * badge table to drift: the milestone is reached by the same call that
   * recorded the work, or it is not reached.
   *
   * The organization on the row comes from the CALLER'S CONTEXT, never from
   * the input — the same rule `ActorRef` follows. A module cannot post work
   * against an organization it is not acting in.
   */
  async recordContribution(ctx: ServiceContext, input: RecordContributionInput) {
    await wait();
    const records = recordsForUser(input.userId);
    if (!records) throw new ProfileNotFoundError(input.userId);

    const asOf = nowIso();
    const before = keysOf(evaluateAchievements({
      joinedAt: records.profile.joinedAt,
      contributions: records.contributions,
      conferred: records.conferred,
      asOf,
    }));

    const contribution: ProfileContribution = {
      id: nextContributionId(),
      userId: input.userId,
      organizationId: ctx.organizationId,
      organizationNameSnapshot: ctx.organizationName,
      capacity: input.capacity,
      kind: input.kind,
      value: input.value,
      occurredAt: input.occurredAt,
      lane: input.lane,
      sourceRef: input.sourceRef,
    };
    appendContribution(contribution);

    const after = evaluateAchievements({
      joinedAt: records.profile.joinedAt,
      contributions: [...records.contributions, contribution],
      conferred: records.conferred,
      asOf,
    });

    const result: ContributionResult = {
      contribution,
      unlocked: after.filter((achievement) => !before.has(achievement.key)),
    };
    return result;
  },

  /* ---------------------------------------------------------------------- */
  /* Share cards                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Built for whoever holds the link, which is why it exists only for a
   * profile its owner made public — and why no viewer is passed in. A link
   * preview in a group chat is not a signed-in reader.
   */
  async shareCard(request: ShareCardRequest): Promise<ShareCard | null> {
    await wait();
    const profile = profileByUsername(request.username.trim().toLowerCase());
    if (!profile || !isShareable(profile)) return null;

    const records = recordsForUser(profile.userId);
    if (!records) return null;
    // Built as a STRANGER sees it, so a card can never carry a figure the
    // profile page withholds from the person who opens it.
    const view: ProfileView | null = buildProfileView(records, null, nowIso());
    if (!view) return null;

    if (!request.achievementKey) return profileShareCard(view, request.origin);

    const achievement = view.achievements?.find((a) => a.key === request.achievementKey);
    return achievement ? achievementShareCard(view, achievement, request.origin) : null;
  },
};
