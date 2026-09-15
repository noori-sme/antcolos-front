import type {
  IsoDateTime, MembershipScope, MembershipStatus, PermissionKey,
  ResponsibilityFunction,
} from "@/types";

/**
 * One membership, as the routing engine needs to see it.
 *
 * Declared HERE rather than imported from the mock directory, so the engine in
 * this folder stays pure: it can be handed a hand-built candidate in a test, a
 * row from the mock directory today, or a row from the real members API
 * tomorrow, and none of those three is a special case.
 *
 * Read the fields and notice which one is missing: there is no role. `title`
 * is carried only so a person can be shown to a person, and nothing in
 * `eligibility.ts` or `routing.ts` reads it. Every routing decision is made
 * from permissions, record scope, asset and carrier assignment, declared work
 * function, and availability.
 */
export interface ResponsibilityCandidate {
  membershipId: string;
  organizationId: string;
  displayName: string;
  /** Display only. The engine never reads this. */
  title?: string;
  status: MembershipStatus;
  isOwner: boolean;
  /** Already resolved through templates, grants and revocations. */
  permissions: ReadonlySet<PermissionKey>;
  scope: MembershipScope;
  /** Set when this membership is a driver. */
  driverProfileId?: string;
  /** False when suspended, ended, off shift or on leave. */
  takesWork: boolean;
  supervisorMembershipId?: string;
  /** Work this membership has been declared for. A signal, never a gate. */
  functions: readonly ResponsibilityFunction[];
  /** Trucks specifically given to this membership. Empty means "not narrowed". */
  truckIds: readonly string[];
  /** Carriers delegated to this membership. Empty means "not narrowed". */
  carrierOrganizationIds: readonly string[];
  shiftLabel?: string;
  departmentLabel?: string;
  /** When the seat or the delegation behind it runs out. */
  endsAt?: IsoDateTime;
}

/**
 * Work this membership already holds, so continuity can be scored.
 *
 * Handing a dispatcher the second problem on a truck they are already working
 * is better than handing it to somebody who has to start from nothing — but
 * only slightly, which is why the weight is small and never decisive.
 */
export interface CandidateWorkload {
  membershipId: string;
  /** Trucks this membership currently holds open work on. */
  truckIds: readonly string[];
  /** Loads this membership currently holds open work on. */
  loadIds: readonly string[];
  /** How many open pieces of work they are holding, for a tie-break. */
  openCount: number;
}
