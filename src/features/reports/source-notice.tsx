"use client";

import { AlertTriangle, CircleSlash, FlaskConical, Info, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReportNotice, ReportSourceStatus, SourceAvailability } from "@/types";

/**
 * Where a number came from, said out loud.
 *
 * Mock data is never silently mixed into a screen next to live data. Every
 * surface that shows a figure from an unconnected module shows this too.
 */

const TONE: Record<SourceAvailability, "success" | "warning" | "danger"> = {
  live: "success",
  mock: "warning",
  unavailable: "danger",
};

const LABEL: Record<SourceAvailability, string> = {
  live: "Live",
  mock: "Mock data",
  unavailable: "Not available",
};

export function AvailabilityBadge({
  availability,
  className,
}: {
  availability: SourceAvailability;
  className?: string;
}) {
  const Icon = availability === "live" ? Plug : availability === "mock" ? FlaskConical : CircleSlash;
  return (
    <Badge tone={TONE[availability]} className={className}>
      <Icon aria-hidden className="size-3" />
      {LABEL[availability]}
    </Badge>
  );
}

export function SourceList({ sources }: { sources: ReportSourceStatus[] }) {
  return (
    <ul className="space-y-3">
      {sources.map((source) => (
        <li key={source.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
          <div className="flex shrink-0 items-center gap-2 sm:w-56">
            <AvailabilityBadge availability={source.availability} />
            <span className="text-[0.8125rem] font-medium text-fg">{source.label}</span>
          </div>
          <p className="text-[0.8125rem] leading-5 text-fg-muted">{source.note}</p>
        </li>
      ))}
    </ul>
  );
}

const NOTICE_ICON = {
  mock_source: FlaskConical,
  excluded_records: AlertTriangle,
  no_data: Info,
  partial_permission: AlertTriangle,
} as const;

export function NoticeBanner({ notice }: { notice: ReportNotice }) {
  const Icon = NOTICE_ICON[notice.kind];
  const tone =
    notice.kind === "mock_source"
      ? "border-st-warning/30 bg-st-warning-bg/50 text-st-warning"
      : notice.kind === "excluded_records"
        ? "border-st-info/30 bg-st-info-bg/50 text-st-info"
        : "border-border bg-surface-sunken text-fg-muted";

  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border px-3.5 py-2.5", tone)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="text-[0.8125rem] leading-5 text-fg">{notice.message}</p>
    </div>
  );
}

export function NoticeList({ notices }: { notices: ReportNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="space-y-2">
      {notices.map((notice, i) => (
        <NoticeBanner key={`${notice.kind}-${i}`} notice={notice} />
      ))}
    </div>
  );
}
