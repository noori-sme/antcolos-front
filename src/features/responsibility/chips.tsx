"use client";

import {
  AlarmClock, CheckCircle2, CircleSlash, Eye, Gavel, PauseCircle, ShieldCheck,
  TrendingUp, UserCheck, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { describeReading } from "@/lib/responsibility";
import {
  APPROVAL_STATE_LABEL, ASSIGNMENT_SOURCE_LABEL, ESCALATION_ACTION_LABEL,
  ESCALATION_TRIGGER_LABEL, RESPONSIBILITY_ROLE_LABEL, SLA_STATE_LABEL,
  type ApprovalState, type AssignmentSource, type EscalationState,
  type ResponsibilityHolder, type ResponsibilityRole, type SlaReading,
  type SlaState,
} from "@/types";

/**
 * The vocabulary, rendered.
 *
 * Every label here comes from the type module's own maps rather than being
 * written a second time in a component. A screen that spelled "Accountable"
 * itself would be a screen that could disagree with the service about what the
 * word means — and the milestone's instruction that feature components must not
 * hardcode role labels is exactly about that.
 */

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

const ROLE_META: Record<
  ResponsibilityRole,
  { icon: LucideIcon; tone: "info" | "progress" | "warning" | "neutral" }
> = {
  responsible: { icon: UserCheck, tone: "info" },
  accountable: { icon: ShieldCheck, tone: "progress" },
  approver: { icon: Gavel, tone: "warning" },
  watcher: { icon: Eye, tone: "neutral" },
};

export function RoleBadge({ role }: { role: ResponsibilityRole }) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon aria-hidden className="size-3" />
      {RESPONSIBILITY_ROLE_LABEL[role]}
    </Badge>
  );
}

/**
 * One person in one role, with the reason they are there.
 *
 * The name comes off the record. There is no lookup table of people in this
 * folder and no component knows a single individual's name.
 */
export function HolderLine({
  holder, showReason = true,
}: {
  holder: ResponsibilityHolder;
  showReason?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <RoleBadge role={holder.role} />
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-medium text-fg">
          {holder.displayName}
          {holder.title ? (
            <span className="ml-1.5 font-normal text-fg-subtle">{holder.title}</span>
          ) : null}
          {!holder.available ? (
            <span className="ml-1.5 text-[0.75rem] font-normal text-st-warning">
              not available
            </span>
          ) : null}
        </p>
        {showReason ? (
          <p className="mt-0.5 text-[0.75rem] text-fg-muted">{holder.reason}</p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Where the assignment came from                                              */
/* -------------------------------------------------------------------------- */

const SOURCE_TONE: Record<AssignmentSource, "neutral" | "info" | "warning" | "outline"> = {
  default_policy: "neutral",
  delegation: "info",
  manual: "outline",
  fallback: "warning",
  escalation: "warning",
  takeover: "outline",
};

export function SourceBadge({ source }: { source: AssignmentSource }) {
  return <Badge tone={SOURCE_TONE[source]}>{ASSIGNMENT_SOURCE_LABEL[source]}</Badge>;
}

/* -------------------------------------------------------------------------- */
/* SLA                                                                         */
/* -------------------------------------------------------------------------- */

const SLA_META: Record<
  SlaState,
  { icon: LucideIcon; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  met: { icon: CheckCircle2, tone: "success" },
  on_track: { icon: CheckCircle2, tone: "neutral" },
  due_soon: { icon: AlarmClock, tone: "warning" },
  breached: { icon: AlarmClock, tone: "danger" },
  paused: { icon: PauseCircle, tone: "neutral" },
};

export function SlaBadge({ state, label }: { state: SlaState; label?: string }) {
  const meta = SLA_META[state];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon aria-hidden className="size-3" />
      {label ?? SLA_STATE_LABEL[state]}
    </Badge>
  );
}

/** One clock, in the words `describeReading` gives it. */
export function SlaClockLine({ reading }: { reading: SlaReading }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[0.8125rem]">
      <span className="text-fg-muted">
        {reading.clock === "acknowledge" ? "Acknowledge" : "Resolve"}
      </span>
      <SlaBadge state={reading.state} label={describeReading(reading)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Escalation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One live trigger, and — the important half — what it did NOT do.
 *
 * Every escalation line on every screen says whether the work moved. That
 * sentence is the product promise made visible: a manager reading a card should
 * never have to wonder whether somebody has quietly been taken off a job.
 */
export function EscalationLine({ state }: { state: EscalationState }) {
  const last = state.reached[state.reached.length - 1];
  const moved = last?.action === "reassign" || last?.action === "takeover";

  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={state.level > 1 ? "warning" : "neutral"}>
          <TrendingUp aria-hidden className="size-3" />
          {ESCALATION_TRIGGER_LABEL[state.trigger]}
        </Badge>
        {last ? (
          <span className="text-[0.75rem] text-fg-subtle">
            Level {last.level} · {ESCALATION_ACTION_LABEL[last.action]}
          </span>
        ) : (
          <span className="text-[0.75rem] text-fg-subtle">Watching</span>
        )}
      </div>
      <p className="mt-1 text-[0.75rem] text-fg-muted">{state.detail}</p>
      {last ? (
        <p className="mt-1 text-[0.75rem] font-medium text-fg-muted">
          {moved
            ? "The policy moved this work — see the timeline."
            : "Nobody was reassigned. Whoever holds it is still responsible."}
        </p>
      ) : null}
      {state.next ? (
        <p className="mt-1 text-[0.75rem] text-fg-subtle">
          Next: {ESCALATION_ACTION_LABEL[state.next.step.action]} at level{" "}
          {state.next.step.level}.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Approval                                                                    */
/* -------------------------------------------------------------------------- */

const APPROVAL_TONE: Record<ApprovalState, "neutral" | "warning" | "success" | "danger"> = {
  not_required: "neutral",
  requested: "warning",
  approved: "success",
  declined: "danger",
};

export function ApprovalBadge({ state }: { state: ApprovalState }) {
  if (state === "not_required") return null;
  return <Badge tone={APPROVAL_TONE[state]}>{APPROVAL_STATE_LABEL[state]}</Badge>;
}

/** Shown where a queue is deliberately empty rather than missing. */
export function NothingHere({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-[0.8125rem] text-fg-muted">
      <CircleSlash aria-hidden className="size-4 text-fg-subtle" />
      {message}
    </p>
  );
}
