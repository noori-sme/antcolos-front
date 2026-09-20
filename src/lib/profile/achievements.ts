import type {
  Achievement, AchievementDefinition, ContributionKind, ProfileCapacity,
  ProfileContribution,
} from "@/types";
import { driverMetrics } from "./metrics";

/**
 * ★ THE BADGE CATALOGUE, AND WHAT IT REFUSES TO INVENT ★
 *
 * Every badge below is DERIVED. Running this function over a person's own
 * contribution rows produces the same set every time, on every device, with no
 * job queue, no nightly sweep and no stored `badges` table to drift out of
 * date. A badge that has to be granted by a background job is a badge that
 * somebody eventually does not get.
 *
 * ── THE ONE THING THIS FILE WILL NOT DO ───────────────────────────────────
 * It will not award "Top Dispatcher Q3 2026". That badge is a statement about
 * everybody ELSE'S quarter, and a profile read has exactly one person's rows.
 * Deriving it here would mean either shipping every dispatcher's figures to
 * every client, or inventing a ranking from one person's data. Both are worse
 * than the alternative: comparative awards are CONFERRED by the platform,
 * arrive as stored records, and are merged in by the caller. See
 * `AchievementOrigin` in `src/types/profile.ts`.
 *
 * ── WHEN A BADGE WAS EARNED ───────────────────────────────────────────────
 * Threshold badges are dated to the CONTRIBUTION THAT CROSSED THE LINE, not to
 * the moment somebody happened to open the page. That is the difference
 * between "100th load dispatched, 4 March" and "100th load dispatched, today",
 * and only one of them is worth sharing.
 */

/** A badge earned by a running total crossing a line. */
interface ThresholdRule {
  shape: "threshold";
  definition: AchievementDefinition;
  capacity: ProfileCapacity;
  kind: ContributionKind;
  threshold: number;
}

/**
 * A badge earned by a RATE rather than a total — and therefore gated on
 * volume, because a perfect record over three loads is not a record.
 */
interface QualityRule {
  shape: "quality";
  definition: AchievementDefinition;
  capacity: ProfileCapacity;
  minimumLoads: number;
  holds: (metrics: ReturnType<typeof driverMetrics>) => boolean;
  figure: (metrics: ReturnType<typeof driverMetrics>) => number;
}

/** A badge earned by time, which nobody has to work for. */
interface TenureRule {
  shape: "tenure";
  definition: AchievementDefinition;
  days: number;
}

type AchievementRule = ThresholdRule | QualityRule | TenureRule;

const define = (
  key: string,
  title: string,
  description: string,
  tier: AchievementDefinition["tier"],
  capacity: AchievementDefinition["capacity"],
  icon: string,
): AchievementDefinition => ({ key, title, description, tier, capacity, icon, origin: "earned" });

export const ACHIEVEMENT_RULES: readonly AchievementRule[] = [
  /* Dispatchers — volume */
  {
    shape: "threshold",
    definition: define("dispatch.loads.1", "First Load Dispatched", "Booked and dispatched a first load on Antcolos.", "bronze", "dispatcher", "PackageCheck"),
    capacity: "dispatcher", kind: "load_dispatched", threshold: 1,
  },
  {
    shape: "threshold",
    definition: define("dispatch.loads.100", "100th Load Dispatched", "Dispatched 100 loads.", "silver", "dispatcher", "Layers"),
    capacity: "dispatcher", kind: "load_dispatched", threshold: 100,
  },
  {
    shape: "threshold",
    definition: define("dispatch.loads.500", "500 Loads Dispatched", "Dispatched 500 loads.", "gold", "dispatcher", "Layers"),
    capacity: "dispatcher", kind: "load_dispatched", threshold: 500,
  },
  {
    shape: "threshold",
    definition: define("dispatch.loads.1000", "1,000 Loads Dispatched", "Dispatched 1,000 loads.", "platinum", "dispatcher", "Trophy"),
    capacity: "dispatcher", kind: "load_dispatched", threshold: 1000,
  },
  /* Dispatchers — value booked */
  {
    shape: "threshold",
    definition: define("dispatch.revenue.1m", "$1M Booked", "Booked a million dollars of freight.", "gold", "dispatcher", "BadgeDollarSign"),
    capacity: "dispatcher", kind: "revenue_booked", threshold: 100_000_000,
  },
  {
    shape: "threshold",
    definition: define("dispatch.revenue.10m", "$10M Booked", "Booked ten million dollars of freight.", "platinum", "dispatcher", "BadgeDollarSign"),
    capacity: "dispatcher", kind: "revenue_booked", threshold: 1_000_000_000,
  },
  /* Drivers — distance */
  {
    shape: "threshold",
    definition: define("driver.miles.100k", "100,000 Miles Club", "Drove 100,000 miles on Antcolos.", "gold", "driver", "Route"),
    capacity: "driver", kind: "miles_driven", threshold: 100_000,
  },
  {
    shape: "threshold",
    definition: define("driver.miles.500k", "500,000 Miles Club", "Drove 500,000 miles on Antcolos.", "platinum", "driver", "Route"),
    capacity: "driver", kind: "miles_driven", threshold: 500_000,
  },
  /* Drivers — volume */
  {
    shape: "threshold",
    definition: define("driver.loads.1", "First Load Delivered", "Delivered a first load on Antcolos.", "bronze", "driver", "PackageCheck"),
    capacity: "driver", kind: "load_delivered", threshold: 1,
  },
  {
    shape: "threshold",
    definition: define("driver.loads.100", "100 Loads Delivered", "Delivered 100 loads.", "silver", "driver", "PackageCheck"),
    capacity: "driver", kind: "load_delivered", threshold: 100,
  },
  /* Drivers — quality. Both gated on volume, deliberately. */
  {
    shape: "quality",
    definition: define("driver.safety.5star", "5-Star Driver Safety Award", "A safety score of 95 or better across at least 50 delivered loads.", "gold", "driver", "ShieldCheck"),
    capacity: "driver",
    minimumLoads: 50,
    holds: (m) => (m.safetyScore ?? 0) >= 95,
    figure: (m) => m.safetyScore ?? 0,
  },
  {
    shape: "quality",
    definition: define("driver.ontime.98", "On-Time Specialist", "98% on-time delivery across at least 50 rated loads.", "silver", "driver", "Clock"),
    capacity: "driver",
    minimumLoads: 50,
    holds: (m) => (m.onTimePercentage ?? 0) >= 98,
    figure: (m) => m.onTimePercentage ?? 0,
  },
  /* Anybody — time */
  {
    shape: "tenure",
    definition: define("tenure.year.1", "One Year on Antcolos", "A year with an Antcolos account.", "bronze", "any", "CalendarCheck"),
    days: 365,
  },
  {
    shape: "tenure",
    definition: define("tenure.year.5", "Five Years on Antcolos", "Five years with an Antcolos account.", "gold", "any", "CalendarCheck"),
    days: 365 * 5,
  },
] as const;

/** Every definition the rules can produce, by key. */
export const ACHIEVEMENT_DEFINITIONS: Readonly<Record<string, AchievementDefinition>> =
  Object.fromEntries(ACHIEVEMENT_RULES.map((rule) => [rule.definition.key, rule.definition]));

/**
 * The definition a conferred badge carries.
 *
 * Kept here so a conferred award renders identically to an earned one, and so
 * the set of comparative awards the platform may confer is written down in the
 * same file as the ones it derives — rather than being whatever a seed file
 * happened to insert.
 */
export const CONFERRED_DEFINITIONS: Readonly<Record<string, AchievementDefinition>> = {
  "dispatch.top.quarter": {
    key: "dispatch.top.quarter",
    title: "Top Dispatcher",
    description: "Ranked first for loads dispatched in a quarter.",
    tier: "platinum",
    origin: "conferred",
    capacity: "dispatcher",
    icon: "Crown",
  },
  "driver.top.quarter": {
    key: "driver.top.quarter",
    title: "Top Driver",
    description: "Ranked first for on-time delivered loads in a quarter.",
    tier: "platinum",
    origin: "conferred",
    capacity: "driver",
    icon: "Crown",
  },
};

/**
 * The moment a running total first reached `threshold`.
 *
 * Rows are summed in the order they happened, so a reversing row can push a
 * total back below the line and a later row can cross it again — and the badge
 * is dated to the crossing that stuck. Returns null when the line was never
 * reached.
 */
export function crossingDate(
  rows: readonly ProfileContribution[],
  threshold: number,
): string | null {
  const ordered = [...rows].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let running = 0;
  let crossedAt: string | null = null;
  for (const row of ordered) {
    running += row.value;
    if (running >= threshold) {
      crossedAt ??= row.occurredAt;
    } else {
      // Fell back below the line: the earlier crossing no longer counts.
      crossedAt = null;
    }
  }
  return crossedAt;
}

export interface AchievementInput {
  joinedAt: string;
  contributions: readonly ProfileContribution[];
  /** The instant the profile is being read. Supplied, never taken from the clock. */
  asOf: string;
  /** Comparative awards the platform decided. Merged in, never derived. */
  conferred?: readonly Achievement[];
}

/**
 * Every badge this person holds, newest first.
 *
 * Deterministic: the same ledger and the same `asOf` always produce the same
 * list, which is what lets a share card rendered on a server and a badge grid
 * rendered in a browser agree about what somebody has won.
 */
export function evaluateAchievements(input: AchievementInput): Achievement[] {
  const { joinedAt, contributions, asOf, conferred = [] } = input;
  const asOfMs = Date.parse(asOf);
  const earned: Achievement[] = [];

  for (const rule of ACHIEVEMENT_RULES) {
    if (rule.shape === "tenure") {
      const at = Date.parse(joinedAt) + rule.days * 86_400_000;
      if (Number.isFinite(at) && at <= asOfMs) {
        earned.push({ key: rule.definition.key, definition: rule.definition, earnedAt: new Date(at).toISOString() });
      }
      continue;
    }

    const rows = contributions.filter((row) => row.capacity === rule.capacity);

    if (rule.shape === "threshold") {
      const matching = rows.filter((row) => row.kind === rule.kind);
      const at = crossingDate(matching, rule.threshold);
      if (!at) continue;
      const total = matching.reduce((sum, row) => sum + row.value, 0);
      earned.push({ key: rule.definition.key, definition: rule.definition, earnedAt: at, value: total });
      continue;
    }

    const metrics = driverMetrics(rows);
    if (metrics.loadsDelivered < rule.minimumLoads || !rule.holds(metrics)) continue;
    // A rate is true AS OF the last piece of work that fed it, not as of now.
    const lastActivity = rows.reduce<string | null>(
      (latest, row) => (!latest || row.occurredAt > latest ? row.occurredAt : latest),
      null,
    );
    earned.push({
      key: rule.definition.key,
      definition: rule.definition,
      earnedAt: lastActivity ?? asOf,
      value: rule.figure(metrics),
    });
  }

  return [...earned, ...conferred].sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
}

/** The badge a share card leads with: the newest of the highest tier held. */
export function headlineAchievement(achievements: readonly Achievement[]): Achievement | null {
  const rank = { platinum: 3, gold: 2, silver: 1, bronze: 0 } as const;
  return [...achievements].sort((a, b) =>
    rank[b.definition.tier] - rank[a.definition.tier]
    || b.earnedAt.localeCompare(a.earnedAt))[0] ?? null;
}
