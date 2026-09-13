import type { Driver, Load, Truck } from "@/types";
import type { ServiceContext } from "./context";

/** Lookups the Needs You drawer needs to render entity context. */
export interface DirectoryService {
  load(ctx: ServiceContext, id: string): Promise<Load>;
  truck(ctx: ServiceContext, id: string): Promise<Truck>;
  driver(ctx: ServiceContext, id: string): Promise<Driver>;
  /** Active memberships of the organization, for assignment menus. */
  assignableMembers(
    ctx: ServiceContext,
  ): Promise<{ membershipId: string; displayName: string; title?: string }[]>;
}
