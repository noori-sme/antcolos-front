import type {
  Achievement, ProfileContribution, UserProfile, WorkplaceAssociation,
} from "@/types";
import { publishedProfiles, publishedRecordsForUser } from "@/lib/profile/published";
import type { ProfileRecords } from "@/lib/profile/view";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The profile store: the permanent records, the workplace timeline, the
 * contribution ledger, the conferred awards and the uploaded avatars.
 *
 * A LEAF, like the document store. It imports no registry and no other mock
 * service, so anything can read it without a cycle, and it enforces nothing —
 * ownership and visibility live one layer up in the service, where the viewer
 * exists.
 *
 * ★ THE LEDGER IS APPEND-ONLY ★
 * There is no `updateContribution` and no `deleteContribution`, here or on the
 * service. A cancelled load is corrected with a reversing row. That is what
 * makes any figure on a profile reproducible from rows that each name a
 * moment, an organization and a source record.
 *
 * ███ FRONTEND ONLY ███
 * In-memory for the life of the tab. Uniqueness on the username, durable
 * avatar storage and the ranking behind a conferred award are the backend's.
 */

/** A conferred award and who it was conferred on. See `ConferredRow` below. */
interface ConferredRow {
  userId: string;
  award: Achievement;
}

interface StoreState {
  profiles: UserProfile[];
  associations: WorkplaceAssociation[];
  contributions: ProfileContribution[];
  /**
   * Conferred awards, each with the person it belongs to.
   *
   * The owner is held HERE rather than on `Achievement`, because an
   * `Achievement` is what a profile view carries and a view is already about
   * exactly one person — a `userId` on it would be a field every renderer had
   * to ignore.
   */
  conferred: ConferredRow[];
  /** Where uploaded avatar bytes live. A real one is an object store. */
  avatars: Record<string, string>;
  seeded: boolean;
}

function emptyState(): StoreState {
  return {
    profiles: [], associations: [], contributions: [], conferred: [],
    avatars: {}, seeded: false,
  };
}

let state: StoreState = emptyState();
let seq = 0;

const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

/** Test hook. Never called by the UI. */
export function resetProfileStore() {
  state = emptyState();
  seq = 0;
}

/**
 * Seeded on first read rather than on import, so a reset genuinely resets.
 *
 * The seed comes from `@/lib/profile/published`, which is also what the
 * server-rendered share card reads. One set of fixtures, two readers — rather
 * than a tab and a crawler disagreeing about the same person.
 */
function ensureSeeded() {
  if (state.seeded) return;
  state.seeded = true;
  for (const seeded of publishedProfiles()) {
    const records = publishedRecordsForUser(seeded.userId);
    if (!records) continue;
    state.profiles.push(records.profile);
    state.associations.push(...records.associations);
    state.contributions.push(...records.contributions);
    state.conferred.push(
      ...records.conferred.map((award) => ({ userId: seeded.userId, award })),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export function profileByUsername(username: string): UserProfile | undefined {
  ensureSeeded();
  return state.profiles.find((p) => p.username === username);
}

export function profileForUser(userId: string): UserProfile | undefined {
  ensureSeeded();
  return state.profiles.find((p) => p.userId === userId);
}

export function usernameTaken(username: string): boolean {
  return profileByUsername(username) !== undefined;
}

/** Everything one person's view is built from. */
export function recordsForUser(userId: string): ProfileRecords | null {
  const profile = profileForUser(userId);
  if (!profile) return null;
  return {
    profile,
    associations: state.associations.filter((a) => a.userId === userId),
    contributions: state.contributions.filter((c) => c.userId === userId),
    conferred: state.conferred.filter((row) => row.userId === userId).map((row) => row.award),
  };
}

export function avatarFor(userId: string): string | undefined {
  ensureSeeded();
  return state.avatars[userId];
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export function putProfile(profile: UserProfile) {
  ensureSeeded();
  const index = state.profiles.findIndex((p) => p.userId === profile.userId);
  if (index >= 0) state.profiles[index] = profile;
  else state.profiles.push(profile);
}

export function appendContribution(row: ProfileContribution) {
  ensureSeeded();
  state.contributions.push(row);
}

export function nextContributionId(): string {
  return rowId("pc");
}

export function putAssociation(association: WorkplaceAssociation) {
  ensureSeeded();
  const index = state.associations.findIndex((a) => a.id === association.id);
  if (index >= 0) state.associations[index] = association;
  else state.associations.push(association);
}

export function nextAssociationId(): string {
  return rowId("wa");
}

export function conferAward(userId: string, award: Achievement) {
  ensureSeeded();
  state.conferred.push({ userId, award });
}

/**
 * Stores avatar bytes and hands back the URL they will be served from.
 *
 * A data URL rather than a blob URL on purpose: a blob URL is scoped to the
 * document that created it and dies with it, and an avatar has to survive
 * being put on a profile page and into a share card. A real implementation
 * returns a CDN URL from an object store and this function is the only thing
 * that changes.
 */
export function putAvatar(userId: string, contentType: string, data: string): string {
  ensureSeeded();
  const url = data.startsWith("data:") ? data : `data:${contentType};base64,${data}`;
  state.avatars[userId] = url;
  return url;
}

export function clearAvatar(userId: string) {
  delete state.avatars[userId];
}
