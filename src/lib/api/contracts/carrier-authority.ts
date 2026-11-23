import type { Paginated } from "@/types/fleet-truck";
import type { CarrierAuthorityRecord, DirectoryCarrier, MyOrganization } from "@/types/carrier-authority";
import type { ServiceContext } from "./context";

/** The carrier's stored FMCSA authority (backend plan 41). http-only. */
export interface CarrierAuthorityService {
  /** `carrier_authority.read`; `null` when never checked. */
  current(ctx: ServiceContext): Promise<CarrierAuthorityRecord | null>;
  /** `carrier_authority.read`; newest first. */
  history(ctx: ServiceContext, page: { page: number; pageSize: number }): Promise<Paginated<CarrierAuthorityRecord>>;
  /** `carrier_authority.refresh`; asks FMCSA now. Not idempotent in the contract (appends a check). */
  refresh(ctx: ServiceContext): Promise<{ record: CarrierAuthorityRecord; changed: boolean }>;
}

/** Other carrier organizations by name, handle, MC or DOT (plan 42). `truck.update`. */
export interface OrgDirectoryService {
  searchCarriers(ctx: ServiceContext, q: string): Promise<DirectoryCarrier[]>;
}

/** The signed-in person's own memberships (plan 42). */
export interface SelfMembershipsService {
  list(ctx: ServiceContext): Promise<MyOrganization[]>;
  /**
   * Ends the caller's own membership. 409 for the last admin (thrown).
   * `alreadyLeft` when there was no active membership (404): a repeat or another tab.
   */
  leave(ctx: ServiceContext, organizationId: string): Promise<{ alreadyLeft: boolean }>;
}
