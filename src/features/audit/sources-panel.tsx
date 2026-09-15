"use client";

import { Database, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuditSources } from "./use-audit";

/**
 * What the ledger is reading from.
 *
 * It exists because "no events from Settlements" and "not connected to
 * Settlements" look identical on a list and mean opposite things — and because
 * a module the reader has no permission for contributes nothing, which is a
 * fact about them rather than about the organization.
 */
export function SourcesPanel() {
  const sources = useAuditSources();
  if (!sources.data?.length) return null;

  return (
    <section
      aria-labelledby="audit-sources"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Database aria-hidden className="size-4 text-fg-subtle" />
        <h2 id="audit-sources" className="text-[0.875rem] font-semibold text-fg">
          Where this comes from
        </h2>
      </div>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        Each module keeps its own history and stays the authority on it. This log is a
        read-only projection of those histories, joined together — not a second copy that
        can disagree with them.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {sources.data.map((source) => (
          <li
            key={source.module}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[0.8125rem] font-medium text-fg">{source.label}</p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                {source.readable
                  ? `${source.eventCount} event${source.eventCount === 1 ? "" : "s"}`
                  : "You do not have permission to read this module"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {source.mock ? <Badge tone="outline">Mock adapter</Badge> : null}
              {!source.readable ? (
                <EyeOff aria-hidden className="size-4 text-fg-subtle" />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
