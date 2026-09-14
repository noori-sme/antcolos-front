"use client";

import { Check, CircleDashed, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MILESTONES, PHASE_LABEL, milestoneMeta } from "@/lib/driver-workflow/catalog";
import type { MilestonePhase } from "@/lib/driver-workflow/catalog";
import { dateTimeIn } from "@/lib/utils";
import type { DriverWorkflowView, MilestoneKind, MilestoneProgress } from "@/types";
import { CONFIRMATION_LABEL, MILESTONE_ICON } from "./labels";

/**
 * The trip's spine.
 *
 * Every milestone is tappable at any time, in any order, whatever came before
 * it — the order here is how the trip normally runs, not a set of gates. A step
 * that was passed over is marked and offered again; it is never a wall.
 */
export function MilestoneRail({
  view, onRecord, onConfirmInference, onRejectInference, pending,
}: {
  view: DriverWorkflowView;
  onRecord: (milestone: MilestoneKind) => void;
  onConfirmInference: (eventId: string, milestone: MilestoneKind) => void;
  onRejectInference: (eventId: string, milestone: MilestoneKind) => void;
  pending?: boolean;
}) {
  const closed = view.workflow.status !== "active";
  const byKind = new Map(view.milestones.map((m) => [m.kind, m]));
  const tz = view.post.stops[0]?.timeZone ?? "UTC";

  const phases = [...new Set(MILESTONES.map((m) => m.phase))];

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>The trip</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {closed
              ? "This trip is closed. Everything below is kept as it was recorded."
              : "Tap whatever just happened. Out of order is fine — nothing here blocks anything else."}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {phases.map((phase) => (
          <section key={phase}>
            <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              {PHASE_LABEL[phase as MilestonePhase]}
            </h3>
            <ul className="mt-2 space-y-2">
              {MILESTONES.filter((m) => m.phase === phase).map((meta) => {
                const progress = byKind.get(meta.kind)!;
                return (
                  <li key={meta.kind}>
                    <MilestoneRow
                      progress={progress}
                      timeZone={tz}
                      closed={closed}
                      pending={pending}
                      onRecord={() => onRecord(meta.kind)}
                      onConfirm={(eventId) => onConfirmInference(eventId, meta.kind)}
                      onReject={(eventId) => onRejectInference(eventId, meta.kind)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function MilestoneRow({
  progress, timeZone, closed, pending, onRecord, onConfirm, onReject,
}: {
  progress: MilestoneProgress;
  timeZone: string;
  closed: boolean;
  pending?: boolean;
  onRecord: () => void;
  onConfirm: (eventId: string) => void;
  onReject: (eventId: string) => void;
}) {
  const meta = milestoneMeta(progress.kind);
  const Icon = MILESTONE_ICON[progress.kind];
  const recorded = progress.state === "recorded";
  const inferred = progress.state === "inferred";
  const skipped = progress.state === "skipped";

  return (
    <div
      className={
        "rounded-lg border px-3.5 py-3 transition-colors " +
        (recorded
          ? "border-st-success/30 bg-st-success-bg/30"
          : inferred
            ? "border-st-warning/40 bg-st-warning-bg/30"
            : skipped
              ? "border-st-warning/30 border-dashed"
              : "border-border")
      }
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border " +
            (recorded
              ? "border-st-success/40 bg-st-success-bg text-st-success"
              : inferred
                ? "border-st-warning/40 bg-st-warning-bg text-st-warning"
                : "border-border bg-surface text-fg-subtle")
          }
        >
          {recorded ? (
            <Check className="size-3.5" />
          ) : inferred ? (
            <Sparkles className="size-3.5" />
          ) : skipped ? (
            <CircleDashed className="size-3.5" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[0.9375rem] font-medium text-fg">{meta.label}</span>
            {inferred ? <Badge tone="warning">Inferred</Badge> : null}
            {skipped ? <Badge tone="warning">Skipped</Badge> : null}
          </div>

          {recorded ? (
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {dateTimeIn(progress.occurredAt!, timeZone)}
              {progress.confirmation ? ` · ${CONFIRMATION_LABEL[progress.confirmation]}` : ""}
            </p>
          ) : inferred && progress.inference ? (
            <div className="mt-1 space-y-2">
              <p className="text-[0.8125rem] leading-5 text-fg-muted">
                {progress.inference.source.toUpperCase()} suggests this happened at{" "}
                {dateTimeIn(progress.inference.observedAt, timeZone)} —{" "}
                {Math.round(progress.inference.confidence * 100)}% confidence.{" "}
                {progress.inference.rationale}
              </p>
              <p className="text-[0.75rem] text-fg-subtle">
                Recorded as a suggestion, not as something you did.
              </p>
              {!closed ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={pending}
                    onClick={() => onConfirm(progress.eventId!)}
                  >
                    Yes, that happened
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onReject(progress.eventId!)}
                  >
                    No, it did not
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {skipped
                ? "Never recorded, and later steps were. Add it if it happened."
                : meta.hint}
            </p>
          )}
        </div>

        {!recorded && !inferred && !closed ? (
          <Button
            size="sm"
            variant={skipped ? "secondary" : "subtle"}
            disabled={pending}
            onClick={onRecord}
            className="shrink-0"
          >
            {skipped ? "Add it" : "Mark"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The two or three things worth offering first, as big targets. */
export function NextActions({
  view, onRecord, pending,
}: {
  view: DriverWorkflowView;
  onRecord: (milestone: MilestoneKind) => void;
  pending?: boolean;
}) {
  if (view.workflow.status !== "active" || view.suggestedMilestones.length === 0) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>What next</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            A suggestion, not a requirement. You can record anything on the trip at any time.
          </p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {view.suggestedMilestones.slice(0, 3).map((kind, i) => {
          const meta = milestoneMeta(kind);
          const Icon = MILESTONE_ICON[kind];
          return (
            <Button
              key={kind}
              size="lg"
              variant={i === 0 ? "primary" : "secondary"}
              disabled={pending}
              onClick={() => onRecord(kind)}
              className="w-full justify-start"
            >
              <Icon aria-hidden />
              {meta.actionLabel}
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Advisory, always. A warning asks a question; it never stops the next action. */
export function TripWarnings({ view }: { view: DriverWorkflowView }) {
  if (view.warnings.length === 0) return null;

  return (
    <Card className="border-st-warning/40">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Worth a look</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            None of this stops you doing anything else on the trip.
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ul className="divide-y divide-border border-t border-border">
          {view.warnings.map((w, i) => (
            <li key={`${w.kind}-${w.milestone ?? i}`} className="flex gap-3 px-5 py-3">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
              <p className="text-[0.875rem] leading-5 text-fg">{w.message}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
