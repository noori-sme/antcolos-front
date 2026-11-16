"use client";

import { FileUp, Package, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Can } from "@/components/auth/can";
import { LoadRecordStatusBadge } from "@/components/common/status-badge";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOAD_RECORD_STATUS } from "@/config/statuses";
import { equipmentLabel, money, routeSummary } from "@/lib/load-records/format";
import { LOAD_TRIP } from "@/lib/load-records/status";
import type { LoadRecord, LoadRecordQuery, LoadRecordStatus } from "@/types/load-record";
import { useLoadRecords } from "./hooks";

const PAGE_SIZE = 25;
const SELECT =
  "h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

const STATUS_OPTIONS: LoadRecordStatus[] = [...LOAD_TRIP, "cancelled"];
const SORTS = [
  { id: "newest", label: "Newest first", sortBy: "createdAt", sortDir: "desc" },
  { id: "pickup-soon", label: "Pickup date, earliest", sortBy: "firstPickupDate", sortDir: "asc" },
  { id: "pickup-late", label: "Pickup date, latest", sortBy: "firstPickupDate", sortDir: "desc" },
] as const;

const pickupDate = (date: string) =>
  date
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
        new Date(`${date}T00:00:00Z`),
      )
    : "—";

/** Search waits for a pause in typing (~300 ms) before asking the API. */
function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** The organization's loads on the real API (F1.2, plan 14). */
export function LiveLoadsScreen() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LoadRecordStatus | "all">("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("newest");
  const [page, setPage] = useState(1);
  const term = useDebounced(search.trim());

  const query: LoadRecordQuery = useMemo(() => {
    const chosen = SORTS.find((s) => s.id === sort) ?? SORTS[0];
    return {
      page,
      pageSize: PAGE_SIZE,
      status: status === "all" ? undefined : status,
      search: term || undefined,
      sortBy: chosen.sortBy,
      sortDir: chosen.sortDir,
    };
  }, [page, status, term, sort]);

  const loads = useLoadRecords(query);
  const data = loads.data;
  const filtered = status !== "all" || Boolean(term);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Loads"
        description="Every load in this organization, from its Rate Con to delivery."
        actions={
          <Can permission="documents:review">
            <Button asChild variant="primary">
              <Link href="/rate-cons/new">
                <FileUp aria-hidden />
                New load from a Rate Con
              </Link>
            </Button>
          </Can>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <label htmlFor="loads-search" className="sr-only">
            Search loads
          </label>
          <Input
            id="loads-search"
            type="search"
            placeholder="Broker, MC or load number"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <label htmlFor="loads-status" className="sr-only">
          Filter by status
        </label>
        <select
          id="loads-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as LoadRecordStatus | "all");
            setPage(1);
          }}
          className={SELECT}
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {LOAD_RECORD_STATUS[s].label}
            </option>
          ))}
        </select>
        <label htmlFor="loads-sort" className="sr-only">
          Sort loads
        </label>
        <select
          id="loads-sort"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as (typeof SORTS)[number]["id"]);
            setPage(1);
          }}
          className={SELECT}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {loads.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : loads.isError && !data ? (
        <ErrorState
          title="Couldn't load your loads"
          description={loads.error.message}
          onRetry={() => void loads.refetch()}
        />
      ) : !data || data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Search}
            title="No loads match"
            description="Try another search or status."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Package}
            title="No loads yet"
            description="A load starts from a broker's Rate Con: upload it, check the values, approve."
            action={
              <Can permission="documents:review">
                <Button asChild variant="primary">
                  <Link href="/rate-cons/new">New load from a Rate Con</Link>
                </Button>
              </Can>
            }
          />
        )
      ) : (
        <>
          <LoadRows loads={data.items} />
          {data.totalPages > 1 ? (
            <nav
              aria-label="Pages"
              className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem] text-fg-muted"
            >
              <span>
                {(data.page - 1) * data.pageSize + 1}–
                {Math.min(data.page * data.pageSize, data.totalItems)} of {data.totalItems}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span>
                  Page {data.page} of {data.totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Table at desktop, stacked cards on a phone; every row opens the load. */
function LoadRows({ loads }: { loads: LoadRecord[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-surface shadow-e1 md:block">
        <table className="w-full text-left text-[0.8125rem]">
          <thead className="border-b border-border bg-surface-sunken text-[0.75rem] text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Load</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Route</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Pickup</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Equipment</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Rate</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((load) => (
              <tr key={load.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                <td className="px-4 py-3">
                  <Link
                    href={`/loads/${load.id}`}
                    className="font-medium text-fg hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {load.brokerLoadNumber}
                  </Link>
                  <p className="text-[0.75rem] text-fg-muted">{load.brokerName}</p>
                </td>
                <td className="px-4 py-3 text-fg">{routeSummary(load.stops)}</td>
                <td className="px-4 py-3 tabular-nums text-fg">{pickupDate(load.firstPickupDate)}</td>
                <td className="px-4 py-3 text-fg">{equipmentLabel(load.equipmentType)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-fg">{money(load.rateTotal) ?? "—"}</td>
                <td className="px-4 py-3">
                  <LoadRecordStatusBadge status={load.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {loads.map((load) => (
          <li key={load.id}>
            <Link
              href={`/loads/${load.id}`}
              className="block rounded-lg border border-border bg-surface px-4 py-3 shadow-e1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{load.brokerLoadNumber}</p>
                  <p className="truncate text-[0.75rem] text-fg-muted">{load.brokerName}</p>
                </div>
                <LoadRecordStatusBadge status={load.status} />
              </div>
              <p className="mt-2 text-[0.8125rem] text-fg">{routeSummary(load.stops)}</p>
              <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                {pickupDate(load.firstPickupDate)} · {equipmentLabel(load.equipmentType)}
                {money(load.rateTotal) ? ` · ${money(load.rateTotal)}` : ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
