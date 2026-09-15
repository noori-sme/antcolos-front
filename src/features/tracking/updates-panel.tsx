"use client";

import { Check, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  TRACKING_UPDATE_KIND_LABEL, type AvailabilityBasis, type TrackingSession,
  type TrackingUpdateKind,
} from "@/types";
import { BasisChip, UpdateStateChip } from "./chips";

/**
 * The broker update history, and what could be said next.
 *
 * Suggestions are assembled by the service from the row, not typed here, which
 * is what keeps a rate or a driver's name out of them: they are built from
 * fields that do not carry one.
 *
 * Nothing on this panel sends anything. The strongest word available is
 * "queued for handoff", and every row says so.
 */
export function UpdatesPanel({
  session,
  suggestions,
  canApprove,
  busy,
  onDraft,
  onApprove,
  onDiscard,
}: {
  session: TrackingSession;
  suggestions: Array<{ kind: TrackingUpdateKind; message: string; basis: AvailabilityBasis }>;
  canApprove: boolean;
  busy?: boolean;
  onDraft: (input: { kind: TrackingUpdateKind; message: string; basis: AvailabilityBasis }) => void;
  onApprove: (updateId: string) => void;
  onDiscard: (updateId: string) => void;
}) {
  const history = [...session.updates].reverse();

  return (
    <section
      aria-labelledby="updates-heading"
      className="rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <h2
        id="updates-heading"
        className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
      >
        <MessageSquarePlus className="size-4 text-fg-subtle" aria-hidden />
        Customer updates
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        {session.updatePolicy === "draft_for_approval"
          ? "Updates are drafted and wait for you. Nothing reaches a link holder until you approve it."
          : "Updates are queued automatically with nobody in the loop, and appear on the link as soon as they are made."}
        {" "}Queued means held for a handoff that does not exist yet — nothing is transmitted.
      </p>

      {suggestions.length > 0 ? (
        <div className="mt-3">
          <p className="text-[0.8125rem] font-medium text-fg">What could be said right now</p>
          <ul className="mt-1.5 space-y-1.5">
            {suggestions.map((s) => (
              <li
                key={`${s.kind}-${s.message}`}
                className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-[0.8125rem] text-fg">{s.message}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-fg-subtle">
                    {TRACKING_UPDATE_KIND_LABEL[s.kind]}
                    <BasisChip basis={s.basis} />
                  </p>
                </div>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDraft(s)}>
                  {session.updatePolicy === "draft_for_approval" ? "Draft it" : "Queue it"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-[0.8125rem] font-medium text-fg">History</p>
        {history.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">Nothing has been drafted yet.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-border">
            {history.map((update) => (
              <li key={update.id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                  <div className="min-w-0">
                    <p className="text-[0.8125rem] leading-relaxed text-fg">{update.message}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-fg-subtle">
                      <UpdateStateChip state={update.state} />
                      <BasisChip basis={update.basis} />
                      <span>
                        {TRACKING_UPDATE_KIND_LABEL[update.kind]} ·{" "}
                        {new Date(update.createdAt).toLocaleString()} · {update.createdByName}
                        {update.approvedByName ? ` · approved by ${update.approvedByName}` : ""}
                        {update.discardReason ? ` · ${update.discardReason}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">{update.handoffNote}</p>
                  </div>
                  {update.state === "draft" ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || !canApprove}
                        onClick={() => onApprove(update.id)}
                        title={canApprove ? undefined : "Approving updates needs tracking:update:send"}
                      >
                        <Check aria-hidden />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !canApprove}
                        onClick={() => onDiscard(update.id)}
                      >
                        <X aria-hidden />
                        Discard
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
