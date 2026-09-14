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
   * The ONLY thing stored about workspace shape; everything else is derived
   * from it — the dashboard in `resolveWorkspace`, and the paperwork the
   * workspace owes in `workspaceKindOf`. It exists because "is there a team
   * here?" cannot be worked out from a member count alone — an organization
   * that has invited its first dispatcher but not had them accept yet is a
   * team, and a one-person carrier is not a solo dispatcher.
   *
   * Only meaningful on DISPATCH_AGENCY organizations. Absent means a team.
   */
  soloDispatcher?: boolean;
  createdAt: string;
  // Nothing about a person.
}

/**
 * What kind of workspace an organization is, for everything that differs
 * between them.
 *
 * Organization TYPE answers "carrier or dispatcher". Workspace KIND answers the
 * question document requirements actually turn on, which has three answers, not
 * two. Derive it — never store it twice.
 *
 * These are the canonical names for the three shapes; `WorkspaceSurfaceKind` in
 * `./workspace` adds the driver portal, which is a membership shape rather than
 * a kind of organization. Both use these same spellings so that one concept is
 * never called two things.
 */
export type WorkspaceKind =
  | "carrier_organization"
  | "dispatch_organization"
  | "individual_dispatcher";

export function workspaceKindOf(
  organization: Pick<Organization, "type" | "soloDispatcher">,
): WorkspaceKind {
  if (organization.type === "CARRIER") return "carrier_organization";
  return organization.soloDispatcher ? "individual_dispatcher" : "dispatch_organization";
}

export const WORKSPACE_KIND_LABEL: Record<WorkspaceKind, string> = {
  carrier_organization: "Carrier organization",
  dispatch_organization: "Dispatch organization",
  individual_dispatcher: "Individual dispatch workspace",
};

export type { OrganizationType };
