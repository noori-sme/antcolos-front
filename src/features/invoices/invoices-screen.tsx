"use client";

import { ClipboardList, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { InvoiceFilters, InvoiceSort } from "@/lib/api/contracts/invoices";
import { useCan } from "@/lib/session/hooks";
import { cn, money } from "@/lib/utils";
import { NewInvoiceDialog } from "./action-dialogs";
import {
  useInvoiceAction, useInvoiceList, useInvoiceSummary, useInvoiceableLoads,
} from "./hooks";
import { InvoiceCards } from "./invoice-cards";
import { InvoicesTable } from "./invoices-table";
import { InvoiceNeedsYouPanel } from "./needs-you-panel";

const VIEWS: { id: NonNullable<InvoiceFilters["view"]>; label: string }[] = [
  { id: "outstanding", label: "Outstanding" },
  { id: "draft", label: "Drafts" },
  { id: "needs_documents", label: "Needs documents" },
  { id: "ready", label: "Ready" },
  { id: "overdue", label: "Overdue" },
  { id: "disputed", label: "Disputed" },
  { id: "paid", label: "Paid" },
  { id: "void", label: "Void" },
  { id: "all", label: "All" },
];

export function InvoicesScreen() {
  const router = useRouter();
  const [view, setView] = useState<NonNullable<InvoiceFilters["view"]>>("outstanding");
  const [search, setSearch] = useState("");
  const [missingDocuments, setMissingDocuments] = useState(false);
  const [sort, setSort] = useState<InvoiceSort>({ field: "issueDate", direction: "desc" });
  const [creating, setCreating] = useState(false);

  const canCreate = useCan("invoices:create");

  const filters: InvoiceFilters = useMemo(
    () => ({
      view,
      search: search.trim() || undefined,
      missingDocuments: missingDocuments || undefined,
    }),
    [view, search, missingDocuments],
  );

  const query = useInvoiceList(filters, sort);
  const summary = useInvoiceSummary();
  const billableLoads = useInvoiceableLoads(creating);
  const action = useInvoiceAction();

  const invoices = query.data?.items ?? [];
  const total = query.data?.totalCount ?? 0;
  const filtered = Boolean(search.trim()) || missingDocuments;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Invoices"
        description="What each broker, shipper or approved payer owes this carrier, and what is holding each invoice up."
        actions={
          <>
            <Badge tone="outline">{total} shown</Badge>
            {canCreate ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                Invoice a load
              </Button>
            ) : null}
          </>
        }
      />

      {/* Money first: the three numbers a carrier owner opens this screen for. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <SummaryTile
          label="Outstanding"
          value={summary.data ? money(summary.data.outstandingCents, { compact: true }) : "—"}
          detail={summary.data ? `${summary.data.outstandingCount} invoices` : undefined}
          loading={summary.isPending}
        />
        <SummaryTile
          label="Overdue"
          value={summary.data ? money(summary.data.overdueCents, { compact: true }) : "—"}
          detail={summary.data ? `${summary.data.overdueCount} past due` : undefined}
          tone={summary.data && summary.data.overdueCount > 0 ? "danger" : undefined}
          loading={summary.isPending}
        />
        <SummaryTile
          label="Disputed"
          value={summary.data ? money(summary.data.disputedCents, { compact: true }) : "—"}
          detail={summary.data ? `${summary.data.disputedCount} contested` : undefined}
          tone={summary.data && summary.data.disputedCount > 0 ? "warning" : undefined}
          loading={summary.isPending}
        />
        <SummaryTile
          label="Waiting on you"
          value={
            summary.data
              ? String(summary.data.draftCount + summary.data.needsDocumentsCount + summary.data.readyCount)
              : "—"
          }
          detail={
            summary.data
              ? `${summary.data.readyCount} ready · ${summary.data.needsDocumentsCount} short of paperwork`
              : undefined
          }
          loading={summary.isPending}
        />
      </div>

      <InvoiceNeedsYouPanel />

      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="Invoice views"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "h-control shrink-0 rounded-md px-3 text-[0.875rem] font-medium transition-colors",
                view === v.id
                  ? "bg-surface-hover text-fg shadow-e1 ring-1 ring-border"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice number, load, payer…"
              aria-label="Search invoices"
              className="pl-9"
            />
          </div>
          <Chip
            label="Missing documents"
            selected={missingDocuments}
            onToggle={() => setMissingDocuments((v) => !v)}
          />
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setMissingDocuments(false);
              }}
            >
              <X aria-hidden />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {query.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load invoices"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filtered ? "No invoices match these filters" : `Nothing in ${VIEWS.find((v) => v.id === view)?.label.toLowerCase()}`}
          description={
            filtered
              ? "Clear the search or the document filter to widen the list."
              : "An invoice appears here once a delivered load is billed."
          }
          action={
            canCreate && !filtered ? (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                Invoice a load
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <InvoicesTable invoices={invoices} sort={sort} onSortChange={setSort} />
          </div>
          <div className="md:hidden">
            <InvoiceCards invoices={invoices} />
          </div>
        </>
      )}

      {canCreate ? (
        <NewInvoiceDialog
          open={creating}
          onOpenChange={(open) => {
            setCreating(open);
            if (!open) action.reset();
          }}
          loads={billableLoads.data ?? []}
          pending={action.isPending}
          error={action.error?.message}
          onConfirm={(loadId) =>
            action.mutate(
              { action: { kind: "create", input: { loadId } } },
              {
                onSuccess: (invoice) => {
                  setCreating(false);
                  router.push(`/finance/invoices/${invoice.id}`);
                },
              },
            )
          }
        />
      ) : null}

      <p className="text-[0.75rem] text-fg-subtle">
        Settlements, reporting, real payment processing, email delivery,
        factoring submission and accounting export are separate modules and are
        deliberately absent rather than stubbed.
      </p>
    </div>
  );
}

function SummaryTile({
  label, value, detail, tone, loading,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "danger" | "warning";
  loading?: boolean;
}) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[0.75rem] text-fg-subtle">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-[1.25rem] leading-7 font-semibold",
          tone === "danger" ? "text-st-danger" : tone === "warning" ? "text-st-warning" : "text-fg",
        )}
      >
        {loading ? "…" : value}
      </p>
      {detail ? <p className="text-[0.75rem] text-fg-muted">{loading ? "" : detail}</p> : null}
    </Card>
  );
}
