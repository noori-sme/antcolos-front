import type { DrilldownRef, Load, ReportRange } from "@/types";
import { destinationStop, originStop } from "@/types";
import { loadPeriodDate } from "../sources/dataset";
import type { ReportDataset } from "../sources/types";
import { bucketKey, bucketLabel, bucketsIn, type Granularity } from "../range";

/**
 * A slice is a subset of the dataset that every metric is computed over. The
 * whole report is one slice; each table row is another; each point on a line is
 * another. Because every view is computed from the same slice function, a
 * number cannot differ between the table, the chart and the summary text.
 */
export interface Slice {
  loads: ReportDataset["loads"];
  invoices: ReportDataset["invoices"];
  settlements: ReportDataset["settlements"];
  expenses: ReportDataset["expenses"];
  spells: ReportDataset["emptySpells"];
  sessions: ReportDataset["searchSessions"];
  opportunities: ReportDataset["opportunities"];
  earnings: ReportDataset["earnings"];
  trucks: ReportDataset["trucks"];
  rateConfirmations: ReportDataset["rateConfirmations"];
  documents: ReportDataset["documents"];
  carriers: ReportDataset["carriers"];
  /** Days the slice covers. Utilization and per-day rates need it. */
  days: number;
}

export function wholeSlice(dataset: ReportDataset, days: number): Slice {
  return {
    loads: dataset.loads,
    invoices: dataset.invoices,
    settlements: dataset.settlements,
    expenses: dataset.expenses,
    spells: dataset.emptySpells,
    sessions: dataset.searchSessions,
    opportunities: dataset.opportunities,
    earnings: dataset.earnings,
    trucks: dataset.trucks,
    rateConfirmations: dataset.rateConfirmations,
    documents: dataset.documents,
    carriers: dataset.carriers,
    days,
  };
}

/**
 * The same slice over the period before. Only the sources that were assembled
 * for both periods are carried; a metric with no previous number shows no
 * trend rather than a made-up one.
 */
export function previousSlice(dataset: ReportDataset, days: number): Slice {
  return {
    loads: dataset.previousLoads,
    invoices: dataset.previousInvoices,
    settlements: [],
    expenses: dataset.previousExpenses,
    spells: [],
    sessions: [],
    opportunities: [],
    earnings: dataset.previousEarnings,
    trucks: dataset.trucks,
    rateConfirmations: [],
    documents: [],
    carriers: dataset.carriers,
    days,
  };
}

const emptySlice = (base: Slice): Slice => ({
  ...base,
  loads: [], invoices: [], settlements: [], expenses: [], spells: [],
  sessions: [], opportunities: [], earnings: [], documents: [], rateConfirmations: [],
});

/** Narrows every load-linked source to one set of loads. */
export function sliceForLoads(base: Slice, loads: Load[]): Slice {
  const ids = new Set(loads.map((l) => l.id));
  const linked = <T extends { loadId?: string }>(rows: T[]) =>
    rows.filter((r) => (r.loadId ? ids.has(r.loadId) : false));

  return {
    ...base,
    loads,
    invoices: base.invoices.filter((i) => ids.has(i.loadId)),
    settlements: base.settlements.filter((s) => s.loadIds.some((id) => ids.has(id))),
    // Operating expenses are not attributable to a single load. A slice made
    // from loads carries none, and every metric that needs them says so.
    expenses: [],
    spells: linked(base.spells),
    sessions: linked(base.sessions),
    opportunities: linked(base.opportunities),
    earnings: base.earnings.filter((e) => ids.has(e.loadId)),
    rateConfirmations: base.rateConfirmations.filter((r) => ids.has(r.loadId)),
    documents: base.documents.filter((d) => ids.has(d.loadId)),
  };
}

export type Dimension =
  | "period"
  | "truck"
  | "driver"
  | "broker"
  | "lane"
  | "carrier"
  | "dispatcher"
  | "invoice_status"
  | "age_bucket"
  | "expense_category";

export interface Group {
  id: string;
  label: string;
  sublabel?: string;
  slice: Slice;
  drilldown?: DrilldownRef;
}

export interface GroupContext {
  dataset: ReportDataset;
  base: Slice;
  range: ReportRange;
  granularity: Granularity;
  now: number;
}

const loadDrilldown = (loads: Load[]): DrilldownRef | undefined =>
  loads.length
    ? { kind: "load", ids: loads.map((l) => l.id), label: `${loads.length} load${loads.length === 1 ? "" : "s"}` }
    : undefined;

function byKey<T>(rows: T[], key: (row: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    const list = map.get(k) ?? [];
    list.push(row);
    map.set(k, list);
  }
  return map;
}

const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Not invoiced yet",
  sent: "Sent, not due",
  overdue: "Overdue",
  paid: "Paid",
};

const AGE_BUCKETS: { id: string; label: string; max: number }[] = [
  { id: "0-30", label: "0–30 days", max: 30 },
  { id: "31-60", label: "31–60 days", max: 60 },
  { id: "61-90", label: "61–90 days", max: 90 },
  { id: "90+", label: "Over 90 days", max: Number.POSITIVE_INFINITY },
];

const EXPENSE_LABEL: Record<string, string> = {
  fuel: "Fuel",
  maintenance: "Maintenance",
  insurance: "Insurance",
  tolls: "Tolls",
  permits: "Permits",
  other: "Other",
};

/**
 * Splits the dataset along one dimension. Every branch ends in `sliceForLoads`
 * or a slice built from one source, so a group never sees a record outside it.
 */
export function groupBy(dimension: Dimension, ctx: GroupContext): Group[] {
  const { base, dataset } = ctx;

  switch (dimension) {
    case "period": {
      const buckets = bucketsIn(ctx.range, ctx.granularity);
      const loadsByBucket = byKey(base.loads, (l) =>
        bucketKey(loadPeriodDate(l), ctx.granularity),
      );
      return buckets.map((key) => {
        const loads = loadsByBucket.get(key) ?? [];
        const slice = sliceForLoads(base, loads);
        // Expenses are dated, so a period CAN carry its own share of them.
        const next = nextBucket(key, ctx.granularity);
        slice.expenses = base.expenses.filter((e) => {
          const t = new Date(e.incurredAt).getTime();
          return t >= new Date(key).getTime() && t < next;
        });
        return {
          id: key,
          label: bucketLabel(key, ctx.granularity),
          slice,
          drilldown: loadDrilldown(loads),
        };
      });
    }

    case "truck": {
      const grouped = byKey(base.loads, (l) => l.assignment?.truckId);
      return base.trucks.map((truck) => {
        const loads = grouped.get(truck.truckId) ?? [];
        const slice = sliceForLoads(base, loads);
        slice.trucks = [truck];
        return {
          id: truck.truckId,
          label: `Unit ${truck.unit}`,
          sublabel: truck.carrierName,
          slice,
          drilldown: loadDrilldown(loads),
        };
      });
    }

    case "driver": {
      const grouped = byKey(base.settlements, (s) => s.driverId);
      return [...grouped.entries()].map(([driverId, settlements]) => {
        const ids = new Set(settlements.flatMap((s) => s.loadIds));
        const loads = base.loads.filter((l) => ids.has(l.id));
        const slice = sliceForLoads(base, loads);
        slice.settlements = settlements;
        return {
          id: driverId,
          label: settlements[0].driverName,
          slice,
          drilldown: {
            kind: "settlement" as const,
            ids: settlements.map((s) => s.id),
            label: `${settlements.length} settlement${settlements.length === 1 ? "" : "s"}`,
          },
        };
      });
    }

    case "broker": {
      const grouped = byKey(base.loads, (l) => l.customer.id);
      return [...grouped.entries()].map(([customerId, loads]) => ({
        id: customerId,
        label: loads[0].customer.name,
        sublabel: loads[0].customer.kind === "broker" ? "Broker" : "Shipper",
        slice: sliceForLoads(base, loads),
        drilldown: loadDrilldown(loads),
      }));
    }

    case "lane": {
      const grouped = byKey(base.loads, (l) => {
        const a = originStop(l).address;
        const b = destinationStop(l).address;
        return `${a.city}, ${a.state} → ${b.city}, ${b.state}`;
      });
      return [...grouped.entries()].map(([lane, loads]) => ({
        id: lane,
        label: lane,
        slice: sliceForLoads(base, loads),
        drilldown: loadDrilldown(loads),
      }));
    }

    case "carrier": {
      const grouped = byKey(base.loads, (l) => l.assignment?.carrierOrganizationId ?? "own_authority");
      return [...grouped.entries()].map(([carrierId, loads]) => {
        const link = dataset.carriers.find((c) => c.carrierOrganizationId === carrierId);
        return {
          id: carrierId,
          label: link?.name ?? (carrierId === "own_authority" ? "Own authority" : carrierId),
          sublabel: link ? "Records shared" : undefined,
          slice: sliceForLoads(base, loads),
          drilldown: loadDrilldown(loads),
        };
      });
    }

    case "dispatcher": {
      const grouped = byKey(base.loads, (l) => dataset.attribution.get(l.id)?.membershipId);
      return [...grouped.entries()].map(([membershipId, loads]) => ({
        id: membershipId,
        label: dataset.attribution.get(loads[0].id)?.displayName ?? "Unattributed",
        slice: sliceForLoads(base, loads),
        drilldown: loadDrilldown(loads),
      }));
    }

    case "invoice_status": {
      const grouped = byKey(base.invoices, (i) => i.status);
      const order = ["draft", "sent", "overdue", "paid"];
      return order
        .filter((status) => grouped.has(status))
        .map((status) => {
          const invoices = grouped.get(status)!;
          const slice = { ...emptySlice(base), invoices };
          return {
            id: status,
            label: INVOICE_STATUS_LABEL[status] ?? status,
            slice,
            drilldown: {
              kind: "invoice" as const,
              ids: invoices.map((i) => i.id),
              label: `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`,
            },
          };
        });
    }

    case "age_bucket": {
      const open = base.invoices.filter((i) => i.status === "sent" || i.status === "overdue");
      return AGE_BUCKETS.map((bucket, i) => {
        const min = i === 0 ? 0 : AGE_BUCKETS[i - 1].max;
        const invoices = open.filter((invoice) => {
          const sent = invoice.sentAt ? new Date(invoice.sentAt).getTime() : ctx.now;
          const age = (ctx.now - sent) / 86_400_000;
          return age > min && age <= bucket.max;
        });
        return {
          id: bucket.id,
          label: bucket.label,
          slice: { ...emptySlice(base), invoices },
          drilldown: invoices.length
            ? {
                kind: "invoice" as const,
                ids: invoices.map((inv) => inv.id),
                label: `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`,
              }
            : undefined,
        };
      });
    }

    case "expense_category": {
      const grouped = byKey(base.expenses, (e) => e.category);
      return [...grouped.entries()].map(([category, expenses]) => ({
        id: category,
        label: EXPENSE_LABEL[category] ?? category,
        slice: { ...emptySlice(base), expenses, loads: base.loads },
        drilldown: {
          kind: "expense" as const,
          ids: expenses.map((e) => e.id),
          label: `${expenses.length} expense record${expenses.length === 1 ? "" : "s"}`,
        },
      }));
    }
  }
}

function nextBucket(key: string, granularity: Granularity): number {
  const d = new Date(key);
  if (granularity === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (granularity === "week") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
}
