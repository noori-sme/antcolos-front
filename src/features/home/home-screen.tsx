"use client";

import {
  CircleDollarSign, Clock3, FileWarning, Package, Plus, Route, Truck,
} from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Can } from "@/components/auth/can";
import { useActiveMembership, useCan, useSession } from "@/lib/session/hooks";
import { money, ratePerMile } from "@/lib/utils";
import { useHomeSummary } from "./hooks";
import { NeedsYouPreview } from "./needs-you-preview";
import {
  ActiveLoadsPanel, DriverAttentionPanel, SoonEmptyTrucksPanel,
  UnassignedLoadsPanel,
} from "./panels";
import { HiddenFinancialTile, StatTile } from "./stat-tile";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Home is not one universal dashboard. It is composed from what the active
 * membership may actually do — no role name is ever checked. Needs You leads,
 * always.
 */
export function HomeScreen() {
  const { user } = useSession();
  const { organization, membership } = useActiveMembership();
  const summary = useHomeSummary();

  const canSeeEquipment = useCan("equipment:view");
  const canSeeDrivers = useCan("drivers:view");
  const canSeeLoads = useCan("loads:view");
  const canSeeRevenue = useCan("revenue:view");
  const canAssign = useCan("loads:assign");

  const firstName = user.displayName.split(" ")[0];
  const title = `${greeting(new Date().getHours())}, ${firstName}`;
  const subtitle = `${organization?.displayName ?? "No organization"} · ${
    membership?.isOwner ? "Owner" : (membership?.title ?? "Member")
  }`;

  if (summary.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-64" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title={title} description={subtitle} />
        <ErrorState
          title="Could not load your home view"
          description={summary.error.message}
          onRetry={() => summary.refetch()}
        />
      </div>
    );
  }

  const s = summary.data;

  return (
    <div className="space-y-section">
      <PageHeader
        title={title}
        description={subtitle}
        actions={
          <>
            <Can permission="loads:assign">
              <Button asChild variant="secondary">
                <Link href="/dispatch">
                  <Route aria-hidden />
                  Dispatch
                </Link>
              </Button>
            </Can>
            <Can permission="loads:create">
              <Button asChild variant="primary">
                <Link href="/rate-cons/new">
                  <Plus aria-hidden />
                  New load
                </Link>
              </Button>
            </Can>
          </>
        }
      />

      {/* Needs You first — before any analytics. */}
      <NeedsYouPreview
        items={s.needsYouPreview}
        openCount={s.counts.needsYouOpen}
        criticalCount={s.counts.needsYouCritical}
      />

      <section
        aria-label="Operational overview"
        className="grid grid-cols-2 gap-stack xl:grid-cols-4"
      >
        {canSeeLoads ? (
          <StatTile
            icon={Package}
            label="Loads in motion"
            value={String(s.counts.activeLoads)}
            hint={
              s.counts.unassignedLoads > 0
                ? `${s.counts.unassignedLoads} waiting for a truck`
                : "All assigned"
            }
            tone={s.counts.unassignedLoads > 0 ? "warning" : "default"}
            href="/loads"
          />
        ) : null}

        {canSeeEquipment ? (
          <StatTile
            icon={Truck}
            label="Trucks needing a load"
            value={String(s.counts.trucksGoingEmpty)}
            hint={`${s.counts.trucksAvailable} empty now · ${s.counts.trucksTotal} total`}
            tone={s.counts.trucksGoingEmpty > 0 ? "warning" : "success"}
            href="/dispatch"
          />
        ) : null}

        <StatTile
          icon={Clock3}
          label="On time, last 7 days"
          value={`${s.onTimePct}%`}
          hint={`+${s.onTimeChangePts} pts vs. prior week`}
        />

        {canSeeRevenue && s.financials ? (
          <StatTile
            icon={CircleDollarSign}
            label="Revenue, week to date"
            value={money(s.financials.weekRevenueCents, { compact: true })}
            hint={`${ratePerMile(s.financials.averageRatePerMileCents)} average · ${money(
              s.financials.unbilledDeliveredCents,
              { compact: true },
            )} unbilled`}
            href="/reports"
          />
        ) : (
          <HiddenFinancialTile permission="revenue:view" />
        )}
      </section>

      {canSeeEquipment || canSeeLoads ? (
        <div className="grid grid-cols-1 gap-stack lg:grid-cols-2">
          {canSeeEquipment ? <SoonEmptyTrucksPanel trucks={s.soonEmptyTrucks} /> : null}
          {canAssign ? <UnassignedLoadsPanel loads={s.unassignedLoads} /> : null}
        </div>
      ) : null}

      {canSeeLoads ? (
        <ActiveLoadsPanel
          loads={s.activeLoads}
          description={
            membership?.scope.loads === "assigned"
              ? "Scoped to loads assigned to you."
              : "Across the whole organization."
          }
        />
      ) : null}

      <div className="grid grid-cols-1 gap-stack lg:grid-cols-2">
        {canSeeLoads ? (
          <ActiveLoadsPanel
            loads={s.upcomingLoads}
            title="Upcoming pickups"
            description="Booked and planned, ordered by pickup time."
          />
        ) : null}
        {canSeeDrivers ? <DriverAttentionPanel drivers={s.driversNeedingAttention} /> : null}
      </div>

      {s.counts.documentsMissing > 0 ? (
        <Can permission="documents:view">
          <Link
            href="/documents"
            className="flex items-center gap-3 rounded-lg border border-st-warning/35 bg-st-warning-bg/45 px-4 py-3 transition-colors hover:bg-st-warning-bg/70"
          >
            <FileWarning aria-hidden className="size-5 shrink-0 text-st-warning" />
            <span className="min-w-0 text-[0.875rem] text-fg">
              <span className="font-medium">
                {s.counts.documentsMissing} load
                {s.counts.documentsMissing > 1 ? "s are" : " is"} missing a required document
              </span>
              <span className="block text-[0.8125rem] text-fg-muted">
                Loads cannot be invoiced until the paperwork is in.
              </span>
            </span>
          </Link>
        </Can>
      ) : null}
    </div>
  );
}
