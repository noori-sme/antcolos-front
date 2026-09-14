import type {
  DrilldownRecord, Load, ReportCatalogEntry, ReportFilters, ReportRange,
  ReportResult,
} from "@/types";
import { laneLabel } from "@/types";
import { resolveAudience } from "@/lib/reports/audience";
import { missingFor, reportDefinition, reportsForAudience } from "@/lib/reports/catalog";
import { computeReport } from "@/lib/reports/compute";
import { previousRange } from "@/lib/reports/range";
import { assembleDataset } from "@/lib/reports/sources/dataset";
import {
  SOURCE_AVAILABILITY, sourceStatuses, type ReportDataset, type SourceOverrides,
} from "@/lib/reports/sources/types";
import { money } from "@/lib/utils/format";
import type {
  DrilldownRequest, ReportWorkspace, ReportsService,
} from "../contracts/reports";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import { MOCK_ORG_MEMBERS } from "./home";
import { mockLoadsService } from "./loads";
import { mockStore } from "./store";
import { fleetSync, truckContextFrom } from "./truck-registry";

/**
 * Reporting, against the mock adapters.
 *
 * Everything the contract promises is enforced HERE, not in the screens:
 *
 *  - `reports:view` opens the module; each report's own keys open the report.
 *  - The audience is resolved from the organization type and the permissions
 *    held. An individual membership asking for an organization-wide report is
 *    denied, not quietly given a smaller version of it.
 *  - Records come from the Loads module and the truck registry through their
 *    own service calls, so their organization scoping, record scoping and rate
 *    redaction apply before reporting sees anything.
 *  - A dispatch workspace analyzes only carriers that have shared their
 *    records; a drill-down cannot reach a record the report excluded.
 */

const LATENCY_MS = 220;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/** Reporting never writes. There is no branch here that creates a record. */
function assertCanOpenReports(ctx: ServiceContext) {
  if (!ctx.permissions.has("reports:view")) {
    throw new PermissionDeniedError(["reports:view"]);
  }
}

function driverNameFor(organizationId: string) {
  let drivers: { id: string; displayName: string }[] = [];
  try {
    drivers = mockStore.org(organizationId).drivers;
  } catch {
    drivers = [];
  }
  return (driverId: string) =>
    drivers.find((d) => d.id === driverId)?.displayName ?? "Driver";
}

interface Assembled {
  dataset: ReportDataset;
  overrides: SourceOverrides;
}

/**
 * Reads every source for one run.
 *
 * A module that cannot serve this workspace is reported as UNAVAILABLE rather
 * than as an empty result — "nothing happened" and "we could not look" are
 * different answers and the reader is owed the difference.
 */
async function assemble(
  ctx: ServiceContext,
  filters: ReportFilters,
  audience: ReportResult["audience"],
): Promise<Assembled> {
  const range = filters.range;
  const previous = previousRange(range);
  const overrides: SourceOverrides = {};

  let loads: Load[] = [];
  try {
    // Through the Loads module's own service: its organization partition, its
    // record scope and its rate redaction all apply before reporting sees a row.
    const page = await mockLoadsService.list(ctx, { view: "all" }, undefined, { limit: 500 });
    loads = page.items;
  } catch (error) {
    overrides.loads = {
      availability: "unavailable",
      note:
        error instanceof PermissionDeniedError
          ? "The Loads module refused this request: your membership does not include loads:view."
          : "The Loads module cannot serve this workspace yet, so there is nothing to analyse. This is not the same as a quiet month — no records could be read at all.",
    };
  }

  let trucks: ReportDataset["trucks"] = [];
  try {
    trucks = fleetSync(truckContextFrom(ctx));
  } catch {
    overrides.trucks = {
      availability: "unavailable",
      note: "The truck registry could not be read for this workspace.",
    };
  }

  // Attribution must not depend on who is asking: the same load belongs to the
  // same dispatcher whether or not the caller may see the roster. What changes
  // with members:view is which reports can be run, not who owns a load.
  const members = MOCK_ORG_MEMBERS[ctx.organizationId] ?? [];

  const dataset = assembleDataset({
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    audience,
    range,
    previousRange: previous,
    loads,
    trucks,
    members,
    driverName: driverNameFor(ctx.organizationId),
  });

  // The organization filter narrows an already-narrowed set. It can only ever
  // remove carriers, never add one back that is not shared.
  const selected = filters.carrierOrganizationIds;
  if (selected && selected.length > 0) {
    const keep = new Set(selected);
    const narrow = (list: Load[]) =>
      list.filter((l) => {
        const carrier = l.assignment?.carrierOrganizationId;
        return carrier ? keep.has(carrier) : keep.has(ctx.organizationId);
      });
    dataset.loads = narrow(dataset.loads);
    dataset.previousLoads = narrow(dataset.previousLoads);
  }

  return { dataset, overrides };
}

function catalogFor(ctx: ServiceContext): ReportCatalogEntry[] {
  const audience = resolveAudience(ctx.organizationType, ctx.permissions);
  if (!audience) return [];
  return reportsForAudience(audience, ctx.organizationType).map((definition) => {
    const missing = missingFor(definition, ctx.permissions);
    return { definition, available: missing.length === 0, missingPermissions: missing };
  });
}

export const mockReportsService: ReportsService = {
  async workspace(ctx): Promise<ReportWorkspace> {
    await wait();
    assertCanOpenReports(ctx);
    const audience = resolveAudience(ctx.organizationType, ctx.permissions)!;

    const { dataset } = await assemble(ctx, { range: neutralRange() }, audience);
    const carriers =
      ctx.organizationType === "DISPATCH_AGENCY"
        ? dataset.carriers
            .filter((c) => c.sharing === "shared")
            .map((c) => ({ id: c.carrierOrganizationId, name: c.name }))
        : [{ id: ctx.organizationId, name: ctx.organizationName }];

    return {
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      audience,
      entries: catalogFor(ctx),
      carriers,
    };
  },

  async run(ctx, request): Promise<ReportResult> {
    await wait();
    assertCanOpenReports(ctx);

    const definition = reportDefinition(request.reportId);
    if (!definition) throw new NotFoundError("Report");

    const audience = resolveAudience(ctx.organizationType, ctx.permissions)!;
    // An individual membership may not run an organization-wide report, and a
    // carrier's reports do not exist inside a dispatch workspace. Both are a
    // denial rather than an empty result.
    if (!definition.audiences.includes(audience)) {
      throw new PermissionDeniedError(
        definition.audiences.includes("carrier_org") ||
        definition.audiences.includes("dispatch_org")
          ? ["revenue:view"]
          : ["reports:view"],
      );
    }
    if (
      definition.organizationTypes &&
      !definition.organizationTypes.includes(ctx.organizationType)
    ) {
      throw new NotFoundError("Report");
    }
    const missing = missingFor(definition, ctx.permissions);
    if (missing.length > 0) throw new PermissionDeniedError(missing);

    const { dataset, overrides } = await assemble(ctx, request.filters, audience);

    return computeReport({
      definition,
      dataset,
      organizationId: ctx.organizationId,
      organizationName: ctx.organizationName,
      audience,
      filters: request.filters,
      permissions: ctx.permissions,
      sourceOverrides: overrides,
    });
  },

  async drilldown(ctx, request: DrilldownRequest): Promise<DrilldownRecord[]> {
    await wait();
    assertCanOpenReports(ctx);
    const definition = reportDefinition(request.reportId);
    if (!definition) throw new NotFoundError("Report");
    const missing = missingFor(definition, ctx.permissions);
    if (missing.length > 0) throw new PermissionDeniedError(missing);

    const audience = resolveAudience(ctx.organizationType, ctx.permissions)!;
    if (!definition.audiences.includes(audience)) {
      throw new PermissionDeniedError(["revenue:view"]);
    }

    const { dataset } = await assemble(ctx, request.filters, audience);
    const wanted = new Set(request.ref.ids);
    const canSeeRates = ctx.permissions.has("rates:view");

    switch (request.ref.kind) {
      case "load":
        return dataset.loads
          .filter((l) => wanted.has(l.id))
          .map((load) => ({
            id: load.id,
            kind: "load" as const,
            title: load.reference,
            subtitle: laneLabel(load),
            meta: [
              { label: "Status", value: load.status.replace(/_/g, " ") },
              { label: "Customer", value: load.customer.name },
              ...(canSeeRates && load.financials
                ? [{ label: "Rate", value: money(load.financials.totalRateCents) }]
                : []),
            ],
            href: `/loads/${load.id}`,
            availability: "live" as const,
          }));

      case "invoice":
        return dataset.invoices
          .filter((i) => wanted.has(i.id))
          .map((invoice) => ({
            id: invoice.id,
            kind: "invoice" as const,
            title: invoice.customerName,
            subtitle: `Load ${dataset.loads.find((l) => l.id === invoice.loadId)?.reference ?? invoice.loadId}`,
            meta: [
              { label: "Amount", value: money(invoice.amountCents) },
              { label: "Status", value: invoice.status },
              ...(invoice.dueAt
                ? [{ label: "Due", value: invoice.dueAt.slice(0, 10) }]
                : []),
            ],
            availability: SOURCE_AVAILABILITY.invoices.availability,
          }));

      case "settlement":
        return dataset.settlements
          .filter((s) => wanted.has(s.id))
          .map((settlement) => ({
            id: settlement.id,
            kind: "settlement" as const,
            title: settlement.driverName,
            subtitle: `${settlement.periodStart.slice(0, 10)} → ${settlement.periodEnd.slice(0, 10)}`,
            meta: [
              { label: "Driver pay", value: money(settlement.driverPayCents) },
              { label: "Loads", value: String(settlement.loadIds.length) },
              { label: "Status", value: settlement.status.replace(/_/g, " ") },
            ],
            availability: SOURCE_AVAILABILITY.settlements.availability,
          }));

      case "expense":
        return dataset.expenses
          .filter((e) => wanted.has(e.id))
          .map((expense) => ({
            id: expense.id,
            kind: "expense" as const,
            title: expense.category,
            subtitle: `Week of ${expense.incurredAt.slice(0, 10)}`,
            meta: [{ label: "Amount", value: money(expense.amountCents) }],
            availability: SOURCE_AVAILABILITY.expenses.availability,
          }));

      case "truck":
        return dataset.trucks
          .filter((t) => wanted.has(t.truckId))
          .map((truck) => ({
            id: truck.truckId,
            kind: "truck" as const,
            title: `Unit ${truck.unit}`,
            subtitle: truck.carrierName,
            meta: [
              { label: "Status", value: truck.status.replace(/_/g, " ") },
              ...(truck.currentCity
                ? [{ label: "Location", value: `${truck.currentCity}, ${truck.currentState ?? ""}` }]
                : []),
            ],
            href: `/fleet/trucks/${truck.truckId}`,
            availability: "live" as const,
          }));

      case "search_session":
        return dataset.searchSessions
          .filter((s) => wanted.has(s.id))
          .map((session) => ({
            id: session.id,
            kind: "search_session" as const,
            title: `Search on unit ${
              dataset.trucks.find((t) => t.truckId === session.truckId)?.unit ?? session.truckId
            }`,
            subtitle: session.openedAt.slice(0, 16).replace("T", " "),
            meta: [{ label: "Outcome", value: session.outcome }],
            availability: SOURCE_AVAILABILITY.search_sessions.availability,
          }));

      case "opportunity":
        return dataset.opportunities
          .filter((o) => wanted.has(o.id))
          .map((opportunity) => ({
            id: opportunity.id,
            kind: "opportunity" as const,
            title: opportunity.brokerName,
            subtitle: `Offered ${opportunity.offeredAt.slice(0, 10)}`,
            meta: [
              { label: "Outcome", value: opportunity.outcome.replace(/_/g, " ") },
              {
                label: "Answered",
                value: opportunity.respondedAt ? opportunity.respondedAt.slice(0, 10) : "no reply",
              },
            ],
            availability: SOURCE_AVAILABILITY.opportunities.availability,
          }));

      case "carrier":
        return dataset.carriers
          .filter((c) => wanted.has(c.carrierOrganizationId) && c.sharing === "shared")
          .map((carrier) => ({
            id: carrier.carrierOrganizationId,
            kind: "carrier" as const,
            title: carrier.name,
            subtitle: carrier.sharedSince
              ? `Sharing records since ${carrier.sharedSince.slice(0, 10)}`
              : undefined,
            meta: [],
            availability: SOURCE_AVAILABILITY.carriers.availability,
          }));

      default:
        return [];
    }
  },

  async sources(ctx) {
    await wait();
    assertCanOpenReports(ctx);
    return sourceStatuses(
      Object.keys(SOURCE_AVAILABILITY) as (keyof typeof SOURCE_AVAILABILITY)[],
    );
  },
};

/** A wide window, used where a run's own range is not the point. */
function neutralRange(): ReportRange {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
