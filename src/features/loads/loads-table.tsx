"use client";

import {
  createColumnHelper, flexRender, getCoreRowModel, useReactTable,
  type SortingState, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadStatusBadge } from "@/components/common/status-badge";
import {
  DropdownMenu, DropdownMenuCheckIndicator, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import type { LoadSort, LoadSortField } from "@/lib/api/contracts/loads";
import { useCan } from "@/lib/session/hooks";
import { cn, dateTimeIn, money, ratePerMile } from "@/lib/utils";
import { destinationStop, originStop, type Load } from "@/types";
import { DocumentStatus } from "./shared";

const col = createColumnHelper<Load>();

const COLUMN_LABEL: Record<string, string> = {
  reference: "Reference",
  customer: "Customer",
  lane: "Lane",
  pickup: "Pickup",
  delivery: "Delivery",
  driver: "Driver",
  equipment: "Equipment",
  status: "Status",
  documents: "Documents",
  miles: "Miles",
  rate: "Rate",
  rpm: "RPM",
};

/** Which table columns map onto a server sort field. */
const SORT_FIELD: Record<string, LoadSortField> = {
  reference: "reference",
  customer: "customer",
  pickup: "pickupAt",
  delivery: "deliveryAt",
  status: "status",
  rate: "rate",
};

export function LoadsTable({
  loads, sort, onSortChange, driverName,
}: {
  loads: Load[];
  sort: LoadSort;
  onSortChange: (next: LoadSort) => void;
  driverName: (driverId?: string) => string;
}) {
  const canSeeRates = useCan("rates:view");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    // Off by default so the table fits a 1440px window without clipping the
    // rate column. All of these stay one click away in the Columns menu.
    delivery: false,
    equipment: false,
    miles: false,
    rpm: false,
  });

  const columns = useMemo(() => {
    const base = [
      col.accessor("reference", {
        id: "reference",
        header: "Reference",
        cell: (c) => (
          <span className="font-mono text-[0.8125rem] font-medium text-fg">
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor((l) => l.customer.name, {
        id: "customer",
        header: "Customer",
        cell: (c) => <span className="truncate text-fg">{c.getValue()}</span>,
      }),
      col.display({
        id: "lane",
        header: "Lane",
        cell: (c) => {
          const a = originStop(c.row.original);
          const b = destinationStop(c.row.original);
          return (
            <span className="block min-w-[12rem] text-fg">
              {a.address.city}, {a.address.state}
              <span className="text-fg-subtle"> → </span>
              {b.address.city}, {b.address.state}
            </span>
          );
        },
      }),
      col.accessor((l) => originStop(l).appointmentAt, {
        id: "pickup",
        header: "Pickup",
        cell: (c) => (
          <span className="whitespace-nowrap text-fg-muted">
            {dateTimeIn(c.getValue(), originStop(c.row.original).timeZone)}
          </span>
        ),
      }),
      col.accessor((l) => destinationStop(l).appointmentAt, {
        id: "delivery",
        header: "Delivery",
        cell: (c) => (
          <span className="whitespace-nowrap text-fg-muted">
            {dateTimeIn(c.getValue(), destinationStop(c.row.original).timeZone)}
          </span>
        ),
      }),
      col.accessor((l) => l.assignment?.driverId, {
        id: "driver",
        header: "Driver",
        cell: (c) =>
          c.getValue() ? (
            <span className="whitespace-nowrap text-fg-muted">
              {driverName(c.getValue())}
            </span>
          ) : (
            <Badge tone="outline">Unassigned</Badge>
          ),
      }),
      col.accessor("equipment", {
        id: "equipment",
        header: "Equipment",
        cell: (c) => (
          <span className="whitespace-nowrap text-fg-muted">
            {EQUIPMENT_LABEL[c.getValue()]}
          </span>
        ),
      }),
      col.accessor("status", {
        id: "status",
        header: "Status",
        cell: (c) => <LoadStatusBadge status={c.getValue()} />,
      }),
      col.display({
        id: "documents",
        header: "Documents",
        cell: (c) => <DocumentStatus load={c.row.original} />,
      }),
      col.accessor((l) => l.financials?.loadedMiles, {
        id: "miles",
        header: "Miles",
        cell: (c) => (
          <span className="tnum block text-right text-fg-muted">
            {c.getValue() ?? "—"}
          </span>
        ),
      }),
    ];

    if (!canSeeRates) return base;

    return [
      ...base,
      col.accessor((l) => l.financials?.totalRateCents, {
        id: "rate",
        header: "Rate",
        cell: (c) => (
          <span className="tnum block text-right font-medium text-fg">
            {c.getValue() != null ? money(c.getValue()!) : "—"}
          </span>
        ),
      }),
      col.accessor((l) => l.financials?.ratePerMileCents, {
        id: "rpm",
        header: "RPM",
        cell: (c) => (
          <span className="tnum block text-right text-fg-muted">
            {c.getValue() != null ? ratePerMile(c.getValue()!) : "—"}
          </span>
        ),
      }),
    ];
  }, [canSeeRates, driverName]);

  const sorting: SortingState = [
    { id: Object.keys(SORT_FIELD).find((k) => SORT_FIELD[k] === sort.field) ?? "pickup",
      desc: sort.direction === "desc" },
  ];

  const table = useReactTable({
    data: loads,
    columns,
    state: { columnVisibility, sorting },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    // Sorting happens in the service so it applies to the whole result set,
    // not just the page the client happens to hold.
    manualSorting: true,
  });

  const toggleSort = (columnId: string) => {
    const field = SORT_FIELD[columnId];
    if (!field) return;
    onSortChange({
      field,
      direction: sort.field === field && sort.direction === "desc" ? "asc" : "desc",
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              <Columns3 aria-hidden />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            {table.getAllLeafColumns().map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={(e) => {
                  e.preventDefault();
                  c.toggleVisibility();
                }}
              >
                {COLUMN_LABEL[c.id] ?? c.id}
                <DropdownMenuCheckIndicator checked={c.getIsVisible()} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-[0.875rem]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-surface-sunken/60 text-left">
                {hg.headers.map((header) => {
                  const sortable = Boolean(SORT_FIELD[header.column.id]);
                  const active = SORT_FIELD[header.column.id] === sort.field;
                  const numeric = ["rate", "rpm", "miles"].includes(header.column.id);
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        "px-3 py-2.5 text-[0.75rem] font-semibold tracking-wide text-fg-subtle uppercase",
                        numeric && "text-right",
                      )}
                      aria-sort={
                        active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(header.column.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-xs transition-colors hover:text-fg",
                            active && "text-fg",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {active ? (
                            sort.direction === "asc" ? (
                              <ArrowUp aria-hidden className="size-3" />
                            ) : (
                              <ArrowDown aria-hidden className="size-3" />
                            )
                          ) : (
                            <ChevronsUpDown aria-hidden className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-border transition-colors hover:bg-surface-hover"
              >
                {row.getVisibleCells().map((cell, i) => (
                  <td
                    key={cell.id}
                    className="h-row px-3 py-[var(--cell-py)] align-middle text-fg-muted"
                  >
                    {i === 0 ? (
                      <Link
                        href={`/loads/${row.original.id}`}
                        className="block rounded-xs outline-offset-2 hover:underline"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Link>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
