"use client";

import {
  Ban, Check, CircleDot, Clock3, Flag, MessageSquare, Pause, Play, Send, X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENT_SOURCE_LABEL } from "@/config/documents";
import { dateTimeIn } from "@/lib/utils";
import type { DriverProposalView, ProposalEvent, ProposalEventType } from "@/types";

/**
 * The negotiation, as it happened. Append-only: a rejected proposal, an expired
 * pause and a proposal that went unavailable all keep every entry, because the
 * question "why did we not run that load" is asked weeks later.
 */

const LABEL: Record<ProposalEventType, string> = {
  "proposal.received": "Dispatch sent this to you",
  "proposal.viewed": "You opened it",
  "proposal.approved": "You approved continued negotiation",
  "proposal.rejected": "You rejected it",
  "proposal.paused": "You paused it",
  "proposal.pause_expired": "The pause ran out",
  "proposal.resumed": "You resumed it",
  "proposal.comment_added": "You commented",
  "proposal.counteroffer_submitted": "You sent a counteroffer",
  "proposal.counteroffer_withdrawn": "You withdrew a counteroffer",
  "proposal.counteroffer_answered": "Dispatch answered a counteroffer",
  "proposal.withdrawn": "Dispatch withdrew it",
  "proposal.expired": "It expired without an answer",
  "proposal.marked_unavailable": "It became unavailable",
  "proposal.finalized": "The load was finalized",
};

const ICON: Partial<Record<ProposalEventType, LucideIcon>> = {
  "proposal.received": Send,
  "proposal.approved": Check,
  "proposal.rejected": X,
  "proposal.paused": Pause,
  "proposal.pause_expired": Clock3,
  "proposal.resumed": Play,
  "proposal.comment_added": MessageSquare,
  "proposal.counteroffer_submitted": Send,
  "proposal.counteroffer_withdrawn": X,
  "proposal.withdrawn": Ban,
  "proposal.expired": Clock3,
  "proposal.marked_unavailable": Ban,
  "proposal.finalized": Flag,
};

export function ProposalHistory({
  proposal, events, loading,
}: {
  proposal: DriverProposalView;
  events: ProposalEvent[];
  loading?: boolean;
}) {
  const tz = proposal.stops[0]?.timeZone ?? "UTC";

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>History</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Kept in full, whatever happens to the proposal.
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {loading ? (
          <p className="border-t border-border px-5 py-8 text-[0.875rem] text-fg-muted">
            Loading…
          </p>
        ) : events.length === 0 ? (
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
              const Icon = ICON[event.type] ?? CircleDot;
              const comment = proposal.comments.find((c) => c.id === event.payload?.commentId);
              const counter = proposal.counteroffers.find(
                (c) => c.id === event.payload?.counterofferId,
              );
              return (
                <li key={event.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                  <span className="z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-subtle">
                    <Icon aria-hidden className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[0.875rem] font-medium text-fg">
                        {LABEL[event.type]}
                      </span>
                      <Badge tone={event.source === "telegram" ? "info" : "neutral"}>
                        {EVENT_SOURCE_LABEL[event.source] ?? event.source}
                      </Badge>
                    </span>

                    {event.payload?.minutes ? (
                      <span className="mt-1 block text-[0.8125rem] text-fg-muted">
                        For {event.payload.minutes} minutes.
                      </span>
                    ) : null}

                    {comment ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg">
                        “{comment.body}”
                      </span>
                    ) : counter ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg">
                        “{counter.message}”
                      </span>
                    ) : event.payload?.note ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                        {event.payload.note}
                      </span>
                    ) : null}

                    {event.payload?.reason ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                        {event.payload.reason}
                      </span>
                    ) : null}

                    {event.payload?.conflictReason ? (
                      <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                        {event.payload.conflictReason}
                      </span>
                    ) : null}

                    <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                      {dateTimeIn(event.occurredAt, tz)} · {event.actor.displayNameSnapshot}
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
