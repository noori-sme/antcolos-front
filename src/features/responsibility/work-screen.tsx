"use client";

import { ListChecks, Settings2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useActiveMembership } from "@/lib/session/hooks";
import {
  FLEET_TIER_LABEL, type ResponsibilityAssignment, type ResponsibilityQueue,
} from "@/types";
import { ResponsibilityPanel } from "./detail-panel";
import { FleetSizeQuestion } from "./fleet-size-question";
import {
  useAssignableMemberships, useResponsibilityAction, useResponsibilityBoard,
} from "./hooks";
import { WorkRow } from "./work-row";

/**
 * My Work: the daily surface.
 *
 * Progressive disclosure, made concrete. This screen shows queues and rows and
 * nothing else — no hierarchy diagram, no policy editor, no SLA form. A Carrier
 * who never opens the settings link in the corner never learns that escalation
 * policies exist, and their work is still routed, still owned and still
 * escalated when it slips.
 *
 * The queues themselves come from the service. A queue that does not apply to
 * this workspace is ABSENT from the response rather than empty, so a lone
 * owner-operator sees no "Team work" tab at all — which is a different
 * statement from a team tab with nothing in it, and the difference is the one a
 * person would otherwise misread as "my colleagues have nothing on".
 */

export function MyWorkScreen() {
  const board = useResponsibilityBoard();
  const members = useAssignableMemberships();
  const action = useResponsibilityAction();
  const { membership } = useActiveMembership();

  const [queue, setQueue] = useState<ResponsibilityQueue | null>(null);
  // The panel holds the assignment itself rather than an id: acting on a piece
  // of work can move it out of the queue you are looking at, and the panel has
  // to stay open showing the result rather than vanishing under the user.
  const [selected, setSelected] = useState<ResponsibilityAssignment | null>(null);

  const queues = useMemo(() => board.data?.queues ?? [], [board.data]);
  // Until somebody picks a tab, land on the first queue that actually has
  // something in it. Opening on an empty "My MT Loop" while five items wait one
  // tab along is a screen that makes a person look for their own work.
  const active = queue
    ? (queues.find((q) => q.queue === queue) ?? queues[0])
    : (queues.find((q) => q.count > 0) ?? queues[0]);

  if (board.isPending) {
    return (
      <div className="space-y-section">
        <PageHeader title="My work" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (board.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="My work" />
        <ErrorState
          title="Could not work out who holds what"
          description={board.error.message}
          onRetry={() => board.refetch()}
        />
      </div>
    );
  }

  const data = board.data!;
  const counts = data.counts;
  const hasTeam = queues.some((q) => q.queue === "team");

  return (
    <div className="space-y-section">
      <PageHeader
        title="My work"
        description={
          // A driver, and a workspace of one, have no team. Promising them one
          // in the subtitle is the same mistake as rendering an empty team
          // queue: it describes somebody else's product.
          hasTeam
            ? "What is yours, what your team is holding, and anything that has slipped."
            : "What is yours, and anything that has slipped."
        }
        actions={
          <div className="flex items-center gap-2">
            {counts.escalated > 0 ? (
              <Badge tone="warning">{counts.escalated} escalated</Badge>
            ) : null}
            {counts.oversight > 0 ? (
              <Badge tone="outline">{counts.oversight} you answer for</Badge>
            ) : null}
            {data.mayCustomize ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/settings/responsibility">
                  <Settings2 aria-hidden />
                  Settings
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {/* The whole of setup: one number, inline, skippable, and only when the
          answer is not already known. See `fleet-size-question.tsx`. */}
      <FleetSizeQuestion profile={data.fleetProfile} />

      {/* The fleet shape, stated in one line rather than configured. */}
      <p className="text-[0.8125rem] text-fg-muted">
        {FLEET_TIER_LABEL[data.fleetProfile.tier]}
        {" · "}
        {data.fleetProfile.truckCount}{" "}
        {data.fleetProfile.truckCount === 1 ? "truck" : "trucks"}
        {" · "}
        {data.fleetProfile.summary}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {queues.map((q) => (
          <Chip
            key={q.queue}
            label={q.label}
            count={q.count}
            selected={q.queue === active?.queue}
            onToggle={() => setQueue(q.queue)}
          />
        ))}
      </div>

      {active ? (
        <>
          <p className="text-[0.8125rem] text-fg-subtle">{active.description}</p>

          {active.items.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={emptyTitle(active.queue)}
              description={emptyDescription(active.queue)}
            />
          ) : (
            <ul className="space-y-2.5">
              {active.items.map((item) => (
                <li key={item.id}>
                  <WorkRow
                    assignment={item}
                    selected={item.id === selected?.id}
                    viewerMembershipId={membership?.id ?? ""}
                    onOpen={() => setSelected(item)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <p className="text-[0.75rem] text-fg-subtle">
        Nothing on this screen runs on a timer. Targets and escalation levels are
        worked out from the records each time the page is read, and no reminder
        or escalation is delivered anywhere — the backend owns that.
      </p>

      <ResponsibilityPanel
        assignment={selected}
        open={selected != null}
        onOpenChange={(v) => !v && setSelected(null)}
        action={action}
        members={members.data ?? []}
        onUpdated={setSelected}
      />
    </div>
  );
}

/**
 * An empty queue that means something good says so.
 *
 * "Unassigned is empty" is the system working, not a missing list, and a screen
 * that says "Nothing here" for both is a screen that cannot tell a person they
 * are on top of things.
 */
function emptyTitle(queue: ResponsibilityQueue): string {
  switch (queue) {
    case "unassigned": return "Nothing is ownerless";
    case "escalated": return "Nothing has escalated";
    case "at_risk": return "Nothing is slipping";
    case "team": return "Your team is holding nothing";
    case "my_mt_loop": return "No truck cycles are yours right now";
    case "my_needs_you": return "Nothing is waiting on you";
    case "all_organization": return "This workspace has no open work";
  }
}

function emptyDescription(queue: ResponsibilityQueue): string {
  switch (queue) {
    case "unassigned":
      return "Every piece of work in this workspace has somebody responsible for it. That is the intended state.";
    case "escalated":
      return "No acknowledgement or resolution target has been missed long enough to involve anybody else.";
    case "at_risk":
      return "Every target is comfortably inside its window.";
    case "team":
      return "Nobody else has anything open. Work appears here as soon as somebody picks something up.";
    default:
      return "Antcolos routes work as it appears, so this fills itself.";
  }
}
