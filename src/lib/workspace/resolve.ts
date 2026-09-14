import type { Membership, Organization, Workspace } from "@/types";

/**
 * Works out what kind of place a membership is working in.
 *
 * A pure function of the organization and the membership, and deliberately
 * nothing else. It never looks at permissions, because the workspace decides
 * which sections EXIST and permissions decide which of those the person may
 * see — collapsing the two is how you end up with a dashboard that hides the
 * team section from an owner because they happen to lack one permission, or
 * shows an "unassigned work" queue to somebody working alone.
 *
 * It also never looks at a role name. `isOwner` is a fact about a membership;
 * "owner" is not a workspace kind.
 */
export function resolveWorkspace(
  organization: Organization | null,
  membership: Membership | null,
): Workspace | null {
  if (!organization || !membership) return null;

  // A driver membership is its own portal wherever it sits, including inside a
  // dispatch agency — the person drives, whatever the organization is.
  if (membership.driverProfileId) {
    return {
      kind: "driver",
      organizationId: organization.id,
      displayName: organization.displayName,
      supportsTeam: false,
      canUpgradeToOrganization: false,
      isDispatchWorkspace: false,
    };
  }

  if (organization.type === "DISPATCH_AGENCY") {
    const solo = organization.soloDispatcher === true;
    return {
      kind: solo ? "individual_dispatcher" : "dispatch_organization",
      organizationId: organization.id,
      displayName: organization.displayName,
      supportsTeam: !solo,
      // Only the person who owns the solo workspace can turn it into a team.
      canUpgradeToOrganization: solo && membership.isOwner,
      isDispatchWorkspace: true,
    };
  }

  return {
    kind: "carrier",
    organizationId: organization.id,
    displayName: organization.displayName,
    supportsTeam: true,
    canUpgradeToOrganization: false,
    isDispatchWorkspace: false,
  };
}

export const WORKSPACE_KIND_LABEL: Record<Workspace["kind"], string> = {
  individual_dispatcher: "Individual dispatcher",
  dispatch_organization: "Dispatch organization",
  carrier: "Carrier",
  driver: "Driver",
};

export const WORKSPACE_KIND_DESCRIPTION: Record<Workspace["kind"], string> = {
  individual_dispatcher:
    "You dispatch on your own. Everything here is your work; there is no team queue to hand it to.",
  dispatch_organization:
    "You dispatch as a team. Work can be held by one person, handed to another, or left in the unassigned queue.",
  carrier: "You run freight under your own authority.",
  driver: "You drive. Your loads, documents and pay.",
};
