"use client";

import { Inbox, Truck } from "lucide-react";
import { SeverityBar } from "@/features/needs-you/severity";
import { cn } from "@/lib/utils";
import {
  RESPONSIBILITY_FUNCTION_LABEL, type ResponsibilityAssignment,
} from "@/types";
import { ApprovalBadge, SlaBadge, SourceBadge } from "./chips";

/**
 * One piece of work, as a row.
 *
 * Four things, in the order somebody scanning a queue at six in the morning
 * actually asks: what is it, who has it, how is it doing, and is anything
 * unusual about how it got there. The `source` badge is the fourth and it earns
 * its place — "Owner fallback" on a row is the visible form of "nobody else can
 * do this", which is a different problem from the row being late.
 *
 * No name is written here. Everything the row says about a person comes off the
 * record the service returned.
 */
export function WorkRow({
  assignment, selected, viewerMembershipId, onOpen,
}: {
  assignment: ResponsibilityAssignment;
  selected: boolean;
  viewerMembershipId: string;
  onOpen: () => void;
}) {
  const mine = assignment.responsible.membershipId === viewerMembershipId;
  const Icon = assignment.work.kind === "mt_loop" ? Truck : Inbox;
  const escalated = assignment.escalations.filter((e) => e.level > 1);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-stretch gap-3 rounded-lg border bg-surface p-3 text-left transition-colors",
        selected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border hover:border-border-strong hover:bg-surface-hover",
      )}
    >
      <SeverityBar severity={assignment.severity} />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start gap-2">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
          <p className="min-w-0 flex-1 text-[0.875rem] font-medium text-fg">
            {assignment.work.label}
          </p>
        </div>

        <p className="text-[0.75rem] text-fg-muted">
          {RESPONSIBILITY_FUNCTION_LABEL[assignment.functionKey]}
          {" · "}
          {mine ? (
            <span className="font-medium text-fg">Yours</span>
          ) : (
            <>With {assignment.responsible.displayName}</>
          )}
          {assignment.accountable.membershipId !== assignment.responsible.membershipId ? (
            <> · {assignment.accountable.displayName} answers for it</>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          <SlaBadge state={assignment.sla.worst} />
          <SourceBadge source={assignment.responsible.source} />
          <ApprovalBadge state={assignment.approvalState ?? "not_required"} />
          {escalated.length > 0 ? (
            <span className="text-[0.75rem] text-st-warning">
              Escalated — still with {assignment.responsible.displayName}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
