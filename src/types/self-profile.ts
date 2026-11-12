/**
 * The signed-in person's own record (NestJS `GET /users/me`,
 * ../antcolos/docs/requirements/profile.md §8). It belongs to the person, not
 * to an organization, and is the same in every organization they join.
 *
 * Not the public `UserProfile` (`./profile.ts`): that one models username
 * pages, visibility and workplaces, which the backend doesn't have yet.
 */
export interface SelfProfileAddress {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface SelfProfileAvatar {
  mimeType: string;
  updatedAt: string;
}

export interface SelfProfile {
  userId: string;
  firstName: string;
  lastName: string;
  /** Display name, computed by the backend from first and last name. */
  name: string;
  username?: string;
  /** Read-only here. */
  email: string;
  phone?: string;
  headline?: string;
  aboutMe?: string;
  /** Absent until a picture is stored. Load the pixels with `avatarBlob`. */
  avatar?: SelfProfileAvatar;
  address?: SelfProfileAddress;
}

/**
 * `PATCH /users/me` body. Only the keys that changed. `null` clears a field
 * (phone, headline, aboutMe); an empty string is never sent.
 */
export interface SelfProfilePatch {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  headline?: string | null;
  aboutMe?: string | null;
}

/** profile.md FR-AV-01: the picture rules the server enforces. */
export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
