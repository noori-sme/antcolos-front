import {
  ASSIGNMENT_STATE_LABEL, SEVERITY_LABEL, CATEGORY_LABEL,
  type AssignmentState, type NeedsYouCategory, type NeedsYouFilters,
  type NeedsYouItem, type NeedsYouSeverity, type NeedsYouStatus,
} from "@/types";

/**
 * Everything the Needs You page is currently asking for, in one value.
 *
 * Kept out of the components on purpose. The toolbar, the Filters panel and the
 * active-filter summary all need to agree about what "active" means and what
 * "clear this one" does, and three components each deciding for themselves is
 * how a summary starts disagreeing with the panel behind it. These functions
 * are pure, so the agreement is testable without a browser.
 */

export type NeedsYouSort = "urgency" | "due" | "newest";

export const SORT_LABEL: Record<NeedsYouSort, string> = {
  urgency: "Most urgent",
  due: "Due soonest",
  newest: "Newest first",
};

export const SORT_ORDER: readonly NeedsYouSort[] = ["urgency", "due", "newest"];

/**
 * Open work is `open` AND `escalated`.
 *
 * Escalating something raises it; it does not close it. A default of `open`
 * alone would hide exactly the work this whole module exists to surface, so
 * "Open" means both — and the Status group says so rather than leaving somebody
 * to work out why two boxes are ticked.
 */
export const OPEN_STATUSES: readonly NeedsYouStatus[] = ["open", "escalated"];

export const STATUS_LABEL: Record<NeedsYouStatus, string> = {
  open: "Open", escalated: "Escalated", snoozed: "Snoozed", resolved: "Resolved",
};

export const SEVERITIES: readonly NeedsYouSeverity[] = [
  "critical", "high", "medium", "low",
];

export const STATUSES: readonly NeedsYouStatus[] = [
  "open", "escalated", "snoozed", "resolved",
];

export const DUE_WINDOWS: readonly { label: string; hours: number }[] = [
  { label: "Next 2h", hours: 2 },
  { label: "Next 8h", hours: 8 },
  { label: "Today", hours: 24 },
];

/**
 * How the responsibility layer placed the work, offered as a filter.
 *
 * ★ NO "UNASSIGNED" ★
 * The old bar had one chip called Unassigned covering two unrelated situations:
 * work sitting with the Owner because nobody else qualified, and work nobody in
 * the workspace can do at all. The first has an owner, an accountable
 * membership and a timeline. These are the states the responsibility layer
 * actually records, so the filter can name each one correctly.
 */
export const ASSIGNMENT_STATES: readonly AssignmentState[] = [
  "manual", "routed", "delegated", "owner_fallback", "needs_assignment",
];

export interface NeedsYouQuery {
  /** Passed to the service unchanged. */
  filters: NeedsYouFilters;
  /** Applied on the client against the responsibility board. Empty = any. */
  assignment: AssignmentState[];
  sort: NeedsYouSort;
}

/**
 * ★ THE DEFAULT PAGE STATE: My Needs You + Open. ★
 *
 * The view is the caller's (`my_needs_you`); this is the rest of it. Anything
 * matching this exactly counts as no filters at all, which is what lets the
 * Filters button read "Filters" with no number on a fresh page load.
 */
export const DEFAULT_NEEDS_YOU_QUERY: NeedsYouQuery = {
  filters: { status: [...OPEN_STATUSES], owner: "all" },
  assignment: [],
  sort: "urgency",
};

export function defaultQuery(): NeedsYouQuery {
  return {
    filters: { status: [...OPEN_STATUSES], owner: "all" },
    assignment: [],
    sort: "urgency",
  };
}

function sameSet<T>(a: readonly T[] | undefined, b: readonly T[]): boolean {
  const left = a ?? [];
  if (left.length !== b.length) return false;
  return left.every((v) => b.includes(v));
}

/** True when the status selection is the page's own default, not a choice. */
export function statusIsDefault(status: readonly NeedsYouStatus[] | undefined): boolean {
  return sameSet(status, OPEN_STATUSES);
}

/* -------------------------------------------------------------------------- */
/* The active-filter summary                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One thing the user has narrowed to, and the query with it undone.
 *
 * `remove` is a whole query rather than a mutation so the summary can be
 * rendered from nothing but this list, and so removing one token can never
 * disturb another.
 */
export interface FilterToken {
  key: string;
  label: string;
  remove: NeedsYouQuery;
}

function dueLabel(hours: number): string {
  return DUE_WINDOWS.find((w) => w.hours === hours)?.label ?? `Within ${hours}h`;
}

/**
 * Everything that differs from the default, in the order a person would say it.
 *
 * Severity first because it is what people filter by most, then time, then the
 * rest. Sorting is not a token: it changes the order, never the contents, and a
 * summary that claims a filter is on when nothing is hidden is a lie.
 */
export function activeFilterTokens(query: NeedsYouQuery): FilterToken[] {
  const { filters } = query;
  const tokens: FilterToken[] = [];
  const withFilters = (patch: Partial<NeedsYouFilters>): NeedsYouQuery => ({
    ...query, filters: { ...filters, ...patch },
  });

  for (const s of filters.severity ?? []) {
    tokens.push({
      key: `severity:${s}`,
      label: SEVERITY_LABEL[s],
      remove: withFilters({
        severity: dropFrom(filters.severity, s),
      }),
    });
  }

  if (filters.dueWithinHours != null) {
    tokens.push({
      key: "due",
      label: dueLabel(filters.dueWithinHours),
      remove: withFilters({ dueWithinHours: undefined }),
    });
  }

  if (!statusIsDefault(filters.status)) {
    for (const s of filters.status ?? []) {
      tokens.push({
        key: `status:${s}`,
        label: STATUS_LABEL[s],
        remove: withFilters({ status: dropFrom(filters.status, s) }),
      });
    }
    // Every status cleared is itself a departure from the default, and without
    // a token there would be nothing on screen to put it back.
    if ((filters.status?.length ?? 0) === 0) {
      tokens.push({
        key: "status:any",
        label: "Any status",
        remove: withFilters({ status: [...OPEN_STATUSES] }),
      });
    }
  }

  if (filters.owner === "me") {
    tokens.push({
      key: "owner:me",
      label: "Assigned to me",
      remove: withFilters({ owner: "all" }),
    });
  } else if (filters.owner === "unassigned") {
    // Not reachable from the redesigned panel — see ASSIGNMENT_STATES — but a
    // deep link or an older saved state can still carry it, and a filter with
    // no way to clear it would strand the queue.
    tokens.push({
      key: "owner:unassigned",
      label: "No assignee",
      remove: withFilters({ owner: "all" }),
    });
  }

  for (const state of query.assignment) {
    tokens.push({
      key: `assignment:${state}`,
      label: ASSIGNMENT_STATE_LABEL[state],
      remove: { ...query, assignment: query.assignment.filter((v) => v !== state) },
    });
  }

  for (const c of filters.category ?? []) {
    tokens.push({
      key: `category:${c}`,
      label: CATEGORY_LABEL[c],
      remove: withFilters({ category: dropFrom(filters.category, c) }),
    });
  }

  for (const k of filters.entityKind ?? []) {
    tokens.push({
      key: `entity:${k}`,
      label: k.replace(/_/g, " "),
      remove: withFilters({ entityKind: dropFrom(filters.entityKind, k) }),
    });
  }

  if (filters.search) {
    tokens.push({
      key: "search",
      label: `“${filters.search}”`,
      remove: withFilters({ search: undefined }),
    });
  }

  return tokens;
}

/** What the Filters button counts. Zero on a fresh page. */
export function activeFilterCount(query: NeedsYouQuery): number {
  return activeFilterTokens(query).length;
}

function dropFrom<T>(list: T[] | undefined, value: T): T[] | undefined {
  const next = (list ?? []).filter((v) => v !== value);
  return next.length > 0 ? next : undefined;
}

export function toggleIn<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  return current.includes(value)
    ? dropFrom(current, value)
    : [...current, value];
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Reorder, never re-rank.
 *
 * "Most urgent" returns the list untouched, because the service already sorted
 * it by the one urgency rule this product has (severity absolutely first, due
 * time breaking ties inside a band). Re-implementing that rule here to get the
 * same answer would give the app two of them, and two ranking rules disagree
 * the moment one is edited.
 */
export function sortItems(
  items: readonly NeedsYouItem[], sort: NeedsYouSort,
): NeedsYouItem[] {
  const NO_DEADLINE = Number.POSITIVE_INFINITY;
  switch (sort) {
    case "urgency":
      return [...items];
    case "due":
      return [...items].sort(
        (a, b) =>
          (a.dueAt ? new Date(a.dueAt).getTime() : NO_DEADLINE) -
          (b.dueAt ? new Date(b.dueAt).getTime() : NO_DEADLINE),
      );
    case "newest":
      return [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }
}

/** Work-type counts over the set on screen, for the panel's group totals. */
export function categoryCounts(
  items: readonly NeedsYouItem[],
): Map<NeedsYouCategory, number> {
  const out = new Map<NeedsYouCategory, number>();
  for (const item of items) out.set(item.category, (out.get(item.category) ?? 0) + 1);
  return out;
}
