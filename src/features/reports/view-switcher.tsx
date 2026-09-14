"use client";

import { AlignLeft, BarChart3, LineChart, Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportView } from "@/types";

const VIEW_META: Record<ReportView, { label: string; icon: LucideIcon; hint: string }> = {
  table: { label: "Table", icon: Table2, hint: "Every row and every column" },
  bar: { label: "Bar", icon: BarChart3, hint: "Compare rows against each other" },
  line: { label: "Line", icon: LineChart, hint: "Follow the numbers over time" },
  summary: { label: "Summary", icon: AlignLeft, hint: "The same numbers, written out" },
};

/**
 * Switches how a report is read. It changes nothing else: the filters, the
 * calculations, the permissions and the source records are identical in every
 * view, and only the views a report's data can honestly carry are offered.
 */
export function ViewSwitcher({
  views,
  value,
  onChange,
}: {
  views: ReportView[];
  value: ReportView;
  onChange: (view: ReportView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Report view"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-e1"
    >
      {views.map((view) => {
        const meta = VIEW_META[view];
        const Icon = meta.icon;
        const selected = view === value;
        return (
          <button
            key={view}
            role="tab"
            aria-selected={selected}
            title={meta.hint}
            onClick={() => onChange(view)}
            className={cn(
              "inline-flex h-control-sm items-center gap-1.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors",
              selected
                ? "bg-surface-hover text-fg ring-1 ring-border"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
