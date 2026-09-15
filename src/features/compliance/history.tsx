"use client";

import { Lock } from "lucide-react";
import { HISTORY_ACTION_LABEL } from "@/config/compliance";
import type { ComplianceHistoryEntry, ComplianceRequirement } from "@/types";
import { formatDateTime } from "./format";
import { ComplianceStatusBadge } from "./status-chips";

/**
 * The timeline, and the audit trail — the same thing, because they must be.
 *
 * Append-only: entries are never edited and never removed, and a mistake is
 * corrected by appending a correcting entry. That is why this renders straight
 * from the record with no filtering of its own beyond the order.
 */
export function ComplianceHistory({
  requirement, timeZone,
}: {
  requirement: ComplianceRequirement;
  timeZone: string;
}) {
  const entries = [...requirement.history].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  return (
    <section
      aria-labelledby="history"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="history" className="text-[0.875rem] font-semibold text-fg">
          Timeline
        </h2>
        <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
          <Lock aria-hidden className="size-3" />
          Append-only
        </span>
      </div>
      <p className="mt-1 text-[0.8125rem] text-fg-muted">
        Nothing here is ever edited or deleted. A mistake is corrected by adding a
        correcting entry.
      </p>

      <ol className="mt-4 space-y-0">
        {entries.map((entry, index) => (
          <Entry
            key={entry.id}
            entry={entry}
            timeZone={timeZone}
            last={index === entries.length - 1}
          />
        ))}
      </ol>
    </section>
  );
}

function Entry({
  entry, timeZone, last,
}: {
  entry: ComplianceHistoryEntry;
  timeZone: string;
  last: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span aria-hidden className="flex flex-col items-center">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong" />
        {last ? null : <span className="w-px flex-1 bg-border" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.8125rem] font-medium text-fg">
            {HISTORY_ACTION_LABEL[entry.action]}
          </p>
          {entry.toStatus && entry.toStatus !== entry.fromStatus ? (
            <ComplianceStatusBadge status={entry.toStatus} />
          ) : null}
        </div>
        {entry.note ? (
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">{entry.note}</p>
        ) : null}
        {entry.evidence ? (
          <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
            Evidence: {entry.evidence.fileName ?? entry.evidence.label}
          </p>
        ) : null}
        <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
          {entry.actor.displayNameSnapshot} · {formatDateTime(entry.at, timeZone)}
        </p>
      </div>
    </li>
  );
}
