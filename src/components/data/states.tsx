import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-[0.9375rem] font-semibold text-fg">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[0.8125rem] text-fg-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "The request did not complete. Try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-st-danger/30 bg-st-danger-bg/50 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-6 text-st-danger" aria-hidden />
      <p className="text-[0.9375rem] font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-[0.8125rem] text-fg-muted">{description}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          <RefreshCw aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32 max-w-[50%]" />
            <Skeleton className="h-3 w-56 max-w-[80%]" />
          </div>
          <Skeleton className="h-3.5 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
