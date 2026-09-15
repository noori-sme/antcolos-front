"use client";

import { ArrowUpRight } from "lucide-react";
import type { EldPublishedSignal } from "@/types";
import { SIGNAL_TARGET_LABEL } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/data/states";
import { QualityChip } from "./chips";

/**
 * What this layer has QUEUED for the modules that consume it.
 *
 * The wording on this panel is load-bearing. Nothing has been sent. Fleet, the
 * Trip Workflow, MT Loop, HOS, Maintenance, Fuel/IFTA and Safety & Compliance
 * all own their own records, and this module cannot write to any of them — it
 * produces typed, addressed, idempotent records and stops. Saying "sent" here
 * would be the single most misleading word available.
 *
 * The grouping is by destination rather than by time because the question this
 * panel answers is "what will each module get", not "what happened recently" —
 * the event table above already answers that one.
 */
export function SignalsPanel({ signals }: { signals: readonly EldPublishedSignal[] }) {
  const byTarget = new Map<EldPublishedSignal["target"], EldPublishedSignal[]>();
  for (const signal of signals) {
    const list = byTarget.get(signal.target) ?? [];
    list.push(signal);
    byTarget.set(signal.target, list);
  }

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Queued for other modules</CardTitle>
        <CardDescription>
          Typed handoffs this layer has produced. Nothing has been transmitted and nothing
          has been written to another module&apos;s records — Fleet, the Trip Workflow, MT Loop,
          HOS, Maintenance, Fuel/IFTA and Compliance each own theirs, and each decides what
          to do with a signal when the integration is merged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <EmptyState
            title="Nothing queued"
            description="Signals are published from accepted events. Flagged and rejected rows never reach another module."
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {[...byTarget.entries()].map(([target, list]) => (
              <li key={target} className="rounded-md border border-border bg-surface-sunken/40 p-3">
                <p className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg">
                    <ArrowUpRight className="size-3.5 text-fg-subtle" aria-hidden />
                    {SIGNAL_TARGET_LABEL[target]}
                  </span>
                  <span className="tnum shrink-0 rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
                    {list.length} pending
                  </span>
                </p>
                <ul className="mt-2 space-y-1">
                  {[...new Set(list.map((s) => s.operation))].map((operation) => {
                    const first = list.find((s) => s.operation === operation)!;
                    return (
                      <li key={operation} className="flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-surface px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
                          {operation}
                        </code>
                        <QualityChip quality={first.quality} />
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-subtle">
                  {list[0].stateReason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
