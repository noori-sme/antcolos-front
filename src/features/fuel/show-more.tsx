"use client";

import { Button } from "@/components/ui/button";

/**
 * A ledger grows without limit, so a list of one has to say how much of it you
 * are looking at.
 *
 * Rendering every row is not a neutral default: a quarter of jurisdiction
 * mileage for a six-truck fleet is several hundred records, and a page that
 * silently drops the reader into the middle of them is worse than one that
 * says "60 of 180" and lets them ask for more.
 */
export function ShowMore({
  shown,
  total,
  onMore,
  noun,
}: {
  shown: number;
  total: number;
  onMore: () => void;
  noun: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-[0.75rem] tabular-nums text-fg-subtle" role="status">
        Showing {Math.min(shown, total).toLocaleString()} of {total.toLocaleString()} {noun}
      </p>
      {shown < total ? (
        <Button variant="secondary" size="sm" onClick={onMore}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}

/** How many rows a fuel list shows before it asks. */
export const PAGE_SIZE = 40;
