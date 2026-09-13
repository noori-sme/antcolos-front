import type {
  Document, Load, LoadEvent, LoadStatus, Page, PageRequest,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * Read-only load access. Mutations (assignment, status transitions, rate-con
 * approval) are deliberately absent until the backend defines their rules —
 * adding them here is how the two models would drift.
 */

export interface LoadFilters {
  /** Matches reference, customer reference, customer name, city or driver. */
  search?: string;
  status?: LoadStatus[];
  /** Named groupings the UI offers as tabs. */
  view?: "active" | "upcoming" | "completed" | "cancelled" | "exceptions" | "all";
  customerId?: string;
  truckId?: string;
  driverId?: string;
  /** Pickup window, inclusive. */
  pickupFrom?: string;
  pickupTo?: string;
  /** Only loads missing at least one required document. */
  missingDocuments?: boolean;
}

export type LoadSortField =
  | "reference" | "status" | "pickupAt" | "deliveryAt" | "customer" | "rate";

export interface LoadSort {
  field: LoadSortField;
  direction: "asc" | "desc";
}

export interface LoadsService {
  /**
   * Results are always narrowed by the caller's organization AND record scope:
   * a membership scoped to "assigned" receives only its own driver's loads.
   * `financials` is omitted from every load unless the caller holds rates:view.
   */
  list(
    ctx: ServiceContext,
    filters?: LoadFilters,
    sort?: LoadSort,
    page?: PageRequest,
  ): Promise<Page<Load>>;

  get(ctx: ServiceContext, loadId: string): Promise<Load>;

  /** The append-only execution timeline, newest first. */
  events(ctx: ServiceContext, loadId: string): Promise<LoadEvent[]>;

  /** Documents linked to the load, newest version of each first. */
  documents(ctx: ServiceContext, loadId: string): Promise<Document[]>;
}
