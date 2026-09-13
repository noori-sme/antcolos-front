"use client";

import { Clock3 } from "lucide-react";
import { isOverdue, relativeTime, useNow } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Deadlines tick. "Now" comes from a hydration-safe store, so the server and
 * client never disagree about the current time.
 */
export function DueLabel({
  dueAt, className,
}: {
  dueAt?: string;
  className?: string;
}) {
  const now = useNow();

  if (!dueAt) {
    return <span className={cn("text-[0.75rem] text-fg-subtle", className)}>No deadline</span>;
  }
  if (now === null) {
    return <span className={cn("text-[0.75rem] text-fg-subtle", className)}>&nbsp;</span>;
  }

  const overdue = isOverdue(dueAt, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.75rem] font-medium",
        overdue ? "text-st-danger" : "text-fg-muted",
        className,
      )}
    >
      <Clock3 aria-hidden className="size-3" />
      {overdue ? `Overdue ${relativeTime(dueAt, now)}` : `Due ${relativeTime(dueAt, now)}`}
    </span>
  );
}
