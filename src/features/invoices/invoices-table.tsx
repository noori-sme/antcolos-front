"use client";

import {
  createColumnHelper, flexRender, getCoreRowModel, useReactTable,
  type SortingState, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckIndicator, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BILLING_PARTY_KIND_LABEL } from "@/config/invoices";
import type { InvoiceSort, InvoiceSortField } from "@/lib/api/contracts/invoices";
import { cn, money, relativeTime } from "@/lib/utils";
import {
  invoiceDaysPastDue, missingInvoiceDocuments, type Invoice,
} from "@/types";
import { InvoiceStatusBadge } from "./status-chips";

const col = createColumnHelper<Invoice>();

const COLUMN_LABEL: Record<string, string> = {
  number: "Invoice",
  billingParty: "Billed to",
  load: "Load",
  lane: "Lane",
  issueDate: "Issued",
  dueDate: "Due",
  status: "Status",
  documents: "Documents",
  total: "Total",
  balance: "Balance",
};

const SORT_FIELD: Record<string, InvoiceSortField> = {
  number: "number",
  billingParty: "billingParty",
  issueDate: "issueDate",
  dueDate: "dueDate",
  status: "status",
  total: "total",
  balance: "balance",
};

const shortDate = (iso?: string) =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "—";

export function InvoicesTable({
  invoices, sort, onSortChange,
}: {
  invoices: Invoice[];
  sort: InvoiceSort;
  onSortChange: (next: InvoiceSort) => void;
}) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    // Off by default so the money columns are never pushed off the edge.
    lane: false,
  });

  const columns = useMemo(
    () => [
      col.accessor("number", {
        id: "number",
        header: "Invoice",
        cell: (c) => (
          <span className="font-mono text-[0.8125rem] font-medium text-fg">
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor((i) => i.billingParty.name, {
        id: "billingParty",
        header: "Billed to",
        cell: (c) => (
          <span className="block min-w-0 truncate text-fg">
            {c.getValue()}
            <span className="block text-[0.75rem] text-fg-subtle">
              {BILLING_PARTY_KIND_LABEL[c.row.original.billingParty.kind]} · net{" "}
              {c.row.original.paymentTermsDays}
            </span>
          </span>
        ),
      }),
      col.accessor((i) => i.load.reference, {
        id: "load",
        header: "Load",
        cell: (c) => (
          <Link
            href={`/loads/${c.row.original.loadId}`}
            className="font-mono text-[0.8125rem] text-fg-muted hover:text-fg hover:underline"
          >
            {c.getValue()}
          </Link>
        ),
      }),
      col.display({
        id: "lane",
        header: "Lane",
        cell: (c) => {
          const l = c.row.original.load;
          return (
            <span className="block min-w-[12rem] text-fg-muted">
              {l.originCity}, {l.originState}
              <span className="text-fg-subtle"> → </span>
              {l.destinationCity}, {l.destinationState}
            </span>
          );
        },
      }),
      col.accessor((i) => i.issueDate, {
        id: "issueDate",
        header: "Issued",
        cell: (c) => (
          <span className="whitespace-nowrap text-fg-muted">{shortDate(c.getValue())}</span>
        ),
      }),
      col.accessor((i) => i.dueDate, {
        id: "dueDate",
        header: "Due",
        cell: (c) => {
          const invoice = c.row.original;
          const past = invoice.status === "overdue" ? invoiceDaysPastDue(invoice) : null;
          return (
            <span className="whitespace-nowrap">
              <span className={past != null && past > 0 ? "text-st-danger" : "text-fg-muted"}>
                {shortDate(c.getValue())}
              </span>
              {past != null && past > 0 ? (
                <span className="block text-[0.6875rem] text-st-danger">
                  {past}d past due
                </span>
              ) : c.getValue() && invoice.balanceCents > 0 ? (
                <span className="block text-[0.6875rem] text-fg-subtle">
                  {relativeTime(c.getValue()!)}
                </span>
              ) : null}
            </span>
          );
        },
      }),
      col.accessor("status", {
        id: "status",
        header: "Status",
        cell: (c) => <InvoiceStatusBadge status={c.getValue()} />,
      }),
      col.display({
        id: "documents",
        header: "Documents",
        cell: (c) => {
          const missing = missingInvoiceDocuments(c.row.original);
          return missing.length === 0 ? (
            <Badge tone="success">Complete</Badge>
          ) : (
            <Badge tone="warning">{missing.length} missing</Badge>
          );
        },
      }),
      col.accessor((i) => i.totalCents, {
        id: "total",
        header: "Total",
        cell: (c) => (
          <span className="tnum block text-right font-medium text-fg">
            {money(c.getValue())}
          </span>
        ),
      }),
      col.accessor((i) => i.balanceCents, {
        id: "balance",
        header: "Balance",
        cell: (c) => (
          <span
            className={cn(
              "tnum block text-right",
              c.getValue() === 0 ? "text-fg-subtle" : "text-fg",
            )}
          >
            {money(c.getValue())}
          </span>
        ),
      }),
    ],
    [],
  );

  const sorting: SortingState = [
    {
      id: Object.keys(SORT_FIELD).find((k) => SORT_FIELD[k] === sort.field) ?? "issueDate",
      desc: sort.direction === "desc",
    },
  ];

  const table = useReactTable({
    data: invoices,
    columns,
    state: { columnVisibility, sorting },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    // Sorting happens in the service so it applies to the whole result set.
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
                  const numeric = ["total", "balance"].includes(header.column.id);
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
                        href={`/finance/invoices/${row.original.id}`}
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
