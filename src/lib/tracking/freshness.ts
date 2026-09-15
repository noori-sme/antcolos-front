import type { LocationSignal, TrackingSignalHealth } from "@/types";

/**
 * How well a truck is actually being tracked — which is a different question
 * from where it is.
 *
 * The distinction this module exists to keep is between "quiet" and "gone".
 * A feed that has said nothing for twenty minutes is fine; one that has said
 * nothing for six hours on a running load is a problem somebody has to chase;
 * one that was reporting every ten minutes and then stopped dead is a
 * different problem again, and is the one a broker will ring about.
 *
 * All four thresholds are stated here rather than scattered through the
 * service, so a screen and a test and an alert cannot disagree about when a
 * signal went stale.
 */

/** Minutes after which a position stops counting as live. */
export const LIVE_WINDOW_MINUTES = 45;
/** Minutes after which it is not merely late but off. */
export const OFFLINE_WINDOW_MINUTES = 240;
/**
 * A feed reporting at least this often, that then goes quiet for longer than
 * `INTERRUPTION_FACTOR` times its own cadence, is INTERRUPTED rather than
 * merely stale: it was working, and it stopped.
 */
export const ESTABLISHED_FEED_SIGNALS = 3;
export const INTERRUPTION_FACTOR = 4;

export interface FreshnessInput {
  /** Signals for this truck on this load, oldest first. */
  signals: readonly LocationSignal[];
  /** True when the load is running and a position is genuinely expected. */
  trackingExpected: boolean;
  /** Set when tracking is not possible or not permitted, with the reason. */
  unavailableReason?: string;
  now?: Date;
}

export interface FreshnessVerdict {
  health: TrackingSignalHealth;
  reason: string;
  lastUpdateAt?: string;
  ageMinutes?: number;
  /** The typical gap between reports, when there are enough to tell. */
  cadenceMinutes?: number;
}

const minutesBetween = (a: number, b: number) => Math.max(0, Math.round((a - b) / 60_000));

/**
 * The median gap between consecutive signals.
 *
 * Median rather than mean on purpose: one four-hour gap in an otherwise
 * ten-minute feed should not drag the cadence out to an hour and make the
 * feed's own outage look normal.
 */
function cadenceOf(signals: readonly LocationSignal[]): number | undefined {
  if (signals.length < ESTABLISHED_FEED_SIGNALS) return undefined;
  const gaps: number[] = [];
  for (let i = 1; i < signals.length; i += 1) {
    gaps.push(
      minutesBetween(Date.parse(signals[i].observedAt), Date.parse(signals[i - 1].observedAt)),
    );
  }
  if (gaps.length === 0) return undefined;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? Math.round((gaps[mid - 1] + gaps[mid]) / 2) : gaps[mid];
}

/**
 * Decide how healthy a truck's tracking is right now.
 *
 * Ordered so the most specific answer wins: an explicit "we may not track
 * this" beats everything, an established feed that stopped is reported as
 * interrupted rather than stale, and "nobody has ever reported" is never
 * dressed up as offline — it is its own sentence.
 */
export function assessFreshness(input: FreshnessInput): FreshnessVerdict {
  const now = input.now ?? new Date();
  const signals = [...input.signals].sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  if (input.unavailableReason) {
    return { health: "unavailable", reason: input.unavailableReason };
  }

  const latest = signals[signals.length - 1];
  if (!latest) {
    return {
      health: input.trackingExpected ? "offline" : "unavailable",
      reason: input.trackingExpected
        ? "No position has ever been reported for this truck on this load."
        : "Nothing is being tracked on this load yet.",
    };
  }

  const ageMinutes = minutesBetween(now.getTime(), Date.parse(latest.observedAt));
  const cadenceMinutes = cadenceOf(signals);
  const base = {
    lastUpdateAt: latest.observedAt,
    ageMinutes,
    cadenceMinutes,
  };

  if (!input.trackingExpected) {
    return {
      ...base,
      health: "unavailable",
      reason: "This load is not running, so no position is expected.",
    };
  }

  // An established feed that has gone quiet for several times its own rhythm
  // has been interrupted. Said before the plain staleness test, because it is
  // the more useful description of the same silence.
  if (
    cadenceMinutes != null
    && cadenceMinutes > 0
    && ageMinutes > Math.max(cadenceMinutes * INTERRUPTION_FACTOR, LIVE_WINDOW_MINUTES)
  ) {
    return {
      ...base,
      health: "interrupted",
      reason:
        `This feed was reporting about every ${cadenceMinutes} minutes and has said nothing for ${ageMinutes}. `
        + "It was working and it stopped.",
    };
  }

  if (ageMinutes > OFFLINE_WINDOW_MINUTES) {
    return {
      ...base,
      health: "offline",
      reason: `Nothing for ${formatAge(ageMinutes)}. Treat the feed as down rather than late.`,
    };
  }

  if (ageMinutes > LIVE_WINDOW_MINUTES) {
    return {
      ...base,
      health: "stale",
      reason: `Last position ${formatAge(ageMinutes)} ago, past the ${LIVE_WINDOW_MINUTES}-minute expectation.`,
    };
  }

  return {
    ...base,
    health: "live",
    reason: `Last position ${formatAge(ageMinutes)} ago.`,
  };
}

export function formatAge(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) {
    return rest === 0
      ? `${hours} hour${hours === 1 ? "" : "s"}`
      : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Whether a position may be leaned on for an availability conclusion.
 *
 * Deliberately stricter than "live". Deciding a truck is free is a bigger
 * claim than drawing a dot on a board, and a three-hour-old position is fine
 * for the second and not for the first.
 */
export const AVAILABILITY_TRUST_WINDOW_MINUTES = 90;

export function positionIsTrustworthy(signal: LocationSignal | undefined, now: Date = new Date()): boolean {
  if (!signal) return false;
  return minutesBetween(now.getTime(), Date.parse(signal.observedAt))
    <= AVAILABILITY_TRUST_WINDOW_MINUTES;
}
