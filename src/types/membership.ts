import type { AppliedTemplate, PermissionKey } from "./permission";

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
  /**
   * The templates applied to this seat, each carrying the permission SNAPSHOT
   * taken when it was applied.
   *
   * Not a list of ids to dereference. A membership that held ids would be a
   * membership whose access changed whenever somebody edited a template — the
   * exact behaviour the product has to be able to promise it does not have.
   * See `AppliedTemplate`.
   */
  appliedTemplates: AppliedTemplate[];
  /** Person-specific additions, on top of whatever the templates brought. */
  grants: PermissionKey[];
  /** Person-specific removals. Beat grants, so one key can be taken back
   *  without building a template for one person. */
  revocations: PermissionKey[];
  scope: MembershipScope;
  driverProfileId?: string;
  isOwner: boolean;
  joinedAt: string;
  endedAt?: string;
  // No personal profile data.
}
