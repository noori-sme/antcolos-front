import { Card, CardContent } from "@/components/ui/card";
import {
  formatCompactUsd, formatCount, formatUsd, laneLabelOf,
} from "@/lib/profile/metrics";
import { cn } from "@/lib/utils";
import { CAPACITY_LABEL, type CapacityMetrics, type LaneMetric } from "@/types";

/**
 * One figure, and what it is.
 *
 * `tnum` matters more here than it looks: a grid of tabular figures that
 * reflows as the numbers change is a grid people stop trusting.
 */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</p>
      <p className="tnum mt-1 text-[1.375rem] leading-7 font-semibold tracking-[-0.015em] text-fg">
        {value}
      </p>
      {note ? <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{note}</p> : null}
    </div>
  );
}

/** "Not enough work yet" is a different statement from a zero, and reads as one. */
const NOT_YET = "—";

function LaneRows({ lanes }: { lanes: LaneMetric[] }) {
  if (lanes.length === 0) return null;
  return (
    <div className="border-t border-border px-4 py-3">
      <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">Top lanes</p>
      <ul className="mt-2 space-y-1.5">
        {lanes.map((lane) => (
          <li
            key={`${lane.origin}-${lane.destination}`}
            className="flex items-baseline justify-between gap-3 text-[0.8125rem]"
          >
            <span className="min-w-0 truncate text-fg">{laneLabelOf(lane)}</span>
            <span className="tnum shrink-0 text-fg-muted">
              {formatCount(lane.loads)} loads
              {lane.averageRateCents > 0 ? ` · ${formatUsd(lane.averageRateCents)} avg` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The operational scoreboard, one grid per capacity somebody has worked in.
 *
 * Every figure here is folded from the contribution ledger on read — nothing
 * on this screen is a stored total. That is why a profile can show a number a
 * former employer would rather it did not: the work happened, the rows say so,
 * and no organization owns the sum.
 */
export function MetricsGrid({ metrics }: { metrics: CapacityMetrics[] }) {
  return (
    <div className="space-y-4">
      {metrics.map((capacity) => (
        <Card key={capacity.capacity} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="text-[0.8125rem] font-semibold text-fg">
              {CAPACITY_LABEL[capacity.capacity]}
            </h3>
            <span className="text-[0.75rem] text-fg-subtle">Across every company</span>
          </div>

          {capacity.capacity === "dispatcher" ? (
            <div className={cn("grid grid-cols-2 divide-x divide-y divide-border", "sm:grid-cols-3 sm:divide-y-0")}>
              <Stat label="Loads dispatched" value={formatCount(capacity.loadsDispatched)} />
              <Stat label="Freight booked" value={formatCompactUsd(capacity.grossRevenueBookedCents)} />
              <Stat
                label="Average rate"
                value={capacity.averageLoadRateCents > 0 ? formatUsd(capacity.averageLoadRateCents) : NOT_YET}
                note={capacity.averageLoadRateCents > 0 ? "Per load, all lanes" : undefined}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
              <Stat label="Loads delivered" value={formatCount(capacity.loadsDelivered)} />
              <Stat label="Miles driven" value={formatCount(capacity.milesDriven)} />
              <Stat
                label="On time"
                value={capacity.onTimePercentage === null ? NOT_YET : `${capacity.onTimePercentage}%`}
              />
              <Stat
                label="Safety score"
                value={capacity.safetyScore === null ? NOT_YET : `${capacity.safetyScore}`}
                note={capacity.cleanInspections > 0 ? `${capacity.cleanInspections} clean inspections` : undefined}
              />
            </div>
          )}

          <LaneRows lanes={capacity.topLanes} />
        </Card>
      ))}

      {metrics.length === 0 ? (
        <Card>
          <CardContent className="pt-5">
            <p className="text-[0.8125rem] text-fg-muted">
              No dispatched or delivered loads on this profile yet. Figures appear here as soon
              as work is recorded — nothing is typed in by hand.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The safety score, explained where it is shown.
 *
 * A derived number a person cannot reconstruct is a number they cannot
 * dispute, so the formula goes on the page rather than in a support article.
 */
export const SAFETY_SCORE_NOTE =
  "Safety score starts at 100, loses 8 for each recorded safety event and gains 2 for each "
  + "clean inspection, capped at 100. It is Antcolos's own summary of what carriers recorded "
  + "here — it is not a CSA or SMS score and has no regulatory meaning.";
