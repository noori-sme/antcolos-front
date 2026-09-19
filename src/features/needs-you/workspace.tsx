"use client";

import { Inbox } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { canAll } from "@/lib/permissions/can";
import { usePermissions, useActiveMembership } from "@/lib/session/hooks";
import { cn, isOverdue, useNow } from "@/lib/utils";
import type { NeedsYouItem } from "@/types";
import { NeedsYouDrawer } from "./detail-drawer";
import { NeedsYouToolbar } from "./filter-bar";
import { NeedsYouFilterPanel } from "./filter-panel";
import { useAttentionViews, useRoutedHolders } from "@/features/responsibility/hooks";
import {
  activeFilterCount, defaultQuery, sortItems, type NeedsYouQuery,
} from "./query";
import {
  NEEDS_YOU_VIEW_ORDER, NeedsYouViewSwitcher, type NeedsYouView,
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
  // Which row is mid-decision. Per item rather than one page-wide flag, so
  // pressing one option does not freeze every other row's buttons.
  const [deciding, setDeciding] = useState<string | null>(null);
  /**
   * Rows somebody has just decided, held in place.
   *
   * Deciding resolves an item, and the default queue is open work — so without
   * this the row a person just pressed disappears under their hand and the only
   * evidence the system carried on is a number in the header dropping by one.
   * Holding it shows the result where the press happened. The hold is for this
   * screen only: it is dropped the moment the view or the filters change, and
   * it survives no reload, because the queue is the record and this is not.
   */
  const [decided, setDecided] = useState<{ item: NeedsYouItem; index: number }[]>([]);
  const [view, setView] = useState<NeedsYouView>("my_needs_you");
  const { isDriverMembership, membership } = useActiveMembership();
  const permissions = usePermissions();
  const now = useNow();

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
  const open = inView.filter((i) => i.status === "open" || i.status === "escalated");
  const counts = {
    open: open.length,
    critical: open.filter((i) => i.severity === "critical").length,
    overdue: open.filter((i) => i.dueAt && now !== null && isOverdue(i.dueAt, now)).length,
    // The headline claim of the whole surface, stated as a number: how many of
    // these the system carried to the point of a single press.
    ready: open.filter((i) => i.automation?.stage === "awaiting_decision").length,
  };

  const narrowed = activeFilterCount(query) > 0;

  /** Changing what is on screen drops the held rows: they belong to the old list. */
  const changeQuery = (next: NeedsYouQuery) => {
    setDecided([]);
    setQuery(next);
  };
  const changeView = (next: NeedsYouView) => {
    setDecided([]);
    setView(next);
  };

  /**
   * The list actually rendered: the queue, with the just-decided rows put back
   * where they were pressed.
   */
  const display = useMemo(() => {
    if (decided.length === 0) return items;
    const out = items.filter((i) => !decided.some((d) => d.item.id === i.id));
    for (const { item, index } of decided) {
      out.splice(Math.min(index, out.length), 0, item);
    }
    return out;
  }, [items, decided]);

  /** One press. The service runs everything downstream of it. */
  const decide = (item: NeedsYouItem, optionId: string) => {
    const index = items.findIndex((i) => i.id === item.id);
    setDeciding(item.id);
    action.mutate(
      { id: item.id, action: { kind: "decide", input: { optionId } } },
      {
        onSettled: () => setDeciding(null),
        onSuccess: (next) => {
          setDecided((held) => [
            ...held.filter((d) => d.item.id !== next.id),
            { item: next, index: Math.max(index, 0) },
          ]);
          if (selected?.id === item.id) setSelected(next);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Needs You"
        actions={
          <StatStrip
            counts={counts}
            scoped={membership?.scope.loads === "assigned"}
            driver={isDriverMembership}
          />
        }
      />

      {/*
        The whole top of the page: three views, a search box, a sort and one
        Filters button. Everything else is behind that button.
      */}
      <NeedsYouToolbar
        query={query}
        onChange={changeQuery}
        onOpenFilters={() => setFiltersOpen(true)}
        filtersButtonRef={filtersButton}
        views={
          <NeedsYouViewSwitcher
            view={activeView}
            onChange={changeView}
            counts={viewCounts}
            available={availableViews}
          />
        }
      />

      <NeedsYouFilterPanel
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        query={query}
        onChange={changeQuery}
        // Counted over the view on screen, unfiltered, so the numbers beside
        // each option hold still while you tick them.
        items={inView}
        resultCount={items.length}
        returnFocusTo={filtersButton}
      />

      {action.isError ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}

      {list.isPending ? (
        <LoadingSkeleton rows={5} />
      ) : list.isError ? (
        <ErrorState
          title="Could not load your queue"
          description={list.error.message}
          onRetry={() => list.refetch()}
        />
      ) : display.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            inView.length === 0 && !narrowed
              ? emptyTitle(activeView)
              : "Nothing matches these filters"
          }
          description={
            inView.length === 0 && !narrowed ? emptyDescription(activeView) : undefined
          }
        />
      ) : (
        <ul aria-label="Needs You queue" className="space-y-2">
          {display.map((item) => (
            <li key={item.id}>
              <NeedsYouCard
                item={item}
                selected={item.id === selected?.id}
                assigneeName={memberName(item)}
                onOpen={() => setSelected(item)}
                onDecide={(optionId) => decide(item, optionId)}
                pending={deciding === item.id}
                mayAct={canAll(permissions, item.recommendedAction.requires)}
              />
            </li>
          ))}
        </ul>
      )}

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

/* -------------------------------------------------------------------------- */
/* The header numbers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The state of the queue in four numbers, and no sentence.
 *
 * `Ready` is the one that matters and is deliberately first among the neutral
 * pair: it counts the items the system carried all the way to a single press.
 * A queue where that number equals the open count is a queue that can be
 * cleared without opening anything.
 */
function StatStrip({
  counts, scoped, driver,
}: {
  counts: { open: number; critical: number; overdue: number; ready: number };
  /** This membership only sees its own loads. Said once, as a mark. */
  scoped?: boolean;
  driver?: boolean;
}) {
  const stats: { label: string; value: number; tone: string }[] = [
    { label: "Open", value: counts.open, tone: "text-fg" },
    { label: "1-click", value: counts.ready, tone: "text-st-progress" },
    { label: "Overdue", value: counts.overdue, tone: "text-st-danger" },
    { label: "Critical", value: counts.critical, tone: "text-st-danger" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {stats
        .filter((s) => s.value > 0 || s.label === "Open")
        .map((s) => (
          <span key={s.label} className="flex items-baseline gap-1">
            <span className={cn("tnum text-[0.9375rem] font-semibold", s.tone)}>
              {s.value}
            </span>
            <span className="text-[0.6875rem] tracking-wide text-fg-subtle uppercase">
              {s.label}
            </span>
          </span>
        ))}
      {scoped || driver ? (
        <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] text-fg-muted">
          {driver ? "Your loads" : "Assigned loads only"}
        </span>
      ) : null}
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
    case "my_needs_you": return "Nothing needs you";
    case "team_oversight": return "Your team is holding nothing";
    case "all_organization": return "No open work";
  }
}

function emptyDescription(view: NeedsYouView): string | undefined {
  switch (view) {
    case "my_needs_you": return "Everything else is being handled.";
    case "team_oversight": return undefined;
    case "all_organization": return undefined;
  }
}
