import type { IsoDateTime } from "./common";
import type { MtLoopBoard } from "./mt-loop";

/**
 * The shape of the place somebody is working in.
 *
 * Antcolos already keeps four things apart, and this adds a fifth without
 * collapsing any of them:
 *
 *   User          who somebody permanently is. One person, one identity.
 *   Organization  the business entity. A carrier, or a dispatch agency.
 *   Membership    that person's seat in that organization.
 *   Permissions   what the membership may do, and over whose records.
 *   Workspace     what the place they are working in LOOKS like.
 *
 * The workspace is the new one, and it is deliberately the thinnest. It answers
 * one question — "is this a one-person operation or a team?" — and that is what
 * decides which parts of the dashboard exist at all. It never answers "may I",
 * which is the permissions' job, and it never answers "whose work is this",
 * which is the work assignment's job.
 *
 * It is derived, never stored as a role name. Two people in the same
 * organization are in the same workspace and can still see completely different
 * dashboards, because their memberships differ.
 */
export type WorkspaceKind =
  | "individual_dispatcher"
  | "dispatch_organization"
  | "carrier"
  | "driver";

export interface Workspace {
  kind: WorkspaceKind;
  /** The organization this workspace belongs to. Always exactly one. */
  organizationId: string;
  displayName: string;
  /**
   * True when the workspace can hold more than one person. A solo dispatcher's
   * workspace cannot, which is why it shows no team, no unassigned queue and no
   * invitations — not because those are forbidden, but because they are
   * meaningless with one person in the room.
   */
  supportsTeam: boolean;
  /** A solo workspace can become an organization. An organization cannot go back. */
  canUpgradeToOrganization: boolean;
  /** True for the dispatch workspaces — the two this dashboard is built for. */
  isDispatchWorkspace: boolean;
}

/* -------------------------------------------------------------------------- */
/* Work assignment                                                             */
/* -------------------------------------------------------------------------- */

export type WorkAssignmentStatus = "assigned" | "released" | "completed";

/**
 * Who is working a piece of dispatch work.
 *
 * Kept as its own dated record rather than a field on the load, and pointed at
 * a MEMBERSHIP rather than a user, because those are different questions with
 * different lifetimes. A person can leave an organization and their membership
 * ends while the work they did stays on the record; the same person can hold
 * work in two organizations at once without either knowing about the other.
 *
 * Assigning work is also not the same as having permission to do it. A
 * dispatcher may be assigned a load they can no longer edit after a permission
 * change — the assignment does not silently disappear, and it does not silently
 * grant anything either.
 */
export interface WorkAssignment {
  id: string;
  organizationId: string;
  loadId: string;
  /** The membership that owns this work. Never a user id, never a role name. */
  membershipId: string;
  /** Snapshot, so ended memberships still read sensibly in history. */
  assigneeName: string;
  status: WorkAssignmentStatus;
  assignedAt: IsoDateTime;
  /** The membership that handed it over. Equal to `membershipId` when claimed. */
  assignedByMembershipId: string;
  releasedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

/** One carrier a dispatch workspace works for, and how much of it it can see. */
export interface WorkspaceCarrier {
  organizationId: string;
  name: string;
  /** Trucks this workspace has been granted dispatch access to. */
  truckCount: number;
  trailerCount: number;
  /** Loads currently running under this carrier's authority. */
  activeLoadCount: number;
}

/** A load as the workspace dashboard shows it. Never the whole load. */
export interface WorkspaceWorkItem {
  loadId: string;
  reference: string;
  status: string;
  customerName: string;
  originCity?: string;
  originState?: string;
  destinationCity?: string;
  destinationState?: string;
  nextAppointmentAt?: IsoDateTime;
  /** Present only when somebody owns the work. */
  assigneeName?: string;
  assigneeMembershipId?: string;
  /** True when the viewer's own membership owns it. */
  isMine: boolean;
  /** The carrier whose authority runs it, for a dispatch workspace. */
  carrierName?: string;
}

/** One line of recent activity, already filtered to what the viewer may see. */
export interface WorkspaceActivityItem {
  id: string;
  at: IsoDateTime;
  summary: string;
  loadReference?: string;
  actorName?: string;
}

/**
 * Everything the dispatch dashboard renders, already narrowed by the service.
 *
 * A section that the viewer may not see is ABSENT rather than empty: `teamWork`
 * is undefined for somebody scoped to their own records, which is a different
 * statement from "the team has no work" and renders differently.
 */
export interface DispatchWorkspaceSummary {
  workspace: Workspace;
  /**
   * The MT Loop board: every truck this workspace is responsible for that is
   * empty or about to be.
   *
   * Always present and always FIRST, because an empty truck is the most
   * expensive thing on this screen. It comes back with no loops in it for a
   * workspace that dispatches nothing — an empty board, not a missing one.
   */
  mtLoop: MtLoopBoard;
  /** Always present. The viewer's own assigned work. */
  myWork: WorkspaceWorkItem[];
  /** Present only in a team workspace, for somebody who may see other people's work. */
  teamWork?: WorkspaceWorkItem[];
  /** Present only for somebody who may hand work out. */
  unassignedWork?: WorkspaceWorkItem[];
  carriers: WorkspaceCarrier[];
  equipment: {
    truckCount: number;
    trailerCount: number;
    /** Trucks with no driver, or trailers on nothing — the ones worth a look. */
    idleTruckCount: number;
    unattachedTrailerCount: number;
  };
  activity: WorkspaceActivityItem[];
  /** Present only in a team workspace for somebody who may see members. */
  team?: {
    memberCount: number;
    pendingInvitationCount: number;
    roleCount: number;
  };
  counts: {
    needsYouOpen: number;
    needsYouCritical: number;
    myWorkCount: number;
    teamWorkCount: number;
    unassignedCount: number;
  };
}
