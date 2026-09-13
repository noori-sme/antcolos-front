import type { EngagementType } from "./driver-profile";
import type { OrganizationType, PermissionKey } from "./permission";

/**
 * What kind of thing is being invited. The kinds differ per organization type:
 * a carrier can invite a whole dispatch organization, a dispatch organization
 * invites its own dispatchers.
 */
export type InvitationKind =
  | "driver"
  | "dispatch_org"
  | "employee"
  | "dispatcher"
  | "custom";

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Invitation {
  id: string;
  /** What the invitation link carries. */
  token: string;
  organizationId: string;
  /** Snapshotted so a renamed organization does not rewrite old invitations. */
  organizationName: string;
  organizationType: OrganizationType;
  kind: InvitationKind;
  /** The role as it read when sent — a preset name, or the custom role's name. */
  roleName: string;
  customRoleId?: string;
  /**
   * Driver invitations only. The carrier decides whether this is a company
   * driver or an owner-operator — it sets the paperwork and the pay, so it is
   * not the driver's to choose, and the acceptance screen shows it read-only.
   */
  engagementType?: EngagementType;
  recipientName: string;
  recipientEmail: string;
  /** Snapshotted too: editing a role later must not silently re-scope a
   *  pending invitation someone is about to accept. */
  permissions: PermissionKey[];
  /**
   * Dispatch-organization invitations only. Everything granted applies to this
   * carrier relationship and nothing else — the dispatch organization's other
   * carrier clients are unaffected.
   */
  scopedToCarrierName?: string;
  expiresAt: string | null;
  createdAt: string;
  status: InvitationStatus;
  /** Mock only: drives whether acceptance detours through Sign Up. */
  recipientHasAccount: boolean;
}

export interface CustomRole {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  /** Archived roles keep working for whoever holds them, but cannot be given out. */
  archived: boolean;
  /** How many current members hold this role. Blocks deletion when above zero. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
