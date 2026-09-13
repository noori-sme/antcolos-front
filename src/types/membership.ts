import type { PermissionKey } from "./permission";

export type MembershipStatus = "invited" | "active" | "suspended" | "left";

export interface MembershipScope {
  /** Permission says what action; scope says over which records. */
  loads: "all" | "assigned";
  financials: "all" | "own";
}

/** The per-organization link. Disposable — the User it points at is not. */
export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  status: MembershipStatus;
  /** Organization-specific job title, display only. Never a permission source. */
  title?: string;
  templateIds: string[];
  grants: PermissionKey[];
  revocations: PermissionKey[];
  scope: MembershipScope;
  driverProfileId?: string;
  isOwner: boolean;
  joinedAt: string;
  endedAt?: string;
  // No personal profile data.
}
