"use client";

import { ArrowRight, Handshake, Truck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { milestoneMeta } from "@/lib/driver-workflow/catalog";
import { relativeTime, useNow } from "@/lib/utils";
import { useProposals, useTrips } from "./hooks";

/**
 * The two things a driver landing on their home screen must not miss: a
 * proposal waiting on their answer, and the trip they are in the middle of.
 *
 * Both render nothing at all when there is nothing to say, so a driver with a
 * quiet day does not get two empty cards between them and their load.
 */

export function ProposalsWaitingCard() {
  const proposals = useProposals({ view: "open" });
  const now = useNow();
  const waiting = proposals.data ?? [];

  if (waiting.length === 0) return null;

  const next = waiting[0];

  return (
    <Card className="border-st-warning/40">
      <CardHeader>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider text-st-warning uppercase">
            <Handshake aria-hidden className="size-3.5" />
            {waiting.length === 1
              ? "A proposal needs your answer"
              : `${waiting.length} proposals need your answer`}
          </p>
          <CardTitle className="mt-1">{next.customerName}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.875rem] text-fg">
          {next.stops[0].address.city}, {next.stops[0].address.state} →{" "}
          {next.stops[next.stops.length - 1].address.city},{" "}
          {next.stops[next.stops.length - 1].address.state}
        </p>
        {next.respondByAt && now !== null ? (
          <Badge tone="warning">Answer {relativeTime(next.respondByAt, now)}</Badge>
        ) : null}
        <p className="text-[0.75rem] text-fg-subtle">
          Nothing is booked. Approving keeps dispatch negotiating — it is not consent to be
          booked.
        </p>
        <Button asChild size="lg" variant="primary" className="w-full sm:w-auto">
          <Link href="/driver/proposals">
            Open proposals
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ActiveTripCard() {
  const trips = useTrips();
  const active = (trips.data ?? []).find((t) => t.status === "active");

  if (!active) return null;

  const current = active.currentMilestone ? milestoneMeta(active.currentMilestone) : undefined;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wider text-primary uppercase">
            <Truck aria-hidden className="size-3.5" />
            Your trip
          </p>
          <CardTitle className="mt-1 font-mono text-[1.125rem]">
            {active.loadReference}
          </CardTitle>
        </div>
        <Badge tone={current ? "progress" : "neutral"}>
          {current ? current.label : "Not started"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.875rem] text-fg">
          {active.originLabel} → {active.destinationLabel}
        </p>
        <Button asChild size="lg" variant="primary" className="w-full sm:w-auto">
          <Link href={`/driver/loads/${active.loadId}`}>
            {current ? "Continue the trip" : "Start rolling"}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
