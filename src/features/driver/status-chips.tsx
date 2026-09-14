import type { DocumentStatus, RelationshipStatus } from "@/types";
import { DOCUMENT_STATUS_LABEL, RELATIONSHIP_LABEL } from "./driver-rules";
import { cn } from "@/lib/utils";

const DOCUMENT_TONE: Record<DocumentStatus, string> = {
  missing: "bg-st-neutral-bg text-st-neutral",
  selected_local: "bg-st-info-bg text-st-info",
  pending_review: "bg-st-progress-bg text-st-progress",
  approved: "bg-st-success-bg text-st-success",
  rejected: "bg-st-danger-bg text-st-danger",
  expired: "bg-st-danger-bg text-st-danger",
  expiring_soon: "bg-st-warning-bg text-st-warning",
  superseded: "bg-st-neutral-bg text-st-neutral",
};

export function DocumentStatusChip({ status, className }: { status: DocumentStatus; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        DOCUMENT_TONE[status],
        className,
      )}
    >
      {DOCUMENT_STATUS_LABEL[status]}
    </span>
  );
}

const RELATIONSHIP_TONE: Record<RelationshipStatus, string> = {
  invited: "bg-st-info-bg text-st-info",
  onboarding: "bg-st-progress-bg text-st-progress",
  active: "bg-st-success-bg text-st-success",
  suspended: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
};

export function RelationshipStatusChip({
  status,
  className,
}: {
  status: RelationshipStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
        RELATIONSHIP_TONE[status],
        className,
      )}
    >
      {RELATIONSHIP_LABEL[status]}
    </span>
  );
}

/** A quiet label for CDL / medical expiry that turns loud as the date nears. */
export function ExpiryChip({
  state,
  children,
}: {
  state: "ok" | "expiring_soon" | "expired" | null;
  children: React.ReactNode;
}) {
  if (state === null) return <span className="text-fg-subtle">Not added yet</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.75rem] font-medium tabular-nums",
        state === "ok" && "text-fg",
        state === "expiring_soon" && "bg-st-warning-bg text-st-warning",
        state === "expired" && "bg-st-danger-bg text-st-danger",
      )}
    >
      {children}
    </span>
  );
}
