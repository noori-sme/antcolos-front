"use client";

import {
  AlertTriangle, CalendarClock, ChevronRight, FilePlus2, FileSignature, Link2,
  PenLine, Plug, Search, ShieldQuestion,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Can } from "@/components/auth/can";
import {
  CONTRACT_INTEGRATIONS, MOCK_CONTRACT_DISCLOSURE, agreementTypeLabel,
  contractDate, effectiveRangeLabel, endsInLabel,
} from "@/lib/contracts";
import { useNow } from "@/lib/utils/use-now";
import { cn } from "@/lib/utils";
import type { ContractStatus, ContractSummary } from "@/types";
import {
  AgreementTypeChip, ContractStatusChip, Disclosure, MockChip, PartyRoleChip,
} from "./chips";
import { useContracts, useContractsDashboard, useTransitionRequests } from "./hooks";

/**
 * The Contracts & Relationships dashboard.
 *
 * Organization-scoped and derived: every count, every tile and every row comes
 * from the service on each read. There is no stored "expiring" list to go stale,
 * and switching organization switches the whole page because the query key is
 * namespaced by it.
 *
 * The page is arranged around what somebody has to DO — signatures waiting,
 * agreements running out, requirements outstanding, terminations unfinished —
 * with the full list underneath rather than above it.
 */

const STATUS_FILTERS: ContractStatus[] = [
  "draft", "pending_review", "awaiting_signature", "active",
  "expiring", "expired", "terminated", "cancelled", "superseded",
];

export function ContractsDashboardScreen() {
  // Null until hydration, so "ends in 18 days" is never computed during the
  // server render and then disagreed with on the client.
  const nowMs = useNow();
  const now = nowMs == null ? null : new Date(nowMs).toISOString();
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<ContractStatus[]>([]);

  const filters = useMemo(
    () => ({ status: statuses.length ? statuses : undefined, includeClosed: statuses.length > 0 }),
    [statuses],
  );

  const dashboard = useContractsDashboard();
  const list = useContracts(filters, "ending_soonest");
  const transitions = useTransitionRequests();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = list.data?.items ?? [];
    if (!q) return items;
    return items.filter((r) =>
      `${r.reference} ${r.title} ${r.counterpartyName}`.toLowerCase().includes(q));
  }, [list.data, query]);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Contracts & relationships"
        description="The terms behind who works for you, on what basis, and for how much."
        actions={
          <Can permission="contracts:create">
            <Button asChild size="sm">
              <Link href="/contracts/new">
                <FilePlus2 aria-hidden />
                New agreement
              </Link>
            </Button>
          </Can>
        }
      />

      <Disclosure>
        <strong className="font-semibold text-fg">Mock agreements.</strong>{" "}
        {MOCK_CONTRACT_DISCLOSURE}{" "}
        A contract here records what was agreed; it never grants or removes
        anybody&apos;s access. Memberships, driver relationships, carrier
        relationships and Operating Authority leases are changed in their own
        modules, and this one can only ask.
      </Disclosure>

      {dashboard.isPending ? <LoadingSkeleton rows={3} /> : null}
      {dashboard.isError ? <ErrorState onRetry={() => dashboard.refetch()} /> : null}

      {dashboard.data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="In force"
              value={dashboard.data.counts.active + dashboard.data.counts.expiring}
              detail={dashboard.data.inForceByType
                .map((t) => `${t.count} ${agreementTypeLabel(t.agreementType).toLowerCase()}`)
                .join(" · ") || "Nothing in force yet."}
              icon={FileSignature}
            />
            <Tile
              label="Waiting on your signature"
              value={dashboard.data.awaitingMySignature.length}
              detail={dashboard.data.awaitingMySignature.length
                ? "You personally hold the authority to sign these."
                : "Nothing is waiting on a signature you can give."}
              icon={PenLine}
              tone={dashboard.data.awaitingMySignature.length ? "warning" : "neutral"}
            />
            <Tile
              label="Expiring"
              value={dashboard.data.expiringSoon.length}
              detail={dashboard.data.expiringSoon.length
                ? "Inside each agreement's own reminder window."
                : "Nothing inside its reminder window."}
              icon={CalendarClock}
              tone={dashboard.data.expiringSoon.length ? "warning" : "neutral"}
            />
            <Tile
              label="Needing attention"
              value={
                dashboard.data.withOpenRequirements.length
                + dashboard.data.unresolvedTerminations.length
              }
              detail={`${dashboard.data.withOpenRequirements.length} with an outstanding requirement · ${dashboard.data.unresolvedTerminations.length} unfinished termination`}
              icon={AlertTriangle}
              tone={
                dashboard.data.withOpenRequirements.length
                + dashboard.data.unresolvedTerminations.length
                  ? "danger"
                  : "neutral"
              }
            />
          </section>

          {dashboard.data.awaitingMySignature.length > 0 ? (
            <Panel
              title="Waiting on your signature"
              description="You hold live signing authority for a party on each of these. You can never sign for the other side."
            >
              {dashboard.data.awaitingMySignature.map((row) => (
                <SummaryRow key={row.contractId} row={row} now={now} />
              ))}
            </Panel>
          ) : null}

          {dashboard.data.expiringSoon.length > 0 ? (
            <Panel
              title="Running out"
              description="Renewing means a new version. The current terms keep their own dates and compensation rules."
            >
              {dashboard.data.expiringSoon.map((row) => (
                <SummaryRow key={row.contractId} row={row} now={now} />
              ))}
            </Panel>
          ) : null}

          {dashboard.data.unresolvedTerminations.length > 0 ? (
            <Panel
              title="Terminations not finished"
              description="Access is revoked in the modules that control it. Nothing is deleted — not the person, the organization, the equipment record, the documents, or any completed load, invoice or settlement."
            >
              {dashboard.data.unresolvedTerminations.map((row) => (
                <SummaryRow key={row.contractId} row={row} now={now} />
              ))}
            </Panel>
          ) : null}

          {transitions.data && transitions.data.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 aria-hidden className="size-4 text-fg-subtle" />
                  Access changes these agreements have asked for
                </CardTitle>
                <p className="mt-1 text-[0.8125rem] text-fg-muted">
                  Every one of these is a note. Nothing has been created, altered
                  or ended — the module that owns each relationship is where the
                  change is actually made.
                </p>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {transitions.data.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-md border border-border bg-surface-sunken px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.8125rem] font-medium text-fg">
                        {request.kind.replace(/_/g, " ")}
                      </span>
                      <MockChip label="Not applied" />
                      <span className="text-[0.75rem] text-fg-subtle">
                        {request.target.labelSnapshot}
                      </span>
                    </div>
                    <p className="mt-1 text-[0.8125rem] text-fg-muted">{request.nextStep}</p>
                    <p className="mt-1 text-[0.75rem] text-fg-subtle">
                      Owned by {request.ownerService} · asked{" "}
                      {contractDate(request.requestedAt)} by {request.requestedByName}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Reference, title or counterparty…"
              aria-label="Search agreements"
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((status) => (
            <Chip
              key={status}
              label={status.replace(/_/g, " ")}
              selected={statuses.includes(status)}
              count={dashboard.data?.counts[status]}
              onToggle={() => setStatuses((current) =>
                current.includes(status)
                  ? current.filter((s) => s !== status)
                  : [...current, status])}
            />
          ))}
        </div>

        <p className="text-[0.75rem] text-fg-subtle">
          Expired, terminated, cancelled and superseded agreements are hidden
          until you ask for them. They are never deleted — pick a status above to
          read one.
        </p>

        {list.isPending ? <LoadingSkeleton rows={5} /> : null}
        {list.isError ? <ErrorState onRetry={() => list.refetch()} /> : null}

        {list.data && list.data.items.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="No agreements here yet"
            description="An agreement records the terms of a business relationship — a driver, an owner-operator, a dispatch organization, a dispatcher, an equipment lease. Write one and it stays a draft until both sides sign."
            action={
              <Can permission="contracts:create">
                <Button asChild size="sm">
                  <Link href="/contracts/new">Write the first one</Link>
                </Button>
              </Can>
            }
          />
        ) : null}

        {list.data && list.data.items.length > 0 && rows.length === 0 ? (
          <EmptyState icon={Search} title="Nothing matches" description="Try a different search or status." />
        ) : null}

        {rows.length > 0 ? (
          <ul className="space-y-2.5">
            {rows.map((row) => (
              <li key={row.contractId}>
                <SummaryRow row={row} now={now} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug aria-hidden className="size-4 text-fg-subtle" />
            Not connected
          </CardTitle>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            Each of these is a declared seam with nothing behind it. The list is
            read from the code, so it cannot drift from what is actually wired.
          </p>
        </CardHeader>
        <CardContent className="grid gap-2.5 sm:grid-cols-2">
          {CONTRACT_INTEGRATIONS.map((integration) => (
            <div
              key={integration.kind}
              className="rounded-md border border-border bg-surface-sunken px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <ShieldQuestion aria-hidden className="size-3.5 text-fg-subtle" />
                <span className="text-[0.8125rem] font-medium text-fg">{integration.label}</span>
                <MockChip label="Not connected" />
              </div>
              <p className="mt-1 text-[0.8125rem] text-fg-muted">{integration.description}</p>
              <p className="mt-1 text-[0.75rem] text-fg-subtle">{integration.today}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Tile({
  label, value, detail, icon: Icon, tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof FileSignature;
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden
          className={cn(
            "size-4",
            tone === "danger" ? "text-st-danger"
              : tone === "warning" ? "text-st-warning" : "text-fg-subtle",
          )}
        />
        <span className="text-[0.8125rem] font-medium text-fg-muted">{label}</span>
      </div>
      <p className="mt-2 text-[1.75rem] leading-9 font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-[0.75rem] text-fg-subtle">{detail}</p>
    </div>
  );
}

function Panel({
  title, description, children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-[0.8125rem] text-fg-muted">{description}</p>
      </CardHeader>
      <CardContent className="space-y-2.5">{children}</CardContent>
    </Card>
  );
}

function SummaryRow({ row, now }: { row: ContractSummary; now: string | null }) {
  const effective = { effective: { from: row.effectiveFrom, to: row.effectiveTo } };
  return (
    <Link
      href={`/contracts/${row.contractId}`}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
        "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.75rem] text-fg-subtle">{row.reference}</span>
          <ContractStatusChip status={row.status} />
          <AgreementTypeChip type={row.agreementType} />
          <MockChip />
        </div>
        <p className="mt-1.5 truncate text-[0.9375rem] font-medium text-fg">{row.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-fg-muted">
          <PartyRoleChip role={row.counterpartyRole} />
          <span>{row.counterpartyName}</span>
          <span aria-hidden className="text-fg-subtle">·</span>
          <span>Version {row.versionNumber}</span>
          <span aria-hidden className="text-fg-subtle">·</span>
          <span>{now ? endsInLabel(effective, now) : effectiveRangeLabel(effective)}</span>
        </p>
        {row.signaturesOutstanding > 0 || row.blockingRequirementsOpen > 0
          || row.terminationOutstanding ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.75rem]">
              {row.signaturesOutstanding > 0 ? (
                <span className="text-st-warning">
                  {row.signaturesOutstanding} signature
                  {row.signaturesOutstanding === 1 ? "" : "s"} outstanding
                </span>
              ) : null}
              {row.blockingRequirementsOpen > 0 ? (
                <span className="text-st-danger">
                  {row.blockingRequirementsOpen} required item
                  {row.blockingRequirementsOpen === 1 ? "" : "s"} missing
                </span>
              ) : null}
              {row.terminationOutstanding ? (
                <span className="text-st-warning">Termination not finished</span>
              ) : null}
            </p>
          ) : null}
        {!row.compensationVisible ? (
          <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
            Compensation terms are not included for you.
          </p>
        ) : null}
      </div>
      <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-fg-subtle" />
    </Link>
  );
}
