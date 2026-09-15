"use client";

import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { MtLoopPanel } from "./mt-loop-panel";
import { useMtLoopBoard, useMtLoopContext } from "./use-mt-loop";

/**
 * Every empty truck in this workspace, whoever is on it.
 *
 * ★ WHERE OVERSIGHT LIVES NOW ★
 * Home became personal: it shows full operational cards only for loops that
 * need the person reading it, and collapses everything the team is handling to
 * one line. That line has to lead somewhere real, and this is it — the
 * organization-wide board, every card, nothing hidden.
 *
 * Separating the two is the whole point. A Carrier Owner is accountable for
 * every truck in their workspace and must be able to look at all of them
 * whenever they choose; what they should not get is an operational card with
 * buttons for a healthy loop a dispatcher is already working, sitting on the
 * screen they open to find out what needs them. Oversight is intentional. A
 * personal queue is not.
 */
export function MtLoopBoardScreen() {
  const ctx = useMtLoopContext();
  const board = useMtLoopBoard();

  if (board.isPending) {
    return (
      <div className="space-y-section">
        <PageHeader title="MT Loop" />
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (board.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="MT Loop" />
        <ErrorState
          title="Could not load the board"
          description={board.error.message}
          onRetry={() => board.refetch()}
        />
      </div>
    );
  }

  const data = board.data;

  return (
    <div className="space-y-section">
      <PageHeader
        title="MT Loop"
        description="Every truck this workspace covers that is empty or about to be — whoever is responsible for it."
        actions={
          data && data.counts.needsYou > 0 ? (
            <Badge tone="outline">{data.counts.needsYou} need you</Badge>
          ) : null
        }
      />

      {data ? (
        <MtLoopPanel
          board={data}
          ctx={ctx}
          // The organization-wide view. Every loop, every card — the counterpart
          // to Home, which shows only what needs the person reading it.
          scope="organization"
          onChanged={() => void board.refetch()}
        />
      ) : null}
    </div>
  );
}
