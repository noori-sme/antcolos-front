"use client";

import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { timelineSentence, timelineVia } from "@/lib/load-records/format";
import { useLoadTimeline } from "./hooks";

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** What happened to the load, oldest first (loads-api-contract.md §8). */
export function LiveLoadTimeline({ loadId }: { loadId: string }) {
  const timeline = useLoadTimeline(loadId);

  return (
    <section aria-labelledby="load-timeline" className="space-y-3">
      <h2 id="load-timeline" className="text-[0.9375rem] font-semibold text-fg">
        Timeline
      </h2>
      {timeline.isPending ? (
        <LoadingSkeleton rows={3} />
      ) : timeline.isError && !timeline.data ? (
        <ErrorState
          title="Couldn't load the timeline"
          description={timeline.error.message}
          onRetry={() => void timeline.refetch()}
        />
      ) : timeline.data.pages[0]?.items.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">Nothing recorded for this load yet.</p>
      ) : (
        <>
          <ol className="space-y-0 border-l border-border pl-4">
            {timeline.data.pages.flatMap((page) => page.items).map((entry) => {
              const via = timelineVia(entry.source);
              return (
              <li key={entry.id} className="relative pb-4 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-border-strong"
                />
                <p className="text-[0.875rem] text-fg">{timelineSentence(entry)}</p>
                {entry.reason ? (
                  <p className="mt-0.5 text-[0.8125rem] text-fg-muted">“{entry.reason}”</p>
                ) : null}
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  <time dateTime={entry.occurredAt}>{WHEN.format(new Date(entry.occurredAt))}</time>
                  {entry.actor ? ` · ${entry.actor.name ?? "A former member"}` : " · System"}
                  {via ? ` · ${via}` : null}
                </p>
              </li>
              );
            })}
          </ol>
          {timeline.hasNextPage ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={timeline.isFetchingNextPage}
              onClick={() => void timeline.fetchNextPage()}
            >
              {timeline.isFetchingNextPage ? "Loading…" : "Show more"}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
