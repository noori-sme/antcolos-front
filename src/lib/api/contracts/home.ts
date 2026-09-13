import type { Driver, FleetTruck, Load, NeedsYouItem } from "@/types";
import type { ServiceContext } from "./context";

export interface OperationalCounts {
  activeLoads: number;
  unassignedLoads: number;
  trucksTotal: number;
  /** Same number the trailer roster shows, from the same registry. */
  trailersTotal: number;
  trailersUnattached: number;
  trucksAvailable: number;
  trucksGoingEmpty: number;
  documentsMissing: number;
  needsYouOpen: number;
  needsYouCritical: number;
}

/** Only ever populated when the membership holds the matching permission. */
export interface FinancialSummary {
  weekRevenueCents: number;
  weekRevenueChangePct: number;
  averageRatePerMileCents: number;
  unbilledDeliveredCents: number;
}

export interface HomeSummary {
  counts: OperationalCounts;
  /** Severity-ordered preview for the Home surface. */
  needsYouPreview: NeedsYouItem[];
  activeLoads: Load[];
  upcomingLoads: Load[];
  soonEmptyTrucks: FleetTruck[];
  unassignedLoads: Load[];
  driversNeedingAttention: Driver[];
  financials: FinancialSummary | null;
  onTimePct: number;
  onTimeChangePts: number;
}

export interface HomeService {
  summary(ctx: ServiceContext): Promise<HomeSummary>;
}
