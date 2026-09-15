"use client";

import { ArrowDownRight, ArrowUpRight, Lock, Minus, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMetric } from "@/lib/reports/format";
import { metricDefinition } from "@/lib/reports/metrics";
import { cn } from "@/lib/utils";
import type { DrilldownRef, MetricValue } from "@/types";

/**
 * The headline numbers.
 *
 * Three things every tile does: it says what the number means, it says whether
 * the change is good news or bad news rather than just up or down, and it opens
 * the records the number came from.
 */
export function MetricTile({
  metric,
  onDrilldown,
}: {
  metric: MetricValue;
  onDrilldown?: (ref: DrilldownRef) => void;
}) {
  const definition = metricDefinition(metric.key);
  const label = definition?.label ?? metric.key;
  const betterWhen = definition?.betterWhen ?? "neutral";

  if (metric.value == null) {
    const denied = metric.unavailable?.reason === "permission";
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg-muted">
            {denied ? <Lock aria-hidden className="size-3.5" /> : null}
            {label}
          </span>
          <span className="mt-1.5 block text-[1.25rem] leading-8 font-semibold text-fg-subtle">
            —
          </span>
          <span className="mt-0.5 block text-[0.75rem] leading-4 text-fg-subtle">
            {metric.unavailable?.detail}
          </span>
        </CardContent>
      </Card>
    );
  }

  const change = metric.changePct;
  const direction = change == null || Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down";
  const good =
    betterWhen === "neutral" || direction === "flat"
      ? "neutral"
      : (direction === "up") === (betterWhen === "higher")
        ? "good"
        : "bad";

  const TrendIcon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <Card className={cn(onDrilldown && metric.drilldown && "transition-colors hover:border-border-strong")}>
      <CardContent className="pt-4">
        <span className="text-[0.8125rem] font-medium text-fg-muted">{label}</span>
        <span className="tnum mt-1.5 block text-[1.5rem] leading-8 font-semibold tracking-[-0.02em] text-fg sm:text-[1.75rem] sm:leading-9">
          {formatMetric(metric.value, metric.unit)}
        </span>
        <span className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem]">
          {change != null && direction !== "flat" ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5",
                good === "good" && "text-st-success",
                good === "bad" && "text-st-danger",
                good === "neutral" && "text-fg-subtle",
              )}
            >
              <TrendIcon aria-hidden className="size-3" />
              {Math.abs(change * 100).toFixed(Math.abs(change) >= 0.1 ? 0 : 1)}%
              <span className="text-fg-subtle">
                {" "}vs {formatMetric(metric.previousValue ?? null, metric.unit)}
              </span>
            </span>
          ) : change != null ? (
            <span className="inline-flex items-center gap-0.5 text-fg-subtle">
              <TrendIcon aria-hidden className="size-3" />
              Level with the previous period
            </span>
          ) : (
            <span className="text-fg-subtle">No comparable previous period</span>
          )}
          {metric.drilldown && onDrilldown ? (
            <button
              type="button"
              onClick={() => onDrilldown(metric.drilldown!)}
              className="inline-flex items-center gap-1 rounded-xs text-primary hover:underline"
            >
              <Search aria-hidden className="size-3" />
              {metric.drilldown.label}
            </button>
          ) : null}
        </span>
      </CardContent>
    </Card>
  );
}

export function MetricTiles({
  metrics,
  onDrilldown,
}: {
  metrics: MetricValue[];
  onDrilldown?: (ref: DrilldownRef) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricTile key={metric.key} metric={metric} onDrilldown={onDrilldown} />
      ))}
    </div>
  );
}
