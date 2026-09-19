"use client";

import { Building2, Eye, UserCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUEUE_DESCRIPTION, QUEUE_LABEL } from "@/types";

/**
 * The three views, kept strictly apart.
 *
 * They are tabs rather than filters on purpose. A filter implies one list you
 * are narrowing; these are three different questions, and the whole point of
 * the responsibility layer is that the answers must not bleed into one another:
 *
 *   My Needs You      what stops unless YOU act.
 *   Team oversight    what people you answer for are holding. Watch it.
 *   All organization  everything, for when you choose to look.
 *
 * Order matters and is fixed. Personal first, because that is the list somebody
 * opens the app to work; organization-wide last, because it is an inspection
 * tool and not an attention queue.
 */

export type NeedsYouView = "my_needs_you" | "team_oversight" | "all_organization";

export const NEEDS_YOU_VIEW_ORDER: readonly NeedsYouView[] = [
  "my_needs_you", "team_oversight", "all_organization",
];

const ICON: Record<NeedsYouView, LucideIcon> = {
  my_needs_you: UserCheck,
  team_oversight: Eye,
  all_organization: Building2,
};

export function NeedsYouViewSwitcher({
  view, onChange, counts, available,
}: {
  view: NeedsYouView;
  onChange: (v: NeedsYouView) => void;
  counts: Record<NeedsYouView, number>;
  /** Views this membership may see. A driver gets only the first. */
  available: readonly NeedsYouView[];
}) {
  // One view and nothing to switch to: a driver, or a workspace of one. A tab
  // strip with a single tab is furniture, so it is absent rather than disabled.
  if (available.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Needs You views"
      className="flex flex-wrap gap-1 rounded-lg bg-surface-sunken p-1"
    >
      {NEEDS_YOU_VIEW_ORDER.filter((v) => available.includes(v)).map((v) => {
        const Icon = ICON[v];
        const selected = v === view;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={selected}
            title={QUEUE_DESCRIPTION[v]}
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex h-control items-center gap-2 rounded-md px-3 text-[0.8125rem] font-medium transition-colors",
              selected
                ? "bg-surface text-fg shadow-e1"
                : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {QUEUE_LABEL[v]}
            <span
              className={cn(
                "tnum text-[0.75rem]",
                selected ? "text-fg-muted" : "text-fg-subtle",
              )}
            >
              {counts[v]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
