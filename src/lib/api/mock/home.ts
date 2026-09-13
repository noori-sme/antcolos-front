import { missingRequiredDocuments, type Load, type Truck } from "@/types";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import type { FinancialSummary, HomeService, HomeSummary } from "../contracts/home";
import { mockNeedsYouService, urgencyScore } from "./needs-you";
import { redactFinancials } from "./loads";
import { mockStore } from "./store";

const ACTIVE: Load["status"][] = [
  "assigned", "dispatched", "at_pickup", "loaded", "in_transit", "at_delivery",
];
const UPCOMING: Load["status"][] = ["planned", "offered", "accepted", "verifying"];

function visibleLoads(ctx: ServiceContext): Load[] {
  if (!ctx.permissions.has("loads:view")) return [];
  const org = mockStore.org(ctx.organizationId);
  const loads = org.loads;
  const scoped =
    ctx.scope.loads === "assigned" && ctx.driverProfileId
      ? loads.filter((l) => l.assignment?.driverId === ctx.driverProfileId)
      : loads;
  return scoped.map((l) => redactFinancials(ctx, l));
}

function visibleTrucks(ctx: ServiceContext): Truck[] {
  if (!ctx.permissions.has("trucks:view")) return [];
  const org = mockStore.org(ctx.organizationId);
  const trucks = org.trucks;
  if (ctx.scope.loads === "assigned" && ctx.driverProfileId) {
    return trucks.filter((t) => t.currentDriverId === ctx.driverProfileId);
  }
  return trucks;
}

function pickupAt(load: Load): number {
  return new Date(load.stops[0].appointmentAt).getTime();
}

export const mockHomeService: HomeService = {
  async summary(ctx): Promise<HomeSummary> {
    const org = mockStore.org(ctx.organizationId);
    const loads = visibleLoads(ctx);
    const trucks = visibleTrucks(ctx);

    const needsYouAll = await mockNeedsYouService.list(ctx, { status: ["open", "escalated"] });

    const activeLoads = loads
      .filter((l) => ACTIVE.includes(l.status))
      .sort((a, b) => pickupAt(a) - pickupAt(b));

    const upcomingLoads = loads
      .filter((l) => UPCOMING.includes(l.status))
      .sort((a, b) => pickupAt(a) - pickupAt(b));

    const unassignedLoads = loads.filter(
      (l) => !l.assignment?.driverId && !["delivered", "invoiced", "paid", "cancelled"].includes(l.status),
    );

    const soonEmptyTrucks = trucks
      .filter((t) => t.status !== "out_of_service" && t.status !== "maintenance")
      .filter((t) => {
        if (t.status === "available") return true;
        if (!t.estimatedEmptyAt) return false;
        return new Date(t.estimatedEmptyAt).getTime() - Date.now() < 12 * 3_600_000;
      })
      .sort((a, b) => {
        const at = a.estimatedEmptyAt ? new Date(a.estimatedEmptyAt).getTime() : 0;
        const bt = b.estimatedEmptyAt ? new Date(b.estimatedEmptyAt).getTime() : 0;
        return at - bt;
      });

    const documentsMissing = loads.filter(
      (l) =>
        missingRequiredDocuments(l).length > 0 &&
        ["delivered", "ready_to_invoice", "in_transit", "at_delivery", "loaded"].includes(l.status),
    ).length;

    const driversNeedingAttention = ctx.permissions.has("drivers:view")
      ? org.drivers.filter((d) => d.documentWarnings > 0 || !d.telegramConnected)
      : [];

    // Financial data is populated ONLY with the matching permission. There is no
    // path that returns it and lets the UI decide whether to render it.
    let financials: FinancialSummary | null = null;
    if (ctx.permissions.has("revenue:view") && ctx.permissions.has("rates:view")) {
      const billable = loads.filter((l) =>
        ["delivered", "ready_to_invoice", "invoiced", "paid"].includes(l.status),
      );
      const weekRevenueCents = billable.reduce((sum, l) => sum + (l.financials?.totalRateCents ?? 0), 0);
      const miles = billable.reduce((sum, l) => sum + (l.financials?.loadedMiles ?? 0), 0);
      const unbilled = loads
        .filter((l) => ["delivered", "ready_to_invoice"].includes(l.status))
        .reduce((sum, l) => sum + (l.financials?.totalRateCents ?? 0), 0);
      financials = {
        weekRevenueCents,
        weekRevenueChangePct: 8.2,
        averageRatePerMileCents: miles > 0 ? Math.round(weekRevenueCents / miles) : 0,
        unbilledDeliveredCents: unbilled,
      };
    }

    return {
      counts: {
        activeLoads: activeLoads.length,
        unassignedLoads: unassignedLoads.length,
        trucksTotal: trucks.length,
        trucksAvailable: trucks.filter((t) => t.status === "available").length,
        trucksGoingEmpty: soonEmptyTrucks.length,
        documentsMissing,
        needsYouOpen: needsYouAll.length,
        needsYouCritical: needsYouAll.filter((i) => i.severity === "critical").length,
      },
      needsYouPreview: [...needsYouAll].sort((a, b) => urgencyScore(a) - urgencyScore(b)).slice(0, 4),
      activeLoads: activeLoads.slice(0, 6),
      upcomingLoads: upcomingLoads.slice(0, 5),
      soonEmptyTrucks: soonEmptyTrucks.slice(0, 6),
      unassignedLoads: unassignedLoads.slice(0, 5),
      driversNeedingAttention: driversNeedingAttention.slice(0, 5),
      financials,
      onTimePct: 94,
      onTimeChangePts: 3,
    };
  },
};

export const mockDirectoryService = {
  async load(ctx: ServiceContext, loadId: string) {
    if (!ctx.permissions.has("loads:view")) throw new PermissionDeniedError(["loads:view"]);
    const found = visibleLoads(ctx).find((l) => l.id === loadId);
    if (!found) throw new PermissionDeniedError(["loads:view"]);
    return found;
  },
  async truck(ctx: ServiceContext, truckId: string) {
    if (!ctx.permissions.has("trucks:view")) throw new PermissionDeniedError(["trucks:view"]);
    const found = visibleTrucks(ctx).find((t) => t.id === truckId);
    if (!found) throw new PermissionDeniedError(["trucks:view"]);
    return found;
  },
  async driver(ctx: ServiceContext, driverId: string) {
    if (!ctx.permissions.has("drivers:view")) throw new PermissionDeniedError(["drivers:view"]);
    const org = mockStore.org(ctx.organizationId);
    const found = org.drivers.find((d) => d.id === driverId);
    if (!found) throw new PermissionDeniedError(["drivers:view"]);
    return found;
  },
  async assignableMembers(ctx: ServiceContext) {
    if (!ctx.permissions.has("members:view")) return [];
    return MOCK_ORG_MEMBERS[ctx.organizationId] ?? [];
  },
};

/** Org-scoped member directory for assignment menus. */
const MOCK_ORG_MEMBERS: Record<
  string,
  { membershipId: string; displayName: string; title?: string }[]
> = {
  org_northline: [
    { membershipId: "mem_northline_owner", displayName: "Sam Murtaza", title: "Owner" },
    { membershipId: "mem_northline_disp1", displayName: "Ivy Delgado", title: "Dispatcher" },
    { membershipId: "mem_northline_disp2", displayName: "Ben Osei", title: "Dispatcher" },
    { membershipId: "mem_northline_books", displayName: "Renata Cruz", title: "Bookkeeper" },
  ],
  org_meridian: [
    { membershipId: "mem_meridian_dispatcher", displayName: "Sam Murtaza", title: "Senior dispatcher" },
    { membershipId: "mem_meridian_ops", displayName: "Tara Whitfield", title: "Operations lead" },
    { membershipId: "mem_meridian_night", displayName: "Jonas Petit", title: "Night dispatcher" },
  ],
  org_cascade: [
    { membershipId: "mem_cascade_driver", displayName: "Sam Murtaza", title: "Company driver" },
  ],
};
