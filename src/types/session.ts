import type { Membership } from "./membership";
import type { Organization } from "./organization";
import type { User } from "./user";

export interface Session {
  /** Constant across organization switches. */
  user: User;
  memberships: Membership[];
  organizations: Organization[];
  /** The only thing switching organizations changes. */
  activeMembershipId: string;
}
