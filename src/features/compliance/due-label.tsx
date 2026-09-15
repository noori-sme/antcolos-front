"use client";

import { CalendarClock } from "lucide-react";
import type { ComplianceStatus } from "@/types";
import { cn, isOverdue, relativeTime, useNow } from "@/lib/utils";

/**
 * When this bites.
 *
 * "No renewal date" is a real answer for a one-time requirement, and for the
 * event-driven cycles whose events Antcolos does not track yet. Both say so
 * rather than showing a blank.
 */
export function DueLabel({
  dueAt, status, className,
}: {
  dueAt?: string;
  status: ComplianceStatus;
  className?: string;
}) {
  const now = useNow();

  if (!dueAt) {
    return (
      <span className={cn("text-[0.75rem] text-fg-subtle", className)}>
        {status === "compliant" ? "No renewal date" : "No deadline set"}
      </span>
    );
  }
  if (now === null) {
    return <span className={cn("text-[0.75rem] text-fg-subtle", className)}>&nbsp;</span>;
  }

  const overdue = isOverdue(dueAt, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.75rem] font-medium",
        overdue ? "text-st-danger" : status === "expiring" ? "text-st-warning" : "text-fg-muted",
        className,
      )}
    >
      <CalendarClock aria-hidden className="size-3" />
      {overdue ? `Lapsed ${relativeTime(dueAt, now)}` : `Due ${relativeTime(dueAt, now)}`}
    </span>
  );
}
