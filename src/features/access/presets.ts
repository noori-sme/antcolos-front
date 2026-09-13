import type { InvitationKind, OrganizationType, PermissionKey } from "@/types";

/**
 * Starting points, not roles.
 *
 * A preset decides what is ticked when the owner picks an invitation type. From
 * that moment the selection belongs to the invitation: ticking or unticking
 * anything changes only what this one person gets, never the preset itself. An
 * owner who wants the change to stick saves it as a custom role instead.
 */
export interface InvitationPreset {
  kind: InvitationKind;
  label: string;
  description: string;
  permissions: PermissionKey[];
  /** True for the type that invites a whole organization rather than a person. */
  invitesOrganization?: boolean;
}

const DRIVER: InvitationPreset = {
  kind: "driver",
  label: "Driver",
  description: "Drives for you. Sees their own loads, their paperwork and their pay.",
  permissions: [
    "loads:view", "loads:status:update",
    "documents:view", "documents:upload",
    "settlements:view",
  ],
};

const DISPATCH_ORG: InvitationPreset = {
  kind: "dispatch_org",
  label: "Dispatch organization",
  description:
    "Invites an entire dispatch company to work your freight. Their administrator accepts, then chooses which of their people work with you.",
  invitesOrganization: true,
  permissions: [
    "loads:view", "loads:create", "loads:edit", "loads:status:update",
    "dispatch:view", "loads:assign",
    "drivers:view", "trucks:view", "trailers:view",
    "customers:view", "documents:view", "documents:upload",
  ],
};

const CARRIER_EMPLOYEE: InvitationPreset = {
  kind: "employee",
  label: "Employee",
  description: "Works in your office. Sees the operation but not the money.",
  permissions: [
    "loads:view", "drivers:view", "trucks:view", "trailers:view",
    "customers:view", "documents:view", "documents:upload",
    "compliance:view",
  ],
};

const DISPATCHER: InvitationPreset = {
  kind: "dispatcher",
  label: "Dispatcher",
  description: "Moves freight for your carrier clients. Does not see what a load pays.",
  permissions: [
    "loads:view", "loads:create", "loads:edit", "loads:status:update",
    "dispatch:view", "loads:assign",
    "drivers:view", "trucks:view", "trailers:view",
    "customers:view", "documents:view", "documents:upload", "compliance:view",
  ],
};

const DISPATCH_EMPLOYEE: InvitationPreset = {
  kind: "employee",
  label: "Employee",
  description: "Works in your office. Support and admin, not dispatch.",
  permissions: ["loads:view", "customers:view", "documents:view"],
};

const CUSTOM: InvitationPreset = {
  kind: "custom",
  label: "Custom role",
  description: "Start from nothing and choose exactly what this person can do.",
  permissions: [],
};

/** What a carrier owner can invite, versus a dispatch organization owner. */
export function invitationPresets(orgType: OrganizationType): InvitationPreset[] {
  return orgType === "CARRIER"
    ? [DRIVER, DISPATCH_ORG, CARRIER_EMPLOYEE, CUSTOM]
    : [DISPATCHER, DISPATCH_EMPLOYEE, CUSTOM];
}

export function findPreset(
  orgType: OrganizationType,
  kind: InvitationKind,
): InvitationPreset | undefined {
  return invitationPresets(orgType).find((p) => p.kind === kind);
}
