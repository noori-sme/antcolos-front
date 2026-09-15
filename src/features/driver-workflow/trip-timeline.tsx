"use client";

import {
  CircleDot, FileText, Flag, MessageSquare, Pencil, ScanLine, Sparkles,
  ThumbsDown, ThumbsUp, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_SOURCE_LABEL } from "@/config/documents";
import { activityMeta, milestoneMeta } from "@/lib/driver-workflow/catalog";
import { dateTimeIn } from "@/lib/utils";
import type { DriverWorkflowEvent, WorkflowEventType } from "@/types";
import { ACTIVITY_ICON, MILESTONE_ICON } from "./labels";

/**
 * The record of what actually happened, in the order it happened.
 *
 * Two times are kept on every entry and the difference between them is shown
 * when it matters: when it happened, and when Antcolos learned about it. A
 * driver catching up after a dead zone produces entries where those differ by
 * hours, and hiding that would be inventing a tidier trip than the real one.
 */

const TYPE_ICON: Partial<Record<WorkflowEventType, LucideIcon>> = {
  "workflow.created": Flag,
  "milestone.inferred": Sparkles,
  "milestone.confirmed": ThumbsUp,
  "milestone.inference_rejected": ThumbsDown,
  "milestone.corrected": Pencil,
  "document.attached": FileText,
  "document.extraction_recorded": ScanLine,
  "document.extraction_corrected": Pencil,
  "comment.added": MessageSquare,
  "workflow.completed": Flag,
};

function titleOf(event: DriverWorkflowEvent): string {
  switch (event.type) {
    case "workflow.created":
      return "Trip created from the finalized load";
    case "milestone.recorded":
      return event.milestone ? milestoneMeta(event.milestone).label : "Milestone";
    case "milestone.inferred":
      return event.milestone
        ? `${milestoneMeta(event.milestone).label} — inferred`
        : "Inferred milestone";
    case "milestone.confirmed":
      return event.milestone
        ? `${milestoneMeta(event.milestone).label} — confirmed by you`
        : "Confirmed";
    case "milestone.inference_rejected":
      return event.milestone
        ? `${milestoneMeta(event.milestone).label} — you said it did not happen`
        : "Rejected";
    case "milestone.corrected":
      return "Time corrected";
    case "activity.recorded":
      return event.activity ? activityMeta(event.activity).label : "Update";
    case "document.attached":
      return `${event.payload?.fileName ?? "Document"} attached`;
    case "document.extraction_recorded":
      return "Fields extracted";
    case "document.extraction_corrected":
      return "Extracted value corrected";
    case "comment.added":
      return "Comment";
    case "handoff.emitted":
      return "Queued for another module";
    case "workflow.completed":
      return "Trip completed";
  }
}

function iconOf(event: DriverWorkflowEvent): LucideIcon {
  if (event.type === "milestone.recorded" && event.milestone) {
    return MILESTONE_ICON[event.milestone];
  }
  if (event.type === "activity.recorded" && event.activity) {
    return ACTIVITY_ICON[event.activity];
  }
  return TYPE_ICON[event.type] ?? CircleDot;
}

function isException(event: DriverWorkflowEvent): boolean {
  return Boolean(event.activity && activityMeta(event.activity).exception);
}

export function TripTimeline({
  events, timeZone,
}: {
  events: DriverWorkflowEvent[];
  timeZone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Everything that happened</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Append-only. Nothing here is edited or removed — a mistake is corrected by adding
            the correction.
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {events.length === 0 ? (
          <p className="border-t border-border px-5 py-8 text-[0.875rem] text-fg-muted">
            Nothing yet.
          </p>
        ) : (
          <ol className="relative border-t border-border px-5 py-4">
            <span
              aria-hidden
              className="absolute top-6 bottom-6 left-[1.8125rem] w-px bg-border"
            />
            {events.map((event) => {
              const Icon = iconOf(event);
              const exception = isException(event);
              const inferred = event.confirmation === "inferred";
              // Recorded long after it happened: the offline catch-up case.
              const lag =
                new Date(event.recordedAt).getTime() - new Date(event.occurredAt).getTime();
              const lateBy = lag > 10 * 60_000 ? lag : 0;

              return (
                <li key={event.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                  <span
                    className={
                      "z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border " +
                      (exception
                        ? "border-st-danger/40 bg-st-danger-bg text-st-danger"
                        : inferred
                          ? "border-st-warning/40 bg-st-warning-bg text-st-warning"
                          : "border-border bg-surface text-fg-subtle")
                    }
                  >
                    <Icon aria-hidden className="size-3.5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[0.875rem] font-medium text-fg">
                        {titleOf(event)}
                      </span>
                      <Badge tone={event.source === "telegram" ? "info" : "neutral"}>
                        {EVENT_SOURCE_LABEL[event.source] ?? event.source}
                      </Badge>
                      {inferred ? <Badge tone="warning">Not confirmed</Badge> : null}
                    </span>

                    {event.inference ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                        {event.inference.rationale} ·{" "}
                        {Math.round(event.inference.confidence * 100)}% confidence
                      </span>
                    ) : null}

                    {event.payload?.note ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                        {event.payload.note}
                      </span>
                    ) : null}

                    {event.type === "document.extraction_corrected" ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                        “{event.payload?.extractedValue}” → “{event.payload?.correctedValue}”
                      </span>
                    ) : null}

                    {event.payload?.exceptionReason ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-st-warning">
                        Recorded without a POD: {event.payload.exceptionReason}
                      </span>
                    ) : null}

                    <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                      {dateTimeIn(event.occurredAt, timeZone)} ·{" "}
                      {event.actor.displayNameSnapshot}
                      {lateBy > 0
                        ? ` · recorded ${Math.round(lateBy / 60_000)} min later`
                        : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
