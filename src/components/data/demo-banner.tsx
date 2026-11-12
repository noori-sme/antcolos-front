import { FlaskConical } from "lucide-react";

/**
 * Shown on every demo page (plan 10): the page runs on sample data from the
 * demo company, not on the organization's live data.
 */
export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demo data"
      className="mb-4 flex items-start gap-2.5 rounded-lg border border-st-warning/30 bg-st-warning-bg px-3.5 py-2.5 text-[0.8125rem] text-fg"
    >
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
      <p>
        <span className="font-semibold">Demo data.</span>{" "}
        <span className="text-fg-muted">
          This page shows sample data from a demo company. Changes aren&apos;t saved and reset
          when you refresh.
        </span>
      </p>
    </div>
  );
}
