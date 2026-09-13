export type ThemePreference = "light" | "dark" | "system";
export type DensityPreference = "comfortable" | "compact";

export interface UserPreferences {
  theme: ThemePreference;
  /** Density lives on the User, so it follows the person across organizations. */
  density: DensityPreference;
  language: string;
  notifications: {
    email: boolean;
    push: boolean;
    telegram: boolean;
  };
}

/**
 * Permanent, organization-independent identity.
 * Joining, leaving or switching an organization never replaces, recreates or
 * erases this record.
 *
 * It is structurally impossible to write `user.permissions` — there is no such
 * field, and there never will be. Permissions live on Membership.
 */
export interface User {
  id: string;
  displayName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  locale: string;
  timeZone: string;
  preferences: UserPreferences;
  createdAt: string;
  // NO permissions. NO role. NO organizationId. NO organization data.
}

/** Actor attribution snapshot stored on every operational and audit record. */
export interface ActorRef {
  userId: string;
  membershipId: string;
  displayNameSnapshot: string;
  source: "web" | "telegram" | "system";
}
