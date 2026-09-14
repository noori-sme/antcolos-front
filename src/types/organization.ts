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
  /**
   * A dispatch workspace run by one person for themselves.
   *
   * It is a real workspace, not a lesser one — but it is not a dispatch
   * organization, and the paperwork asked of it is different: personal
   * identity and a service agreement rather than company registration and
   * company-level insurance. Meaningful only when `type` is "DISPATCH_AGENCY";
   * a carrier is never individual, because authority is held by the company.
   */
  individual?: boolean;
  // Nothing about a person.
}

/**
 * What kind of workspace this is, for everything that differs between them.
 *
 * Organization TYPE answers "carrier or dispatcher". Workspace KIND answers the
 * question document requirements actually turn on, which has three answers, not
 * two. Derive it — never store it twice.
 */
export type WorkspaceKind =
  | "carrier_organization"
  | "dispatch_organization"
  | "individual_dispatcher";

export function workspaceKindOf(
  organization: Pick<Organization, "type" | "individual">,
): WorkspaceKind {
  if (organization.type === "CARRIER") return "carrier_organization";
  return organization.individual ? "individual_dispatcher" : "dispatch_organization";
}

export const WORKSPACE_KIND_LABEL: Record<WorkspaceKind, string> = {
  carrier_organization: "Carrier organization",
  dispatch_organization: "Dispatch organization",
  individual_dispatcher: "Individual dispatch workspace",
};

export type { OrganizationType };
