"use client";

import { Landmark } from "lucide-react";
import {
  FACTORING_FILTER_LABEL, FACTORING_FILTER_ORDER, type FactoringFilterKey,
} from "@/types";
import { InfoTip } from "@/features/mt-loop/tip";

/**
 * The Load Search factoring filter, for the carrier currently being worked.
 *
 * ★ SEVEN OPTIONS, AND "SHOW ALL" IS THE DEFAULT ★
 * Defaulting to "Approved only" would quietly delete most of the market from a
 * dispatcher's screen on the first day, before anybody has checked anything —
 * and they would conclude there was no freight rather than that nobody had
 * looked. So the filter starts open, and narrowing is a deliberate act.
 *
 * ★ AND IT IS SCOPED TO ONE CARRIER ★
 * Each row's factoring answer belongs to the carrier the TRUCK runs under. A
 * dispatch workspace with two carriers' trucks on one board filters each row
 * against its own carrier's factor, because there is no single answer to filter
 * against.
 */
export function FactoringFilter({
  value, onChange, counts, carrierName, className,
}: {
  value: FactoringFilterKey;
  onChange: (next: FactoringFilterKey) => void;
  /** How many rows each option would leave. Shown so nothing hides silently. */
  counts?: Partial<Record<FactoringFilterKey, number>>;
  /** Named so a dispatcher covering two carriers knows whose factor this is. */
  carrierName?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor="factoring-filter"
        className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase"
      >
        <Landmark className="size-3" aria-hidden />
        Factoring
        <InfoTip
          text={
            carrierName
              ? `Whether ${carrierName}'s factor will fund the invoice on each broker. Another carrier's factor gives different answers.`
              : "Whether the carrier's factor will fund the invoice on each broker."
          }
        />
      </label>
      <select
        id="factoring-filter"
        data-testid="factoring-filter"
        value={value}
        onChange={(e) => onChange(e.target.value as FactoringFilterKey)}
        className="mt-1 h-control-sm w-full rounded-md border border-border bg-surface px-2.5 text-[0.8125rem] text-fg"
      >
        {FACTORING_FILTER_ORDER.map((key) => (
          <option key={key} value={key}>
            {FACTORING_FILTER_LABEL[key]}
            {counts?.[key] !== undefined ? ` (${counts[key]})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
