"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Filter chip. Touch-sized, keyboard operable, and states its own pressed-ness. */
export function Chip({
  label, selected, onToggle, count, className,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "inline-flex h-control-sm items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors",
        selected
          ? "border-primary bg-primary/12 text-primary"
          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
        className,
      )}
    >
      {selected ? <Check aria-hidden className="size-3.5" /> : null}
      {label}
      {count != null ? (
        <span className={cn("tnum text-[0.75rem]", selected ? "text-primary" : "text-fg-subtle")}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
