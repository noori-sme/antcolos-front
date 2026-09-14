import type { OrganizationType } from "./permission";

export interface Organization {
  id: string;
  type: OrganizationType;
  legalName: string;
  displayName: string;
  dotNumber?: string;
  mcNumber?: string;
  timeZone: string;
  /**
   * A dispatch organization with exactly one person in it and no team.
   *
   * The ONLY thing stored about workspace shape; everything else the dashboard
   * needs is derived from it in `resolveWorkspace`. It exists because "is there
   * a team here?" cannot be worked out from a member count alone — an
   * organization that has invited its first dispatcher but not had them accept
   * yet is a team, and a one-person carrier is not a solo dispatcher.
   *
   * Only meaningful on DISPATCH_AGENCY organizations. Absent means a team.
   */
  soloDispatcher?: boolean;
  createdAt: string;
  // Nothing about a person.
}

export type { OrganizationType };
