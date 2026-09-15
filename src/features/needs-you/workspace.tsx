"use client";

import { Inbox } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { useActiveMembership } from "@/lib/session/hooks";
import type { NeedsYouItem } from "@/types";
import { NeedsYouDrawer } from "./detail-drawer";
import { NeedsYouToolbar } from "./filter-bar";
import { NeedsYouFilterPanel } from "./filter-panel";
import { useAttentionViews, useRoutedHolders } from "@/features/responsibility/hooks";
import {
  activeFilterCount, defaultQuery, sortItems, type NeedsYouQuery,
} from "./query";
import {
  NEEDS_YOU_VIEW_ORDER, NeedsYouViewNote, NeedsYouViewSwitcher, type NeedsYouView,
} from "./view-switcher";
import {
  useAssignableMembers, useNeedsYouAction, useNeedsYouList,
} from "./hooks";
import { NeedsYouCard } from "./item-card";

export function NeedsYouWorkspace() {
  /**
   * ★ THE DEFAULT PAGE STATE: My Needs You + Open. ★
   *
   * Nothing else is on. A person arriving here is answering "what needs me?",
   * and the page answers it before offering to narrow it — the Filters button
   * reads "Filters" with no number until they choose something.
   */
  const [query, setQuery] = useState<NeedsYouQuery>(defaultQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  // The drawer holds the item itself, not just its id: acting on an item can
  // move it out of the current filter, and the panel must stay open showing the
  // result rather than vanishing under the user.
  const [selected, setSelected] = useState<NeedsYouItem | null>(null);
  const [view, setView] = useState<NeedsYouView>("my_needs_you");
  const { isDriverMembership, membership } = useActiveMembership();

  // ★ THE shared derivation. ★
  // Home reads exactly this, through the same service call, so the two surfaces
  // cannot disagree about what needs somebody. This page never decides for
  // itself what belongs in a personal queue.
  const attention = useAttentionViews();

  const list = useNeedsYouList(query.filters);
  const members = useAssignableMembers();
  const action = useNeedsYouAction();

  /**
   * The three views, applied over the queue this page already loads.
   *
   * The ids come from the responsibility service; the ITEMS stay this module's
   * own, so every existing behaviour — filters, deep links, the drawer, resolve
   * and snooze — keeps working unchanged. Only which subset is on screen moves.
   */
  const viewIds = useMemo(() => {
    const v = attention.data;
    const ids = (list: { work: { kind: string; id: string } }[] | undefined) =>
      new Set((list ?? []).filter((a) => a.work.kind === "needs_you").map((a) => a.work.id));
    return {
      my_needs_you: ids(v?.myNeedsYou),
      team_oversight: ids(v?.teamOversight),
      all_organization: ids(v?.allOrganization),
    } satisfies Record<NeedsYouView, Set<string>>;
  }, [attention.data]);

  /**
   * Which views this membership gets.
   *
   * Three separate answers, not one: a driver may not see other people's work,
   * a lone owner-operator has no other people, and both differ from an Owner
   * who has both. Absent and empty stay apart — showing somebody an empty Team
   * oversight tab tells them their colleagues have nothing on, which is a very
   * different claim from "you work alone".
   */
  const availableViews = useMemo<NeedsYouView[]>(() => {
    const v = attention.data;
    if (!v?.maySeeTeam) return ["my_needs_you"];
    return NEEDS_YOU_VIEW_ORDER.filter(
      (view) => view !== "team_oversight" || v.teamOversightApplies,
    );
  }, [attention.data]);
  const activeView = availableViews.includes(view) ? view : "my_needs_you";

  const all = useNeedsYouList({ owner: "all" });
  const allItems = useMemo(() => all.data ?? [], [all.data]);

  const viewCounts = useMemo(
    () => ({
      my_needs_you: allItems.filter((i) => viewIds.my_needs_you.has(i.id)).length,
      team_oversight: allItems.filter((i) => viewIds.team_oversight.has(i.id)).length,
      all_organization: allItems.filter((i) => viewIds.all_organization.has(i.id)).length,
    }),
    [allItems, viewIds],
  );

  // Who a row is routed to, when nobody has explicitly taken it. Read from the
  // responsibility board the viewer already has cached rather than one query
  // per row — and used only as a label and as the Responsibility filter's
  // source. Without it the queue says "Unassigned" about items the routing
  // engine has given somebody, which is the one thing this milestone must
  // never let a screen claim.
  const routed = useRoutedHolders();

  /**
   * The list on screen: the view, then the service filters, then responsibility,
   * then the sort.
   *
   * Responsibility is applied here rather than in the service because it is the
   * responsibility layer's answer, not the Needs You queue's — the queue records
   * an explicit assignee and nothing else. Reading it from the board the page
   * already holds keeps one routing engine rather than growing a second.
   */
  const items = useMemo(() => {
    const inQueue = (list.data ?? []).filter((i) => viewIds[activeView].has(i.id));
    const byAssignment =
      query.assignment.length === 0
        ? inQueue
        : inQueue.filter((i) => {
            const state = routed.get(i.id)?.assignmentState;
            return state != null && query.assignment.includes(state);
          });
    return sortItems(byAssignment, query.sort);
  }, [list.data, viewIds, activeView, query.assignment, query.sort, routed]);

  const memberName = useCallback(
    (item: NeedsYouItem) => {
      if (item.assigneeMembershipId) {
        return members.data?.find((m) => m.membershipId === item.assigneeMembershipId)
          ?.displayName ?? "Assigned";
      }
      const holder = routed.get(item.id);
      if (!holder) return undefined;
      return holder.isFallback
        ? `${holder.displayName} (owner fallback)`
        : holder.displayName;
    },
    [members.data, routed],
  );

  // Counted over the ACTIVE view, never the whole organization. The header
  // badge used to say "142 open" to a Carrier Owner whose personal list held
  // ten things, which is the headline version of the mistake this change fixes.
  const inView = useMemo(
    () => allItems.filter((i) => viewIds[activeView].has(i.id)),
    [allItems, viewIds, activeView],
  );
  const openCount = inView.filter(
    (i) => i.status === "open" || i.status === "escalated",
  ).length;
  const criticalCount = inView.filter(
    (i) => i.severity === "critical" && (i.status === "open" || i.status === "escalated"),
  ).length;

  const narrowed = activeFilterCount(query) > 0;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Needs You"
        description={
          isDriverMembership
            ? "Decisions and exceptions on your own loads."
            : "What needs you, what your team is holding, and the whole workspace — kept apart."
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

      {/*
        The whole top of the page: three views, a search box, a sort and one
        Filters button. Everything else is behind that button.
      */}
      <NeedsYouToolbar
        query={query}
        onChange={setQuery}
        onOpenFilters={() => setFiltersOpen(true)}
        filtersButtonRef={filtersButton}
        views={
          <NeedsYouViewSwitcher
            view={activeView}
            onChange={setView}
            counts={viewCounts}
            available={availableViews}
          />
        }
      />
      <NeedsYouViewNote view={activeView} />

      <NeedsYouFilterPanel
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        query={query}
        onChange={setQuery}
        // Counted over the view on screen, unfiltered, so the numbers beside
        // each option hold still while you tick them.
        items={inView}
        resultCount={items.length}
        returnFocusTo={filtersButton}
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
            inView.length === 0 && !narrowed
              ? emptyTitle(activeView)
              : "Nothing matches these filters"
          }
          description={
            inView.length === 0 && !narrowed
              ? emptyDescription(activeView)
              : "Clear a filter to widen the queue."
          }
        />
      ) : (
        <ul aria-label="Needs You queue" className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <NeedsYouCard
                item={item}
                selected={item.id === selected?.id}
                assigneeName={memberName(item)}
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

/**
 * An empty view that means something good says so.
 *
 * "My Needs You is empty" is the system working — an Owner who has delegated
 * well should see it — and it must not read like a missing list.
 */
function emptyTitle(view: NeedsYouView): string {
  switch (view) {
    case "my_needs_you": return "Nothing needs you right now";
    case "team_oversight": return "Your team is holding nothing";
    case "all_organization": return "This workspace has no open work";
  }
}

function emptyDescription(view: NeedsYouView): string {
  switch (view) {
    case "my_needs_you":
      return "Work lands here when it is yours to do, when somebody escalates it to you or asks for your help, when it is waiting on your approval, or when nobody else can do it. Everything else is being handled — look under Team oversight.";
    case "team_oversight":
      return "Nobody you answer for has anything open right now.";
    case "all_organization":
      return "Antcolos watches loads, trucks, drivers and documents, and puts anything that needs a decision here.";
  }
}
