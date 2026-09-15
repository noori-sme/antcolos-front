"use client";

import Link from "next/link";
import { ArrowRight, GitBranch, Link2 } from "lucide-react";
import { AUDIT_MODULE_LABEL, auditActionLabel } from "@/lib/audit/actions";
import type { AuditEvent } from "@/types";
import { cn } from "@/lib/utils";
import { OutcomeBadge, SourceBadge } from "./chips";
import { changeValue, formatDateTime, relativeTime } from "./format";

/**
 * One event.
 *
 * Shows the actor, what happened, what moved and where it came from. A withheld
 * value is rendered as a withheld value — never as blank, which would read as
 * "nothing was there".
 */
export function AuditEventRow({
  event, timeZone, href,
}: {
  event: AuditEvent;
  timeZone: string;
  href?: string;
}) {
  const changes = event.changes?.changes ?? [];
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] font-medium text-fg">{event.summary}</span>
        <OutcomeBadge outcome={event.outcome} />
        <SourceBadge source={event.source} />
        {event.correctsEventId ? (
          <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-fg-subtle">
            <GitBranch aria-hidden className="size-3" />
            Correction
          </span>
        ) : null}
      </div>

      <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
        {event.actor.displayNameSnapshot} · {AUDIT_MODULE_LABEL[event.module]} ·{" "}
        {auditActionLabel(event.action)}
        {event.sourceAction ? ` (${event.sourceAction})` : ""}
      </p>

      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
        <Link2 aria-hidden className="size-3" />
        <span className="truncate">{event.entity.label}</span>
        <span aria-hidden>·</span>
        <time dateTime={event.occurredAt} title={formatDateTime(event.occurredAt, timeZone)}>
          {relativeTime(event.occurredAt)}
        </time>
      </p>

      {changes.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {changes.slice(0, 4).map((change) => (
            <li
              key={change.field}
              className={cn(
                "rounded-sm border px-2 py-0.5 text-[0.6875rem]",
                change.redacted
                  ? "border-dashed border-border-strong text-fg-subtle"
                  : "border-border text-fg-muted",
              )}
            >
              {change.redacted ? (
                <>
                  {change.label} — <span className="italic">withheld</span>
                </>
              ) : (
                <>
                  {change.label}: {changeValue(change.before)}
                  <ArrowRight aria-hidden className="mx-1 inline size-3 align-[-2px]" />
                  {changeValue(change.after)}
                </>
              )}
            </li>
          ))}
          {changes.length > 4 ? (
            <li className="px-1 py-0.5 text-[0.6875rem] text-fg-subtle">
              +{changes.length - 4} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </>
  );

  const className =
    "block w-full rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong";

  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
