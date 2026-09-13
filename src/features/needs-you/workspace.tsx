"use client";

import { Inbox } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { useActiveMembership } from "@/lib/session/hooks";
import type { NeedsYouFilters, NeedsYouItem } from "@/types";
import { NeedsYouDrawer } from "./detail-drawer";
import { NeedsYouFilterBar } from "./filter-bar";
import {
  useAssignableMembers, useNeedsYouAction, useNeedsYouList,
} from "./hooks";
import { NeedsYouCard } from "./item-card";

const DEFAULT_FILTERS: NeedsYouFilters = {
  status: ["open", "escalated"],
  owner: "all",
};

export function NeedsYouWorkspace() {
  const [filters, setFilters] = useState<NeedsYouFilters>(DEFAULT_FILTERS);
  // The drawer holds the item itself, not just its id: acting on an item can
  // move it out of the current filter, and the panel must stay open showing the
  // result rather than vanishing under the user.
  const [selected, setSelected] = useState<NeedsYouItem | null>(null);
  const { isDriverMembership, membership } = useActiveMembership();

  // Unfiltered (status-wide) set, used for chip counts so the numbers do not
  // change as you filter.
  const all = useNeedsYouList({ owner: "all" });
  const list = useNeedsYouList(filters);
  const members = useAssignableMembers();
  const action = useNeedsYouAction();

  const items = useMemo(() => list.data ?? [], [list.data]);

  const memberName = useCallback(
    (membershipId?: string) =>
      membershipId
        ? (members.data?.find((m) => m.membershipId === membershipId)?.displayName ??
          "Assigned")
        : undefined,
    [members.data],
  );

  const openCount = (all.data ?? []).filter(
    (i) => i.status === "open" || i.status === "escalated",
  ).length;
  const criticalCount = (all.data ?? []).filter(
    (i) => i.severity === "critical" && (i.status === "open" || i.status === "escalated"),
  ).length;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Needs You"
        description={
          isDriverMembership
            ? "Decisions and exceptions on your own loads."
            : "Decisions and exceptions, ordered by operational urgency."
        }
        actions={
          <div className="flex items-center gap-2">
            {criticalCount > 0 ? (
              <Badge tone="danger">{criticalCount} critical</Badge>
            ) : null}
            <Badge tone="outline">{openCount} open</Badge>
          </div>
        }
      />

      <NeedsYouFilterBar
        filters={filters}
        onChange={setFilters}
        allItems={all.data ?? []}
      />

      {list.isPending ? (
        <LoadingSkeleton rows={5} />
      ) : list.isError ? (
        <ErrorState
          title="Could not load your queue"
          description={list.error.message}
          onRetry={() => list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            (all.data ?? []).length === 0
              ? "Nothing needs you right now"
              : "Nothing matches these filters"
          }
          description={
            (all.data ?? []).length === 0
              ? "Antcolos watches loads, trucks, drivers and documents, and puts anything that needs a decision here."
              : "Clear a filter to widen the queue."
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <NeedsYouCard
                item={item}
                selected={item.id === selected?.id}
                assigneeName={memberName(item.assigneeMembershipId)}
                onOpen={() => setSelected(item)}
              />
            </li>
          ))}
        </ul>
      )}

      {membership?.scope.loads === "assigned" ? (
        <p className="text-[0.75rem] text-fg-subtle">
          Showing only items about loads assigned to you.
        </p>
      ) : null}

      <NeedsYouDrawer
        item={selected}
        open={Boolean(selected)}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
          action.reset();
        }}
        onItemUpdated={setSelected}
        action={action}
        members={members.data ?? []}
        memberName={memberName}
      />
    </div>
  );
}
