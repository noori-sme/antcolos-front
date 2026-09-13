"use client";

import {
  ArrowRight, Clock3, MapPin, Package, Upload,
} from "lucide-react";
import Link from "next/link";
import { LoadStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DueLabel } from "@/features/needs-you/due-label";
import { SeverityBar } from "@/features/needs-you/severity";
import { useActiveMembership, useSession } from "@/lib/session/hooks";
import { dateTimeIn, relativeTime, useNow } from "@/lib/utils";
import { destinationStop, originStop } from "@/types";
import { CATEGORY_LABEL } from "@/types";
import { useHomeSummary } from "./hooks";

/**
 * Driver home: the current or next load first, one clear next action, and the
 * items that need the driver. High-contrast utility sizing — bigger targets and
 * simpler layout than the desktop shell, from the same tokens.
 *
 * Milestone 2 scope: this is the read + triage surface. Status transitions and
 * document upload land with the driver portal milestone.
 */
export function DriverHomeScreen() {
  const { user } = useSession();
  const { organization } = useActiveMembership();
  const summary = useHomeSummary();
  const now = useNow();

  const tz = organization?.timeZone ?? "UTC";
  const firstName = user.displayName.split(" ")[0];

  if (summary.isPending) return <LoadingSkeleton rows={4} />;
  if (summary.isError) {
    return <ErrorState description={summary.error.message} onRetry={() => summary.refetch()} />;
  }

  const s = summary.data;
  const current = s.activeLoads[0];
  const next = s.upcomingLoads[0];

  return (
    <div className="space-y-stack">
      <header>
        <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
          Hi {firstName}
        </h1>
        <p className="mt-0.5 text-[0.875rem] text-fg-muted">
          {organization?.displayName}
        </p>
      </header>

      {current ? (
        <Card className="border-primary/40">
          <CardHeader>
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold tracking-wider text-primary uppercase">
                Current load
              </p>
              <CardTitle className="mt-1 font-mono text-[1.125rem]">
                {current.reference}
              </CardTitle>
            </div>
            <LoadStatusBadge status={current.status} />
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3">
              {[originStop(current), destinationStop(current)].map((stop, i) => (
                <li key={stop.id} className="flex gap-3">
                  <span className="flex flex-col items-center">
                    <span
                      aria-hidden
                      className={`mt-1 size-2.5 rounded-full ${i === 0 ? "bg-fg-subtle" : "bg-primary"}`}
                    />
                    {i === 0 ? (
                      <span aria-hidden className="my-1 w-px flex-1 bg-border" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 pb-1">
                    <span className="block text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                      {stop.kind === "pickup" ? "Pick up" : "Deliver"}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[1rem] font-semibold text-fg">
                      <MapPin aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                      {stop.address.city}, {stop.address.state}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] text-fg-muted">
                      <Clock3 aria-hidden className="size-3.5 shrink-0" />
                      {dateTimeIn(stop.appointmentAt, tz)}
                      {now !== null ? (
                        <span className="text-fg-subtle">
                          · {relativeTime(stop.appointmentAt, now)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg" variant="primary" className="w-full sm:w-auto">
                <Link href="/driver/loads">
                  Open this load
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                <Link href="/driver/documents">
                  <Upload aria-hidden />
                  Upload a document
                </Link>
              </Button>
            </div>
            <p className="text-[0.75rem] text-fg-subtle">
              Status updates and photo upload arrive with the driver portal
              milestone. Telegram stays your primary workflow.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Package aria-hidden className="size-6 text-fg-subtle" />
            <p className="text-[0.9375rem] font-semibold text-fg">No load in progress</p>
            <p className="max-w-xs text-[0.8125rem] text-fg-muted">
              Dispatch will send your next assignment here and to Telegram.
            </p>
          </CardContent>
        </Card>
      )}

      {next ? (
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                Next up
              </p>
              <CardTitle className="mt-1 font-mono text-[0.9375rem]">
                {next.reference}
              </CardTitle>
            </div>
            {next.assignment?.consent.status === "pending" ? (
              <Badge tone="warning">Needs your answer</Badge>
            ) : (
              <LoadStatusBadge status={next.status} />
            )}
          </CardHeader>
          <CardContent>
            <p className="text-[0.875rem] text-fg">
              {originStop(next).address.city}, {originStop(next).address.state} →{" "}
              {destinationStop(next).address.city}, {destinationStop(next).address.state}
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              Picks up {dateTimeIn(originStop(next).appointmentAt, tz)}
              {now !== null ? ` · ${relativeTime(originStop(next).appointmentAt, now)}` : ""}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Needs you</CardTitle>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {s.counts.needsYouOpen === 0
                ? "Nothing outstanding."
                : `${s.counts.needsYouOpen} open on your loads.`}
            </p>
          </div>
          {s.counts.needsYouOpen > 0 ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/needs-you">
                All
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {s.needsYouPreview.length === 0 ? (
            <p className="border-t border-border px-5 py-8 text-[0.875rem] text-fg-muted">
              You are all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {s.needsYouPreview.map((item) => (
                <li key={item.id}>
                  <Link
                    href="/needs-you"
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors active:bg-surface-hover"
                  >
                    <SeverityBar severity={item.severity} className="min-h-10 self-stretch" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                        {CATEGORY_LABEL[item.category]}
                      </span>
                      <span className="mt-0.5 block text-[0.9375rem] leading-5 font-medium text-fg">
                        {item.title}
                      </span>
                      <span className="mt-1 block">
                        <DueLabel dueAt={item.dueAt} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
