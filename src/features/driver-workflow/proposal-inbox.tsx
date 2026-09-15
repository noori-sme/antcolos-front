"use client";

import { ArrowRight, Clock3, Inbox, MapPin, Pause } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { PageHeader } from "@/components/layout/page-header";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { dateTimeIn, relativeTime, useNow } from "@/lib/utils";
import type { DriverProposalFilters } from "@/lib/api/contracts/driver-workflow";
import type { DriverProposalView } from "@/types";
import { useProposals } from "./hooks";
import { ProposalStatusBadge } from "./labels";

/**
 * The proposal inbox: what dispatch has asked the driver about, before anything
 * is booked. Tuned for a phone in a cab — big targets, one column, the answer
 * deadline and the pause countdown never more than a glance away.
 */

const VIEWS: { id: NonNullable<DriverProposalFilters["view"]>; label: string }[] = [
  { id: "open", label: "Needs an answer" },
  { id: "answered", label: "Answered" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

export function ProposalInbox() {
  const [view, setView] = useState<NonNullable<DriverProposalFilters["view"]>>("open");
  const proposals = useProposals({ view });

  return (
    <div className="space-y-stack">
      <PageHeader
        title="Load proposals"
        description="Freight dispatch is weighing up for you. Nothing here is booked, and approving one is not the same as agreeing to run it."
      />

      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Chip
            key={v.id}
            label={v.label}
            selected={view === v.id}
            onToggle={() => setView(v.id)}
          />
        ))}
      </div>

      {proposals.isPending ? <LoadingSkeleton rows={3} /> : null}

      {proposals.isError ? (
        <ErrorState
          description={proposals.error.message}
          onRetry={() => proposals.refetch()}
        />
      ) : null}

      {proposals.data?.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={view === "open" ? "Nothing waiting on you" : "Nothing here"}
          description={
            view === "open"
              ? "When dispatch wants your read on a load before it is booked, it shows up here."
              : "Try another filter."
          }
        />
      ) : null}

      <ul className="space-y-3">
        {proposals.data?.map((proposal) => (
          <li key={proposal.id}>
            <ProposalRow proposal={proposal} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposalRow({ proposal }: { proposal: DriverProposalView }) {
  const now = useNow();
  const pickup = proposal.stops.find((s) => s.kind === "pickup") ?? proposal.stops[0];
  const delivery =
    [...proposal.stops].reverse().find((s) => s.kind === "delivery") ??
    proposal.stops[proposal.stops.length - 1];

  const openCounters = proposal.counteroffers.filter((c) => c.status === "submitted").length;

  return (
    <Card
      className={
        proposal.status === "awaiting_driver_response"
          ? "border-primary/40 transition-colors"
          : proposal.status === "unavailable"
            ? "opacity-80 transition-colors"
            : "transition-colors"
      }
    >
      <Link
        href={`/driver/proposals/${proposal.id}`}
        className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                {proposal.customerKind === "broker" ? "Broker" : "Shipper"}
              </p>
              <p className="mt-0.5 truncate text-[1rem] font-semibold text-fg">
                {proposal.customerName}
              </p>
            </div>
            <ProposalStatusBadge status={proposal.status} />
          </div>

          <p className="flex items-center gap-1.5 text-[0.9375rem] text-fg">
            <MapPin aria-hidden className="size-4 shrink-0 text-fg-subtle" />
            {pickup.address.city}, {pickup.address.state}
            <ArrowRight aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            {delivery.address.city}, {delivery.address.state}
          </p>

          <p className="text-[0.8125rem] text-fg-muted">
            Picks up {dateTimeIn(pickup.appointmentAt, pickup.timeZone)} ·{" "}
            {EQUIPMENT_LABEL[proposal.equipmentType] ?? proposal.equipmentType}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {proposal.activePause && now !== null ? (
              <Badge tone="info">
                <Pause aria-hidden className="size-3" />
                Paused, back to you {relativeTime(proposal.activePause.expiresAt, now)}
              </Badge>
            ) : null}

            {proposal.status === "awaiting_driver_response" &&
            proposal.respondByAt &&
            now !== null ? (
              <Badge tone="warning">
                <Clock3 aria-hidden className="size-3" />
                Answer {relativeTime(proposal.respondByAt, now)}
              </Badge>
            ) : null}

            {openCounters > 0 ? (
              <Badge tone="outline">
                {openCounters} open counteroffer{openCounters === 1 ? "" : "s"}
              </Badge>
            ) : null}

            {proposal.comments.length > 0 ? (
              <Badge tone="outline">
                {proposal.comments.length} comment{proposal.comments.length === 1 ? "" : "s"}
              </Badge>
            ) : null}

            {proposal.approval ? (
              <Badge tone={proposal.approval.bookingConsent === "granted" ? "success" : "outline"}>
                {proposal.approval.bookingConsent === "granted"
                  ? "Booking consent given"
                  : "Not booking consent"}
              </Badge>
            ) : null}
          </div>

          {proposal.unavailability ? (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-[0.8125rem] text-fg-muted">
              {proposal.unavailability.reason} Everything you said about it is kept.
            </p>
          ) : null}
        </CardContent>
      </Link>
    </Card>
  );
}
