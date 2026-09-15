"use client";

import { ArrowUpDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SORT_LABEL, SORT_ORDER, activeFilterTokens, defaultQuery,
  type NeedsYouQuery, type NeedsYouSort,
} from "./query";

/**
 * The collapsed top of Needs You.
 *
 * ★ WHAT IS ABOVE THE WORK, AND NOTHING ELSE ★
 * Six controls: the three views, a search box, a sort, and one Filters button
 * carrying the number of filters currently on. Everything the old bar showed —
 * severity, due time, status, responsibility and every work-type chip — is in
 * the panel behind that button, grouped and counted.
 *
 * The rule this encodes: a person opens Needs You to find out what needs them.
 * The page should answer that before it offers to narrow it.
 */

/** How many filters are named in the summary before it collapses to "+N more". */
const SUMMARY_LIMIT = 3;

export function NeedsYouToolbar({
  query, onChange, onOpenFilters, views, filtersButtonRef,
}: {
  query: NeedsYouQuery;
  onChange: (next: NeedsYouQuery) => void;
  onOpenFilters: () => void;
  /** The three-view switcher, passed in so this file owns no routing rules. */
  views?: React.ReactNode;
  /** So the panel can put focus back where the keyboard left it. */
  filtersButtonRef?: React.Ref<HTMLButtonElement>;
}) {
  const sortId = useId();
  const tokens = activeFilterTokens(query);

  return (
    <div className="space-y-2.5">
      {/*
        Two short rows rather than one long one, at every width.

        Which queue you are in is the first question and gets its own line; the
        rest — find, order, narrow — is the second. Letting them share a row
        means the sort and the Filters button wrap somewhere different on every
        screen size, which is how a "compact" header stops being predictable.
      */}
      {views}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            type="search"
            value={query.filters.search ?? ""}
            onChange={(e) =>
              onChange({
                ...query,
                filters: { ...query.filters, search: e.target.value || undefined },
              })
            }
            placeholder="Search items, loads, trucks…"
            aria-label="Search Needs You"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <ArrowUpDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
            />
            <label htmlFor={sortId} className="sr-only">
              Sort this queue
            </label>
            <select
              id={sortId}
              value={query.sort}
              onChange={(e) =>
                onChange({ ...query, sort: e.target.value as NeedsYouSort })
              }
              className="h-control appearance-none rounded-md border border-border bg-surface pr-3 pl-8 text-[0.8125rem] font-medium text-fg"
            >
              {SORT_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <Button
            ref={filtersButtonRef}
            variant={tokens.length > 0 ? "primary" : "secondary"}
            onClick={onOpenFilters}
            aria-label={
              tokens.length > 0
                ? `Filters, ${tokens.length} active`
                : "Filters"
            }
          >
            <SlidersHorizontal aria-hidden />
            Filters
            {tokens.length > 0 ? (
              <span
                className={cn(
                  "tnum rounded-full px-1.5 text-[0.75rem]",
                  "bg-primary-fg/20 text-primary-fg",
                )}
              >
                {tokens.length}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      <ActiveFilterSummary
        query={query}
        onChange={onChange}
        onOpenFilters={onOpenFilters}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The summary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What is currently narrowed, and nothing about what is not.
 *
 * Reads `Critical · Today · Compliance · +2 more · Clear`. The inactive options
 * are not here — they are in the panel, which is where somebody goes to turn
 * one on. A summary that redisplays every unselected filter is the row of chips
 * this redesign removed, wearing a different name.
 */
function ActiveFilterSummary({
  query, onChange, onOpenFilters,
}: {
  query: NeedsYouQuery;
  onChange: (next: NeedsYouQuery) => void;
  onOpenFilters: () => void;
}) {
  const tokens = activeFilterTokens(query);
  if (tokens.length === 0) return null;

  const shown = tokens.slice(0, SUMMARY_LIMIT);
  const hidden = tokens.length - shown.length;

  return (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
      aria-label="Active filters"
    >
      <span className="text-[0.75rem] text-fg-subtle">Filtered to</span>
      {shown.map((token) => (
        <button
          key={token.key}
          type="button"
          onClick={() => onChange(token.remove)}
          aria-label={`Remove filter ${token.label}`}
          className="inline-flex h-control-sm max-w-[14rem] items-center gap-1 rounded-full border border-primary bg-primary/12 px-2.5 text-[0.75rem] font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <span className="truncate">{token.label}</span>
          <X aria-hidden className="size-3" />
        </button>
      ))}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={onOpenFilters}
          className="h-control-sm rounded-full px-2 text-[0.75rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          +{hidden} more
        </button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ ...defaultQuery(), sort: query.sort })}
      >
        Clear
      </Button>
    </div>
  );
}
