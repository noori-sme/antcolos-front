"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetCloseButton, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ASSIGNMENT_STATE_DESCRIPTION, ASSIGNMENT_STATE_LABEL, CATEGORY_LABEL, SEVERITY_LABEL,
  type NeedsYouCategory, type NeedsYouItem,
} from "@/types";
import {
  ASSIGNMENT_STATES, DUE_WINDOWS, SEVERITIES, STATUSES, STATUS_LABEL,
  activeFilterCount, categoryCounts, defaultQuery, statusIsDefault, toggleIn,
  type NeedsYouQuery,
} from "./query";
import { groupWorkTypes } from "./work-types";

/**
 * Every secondary filter, behind one button.
 *
 * ★ WHY A PANEL AND NOT A ROW OF CHIPS ★
 * The old bar put search, responsibility, severity, time, status and more than
 * thirty work-type chips above the queue. A person opening Needs You to find
 * out what needs them read roughly sixty controls before reaching the first
 * item. The filtering power was right; its place in the hierarchy was wrong.
 * None of it is gone — all of it is one press away, grouped, counted, and
 * closed by default.
 *
 * The surface is the app's existing `Sheet`, which is already a right-hand
 * panel from `sm:` up and a bottom sheet on phones, so this gets the correct
 * behaviour on both without a second responsive implementation.
 */

/* -------------------------------------------------------------------------- */
/* One collapsible group                                                       */
/* -------------------------------------------------------------------------- */

function Group({
  title, hint, count, defaultOpen, children,
}: {
  title: string;
  hint?: string;
  /** Selections inside this group, shown on the header so a closed group still reports. */
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || count > 0);
  const id = useId();

  return (
    <section className="border-b border-border last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 py-3 text-left text-[0.875rem] font-medium text-fg"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-fg-subtle transition-transform",
              open ? "" : "-rotate-90",
            )}
          />
          <span className="flex-1">{title}</span>
          {count > 0 ? (
            <span className="tnum rounded-full bg-primary/12 px-2 py-0.5 text-[0.75rem] font-medium text-primary">
              {count}
            </span>
          ) : null}
        </button>
      </h3>
      <div id={id} hidden={!open} className="pb-4">
        {hint ? <p className="mb-2.5 text-[0.75rem] text-fg-subtle">{hint}</p> : null}
        {children}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Work type                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Seventy-eight work types, grouped by the module that raises them.
 *
 * Only the types the current view actually contains are offered — filtering to
 * something that cannot be there is a dead end — plus anything already
 * selected, so a selection is never left with no way to clear it.
 */
function WorkTypeGroups({
  items, selected, onToggle,
}: {
  items: readonly NeedsYouItem[];
  selected: readonly NeedsYouCategory[];
  onToggle: (c: NeedsYouCategory) => void;
}) {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => categoryCounts(items), [items]);
  const groups = useMemo(
    () => groupWorkTypes({ counts, selected, query }),
    [counts, selected, query],
  );
  const searchId = useId();

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a work type…"
          aria-label="Find a work type"
          className="pl-9"
        />
      </div>

      {groups.length === 0 ? (
        <p className="py-2 text-[0.8125rem] text-fg-subtle">
          No work type here matches “{query}”.
        </p>
      ) : (
        groups.map((group) => {
          const picked = group.categories.filter((c) => selected.includes(c)).length;
          return (
            <WorkTypeModule
              key={group.module}
              label={group.label}
              count={group.count}
              picked={picked}
              /* A search narrows to what somebody is looking for, so opening the
                 remaining groups is the answer rather than another press. */
              defaultOpen={query.trim().length > 0 || picked > 0}
            >
              <div className="flex flex-wrap gap-1.5 pt-1 pb-2">
                {group.categories.map((c) => (
                  <Chip
                    key={c}
                    label={CATEGORY_LABEL[c]}
                    count={counts.get(c) ?? 0}
                    selected={selected.includes(c)}
                    onToggle={() => onToggle(c)}
                  />
                ))}
              </div>
            </WorkTypeModule>
          );
        })
      )}
    </div>
  );
}

function WorkTypeModule({
  label, count, picked, defaultOpen, children,
}: {
  label: string;
  count: number;
  picked: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] font-medium text-fg"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-fg-subtle transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <span className="flex-1">{label}</span>
        {picked > 0 ? (
          <span className="tnum text-[0.75rem] font-medium text-primary">{picked}</span>
        ) : (
          <span className="tnum text-[0.75rem] text-fg-subtle">{count}</span>
        )}
      </button>
      <div id={id} hidden={!open} className="px-3">
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

export function NeedsYouFilterPanel({
  open, onOpenChange, query, onChange, items, resultCount, returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  query: NeedsYouQuery;
  onChange: (next: NeedsYouQuery) => void;
  /** The current view, unfiltered. Counts come from here so they hold still. */
  items: readonly NeedsYouItem[];
  /** What the queue would show if the panel closed now. */
  resultCount: number;
  /**
   * The button that opened this, so focus can go back to it.
   *
   * The panel is controlled from the page rather than by a `SheetTrigger`, so
   * Radix has no trigger to restore focus to and a keyboard user who pressed
   * Escape would be dropped on `document.body` — able to see the button and
   * unable to reach it without tabbing the whole page again.
   */
  returnFocusTo?: React.RefObject<HTMLButtonElement | null>;
}) {
  const { filters } = query;
  const setFilters = (patch: Partial<typeof filters>) =>
    onChange({ ...query, filters: { ...filters, ...patch } });

  const severityCount = (s: (typeof SEVERITIES)[number]) =>
    items.filter((i) => i.severity === s).length;

  const active = activeFilterCount(query);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="Filters"
        description="Narrow this queue by status, severity, due time, responsibility and work type."
        onCloseAutoFocus={(e) => {
          if (!returnFocusTo?.current) return;
          e.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <p className="text-[0.9375rem] font-semibold text-fg">Filters</p>
            <p className="text-[0.75rem] text-fg-subtle">
              {resultCount} {resultCount === 1 ? "item" : "items"} match
            </p>
          </div>
          <SheetCloseButton />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <Group
            title="Status"
            hint="Escalated work is still open — it has been raised, not closed."
            // The default (Open + Escalated) is not a narrowing, so it is not
            // badged. "Active" has to mean the same thing in the group header,
            // on the Filters button and in the summary, or the three disagree.
            count={statusIsDefault(filters.status) ? 0 : (filters.status?.length ?? 0)}
            defaultOpen
          >
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={STATUS_LABEL[s]}
                  selected={filters.status?.includes(s) ?? false}
                  onToggle={() => setFilters({ status: toggleIn(filters.status, s) })}
                />
              ))}
            </div>
          </Group>

          <Group title="Severity" count={filters.severity?.length ?? 0} defaultOpen>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITIES.map((s) => (
                <Chip
                  key={s}
                  label={SEVERITY_LABEL[s]}
                  count={severityCount(s)}
                  selected={filters.severity?.includes(s) ?? false}
                  onToggle={() => setFilters({ severity: toggleIn(filters.severity, s) })}
                />
              ))}
            </div>
          </Group>

          <Group
            title="Due time"
            count={filters.dueWithinHours != null ? 1 : 0}
            defaultOpen
          >
            <div className="flex flex-wrap gap-1.5">
              {DUE_WINDOWS.map((w) => (
                <Chip
                  key={w.hours}
                  label={w.label}
                  selected={filters.dueWithinHours === w.hours}
                  onToggle={() =>
                    setFilters({
                      dueWithinHours:
                        filters.dueWithinHours === w.hours ? undefined : w.hours,
                    })
                  }
                />
              ))}
            </div>
          </Group>

          {/*
            ★ RESPONSIBILITY, NOT "UNASSIGNED" ★
            Two separate questions, because they are two separate questions: who
            explicitly holds it, and how it came to be theirs. The second is
            where Owner fallback and Needs assignment live — the two things the
            old single "Unassigned" chip was conflating.
          */}
          <Group
            title="Responsibility"
            count={
              (filters.owner === "me" ? 1 : 0) + query.assignment.length
            }
            defaultOpen={false}
          >
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[0.75rem] font-medium text-fg-muted">
                  Assigned to
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip
                    label="Anyone"
                    selected={(filters.owner ?? "all") === "all"}
                    onToggle={() => setFilters({ owner: "all" })}
                  />
                  <Chip
                    label="Assigned to me"
                    selected={filters.owner === "me"}
                    onToggle={() =>
                      setFilters({ owner: filters.owner === "me" ? "all" : "me" })
                    }
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[0.75rem] font-medium text-fg-muted">
                  How it got there
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {ASSIGNMENT_STATES.map((state) => (
                    <Chip
                      key={state}
                      label={ASSIGNMENT_STATE_LABEL[state]}
                      selected={query.assignment.includes(state)}
                      onToggle={() =>
                        onChange({
                          ...query,
                          assignment: query.assignment.includes(state)
                            ? query.assignment.filter((v) => v !== state)
                            : [...query.assignment, state],
                        })
                      }
                    />
                  ))}
                </div>
                <p className="mt-2 text-[0.75rem] text-fg-subtle">
                  {ASSIGNMENT_STATE_DESCRIPTION.owner_fallback}
                </p>
              </div>
            </div>
          </Group>

          <Group
            title="Work type"
            count={filters.category?.length ?? 0}
            defaultOpen={false}
          >
            <WorkTypeGroups
              items={items}
              selected={filters.category ?? []}
              onToggle={(c) => setFilters({ category: toggleIn(filters.category, c) })}
            />
          </Group>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={active === 0}
            onClick={() => onChange({ ...defaultQuery(), sort: query.sort })}
          >
            <X aria-hidden />
            Clear all
          </Button>
          <SheetClose asChild>
            <Button variant="primary" size="sm">
              Show {resultCount} {resultCount === 1 ? "item" : "items"}
            </Button>
          </SheetClose>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
