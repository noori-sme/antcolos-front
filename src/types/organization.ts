import type { OrganizationType } from "./permission";

export interface Organization {
  id: string;
  type: OrganizationType;
  legalName: string;
  displayName: string;
  dotNumber?: string;
  mcNumber?: string;
  timeZone: string;
  createdAt: string;
  // Nothing about a person.
}

export type { OrganizationType };
