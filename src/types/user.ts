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

/**
 * Actor attribution snapshot stored on every operational and audit record.
 *
 * ★ EVERY FIELD HERE IS ATTRIBUTION. NONE OF IT IS AUTHORITY. ★
 *
 * An `ActorRef` says who did something and on whose behalf. It is WRITTEN from
 * what a service already proved; it is never READ to decide whether something
 * is allowed. The delegation guard derives the acting and owning organizations
 * from a live grant and A6's `operatingContextAt`, then stamps them here — so
 * a caller that forges `actingOrganizationId` changes the label on a refusal
 * and nothing else.
 */
export interface ActorRef {
  userId: string;
  membershipId: string;
  displayNameSnapshot: string;
  source: "web" | "telegram" | "system";
  /**
   * The organization the person was acting IN — their own workspace.
   *
   * Set when that differs from the organization owning the record, which is
   * exactly the delegated case: a dispatcher at a provider booking a load for
   * a carrier. Absent means the actor was working in the owning organization.
   */
  actingOrganizationId?: string;
  actingOrganizationName?: string;
}
