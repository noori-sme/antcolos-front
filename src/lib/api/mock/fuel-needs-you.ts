import type {
  FuelTransaction, IftaPeriod, JurisdictionMileageRecord, NeedsYouItem,
  NeedsYouSeverity, PermissionKey,
} from "@/types";
import { countableMileage, countableTransactions } from "@/lib/fuel/economy";
import {
  FUEL_FLAG_DESCRIPTION, FUEL_FLAG_LABEL, MILEAGE_FLAG_LABEL,
} from "@/lib/fuel/labels";
import {
  isPeriodFinished, isQuarterFinished, periodLabel, quarterOf, quarterDueDate, yearOf,
} from "@/lib/fuel/periods";
import { READINESS_ISSUE_LABEL, readinessIssues } from "@/lib/fuel/ifta";
import { formatGallons } from "@/lib/fuel/units";
import type { ServiceContext } from "../contracts/context";
import { fuelDb } from "./fuel-store";
import { attributionReviewStanding } from "./fuel-propagation";
import { mockStore } from "./store";
import { fleetSync, truckContextFrom } from "./truck-registry";

/**
 * Needs You items DERIVED from the fuel ledger.
 *
 * Not seeded, not hand-written: every item below exists because a specific
 * record is in a specific state right now, and stops existing the moment that
 * is no longer true. Attaching the missing receipt closes the item; correcting
 * the impossible mileage row closes the item. That is the difference between a
 * queue and a list of notices.
 *
 * Items are given deterministic ids derived from the record they are about, so
 * a sync never produces a second copy of one somebody is already working on,
 * and so snoozes and assignments survive.
 */

const SYSTEM = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system" as const,
};

const FUEL_PREFIX = "ny_fuel_";

/** The permissions an item needs, mirroring the service that produced it. */
const FUEL_REQUIRES: PermissionKey[] = ["fuel:view"];
const MILEAGE_REQUIRES: PermissionKey[] = ["mileage:view"];
const IFTA_REQUIRES: PermissionKey[] = ["ifta:view"];

function item(
  organizationId: string,
  id: string,
  fields: Omit<NeedsYouItem, "id" | "organizationId" | "status" | "createdAt" | "history">,
  createdAt: string,
): NeedsYouItem {
  return {
    id,
    organizationId,
    status: "open",
    createdAt,
    history: [
      { id: `${id}_h1`, at: createdAt, actor: SYSTEM, action: "created", note: fields.reason },
    ],
    ...fields,
  };
}

/** The quarter a record falls in, and when that quarter's return is due. */
function dueForRecord(at: string): { label: string; dueAt: string; finished: boolean } {
  const year = yearOf(at);
  const quarter = quarterOf(at);
  return {
    label: periodLabel(year, quarter),
    dueAt: `${quarterDueDate(year, quarter)}T23:59:59.000Z`,
    finished: isQuarterFinished(year, quarter),
  };
}

function truckLabel(t: { truckUnitSnapshot?: string; truckId: string }): string {
  return t.truckUnitSnapshot ? `Unit ${t.truckUnitSnapshot}` : "Unit unknown";
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

function missingReceiptItem(organizationId: string, t: FuelTransaction): NeedsYouItem {
  const period = dueForRecord(t.purchasedAt);
  const severity: NeedsYouSeverity = period.finished ? "high" : "medium";
  return item(
    organizationId,
    `${FUEL_PREFIX}receipt_${t.id}`,
    {
      category: "missing_fuel_receipt",
      severity,
      title: `Receipt missing — ${truckLabel(t)}, ${t.location.merchantName ?? t.location.jurisdiction}`,
      reason: `${formatGallons(t.gallonsThousandths)} of ${t.fuelType.replace(/_/g, " ")} was recorded with no receipt attached. A qualified purchase cannot be evidenced on ${period.label} without one.`,
      detail: period.finished
        ? "The quarter this purchase falls in has already closed, so this is holding up the return."
        : "The quarter is still open. Getting the receipt on now avoids a scramble at the end of it.",
      entity: {
        kind: "fuel_transaction",
        id: t.id,
        label: `${t.location.merchantName ?? "Fuel"} · ${t.location.jurisdiction} · ${formatGallons(t.gallonsThousandths)}`,
        href: `/fuel/transactions/${t.id}`,
      },
      relatedEntities: [
        { kind: "truck", id: t.truckId, label: truckLabel(t), href: `/fleet/trucks/${t.truckId}` },
      ],
      recommendedAction: {
        kind: "attach_receipt",
        label: "Attach the receipt",
        requires: ["documents:upload"],
      },
      dueAt: period.dueAt,
      source: "system",
      requires: FUEL_REQUIRES,
    },
    t.createdAt,
  );
}

function duplicateItem(organizationId: string, t: FuelTransaction): NeedsYouItem {
  const period = dueForRecord(t.purchasedAt);
  return item(
    organizationId,
    `${FUEL_PREFIX}dupe_${t.id}`,
    {
      category: "duplicate_fuel_purchase",
      severity: "high",
      title: `Possible duplicate purchase — ${truckLabel(t)}`,
      reason: `This purchase matches an existing one on the same truck, within the same window, for the same gallons and cost. Counted twice it overstates ${period.label} gallons and understates the fleet's MPG.`,
      detail: "Antcolos does not decide which one is real. Confirm the duplicate and it stops counting; reject the match and both stand.",
      entity: {
        kind: "fuel_transaction",
        id: t.id,
        label: `${t.location.merchantName ?? "Fuel"} · ${formatGallons(t.gallonsThousandths)}`,
        href: `/fuel/transactions/${t.id}`,
      },
      recommendedAction: {
        kind: "resolve_duplicate",
        label: "Compare the two purchases",
        requires: ["fuel:review"],
      },
      dueAt: period.dueAt,
      source: "system",
      requires: FUEL_REQUIRES,
    },
    t.createdAt,
  );
}

function suspiciousItem(organizationId: string, t: FuelTransaction, flags: string[]): NeedsYouItem {
  const period = dueForRecord(t.purchasedAt);
  const worst = flags.includes("no_active_operating_authority") || flags.includes("odometer_regression");
  return item(
    organizationId,
    `${FUEL_PREFIX}check_${t.id}`,
    {
      category: "suspicious_fuel_transaction",
      severity: worst ? "high" : "medium",
      title: `Fuel purchase to check — ${truckLabel(t)}`,
      reason: flags
        .map((f) => FUEL_FLAG_LABEL[f as keyof typeof FUEL_FLAG_LABEL] ?? f)
        .join(" · "),
      // Each flag's own sentence, then the standing note. A person acting on
      // this needs to know what the check actually found — including, for an
      // unestablished carrier, that the odometer on the receipt did not reach
      // the Equipment Meter Ledger and the purchase kept it either way.
      detail: [
        ...flags.map((f) => FUEL_FLAG_DESCRIPTION[f as keyof typeof FUEL_FLAG_DESCRIPTION]).filter(Boolean),
        "These are arithmetic checks, not an accusation and not fraud detection. Somebody looks, and either accepts the purchase or corrects it.",
      ].join(" "),
      entity: {
        kind: "fuel_transaction",
        id: t.id,
        label: `${t.location.merchantName ?? "Fuel"} · ${t.location.jurisdiction}`,
        href: `/fuel/transactions/${t.id}`,
      },
      relatedEntities: [
        { kind: "truck", id: t.truckId, label: truckLabel(t), href: `/fleet/trucks/${t.truckId}` },
      ],
      recommendedAction: { kind: "review", label: "Review the purchase", requires: ["fuel:review"] },
      dueAt: period.dueAt,
      source: "system",
      requires: FUEL_REQUIRES,
    },
    t.createdAt,
  );
}

function mileageItem(organizationId: string, r: JurisdictionMileageRecord): NeedsYouItem {
  const period = dueForRecord(r.travelStartedAt);
  const impossible =
    r.flags.includes("taxable_exceeds_total") || r.flags.includes("negative_miles");
  return item(
    organizationId,
    `${FUEL_PREFIX}mileage_${r.id}`,
    {
      category: "invalid_mileage",
      severity: impossible ? "high" : "medium",
      title: `Mileage to fix — ${r.jurisdiction}, ${truckLabel(r)}`,
      reason: r.flags.map((f) => MILEAGE_FLAG_LABEL[f]).join(" · "),
      detail: impossible
        ? "A record that cannot be true will not be accepted for a return. Correct it — the original stays on the record with the reason."
        : "Worth a look before the quarter closes.",
      entity: {
        kind: "mileage_record",
        id: r.id,
        label: `${r.jurisdiction} · ${r.totalMiles.toLocaleString()} mi`,
        href: "/fuel/mileage",
      },
      relatedEntities: [
        { kind: "truck", id: r.truckId, label: truckLabel(r), href: `/fleet/trucks/${r.truckId}` },
      ],
      recommendedAction: {
        kind: "review_mileage",
        label: "Review the mileage record",
        requires: ["mileage:review"],
      },
      dueAt: period.dueAt,
      source: "system",
      requires: MILEAGE_REQUIRES,
    },
    r.createdAt,
  );
}

function periodItem(
  organizationId: string,
  period: IftaPeriod,
  issues: readonly string[],
): NeedsYouItem {
  const dueAt = `${period.dueOn}T23:59:59.000Z`;
  const overdue = Date.parse(dueAt) < Date.now();
  return item(
    organizationId,
    `${FUEL_PREFIX}period_${period.id}`,
    {
      category: "incomplete_ifta_period",
      severity: overdue ? "critical" : "high",
      title: `${periodLabel(period.year, period.quarter)} is not ready to file`,
      reason: issues
        .map((i) => READINESS_ISSUE_LABEL[i as keyof typeof READINESS_ISSUE_LABEL] ?? i)
        .join(" · "),
      detail:
        "Antcolos does not file this or work out what is owed. It gets the quarter to the point where the person who does file it has everything.",
      entity: {
        kind: "ifta_period",
        id: period.id,
        label: `${periodLabel(period.year, period.quarter)} · ${period.carrierNameSnapshot}`,
        href: `/fuel/ifta/${period.id}`,
      },
      recommendedAction: {
        kind: "complete_period",
        label: "Open the quarter",
        requires: ["ifta:view"],
      },
      dueAt,
      source: "system",
      requires: IFTA_REQUIRES,
    },
    period.createdAt,
  );
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Brings the organization's Needs You queue into line with the fuel ledger.
 *
 * Additive and subtractive: new problems appear, and items whose problem has
 * gone are resolved with a note rather than deleted, so the history of what
 * was outstanding survives. Anything a person has already snoozed, assigned or
 * escalated keeps that state — the sync never overwrites an item it has
 * already created.
 *
 * Called by the Needs You service on every read, which is what keeps the queue
 * and the fuel screens from ever disagreeing.
 */
export function syncFuelNeedsYou(ctx: ServiceContext) {
  const org = mockStore.org(ctx.organizationId);
  const db = fuelDb();

  // Only this organization's own ledger, and only trucks it can still see.
  const visible = new Set(fleetSync(truckContextFrom(ctx)).map((t) => t.truckId));
  const mine = db.transactions.filter(
    (t) => t.organizationId === ctx.organizationId && visible.has(t.truckId),
  );
  const myMileage = db.mileage.filter(
    (r) => r.organizationId === ctx.organizationId && visible.has(r.truckId),
  );

  const desired = new Map<string, NeedsYouItem>();

  for (const t of countableTransactions(mine)) {
    if (t.qualifiesForIfta && t.flags.includes("missing_receipt")) {
      const built = missingReceiptItem(ctx.organizationId, t);
      desired.set(built.id, built);
    }
    if (t.flags.includes("possible_duplicate") && t.state !== "duplicate") {
      const built = duplicateItem(ctx.organizationId, t);
      desired.set(built.id, built);
    }
    /*
     * A finding that the carrier cannot be established closes THAT question and
     * only that one. The purchase can still be in the queue for a receipt, a
     * duplicate or an odometer that ran backwards; what it stops being is a
     * question nobody could answer, asked again on every read.
     *
     * The finding is checked against the canonical records rather than trusted
     * as a stored flag — see `attributionReviewStanding` — so the moment the
     * registry says something new, this comes back.
     */
    const reviewed = attributionReviewStanding(t);
    const suspicious = t.flags.filter(
      (f) => f !== "missing_receipt"
        && f !== "possible_duplicate"
        && !(reviewed && f === "no_active_operating_authority"),
    );
    if (suspicious.length > 0) {
      const built = suspiciousItem(ctx.organizationId, t, suspicious);
      desired.set(built.id, built);
    }
  }

  for (const r of countableMileage(myMileage)) {
    if (r.flags.length === 0) continue;
    const built = mileageItem(ctx.organizationId, r);
    desired.set(built.id, built);
  }

  for (const period of db.periods.filter((p) => p.organizationId === ctx.organizationId)) {
    if (period.state === "filed") continue;
    const fuel = mine.filter(
      (t) =>
        t.attribution.carrierOrganizationId === period.carrierOrganizationId &&
        t.purchasedAt >= `${period.startsOn}T00:00:00.000Z` &&
        t.purchasedAt <= `${period.endsOn}T23:59:59.999Z`,
    );
    const miles = myMileage.filter(
      (r) =>
        r.attribution.carrierOrganizationId === period.carrierOrganizationId &&
        r.travelStartedAt >= `${period.startsOn}T00:00:00.000Z` &&
        r.travelStartedAt <= `${period.endsOn}T23:59:59.999Z`,
    );
    const issues = readinessIssues(period, fuel, miles);
    // A quarter that is simply still running is not a thing to chase.
    const actionable = issues.filter((i) => i !== "period_not_finished");
    if (!isPeriodFinished(period) || actionable.length === 0) continue;
    const built = periodItem(ctx.organizationId, period, actionable);
    desired.set(built.id, built);
  }

  const existing = new Map(
    org.needsYou.filter((n) => n.id.startsWith(FUEL_PREFIX)).map((n) => [n.id, n]),
  );

  for (const [id, built] of desired) {
    const current = existing.get(id);
    if (!current) {
      org.needsYou.push(built);
      continue;
    }
    // A person reopened it or is working on it. Refresh only what it says, and
    // never the state somebody put it in.
    current.reason = built.reason;
    current.detail = built.detail;
    current.severity = built.severity;
    if (current.status === "resolved") {
      current.status = "open";
      current.resolvedAt = undefined;
      current.resolutionNote = undefined;
      current.history = [
        ...current.history,
        {
          id: `${id}_h${current.history.length + 1}`,
          at: new Date().toISOString(),
          actor: SYSTEM,
          action: "reopened",
          note: "The problem is present again in the fuel ledger.",
        },
      ];
    }
  }

  for (const [id, current] of existing) {
    if (desired.has(id) || current.status === "resolved") continue;
    current.status = "resolved";
    current.resolvedAt = new Date().toISOString();
    current.resolutionNote = "No longer outstanding in the fuel ledger.";
    current.history = [
      ...current.history,
      {
        id: `${id}_h${current.history.length + 1}`,
        at: current.resolvedAt,
        actor: SYSTEM,
        action: "resolved",
        note: "The fuel record this was about no longer has the problem.",
      },
    ];
  }
}
