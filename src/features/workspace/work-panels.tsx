"use client";

import { ArrowRight, Package } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { WorkspaceWorkItem } from "@/types";
import { cn } from "@/lib/utils";

/**
 * The three work lists — mine, the team's, and the queue — are one component.
 *
 * They differ only in what they say when they are empty and what you can do to
 * a row, and both of those are arguments. Writing them three times is how the
 * "claim" button ends up on the wrong list.
 */
export function WorkList({
  items,
  emptyTitle,
  emptyDescription,
  action,
  busyLoadId,
  showAssignee = false,
}: {
  items: WorkspaceWorkItem[];
  emptyTitle: string;
  emptyDescription: string;
  /** Rendered per row when the viewer may act on it. */
  action?: (item: WorkspaceWorkItem) => { label: string; onClick: () => void } | null;
  busyLoadId?: string | null;
  showAssignee?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3.5 py-4 text-center">
        <p className="text-[0.8125rem] font-medium text-fg">{emptyTitle}</p>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{emptyDescription}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const act = action?.(item) ?? null;
        return (
          <li
            key={item.loadId}
            className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  <Link
                    href={`/loads/${item.loadId}`}
                    className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {item.reference}
                  </Link>
                  <StatusChip status={item.status} />
                  {showAssignee && item.assigneeName ? (
                    <span className="text-[0.75rem] font-normal text-fg-muted">
                      {item.isMine ? "You" : item.assigneeName}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-subtle">
                  <span className="inline-flex items-center gap-1">
                    {[item.originCity, item.originState].filter(Boolean).join(", ") || "Origin not set"}
                    <ArrowRight className="size-3" aria-hidden />
                    {[item.destinationCity, item.destinationState].filter(Boolean).join(", ") || "Destination not set"}
                  </span>
                  <span>{item.customerName}</span>
                  {item.carrierName ? <span>Runs under {item.carrierName}</span> : null}
                </p>
              </div>
              {act ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyLoadId === item.loadId}
                  onClick={act.onClick}
                >
                  {act.label}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const STATUS_TONE: Record<string, string> = {
  verifying: "bg-st-info-bg text-st-info",
  planned: "bg-st-info-bg text-st-info",
  offered: "bg-st-info-bg text-st-info",
  accepted: "bg-st-info-bg text-st-info",
  assigned: "bg-st-progress-bg text-st-progress",
  dispatched: "bg-st-progress-bg text-st-progress",
  at_pickup: "bg-st-progress-bg text-st-progress",
  loaded: "bg-st-progress-bg text-st-progress",
  in_transit: "bg-st-progress-bg text-st-progress",
  at_delivery: "bg-st-progress-bg text-st-progress",
  delivered: "bg-st-success-bg text-st-success",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        STATUS_TONE[status] ?? "bg-st-neutral-bg text-st-neutral",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** A section of the dashboard. One heading, one count, one body. */
export function WorkspacePanel({
  title,
  count,
  description,
  action,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            {title}
            {count !== undefined ? (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export const WorkIcon = Package;
