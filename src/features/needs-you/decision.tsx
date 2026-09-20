"use client";

import {
  Check, CheckCircle2, ChevronRight, CircleSlash, ExternalLink, Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  automationProgress, type NeedsYouAutomation, type NeedsYouDecisionOption,
  type NeedsYouMetric, type NeedsYouMetricTone,
} from "@/types";

/**
 * The decision half of a Needs You row.
 *
 * ★ ONE PRESS ★
 * Everything here exists to make the press possible without reading a
 * paragraph: what the system already did, compressed to a meter and a trail of
 * five-word chips; what it worked out, as columns of numbers; and the buttons
 * that resume it. Long context is reachable on hover and nowhere else — a row
 * that explains itself in prose is a row somebody has to read before they can
 * work.
 */

/* -------------------------------------------------------------------------- */
/* What the system already did                                                 */
/* -------------------------------------------------------------------------- */

/** How many pre-work chips are shown before the rest collapse to "+N". */
const TRAIL_LIMIT = 3;

export function AutomationMeter({
  automation, className,
}: {
  automation: NeedsYouAutomation;
  className?: string;
}) {
  const pct = automationProgress(automation);
  const done = automation.stage === "done";

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden
        className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-st-neutral-bg sm:w-24"
      >
        <span
          className={cn(
            "block h-full rounded-full",
            done ? "bg-st-success" : "bg-st-progress",
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tnum shrink-0 text-[0.6875rem] font-medium text-fg-muted">
        {done
          ? `${automation.stepsDone} steps run`
          : `${automation.stepsDone}/${automation.stepsTotal} automated`}
      </span>
    </div>
  );
}

/**
 * The pre-work, as chips.
 *
 * Each chip is the five-word label; the sentence behind it is on hover. The
 * ones past the limit are counted rather than listed, because the point of the
 * trail is "a lot has already happened", not a reading task.
 */
export function PreworkTrail({ automation }: { automation: NeedsYouAutomation }) {
  const steps = automation.prework;
  if (steps.length === 0) return null;

  const shown = steps.slice(-TRAIL_LIMIT);
  const hidden = steps.length - shown.length;

  return (
    // Desktop only. A phone gets the meter, which carries the same claim in a
    // sixth of the height; the whole trail is one press away in the drawer.
    <ul className="hidden min-w-0 flex-wrap items-center gap-1 sm:flex">
      {hidden > 0 ? (
        <li className="tnum text-[0.6875rem] text-fg-subtle">+{hidden}</li>
      ) : null}
      {shown.map((step) => (
        <li key={step.id}>
          {step.detail ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help items-center gap-1 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
                  <Check aria-hidden className="size-2.5 text-st-success" />
                  {step.label}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[22rem]">{step.detail}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
              <Check aria-hidden className="size-2.5 text-st-success" />
              {step.label}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* The options                                                                 */
/* -------------------------------------------------------------------------- */

const METRIC_TONE: Record<NeedsYouMetricTone, string> = {
  good: "text-st-success",
  warn: "text-st-warning",
  bad: "text-st-danger",
  neutral: "text-fg",
};

function MetricValue({ metric }: { metric: NeedsYouMetric }) {
  const value = (
    <span
      className={cn(
        "tnum text-[0.8125rem] font-semibold",
        METRIC_TONE[metric.tone ?? "neutral"],
        metric.detail && "cursor-help decoration-dotted underline-offset-2",
      )}
    >
      {metric.value}
    </span>
  );
  if (!metric.detail) return value;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{value}</TooltipTrigger>
      <TooltipContent className="max-w-[22rem]">{metric.detail}</TooltipContent>
    </Tooltip>
  );
}

/** The "what happens next" list, on hover. Never inline: it is the system's job. */
function Downstream({
  option, children,
}: {
  option: NeedsYouDecisionOption;
  children: React.ReactNode;
}) {
  if (option.downstream.length === 0) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-[24rem]">
        <span className="mb-1 block text-[0.6875rem] tracking-wider uppercase opacity-70">
          Then, on its own
        </span>
        <ol className="space-y-0.5">
          {option.downstream.map((step, i) => (
            <li key={step} className="flex gap-1.5">
              <span className="tnum opacity-60">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Options that carry numbers, side by side.
 *
 * Used when the system has priced alternatives — three renewal quotes, say.
 * Each column is the whole comparison for one option plus the button that takes
 * it, so a person compares and commits in one place.
 */
function OptionGrid({
  options, onDecide, pending, disabled,
}: {
  options: NeedsYouDecisionOption[];
  onDecide: (optionId: string) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    // Container queries, not viewport ones: the same grid renders three across
    // on a wide page and one across in a narrow drawer, and only the container
    // it is actually in knows which.
    <div className="@container/options">
      <div className="grid gap-1.5 @md/options:grid-cols-2 @3xl/options:grid-cols-3">
      {options.map((option) => (
        <div
          key={option.id}
          data-option={option.id}
          className={cn(
            "flex flex-col gap-2 rounded-md border p-2.5",
            option.recommended
              ? "border-primary/40 bg-primary/[0.04]"
              : "border-border bg-surface-sunken/60",
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-fg">
              {option.name ?? option.label}
            </span>
            {option.recommended ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-primary/12 px-1.5 text-[0.625rem] font-semibold tracking-wide text-primary uppercase">
                    <Sparkles aria-hidden className="size-2.5" />
                    Pick
                  </span>
                </TooltipTrigger>
                <TooltipContent>The system&rsquo;s own ranking. Yours to override.</TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
            {option.metrics.map((metric) => (
              <div key={metric.label} className="col-span-2 flex items-baseline justify-between gap-2">
                <dt className="text-[0.6875rem] text-fg-subtle">{metric.label}</dt>
                <dd>
                  <MetricValue metric={metric} />
                </dd>
              </div>
            ))}
          </dl>

          <Downstream option={option}>
            <Button
              size="sm"
              variant={option.recommended ? "primary" : "secondary"}
              disabled={pending || disabled}
              onClick={() => onDecide(option.id)}
              className="w-full"
            >
              {option.label}
            </Button>
          </Downstream>
        </div>
      ))}
      </div>
    </div>
  );
}

/**
 * The buttons that finish the item.
 *
 * Three shapes, decided by what the system worked out rather than by the caller:
 *   • a handoff — one link, straight to where the record is fixed;
 *   • priced alternatives — a column each, compared and committed in place;
 *   • the ordinary case — one primary press, and a way to say no.
 */
export function DecisionActions({
  automation, onDecide, pending, disabled, disabledReason,
}: {
  automation: NeedsYouAutomation;
  onDecide: (optionId: string) => void;
  pending?: boolean;
  /** No permission to act. The buttons stay visible and say why. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const options = automation.options;
  if (options.length === 0) return null;

  const priced = options.filter((o) => o.metrics.length > 0);
  const rest = options.filter((o) => o.metrics.length === 0);

  const note = disabled && disabledReason ? (
    <p className="text-[0.6875rem] text-fg-subtle">{disabledReason}</p>
  ) : null;

  /* A handoff: the item is a view of another module's state. */
  if (options.length === 1 && options[0].intent === "open") {
    const option = options[0];
    return (
      <div data-decision="handoff" className="flex flex-wrap items-center gap-2">
        {option.href ? (
          <Button size="sm" variant="primary" asChild>
            <Link href={option.href}>
              {option.label}
              <ExternalLink aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled>
            {option.label}
          </Button>
        )}
        <span className="text-[0.6875rem] text-fg-subtle">Clears itself</span>
      </div>
    );
  }

  if (priced.length > 1) {
    return (
      <div data-decision="priced" className="space-y-1.5">
        <OptionGrid
          options={priced}
          onDecide={onDecide}
          pending={pending}
          disabled={disabled}
        />
        {rest.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {rest.map((option) => (
              <Downstream key={option.id} option={option}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || disabled}
                  onClick={() => onDecide(option.id)}
                >
                  <CircleSlash aria-hidden />
                  {option.label}
                </Button>
              </Downstream>
            ))}
            {note}
          </div>
        ) : (
          note
        )}
      </div>
    );
  }

  return (
    <div data-decision="pair" className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => (
        <Downstream key={option.id} option={option}>
          <Button
            size="sm"
            variant={option.intent === "approve" ? "primary" : "ghost"}
            disabled={pending || disabled}
            onClick={() => onDecide(option.id)}
          >
            {option.intent === "approve" ? <CheckCircle2 aria-hidden /> : null}
            {option.label}
          </Button>
        </Downstream>
      ))}
      {note}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* After the press                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the system did once somebody decided.
 *
 * Shown in place of the buttons, so the row proves the automation resumed
 * rather than only that the item went away.
 */
export function DecisionOutcome({
  automation, onOpen,
}: {
  automation: NeedsYouAutomation;
  onOpen?: () => void;
}) {
  const decision = automation.decision;
  if (!decision) return null;

  return (
    <div data-decision="done" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-st-success-bg/50 px-2.5 py-1.5">
      <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-st-success" />
      <span className="text-[0.75rem] font-medium text-fg">{decision.optionLabel}</span>
      <span className="tnum text-[0.6875rem] text-fg-muted">
        {decision.steps.length} step{decision.steps.length === 1 ? "" : "s"} run
      </span>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          What ran
          <ChevronRight aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

/** The executed steps, in order. For the drawer, where there is room. */
export function ExecutionTrail({ automation }: { automation: NeedsYouAutomation }) {
  const decision = automation.decision;
  if (!decision) return null;

  return (
    <ol className="space-y-1.5">
      {decision.steps.map((step) => (
        <li key={step.label} className="flex items-start gap-2">
          <CheckCircle2
            aria-hidden
            className={cn(
              "mt-0.5 size-3.5 shrink-0",
              step.state === "done" ? "text-st-success" : "text-fg-subtle",
            )}
          />
          <span className="text-[0.8125rem] text-fg">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
