import type {
  ActorRef, FuelAuditEntry, FuelAuditKind, FuelDashboard,
  FuelEconomySummary, FuelSharingGrant, FuelTransaction, FuelTransactionFilters,
  IftaJurisdictionSummary, IftaPeriod, IftaPeriodSummary,
  JurisdictionMileageRecord, MileageRecordFilters, PermissionKey, Quarter,
} from "@/types";
import { attributionFrom, declareAttribution } from "@/lib/fuel/attribution";
import { countableMileage, countableTransactions, groupBy, summarize } from "@/lib/fuel/economy";
import {
  derivePeriodState, jurisdictionSummaries, mileageInPeriod, qualifyForIfta,
  readinessIssues, transactionsInPeriod,
} from "@/lib/fuel/ifta";
import { FUEL_INTEGRATIONS, taxRatesAvailable } from "@/lib/fuel/integrations";
import {
  periodId as makePeriodId, quarterBounds, quarterDueDate, quarterOf, recentQuarters, yearOf,
} from "@/lib/fuel/periods";
import { findDuplicate } from "@/lib/fuel/duplicates";
import { validateMileage, validateTransaction } from "@/lib/fuel/validation";
import {
  NotFoundError, OrganizationScopeError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  CorrectFuelPurchaseInput, CorrectMileageInput, FuelDashboardWindow, FuelImportResult,
  FuelService, FuelTransactionDetail, IftaService, MileageRecordDetail,
  RecordFilingInput, RecordFuelPurchaseInput, RecordMileageInput,
} from "../contracts/fuel";
import {
  fuelDb, jurisdictionsTravelled, ledgerHistoryFor, nextFuelId, referencePriceMills,
  type FuelState,
} from "./fuel-store";
import { operatingContextAt, truckIdsRelatedTo, truckUnitNumber } from "./truck-registry";
import { mockStore } from "./store";
import {
  assertFuelOdometerAllowed, assertMileageOdometerAllowed, attributionReviewStanding,
  contributeMileageOdometer, fuelAttributionRefusal, mileageAttributionRefusal,
  mileageAttributionReviewStanding, publishFuelTransaction,
} from "./fuel-propagation";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The Fuel & IFTA service, and the boundary that actually enforces access.
 *
 * Four independent gates, checked in this order on every single call. Any one
 * of them failing is a refusal, and the UI hiding a button is not one of them:
 *
 *  1. PERMISSION       The membership holds the key the method declares.
 *  2. ORGANIZATION     The record belongs to the caller's own ledger, or to a
 *                      carrier that explicitly shared it with them. There is
 *                      no third way to reach a fuel record.
 *  3. RELATIONSHIP     The truck is one the caller's organization can see at
 *                      all, asked of the truck registry rather than assumed.
 *                      A truck whose relationship ended takes its fuel with it.
 *  4. RECORD SCOPE     A driver membership sees its own records and no others.
 *
 * On top of those, two redactions that are omissions rather than blanks: money
 * without `fuel:costs:view`, and the whole IFTA service for a dispatch
 * organization that was not separately authorized.
 */

const LATENCY_MS = 220;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));
const nowIso = () => new Date().toISOString();

function requirePermissions(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new PermissionDeniedError(missing);
}

/* -------------------------------------------------------------------------- */
/* Organization reach                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Grants that let THIS organization read another's fuel data.
 *
 * Only a dispatch organization ever has any: a carrier reads its own ledger
 * and nobody else's, whatever it has been granted, because a grant is a way to
 * give access out, not to take it.
 */
function grantsToMe(db: FuelState, ctx: ServiceContext): FuelSharingGrant[] {
  return db.grants.filter(
    (g) => g.dispatchOrganizationId === ctx.organizationId && g.status === "active",
  );
}

function grantCovers(grant: FuelSharingGrant, truckId: string): boolean {
  return grant.scope === "all_trucks" || grant.truckIds.includes(truckId);
}

/** The grant, if any, through which this organization may see this record. */
function sharingGrantFor(
  db: FuelState,
  ctx: ServiceContext,
  organizationId: string,
  truckId: string,
): FuelSharingGrant | null {
  if (organizationId === ctx.organizationId) return null;
  return (
    grantsToMe(db, ctx).find(
      (g) =>
        g.carrierOrganizationId === organizationId &&
        g.includesOperationalFuel &&
        grantCovers(g, truckId),
    ) ?? null
  );
}

/**
 * The trucks this organization can see at all, from the permanent registry.
 *
 * Asked rather than assumed: the fuel module has no opinion about which trucks
 * belong to whom, and inheriting the registry's answer is what makes fuel
 * visibility end at exactly the same moment a relationship does.
 */
function visibleTruckIds(ctx: ServiceContext): Set<string> {
  return new Set(
    truckIdsRelatedTo(
      ctx.organizationId,
      ctx.scope.loads === "assigned" ? ctx.driverProfileId : undefined,
    ),
  );
}

/** Trucks a dispatch organization may see fuel for, per grant. */
function sharedTruckIds(db: FuelState, ctx: ServiceContext): Set<string> {
  const out = new Set<string>();
  for (const grant of grantsToMe(db, ctx)) {
    if (!grant.includesOperationalFuel) continue;
    if (grant.scope === "all_trucks") {
      for (const id of truckIdsRelatedTo(grant.carrierOrganizationId)) out.add(id);
    }
    for (const id of grant.truckIds) out.add(id);
  }
  return out;
}

/** Whether the caller may see money at all, and through which route. */
function maySeeCost(db: FuelState, ctx: ServiceContext, recordOrganizationId: string): boolean {
  if (!ctx.permissions.has("fuel:costs:view")) return false;
  if (recordOrganizationId === ctx.organizationId) return true;
  // Shared data: the carrier decides whether its costs travel with it. The
  // dispatcher's own permission is necessary and not sufficient.
  return grantsToMe(db, ctx).some(
    (g) => g.carrierOrganizationId === recordOrganizationId && g.includesCosts,
  );
}

/**
 * Whether a record is reachable at all, and how.
 *
 * Returns null when it is not, and every caller turns null into "not found"
 * rather than "forbidden": telling somebody a record exists but is not theirs
 * turns an id field into a directory of other carriers' fuel.
 */
type Reach = { via: "own_ledger" } | { via: "sharing"; grant: FuelSharingGrant };

function reach(
  db: FuelState,
  ctx: ServiceContext,
  record: { organizationId: string; truckId: string; driverProfileId?: string },
): Reach | null {
  // Gate 4 first — a driver's scope narrows everything else.
  if (ctx.scope.loads === "assigned") {
    if (!ctx.driverProfileId || record.driverProfileId !== ctx.driverProfileId) return null;
  }

  if (record.organizationId === ctx.organizationId) {
    // Gate 3: the truck must still be one this organization can see.
    return visibleTruckIds(ctx).has(record.truckId) ? { via: "own_ledger" } : null;
  }

  const grant = sharingGrantFor(db, ctx, record.organizationId, record.truckId);
  return grant ? { via: "sharing", grant } : null;
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

/** Drops the cost object entirely. Never zeroes it — absent means withheld. */
function redact(db: FuelState, ctx: ServiceContext, t: FuelTransaction): FuelTransaction {
  if (maySeeCost(db, ctx, t.organizationId)) return t;
  const rest = { ...t };
  delete rest.cost;
  return rest;
}

/** Applies the same rule to a derived summary. */
function redactEconomy(summary: FuelEconomySummary, costVisible: boolean): FuelEconomySummary {
  if (costVisible) return summary;
  const rest = { ...summary };
  delete rest.totalSpendCents;
  delete rest.costPerMileMills;
  delete rest.averagePricePerGallonMills;
  return rest;
}

function redactJurisdiction(
  line: IftaJurisdictionSummary,
  costVisible: boolean,
): IftaJurisdictionSummary {
  if (costVisible) return line;
  const rest = { ...line };
  delete rest.spendCents;
  return rest;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

function readableTransactions(db: FuelState, ctx: ServiceContext): FuelTransaction[] {
  const mine = visibleTruckIds(ctx);
  const shared = sharedTruckIds(db, ctx);
  return db.transactions.filter((t) => {
    if (ctx.scope.loads === "assigned") {
      if (!ctx.driverProfileId || t.driverProfileId !== ctx.driverProfileId) return false;
    }
    if (t.organizationId === ctx.organizationId) return mine.has(t.truckId);
    return shared.has(t.truckId) && sharingGrantFor(db, ctx, t.organizationId, t.truckId) !== null;
  });
}

function readableMileage(db: FuelState, ctx: ServiceContext): JurisdictionMileageRecord[] {
  const mine = visibleTruckIds(ctx);
  const shared = sharedTruckIds(db, ctx);
  return db.mileage.filter((r) => {
    if (ctx.scope.loads === "assigned") {
      if (!ctx.driverProfileId || r.driverProfileId !== ctx.driverProfileId) return false;
    }
    if (r.organizationId === ctx.organizationId) return mine.has(r.truckId);
    return shared.has(r.truckId) && sharingGrantFor(db, ctx, r.organizationId, r.truckId) !== null;
  });
}

function matchesTransaction(t: FuelTransaction, f: FuelTransactionFilters): boolean {
  if (!f.includeSuperseded && !t.revision.isCurrent) return false;
  if (f.truckId && t.truckId !== f.truckId) return false;
  if (f.driverProfileId && t.driverProfileId !== f.driverProfileId) return false;
  if (f.loadId && t.loadId !== f.loadId) return false;
  if (f.jurisdiction?.length && !f.jurisdiction.includes(t.location.jurisdiction)) return false;
  if (f.fuelType?.length && !f.fuelType.includes(t.fuelType)) return false;
  if (f.state?.length && !f.state.includes(t.state)) return false;
  if (f.source?.length && !f.source.includes(t.source)) return false;
  if (f.flagged === true && t.flags.length === 0) return false;
  if (f.flagged === false && t.flags.length > 0) return false;
  if (f.missingReceipt === true && t.receiptDocumentId) return false;
  if (f.purchasedFrom && t.purchasedAt < f.purchasedFrom) return false;
  if (f.purchasedTo && t.purchasedAt > f.purchasedTo) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = [
      t.location.merchantName, t.location.address.city, t.location.jurisdiction,
      t.truckUnitSnapshot, t.driverNameSnapshot, t.loadReferenceSnapshot, t.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function matchesMileage(r: JurisdictionMileageRecord, f: MileageRecordFilters): boolean {
  if (!f.includeSuperseded && !r.revision.isCurrent) return false;
  if (f.truckId && r.truckId !== f.truckId) return false;
  if (f.driverProfileId && r.driverProfileId !== f.driverProfileId) return false;
  if (f.jurisdiction?.length && !f.jurisdiction.includes(r.jurisdiction)) return false;
  if (f.state?.length && !f.state.includes(r.state)) return false;
  if (f.source?.length && !f.source.includes(r.source)) return false;
  if (f.flagged === true && r.flags.length === 0) return false;
  if (f.flagged === false && r.flags.length > 0) return false;
  if (f.travelFrom && r.travelEndedAt < f.travelFrom) return false;
  if (f.travelTo && r.travelStartedAt > f.travelTo) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Attribution and audit                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Who was running this truck at this instant, for an attribution snapshot.
 *
 * One line, because the rule is not fuel's to own. It lives in
 * `@/lib/fleet/operating-context` and the truck registry runs it over its own
 * canonical rows; the meter ledger asks the same question of the same function.
 * Fuel used to assemble authority windows and resolve them itself, which is how
 * two answers to "who was running it" came to exist for one truck and one
 * moment.
 */
function attributionAt(truckId: string, occurredAt: string, resolvedAt: string) {
  return attributionFrom(operatingContextAt(truckId, occurredAt), resolvedAt);
}

function auditEntry(
  db: FuelState,
  organizationId: string,
  kind: FuelAuditKind,
  actor: ActorRef,
  subject: FuelAuditEntry["subject"],
  summary: string,
  before?: FuelAuditEntry["before"],
  after?: FuelAuditEntry["after"],
): FuelAuditEntry {
  const entry: FuelAuditEntry = {
    id: nextFuelId("faud"),
    organizationId,
    kind,
    at: nowIso(),
    actor,
    subject,
    summary,
    before,
    after,
  };
  db.audit.push(entry);
  return entry;
}

/** Recomputes the flags on one record after it is written or changed. */
function flagTransaction(db: FuelState, t: FuelTransaction) {
  // Every input is scoped to the record's OWN ledger. A truck two carriers run
  // has two odometer series and two sets of receipts; judging one against the
  // other invents regressions and duplicates, and leaks besides.
  const ownLedger = db.transactions.filter((o) => o.organizationId === t.organizationId);
  const match = findDuplicate(t, ownLedger);
  if (match) t.duplicateOfId = match.transactionId;
  t.flags = validateTransaction({
    transaction: t,
    truckHistory: ledgerHistoryFor(db.transactions, t.organizationId, t.truckId, t.id),
    referencePriceMills: referencePriceMills(db.transactions, t.organizationId, t.fuelType),
    jurisdictionsTravelled: jurisdictionsTravelled(db.mileage, t.organizationId, t.truckId),
    duplicateOfId: match?.transactionId,
  });
}

function flagMileage(db: FuelState, r: JurisdictionMileageRecord) {
  r.flags = validateMileage({
    record: r,
    truckRecords: db.mileage.filter(
      (o) => o.organizationId === r.organizationId && o.truckId === r.truckId,
    ),
  });
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

function findTransaction(db: FuelState, ctx: ServiceContext, id: string): FuelTransaction {
  const t = db.transactions.find((x) => x.id === id);
  if (!t) throw new NotFoundError("Fuel purchase");
  if (!reach(db, ctx, t)) throw new NotFoundError("Fuel purchase");
  return t;
}

function findMileage(db: FuelState, ctx: ServiceContext, id: string): JurisdictionMileageRecord {
  const r = db.mileage.find((x) => x.id === id);
  if (!r) throw new NotFoundError("Mileage record");
  if (!reach(db, ctx, r)) throw new NotFoundError("Mileage record");
  return r;
}

/**
 * A write is only ever accepted into the caller's OWN ledger.
 *
 * A dispatch organization that has been shown a carrier's fuel can read it and
 * nothing more: being allowed to look at somebody's tax records is not being
 * allowed to write them.
 */
function requireOwnLedger(ctx: ServiceContext, record: { organizationId: string }) {
  if (record.organizationId !== ctx.organizationId) {
    throw new OrganizationScopeError(record.organizationId, ctx.organizationId);
  }
}

/** A truck the caller's organization has a live relationship with. */
function requireVisibleTruck(ctx: ServiceContext, truckId: string) {
  if (!visibleTruckIds(ctx).has(truckId)) {
    // Same answer as a truck that does not exist. See the registry's reasoning.
    throw new NotFoundError("Truck");
  }
}

/* -------------------------------------------------------------------------- */
/* Periods                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Quarters this organization's own records fall into, opening any that are
 * missing.
 *
 * Periods are containers, so one exists for every quarter that has records in
 * it — a carrier should never have to remember to create a quarter before the
 * fuel it already bought can be looked at.
 */
function ensurePeriods(db: FuelState, ctx: ServiceContext): IftaPeriod[] {
  const own = db.transactions.filter((t) => t.organizationId === ctx.organizationId);
  const ownMileage = db.mileage.filter((r) => r.organizationId === ctx.organizationId);
  const wanted = new Map<string, { year: number; quarter: Quarter; carrierId: string; carrierName: string }>();

  const add = (at: string, carrierId: string, carrierName: string) => {
    if (!carrierId) return;
    const year = yearOf(at);
    const quarter = quarterOf(at);
    wanted.set(makePeriodId(ctx.organizationId, carrierId, year, quarter), {
      year, quarter, carrierId, carrierName,
    });
  };

  for (const t of own) add(t.purchasedAt, t.attribution.carrierOrganizationId, t.attribution.carrierNameSnapshot);
  for (const r of ownMileage) add(r.travelStartedAt, r.attribution.carrierOrganizationId, r.attribution.carrierNameSnapshot);
  // The current quarter always exists, even before anything is recorded in it.
  for (const { year, quarter } of recentQuarters(nowIso(), 1)) {
    wanted.set(makePeriodId(ctx.organizationId, ctx.organizationId, year, quarter), {
      year, quarter, carrierId: ctx.organizationId, carrierName: ctx.organizationId,
    });
  }

  for (const [id, spec] of wanted) {
    if (db.periods.some((p) => p.id === id)) continue;
    const { startsOn, endsOn } = quarterBounds(spec.year, spec.quarter);
    db.periods.push({
      id,
      organizationId: ctx.organizationId,
      carrierOrganizationId: spec.carrierId,
      carrierNameSnapshot: spec.carrierName,
      year: spec.year,
      quarter: spec.quarter,
      startsOn,
      endsOn,
      dueOn: quarterDueDate(spec.year, spec.quarter),
      state: "incomplete",
      amendments: [],
      createdAt: nowIso(),
    });
  }

  return db.periods.filter((p) => p.organizationId === ctx.organizationId);
}

/** Builds a period's derived figures from the records currently in it. */
function summarizePeriod(
  db: FuelState,
  ctx: ServiceContext,
  period: IftaPeriod,
  costVisible: boolean,
): IftaPeriodSummary {
  const readable = readableTransactions(db, ctx);
  const readableMiles = readableMileage(db, ctx);
  const fuel = transactionsInPeriod(readable, period);
  const miles = mileageInPeriod(readableMiles, period);
  const issues = readinessIssues(period, fuel, miles);

  // A stored decision is never recomputed away; everything else is derived.
  const derived = derivePeriodState(period, issues);
  if (derived !== period.state) period.state = derived;

  return {
    period: { ...period },
    economy: redactEconomy(summarize(fuel, miles), costVisible),
    jurisdictions: jurisdictionSummaries(fuel, miles).map((j) => redactJurisdiction(j, costVisible)),
    readiness: { issues, ready: issues.length === 0 },
    taxRatesAvailable: taxRatesAvailable(),
  };
}

/**
 * IFTA access for a dispatch organization.
 *
 * Holding `ifta:view` is necessary and NOT sufficient: a dispatch agency also
 * needs a carrier to have turned tax filing on in its sharing grant. Without
 * one it gets nothing — not an empty list of somebody's quarters, nothing.
 */
function requireIftaAccess(db: FuelState, ctx: ServiceContext, ...keys: PermissionKey[]) {
  requirePermissions(ctx, ...keys);
  const org = organizationType(ctx);
  if (org !== "DISPATCH_AGENCY") return;
  const authorized = grantsToMe(db, ctx).some((g) => g.includesTaxFiling);
  if (!authorized) throw new PermissionDeniedError(["ifta:view"]);
}

/**
 * The caller's organization type.
 *
 * Read from the seeded organization records rather than guessed from the
 * permissions, so a dispatch organization stays a dispatch organization even
 * if somebody grants it every key in the catalog.
 */
function organizationType(ctx: ServiceContext): "CARRIER" | "DISPATCH_AGENCY" {
  return DISPATCH_ORGANIZATIONS.has(ctx.organizationId) ? "DISPATCH_AGENCY" : "CARRIER";
}

/**
 * Which organizations are dispatch agencies.
 *
 * The mock's stand-in for the organization directory the real service reads.
 * It is a deny-list of tax access, so it is kept next to the check it feeds
 * rather than inferred anywhere else.
 */
const DISPATCH_ORGANIZATIONS = new Set(["org_meridian", "org_summit"]);

/* -------------------------------------------------------------------------- */
/* The fuel service                                                            */
/* -------------------------------------------------------------------------- */

export const mockFuelService: FuelService = {
  async dashboard(ctx, window: FuelDashboardWindow = { kind: "current_quarter" }) {
    await wait();
    requirePermissions(ctx, "fuel:view");
    const db = fuelDb();
    const costVisible = ctx.permissions.has("fuel:costs:view");

    const [{ year, quarter }] = recentQuarters(nowIso(), 1);
    const targetYear = window.year ?? year;
    const targetQuarter = window.quarter ?? quarter;
    const { startsOn, endsOn } = quarterBounds(targetYear, targetQuarter);

    const from =
      window.kind === "last_90_days"
        ? new Date(Date.now() - 90 * 86_400_000).toISOString()
        : `${startsOn}T00:00:00.000Z`;
    const to =
      window.kind === "last_90_days" ? nowIso() : `${endsOn}T23:59:59.999Z`;
    const label =
      window.kind === "last_90_days" ? "Last 90 days" : `Q${targetQuarter} ${targetYear}`;

    const allTransactions = readableTransactions(db, ctx);
    const allMileage = readableMileage(db, ctx);
    const inWindow = allTransactions.filter((t) => t.purchasedAt >= from && t.purchasedAt <= to);
    const milesInWindow = allMileage.filter(
      (r) => r.travelStartedAt >= from && r.travelStartedAt <= to,
    );

    const countableFuel = countableTransactions(inWindow);
    const countableMiles = countableMileage(milesInWindow);

    const byTruck = [...groupBy(countableFuel, (t) => t.truckId)]
      .map(([truckId, rows]) => {
        const truckMiles = countableMiles.filter((r) => r.truckId === truckId);
        const economy = redactEconomy(summarize(rows, truckMiles), costVisible);
        return {
          ...economy,
          truckId,
          unit: rows[0].truckUnitSnapshot ?? truckUnitNumber(truckId, ctx.organizationId) ?? "—",
          currentDriverName: rows[0].driverNameSnapshot,
        };
      })
      .sort((a, b) => b.mpgHundredths - a.mpgHundredths);

    const byDriver = [...groupBy(countableFuel, (t) => t.driverProfileId)]
      .map(([driverProfileId, rows]) => {
        const driverMiles = countableMiles.filter((r) => r.driverProfileId === driverProfileId);
        const economy = redactEconomy(summarize(rows, driverMiles), costVisible);
        return {
          ...economy,
          driverProfileId,
          driverName: rows[0].driverNameSnapshot ?? driverProfileId,
        };
      })
      .sort((a, b) => b.mpgHundredths - a.mpgHundredths);

    // The IFTA panel on the dashboard follows the same rule as the IFTA
    // screens: permission plus, for a dispatch organization, an explicit grant.
    let currentPeriod: IftaPeriodSummary | null = null;
    try {
      requireIftaAccess(db, ctx, "ifta:view");
      const periods = ensurePeriods(db, ctx);
      const current = periods.find(
        (p) =>
          p.year === targetYear &&
          p.quarter === targetQuarter &&
          p.carrierOrganizationId === ctx.organizationId,
      );
      currentPeriod = current ? summarizePeriod(db, ctx, current, costVisible) : null;
    } catch {
      currentPeriod = null;
    }

    const dashboard: FuelDashboard = {
      window: { from, to, label },
      economy: redactEconomy(summarize(inWindow, milesInWindow), costVisible),
      costVisible,
      byTruck,
      byDriver,
      byJurisdiction: jurisdictionSummaries(inWindow, milesInWindow).map((j) =>
        redactJurisdiction(j, costVisible),
      ),
      currentPeriod,
      recentTransactions: allTransactions
        .filter((t) => t.revision.isCurrent)
        .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
        .slice(0, 8)
        .map((t) => redact(db, ctx, t)),
      counts: {
        transactionsTotal: allTransactions.filter((t) => t.revision.isCurrent).length,
        awaitingReview: allTransactions.filter(
          (t) => t.revision.isCurrent && (t.state === "manual" || t.state === "imported" || t.state === "pending_review"),
        ).length,
        missingReceipts: allTransactions.filter(
          (t) => t.revision.isCurrent && t.flags.includes("missing_receipt") && t.state !== "rejected",
        ).length,
        duplicates: allTransactions.filter(
          (t) => t.revision.isCurrent && (t.state === "duplicate" || t.flags.includes("possible_duplicate")),
        ).length,
        flagged: allTransactions.filter(
          (t) => t.revision.isCurrent && t.flags.some((f) => f !== "missing_receipt"),
        ).length,
        mileageRecords: allMileage.filter((r) => r.revision.isCurrent).length,
        mileageAwaitingReview: allMileage.filter(
          (r) => r.revision.isCurrent && (r.state === "manual" || r.state === "imported" || r.state === "pending_review"),
        ).length,
      },
    };
    return dashboard;
  },

  async listTransactions(ctx, filters = {}) {
    await wait();
    requirePermissions(ctx, "fuel:view");
    const db = fuelDb();
    return readableTransactions(db, ctx)
      .filter((t) => matchesTransaction(t, filters))
      .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
      .map((t) => redact(db, ctx, t));
  },

  async getTransaction(ctx, transactionId): Promise<FuelTransactionDetail> {
    await wait();
    requirePermissions(ctx, "fuel:view");
    const db = fuelDb();
    const t = findTransaction(db, ctx, transactionId);

    const revisions = db.transactions
      .filter((x) => x.revision.originalId === t.revision.originalId)
      .sort((a, b) => a.revision.number - b.revision.number)
      .map((x) => redact(db, ctx, x));

    const duplicate = t.duplicateOfId
      ? db.transactions.find((x) => x.id === t.duplicateOfId) ?? null
      : null;

    return {
      transaction: redact(db, ctx, t),
      revisions,
      audit: db.audit
        .filter((a) => a.subject.kind === "transaction" && a.subject.id === t.id)
        .sort((a, b) => b.at.localeCompare(a.at)),
      receipt: t.receiptDocumentId
        ? db.receipts.find((d) => d.id === t.receiptDocumentId) ?? null
        : null,
      duplicateOf: duplicate && reach(db, ctx, duplicate) ? redact(db, ctx, duplicate) : null,
    };
  },

  async recordTransaction(ctx, input: RecordFuelPurchaseInput) {
    await wait();
    requirePermissions(ctx, "fuel:record");
    const db = fuelDb();
    requireVisibleTruck(ctx, input.truckId);

    if (input.gallonsThousandths <= 0) throw new Error("Gallons must be greater than zero.");
    if (input.totalCostCents < 0) throw new Error("A purchase cannot cost less than nothing.");
    if (Date.parse(input.purchasedAt) > Date.now() + 60_000) {
      throw new Error("A fuel purchase cannot be recorded in the future.");
    }

    const resolvedAt = nowIso();
    const resolved = attributionAt(input.truckId, input.purchasedAt, resolvedAt);

    // A person may fill a gap the history left. A person may not overrule the
    // history — that is how a filed quarter gets quietly re-attributed.
    let attribution = resolved;
    if (input.declaredCarrierOrganizationId) {
      if (resolved.basis !== "unresolved") {
        throw new Error(
          "The operating authority for that moment is already on record. A declared carrier is only accepted when nothing covers it.",
        );
      }
      attribution = declareAttribution(
        input.declaredCarrierOrganizationId,
        input.declaredCarrierOrganizationId === ctx.organizationId
          ? ctx.actor.displayNameSnapshot
          : input.declaredCarrierOrganizationId,
        resolvedAt,
      );
    }

    // The pump odometer is a meter reading, and only the carrier operating the
    // truck may write one. Checked here so a refusal happens instead of the
    // purchase, rather than after it is already on the ledger.
    assertFuelOdometerAllowed({
      organizationId: ctx.organizationId,
      truckId: input.truckId,
      purchasedAt: input.purchasedAt,
      odometerMiles: input.odometerMiles,
    });

    const qualification = qualifyForIfta(input.fuelType, input.location.jurisdiction);
    const id = nextFuelId("fuel");
    const load = input.loadId
      ? mockStore.org(ctx.organizationId).loads.find((l) => l.id === input.loadId)
      : undefined;

    const transaction: FuelTransaction = {
      id,
      organizationId: ctx.organizationId,
      truckId: input.truckId,
      truckUnitSnapshot: truckUnitNumber(input.truckId, ctx.organizationId),
      driverProfileId: input.driverProfileId,
      driverNameSnapshot: undefined,
      loadId: input.loadId,
      loadReferenceSnapshot: load?.reference,
      attribution,
      purchasedAt: input.purchasedAt,
      location: input.location,
      odometerMiles: input.odometerMiles,
      fuelType: input.fuelType,
      gallonsThousandths: input.gallonsThousandths,
      cost: {
        currency: "USD",
        pricePerGallonMills: input.pricePerGallonMills,
        totalCostCents: input.totalCostCents,
      },
      qualifiesForIfta: qualification.qualifies,
      qualificationNote: qualification.note,
      source: "manual",
      state: "manual",
      receiptDocumentId: input.receiptDocumentId,
      flags: [],
      revision: { number: 1, originalId: id, isCurrent: true },
      notes: input.notes,
      createdAt: resolvedAt,
      createdBy: ctx.actor,
    };

    db.transactions.push(transaction);
    flagTransaction(db, transaction);
    auditEntry(
      db, ctx.organizationId, "transaction.recorded", ctx.actor,
      { kind: "transaction", id, label: `${input.location.merchantName ?? "Fuel"} · ${input.location.jurisdiction}` },
      `Fuel purchase recorded for unit ${transaction.truckUnitSnapshot ?? "—"}, attributed to ${attribution.carrierNameSnapshot} (${attribution.basis.replace(/_/g, " ")}).`,
    );

    // One canonical transaction, one event. The pump odometer reaches the
    // Equipment Meter Ledger from here, which is what makes an oil change come
    // due from a fuel receipt without anybody re-typing mileage.
    await publishFuelTransaction(transaction, ctx.actor, {
      extracted: input.extracted,
    });
    return redact(db, ctx, transaction);
  },

  async acceptAttributionNotEstablishable(ctx, transactionId, reason) {
    await wait();
    requirePermissions(ctx, "fuel:review");
    const db = fuelDb();
    const t = findTransaction(db, ctx, transactionId);
    requireOwnLedger(ctx, t);
    if (!reason.trim()) {
      throw new Error("Say what was looked at and what was not there. A finding needs a reason.");
    }
    if (!t.revision.isCurrent) {
      throw new Error("This revision has been superseded. Review the current one instead.");
    }
    if (t.attribution.basis !== "unresolved") {
      throw new Error(
        `The operating authority for this purchase is already on record as ${t.attribution.carrierNameSnapshot}. There is nothing to find.`,
      );
    }

    /*
     * A refusal code is not proof that an answer can never be found, so the
     * reviewer's finding is only accepted where a finding is the honest thing
     * to make.
     *
     * NOT when the records answer. NOT when the obstacle is authority — that
     * says somebody else operates the truck, which is an answer, and recording
     * "nobody can tell" over the top of it would be false. Only where the
     * canonical records genuinely do not cover the moment.
     */
    const refusal = fuelAttributionRefusal(t);
    if (!refusal) {
      throw new Error(
        "The canonical records establish who was operating this truck when the pump was read, so this is not a purchase anybody has to give up on.",
      );
    }
    if (refusal.kind !== "attribution") {
      throw new Error(
        "This purchase is not unattributable — it belongs to another carrier's authority. That is an answer, not a gap, and it is not this workspace's to close.",
      );
    }

    // Already found, and the records have not moved since. Nothing happens
    // twice: no second finding, no second audit line.
    if (attributionReviewStanding(t)) return redact(db, ctx, t);

    t.attributionReview = {
      at: nowIso(),
      by: ctx.actor,
      outcome: "not_establishable",
      reason: reason.trim(),
      refusalCode: refusal.code,
      refusalRecords: [...refusal.records],
    };

    auditEntry(
      db, ctx.organizationId, "transaction.attribution_reviewed", ctx.actor,
      { kind: "transaction", id: t.id, label: t.location.merchantName ?? t.location.jurisdiction },
      `Operating authority could not be established and will not be guessed at: ${t.attributionReview.reason} The purchase stands, its attribution still reads unresolved, and its odometer stays out of the Equipment Meter Ledger.`,
      { attributionReview: null },
      { attributionReview: "not_establishable", refusalCode: refusal.code },
    );
    return redact(db, ctx, t);
  },

  async verifyTransaction(ctx, transactionId) {
    await wait();
    requirePermissions(ctx, "fuel:review");
    const db = fuelDb();
    const t = findTransaction(db, ctx, transactionId);
    requireOwnLedger(ctx, t);
    if (!t.revision.isCurrent) {
      throw new Error("This revision has been superseded. Review the current one instead.");
    }
    if (t.state === "duplicate" || t.state === "rejected") {
      throw new Error(`A ${t.state} purchase cannot be verified. Reopen it with a correction instead.`);
    }
    // Re-publishing re-contributes the odometer, so the same rule applies
    // before anything on the record changes.
    assertFuelOdometerAllowed({
      organizationId: ctx.organizationId,
      truckId: t.truckId,
      purchasedAt: t.purchasedAt,
      odometerMiles: t.odometerMiles,
    });

    const before = t.state;
    t.state = "verified";
    t.verifiedBy = ctx.actor;
    t.verifiedAt = nowIso();
    auditEntry(
      db, ctx.organizationId, "transaction.verified", ctx.actor,
      { kind: "transaction", id: t.id, label: t.location.merchantName ?? t.location.jurisdiction },
      "Purchase accepted after review.",
      { state: before }, { state: "verified" },
    );
    // Republished so every projection learns the value is now confirmed rather
    // than somebody's unreviewed typing. The event id is the transaction's, so
    // nothing is duplicated — the projections are re-run against it.
    await publishFuelTransaction(t, ctx.actor);
    return redact(db, ctx, t);
  },

  async rejectTransaction(ctx, transactionId, reason) {
    await wait();
    requirePermissions(ctx, "fuel:review");
    if (!reason.trim()) throw new Error("A rejection needs a reason.");
    const db = fuelDb();
    const t = findTransaction(db, ctx, transactionId);
    requireOwnLedger(ctx, t);
    const before = t.state;
    t.state = "rejected";
    t.rejectionReason = reason.trim();
    auditEntry(
      db, ctx.organizationId, "transaction.rejected", ctx.actor,
      { kind: "transaction", id: t.id, label: t.location.merchantName ?? t.location.jurisdiction },
      `Rejected: ${reason.trim()}`,
      { state: before }, { state: "rejected" },
    );
    return redact(db, ctx, t);
  },

  async markDuplicate(ctx, transactionId, duplicateOfId) {
    await wait();
    requirePermissions(ctx, "fuel:review");
    const db = fuelDb();
    const t = findTransaction(db, ctx, transactionId);
    const other = findTransaction(db, ctx, duplicateOfId);
    requireOwnLedger(ctx, t);
    if (t.id === other.id) throw new Error("A purchase cannot be a duplicate of itself.");
    if (other.state === "duplicate") {
      // Otherwise two rows point at each other and neither is the real one.
      throw new Error("That purchase is itself marked a duplicate. Point at the original instead.");
    }
    const before = t.state;
    t.state = "duplicate";
    t.duplicateOfId = other.id;
    auditEntry(
      db, ctx.organizationId, "transaction.marked_duplicate", ctx.actor,
      { kind: "transaction", id: t.id, label: t.location.merchantName ?? t.location.jurisdiction },
      "Confirmed as a duplicate of an existing purchase. It no longer counts toward gallons, spend or any IFTA figure.",
      { state: before }, { state: "duplicate", duplicateOfId: other.id },
    );
    return redact(db, ctx, t);
  },

  /**
   * A correction writes a NEW record and supersedes the old one.
   *
   * The original is not touched beyond being marked superseded, keeps its own
   * audit, and stays readable forever. Attribution, truck and organization are
   * carried across unchanged — a correction fixes what was written down, never
   * whose it was.
   */
  async correctTransaction(ctx, transactionId, input: CorrectFuelPurchaseInput) {
    await wait();
    requirePermissions(ctx, "fuel:correct");
    if (!input.reason.trim()) throw new Error("A correction needs a reason.");
    const db = fuelDb();
    const original = findTransaction(db, ctx, transactionId);
    requireOwnLedger(ctx, original);
    if (!original.revision.isCurrent) {
      throw new Error("This revision has already been superseded. Correct the current one.");
    }

    assertFuelOdometerAllowed({
      organizationId: ctx.organizationId,
      truckId: original.truckId,
      purchasedAt: input.purchasedAt ?? original.purchasedAt,
      odometerMiles: input.odometerMiles ?? original.odometerMiles,
    });

    const jurisdiction = input.location?.jurisdiction ?? original.location.jurisdiction;
    const fuelType = input.fuelType ?? original.fuelType;
    const qualification = qualifyForIfta(fuelType, jurisdiction);
    const id = nextFuelId("fuel");

    const revised: FuelTransaction = {
      ...original,
      id,
      purchasedAt: input.purchasedAt ?? original.purchasedAt,
      location: input.location ?? original.location,
      odometerMiles: input.odometerMiles ?? original.odometerMiles,
      fuelType,
      gallonsThousandths: input.gallonsThousandths ?? original.gallonsThousandths,
      cost: {
        currency: "USD",
        pricePerGallonMills:
          input.pricePerGallonMills ?? original.cost?.pricePerGallonMills ?? 0,
        totalCostCents: input.totalCostCents ?? original.cost?.totalCostCents ?? 0,
      },
      qualifiesForIfta: qualification.qualifies,
      qualificationNote: qualification.note,
      driverProfileId: input.driverProfileId ?? original.driverProfileId,
      loadId: input.loadId ?? original.loadId,
      receiptDocumentId: input.receiptDocumentId ?? original.receiptDocumentId,
      notes: input.notes ?? original.notes,
      // A corrected record starts its review again. Somebody accepted the old
      // numbers; nobody has yet accepted these.
      state: "pending_review",
      verifiedBy: undefined,
      verifiedAt: undefined,
      rejectionReason: undefined,
      flags: [],
      revision: {
        number: original.revision.number + 1,
        originalId: original.revision.originalId,
        supersedesId: original.id,
        isCurrent: true,
        correctionReason: input.reason.trim(),
      },
      createdAt: nowIso(),
      createdBy: ctx.actor,
    };

    original.revision = { ...original.revision, isCurrent: false, supersededById: id };
    original.state = "corrected";
    db.transactions.push(revised);
    flagTransaction(db, revised);

    auditEntry(
      db, ctx.organizationId, "transaction.corrected", ctx.actor,
      { kind: "transaction", id: original.id, label: original.location.merchantName ?? original.location.jurisdiction },
      `Corrected: ${input.reason.trim()}`,
      {
        gallonsThousandths: original.gallonsThousandths,
        totalCostCents: original.cost?.totalCostCents ?? null,
        jurisdiction: original.location.jurisdiction,
      },
      {
        gallonsThousandths: revised.gallonsThousandths,
        totalCostCents: revised.cost?.totalCostCents ?? null,
        jurisdiction: revised.location.jurisdiction,
        revisionId: revised.id,
      },
    );

    // A correction inside a filed quarter is an amendment, not an edit.
    markAmended(db, ctx, revised, input.reason.trim());

    // The corrected revision publishes with what the receipt ORIGINALLY said
    // beside it, so every downstream can show "shown as X, corrected to Y"
    // instead of quietly replacing one number with another.
    await publishFuelTransaction(revised, ctx.actor, {
      supersedesTransactionId: original.id,
      correctionReason: input.reason.trim(),
      extracted: {
        gallonsThousandths: original.gallonsThousandths,
        totalCostCents: original.cost?.totalCostCents,
        pricePerGallonMills: original.cost?.pricePerGallonMills,
        odometerMiles: original.odometerMiles,
        jurisdiction: original.location.jurisdiction,
        merchantName: original.location.merchantName,
        purchasedAt: original.purchasedAt,
      },
    });
    return redact(db, ctx, revised);
  },

  async attachReceipt(ctx, transactionId, documentId) {
    await wait();
    requirePermissions(ctx, "documents:upload");
    const db = fuelDb();
    const t = findTransaction(db, ctx, transactionId);
    requireOwnLedger(ctx, t);
    const document = db.receipts.find((d) => d.id === documentId);
    if (!document) throw new NotFoundError("Document");
    if (document.organizationId !== ctx.organizationId) {
      throw new OrganizationScopeError(document.organizationId, ctx.organizationId);
    }
    t.receiptDocumentId = documentId;
    if (!document.links.some((l) => l.entityKind === "fuel_transaction" && l.entityId === t.id)) {
      document.links.push({ entityKind: "fuel_transaction", entityId: t.id });
    }
    flagTransaction(db, t);
    auditEntry(
      db, ctx.organizationId, "transaction.receipt_attached", ctx.actor,
      { kind: "transaction", id: t.id, label: document.fileName },
      `Receipt ${document.fileName} attached.`,
    );
    return redact(db, ctx, t);
  },

  async listMileage(ctx, filters = {}) {
    await wait();
    requirePermissions(ctx, "mileage:view");
    const db = fuelDb();
    return readableMileage(db, ctx)
      .filter((r) => matchesMileage(r, filters))
      .sort((a, b) => b.travelStartedAt.localeCompare(a.travelStartedAt));
  },

  async getMileage(ctx, recordId): Promise<MileageRecordDetail> {
    await wait();
    requirePermissions(ctx, "mileage:view");
    const db = fuelDb();
    const record = findMileage(db, ctx, recordId);
    return {
      record,
      revisions: db.mileage
        .filter((x) => x.revision.originalId === record.revision.originalId)
        .sort((a, b) => a.revision.number - b.revision.number),
      audit: db.audit
        .filter((a) => a.subject.kind === "mileage" && a.subject.id === record.id)
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
  },

  async recordMileage(ctx, input: RecordMileageInput) {
    await wait();
    requirePermissions(ctx, "mileage:record");
    const db = fuelDb();
    requireVisibleTruck(ctx, input.truckId);

    if (Date.parse(input.travelEndedAt) < Date.parse(input.travelStartedAt)) {
      throw new Error("Travel cannot end before it started.");
    }
    if (input.totalMiles < 0 || input.taxableMiles < 0) {
      throw new Error("Miles cannot be negative.");
    }
    if (input.taxableMiles > input.totalMiles) {
      throw new Error("Taxable miles cannot exceed the total miles run in the jurisdiction.");
    }

    const resolvedAt = nowIso();
    // The leg's START, which is what the previous resolver was given too: a
    // jurisdiction leg belongs to whoever was running the truck when it began.
    const resolved = attributionAt(input.truckId, input.travelStartedAt, resolvedAt);
    let attribution = resolved;
    if (input.declaredCarrierOrganizationId) {
      if (resolved.basis !== "unresolved") {
        throw new Error(
          "The operating authority for that period is already on record and cannot be overridden.",
        );
      }
      attribution = declareAttribution(
        input.declaredCarrierOrganizationId,
        input.declaredCarrierOrganizationId === ctx.organizationId
          ? ctx.actor.displayNameSnapshot
          : input.declaredCarrierOrganizationId,
        resolvedAt,
      );
    }

    assertMileageOdometerAllowed({
      organizationId: ctx.organizationId,
      truckId: input.truckId,
      travelEndedAt: input.travelEndedAt,
      odometerEndMiles: input.odometerEndMiles,
    });

    const id = nextFuelId("mil");
    const record: JurisdictionMileageRecord = {
      id,
      organizationId: ctx.organizationId,
      truckId: input.truckId,
      truckUnitSnapshot: truckUnitNumber(input.truckId, ctx.organizationId),
      driverProfileId: input.driverProfileId,
      loadId: input.loadId,
      attribution,
      jurisdiction: input.jurisdiction.toUpperCase(),
      travelStartedAt: input.travelStartedAt,
      travelEndedAt: input.travelEndedAt,
      totalMiles: input.totalMiles,
      taxableMiles: input.taxableMiles,
      odometerStartMiles: input.odometerStartMiles,
      odometerEndMiles: input.odometerEndMiles,
      source: "manual",
      state: "manual",
      flags: [],
      revision: { number: 1, originalId: id, isCurrent: true },
      notes: input.notes,
      createdAt: resolvedAt,
      createdBy: ctx.actor,
    };

    db.mileage.push(record);
    flagMileage(db, record);
    auditEntry(
      db, ctx.organizationId, "mileage.recorded", ctx.actor,
      { kind: "mileage", id, label: `${record.jurisdiction} · ${record.totalMiles} mi` },
      `${record.totalMiles} miles in ${record.jurisdiction} recorded for unit ${record.truckUnitSnapshot ?? "—"}, attributed to ${attribution.carrierNameSnapshot}.`,
    );
    // The odometer at the end of the leg is a meter reading like any other.
    await contributeMileageOdometer(record, ctx.actor);
    return record;
  },

  async acceptMileageAttributionNotEstablishable(ctx, recordId, reason) {
    await wait();
    requirePermissions(ctx, "mileage:review");
    const db = fuelDb();
    const r = findMileage(db, ctx, recordId);
    requireOwnLedger(ctx, r);
    if (!reason.trim()) {
      throw new Error("Say what was looked at and what was not there. A finding needs a reason.");
    }
    if (!r.revision.isCurrent) {
      throw new Error("This revision has been superseded. Review the current one instead.");
    }
    if (r.attribution.basis !== "unresolved") {
      throw new Error(
        `The operating authority for this leg is already on record as ${r.attribution.carrierNameSnapshot}. There is nothing to find.`,
      );
    }

    // The same two refusals as a purchase, for the same reasons: the records
    // answering is not a gap, and another carrier's authority is an answer.
    const refusal = mileageAttributionRefusal(r);
    if (!refusal) {
      throw new Error(
        "The canonical records establish who was operating this truck for that travel, so this is not a leg anybody has to give up on.",
      );
    }
    if (refusal.kind !== "attribution") {
      throw new Error(
        "This leg is not unattributable — it belongs to another carrier's authority. That is an answer, not a gap, and it is not this workspace's to close.",
      );
    }

    if (mileageAttributionReviewStanding(r)) return r;

    r.attributionReview = {
      at: nowIso(),
      by: ctx.actor,
      outcome: "not_establishable",
      reason: reason.trim(),
      refusalCode: refusal.code,
      refusalRecords: [...refusal.records],
    };

    auditEntry(
      db, ctx.organizationId, "mileage.attribution_reviewed", ctx.actor,
      { kind: "mileage", id: r.id, label: `${r.jurisdiction} · ${r.totalMiles} mi` },
      `Operating authority could not be established and will not be guessed at: ${r.attributionReview.reason} The leg stands, its attribution still reads unresolved, and its odometer stays out of the Equipment Meter Ledger.`,
      { attributionReview: null },
      { attributionReview: "not_establishable", refusalCode: refusal.code },
    );
    return r;
  },

  async verifyMileage(ctx, recordId) {
    await wait();
    requirePermissions(ctx, "mileage:review");
    const db = fuelDb();
    const r = findMileage(db, ctx, recordId);
    requireOwnLedger(ctx, r);
    if (!r.revision.isCurrent) {
      throw new Error("This revision has been superseded. Review the current one instead.");
    }
    if (r.flags.includes("taxable_exceeds_total") || r.flags.includes("negative_miles")) {
      // Verification is a statement that the numbers are right. These are not.
      throw new Error("This record is arithmetically impossible. Correct it before verifying it.");
    }
    const before = r.state;
    r.state = "verified";
    r.verifiedBy = ctx.actor;
    r.verifiedAt = nowIso();
    auditEntry(
      db, ctx.organizationId, "mileage.verified", ctx.actor,
      { kind: "mileage", id: r.id, label: `${r.jurisdiction} · ${r.totalMiles} mi` },
      "Mileage accepted after review.",
      { state: before }, { state: "verified" },
    );
    return r;
  },

  async rejectMileage(ctx, recordId, reason) {
    await wait();
    requirePermissions(ctx, "mileage:review");
    if (!reason.trim()) throw new Error("A rejection needs a reason.");
    const db = fuelDb();
    const r = findMileage(db, ctx, recordId);
    requireOwnLedger(ctx, r);
    const before = r.state;
    r.state = "rejected";
    r.rejectionReason = reason.trim();
    auditEntry(
      db, ctx.organizationId, "mileage.rejected", ctx.actor,
      { kind: "mileage", id: r.id, label: `${r.jurisdiction} · ${r.totalMiles} mi` },
      `Rejected: ${reason.trim()}`,
      { state: before }, { state: "rejected" },
    );
    return r;
  },

  async correctMileage(ctx, recordId, input: CorrectMileageInput) {
    await wait();
    requirePermissions(ctx, "mileage:review");
    if (!input.reason.trim()) throw new Error("A correction needs a reason.");
    const db = fuelDb();
    const original = findMileage(db, ctx, recordId);
    requireOwnLedger(ctx, original);
    if (!original.revision.isCurrent) {
      throw new Error("This revision has already been superseded. Correct the current one.");
    }

    const totalMiles = input.totalMiles ?? original.totalMiles;
    const taxableMiles = input.taxableMiles ?? original.taxableMiles;
    if (taxableMiles > totalMiles) {
      throw new Error("Taxable miles cannot exceed the total miles run in the jurisdiction.");
    }

    const id = nextFuelId("mil");
    const revised: JurisdictionMileageRecord = {
      ...original,
      id,
      jurisdiction: (input.jurisdiction ?? original.jurisdiction).toUpperCase(),
      travelStartedAt: input.travelStartedAt ?? original.travelStartedAt,
      travelEndedAt: input.travelEndedAt ?? original.travelEndedAt,
      totalMiles,
      taxableMiles,
      odometerStartMiles: input.odometerStartMiles ?? original.odometerStartMiles,
      odometerEndMiles: input.odometerEndMiles ?? original.odometerEndMiles,
      notes: input.notes ?? original.notes,
      state: "pending_review",
      verifiedBy: undefined,
      verifiedAt: undefined,
      rejectionReason: undefined,
      flags: [],
      revision: {
        number: original.revision.number + 1,
        originalId: original.revision.originalId,
        supersedesId: original.id,
        isCurrent: true,
        correctionReason: input.reason.trim(),
      },
      createdAt: nowIso(),
      createdBy: ctx.actor,
    };

    original.revision = { ...original.revision, isCurrent: false, supersededById: id };
    original.state = "corrected";
    db.mileage.push(revised);
    flagMileage(db, revised);

    auditEntry(
      db, ctx.organizationId, "mileage.corrected", ctx.actor,
      { kind: "mileage", id: original.id, label: `${original.jurisdiction} · ${original.totalMiles} mi` },
      `Corrected: ${input.reason.trim()}`,
      { totalMiles: original.totalMiles, taxableMiles: original.taxableMiles, jurisdiction: original.jurisdiction },
      { totalMiles, taxableMiles, jurisdiction: revised.jurisdiction, revisionId: revised.id },
    );
    markAmended(db, ctx, revised, input.reason.trim());
    return revised;
  },

  async runImport(ctx, adapterId): Promise<FuelImportResult> {
    await wait();
    requirePermissions(ctx, "fuel:import");
    const adapter = FUEL_INTEGRATIONS.find((i) => i.id === adapterId);
    if (!adapter) throw new NotFoundError("Integration");
    // There is no other branch. Nothing is connected, and this is the only
    // answer the module can give without inventing a connection.
    return {
      status: "not_connected",
      adapter,
      message: `${adapter.label} is not connected. Nothing was imported, and no outside system was contacted.`,
    };
  },

  async integrations(ctx) {
    requirePermissions(ctx, "fuel:view");
    return [...FUEL_INTEGRATIONS];
  },

  async audit(ctx, subjectId) {
    await wait();
    requirePermissions(ctx, "fuel:view");
    const db = fuelDb();
    return db.audit
      .filter((a) => a.organizationId === ctx.organizationId)
      .filter((a) => (subjectId ? a.subject.id === subjectId : true))
      .sort((a, b) => b.at.localeCompare(a.at));
  },

  async sharingGrants(ctx) {
    await wait();
    requirePermissions(ctx, "fuel:view");
    const db = fuelDb();
    return db.grants.filter(
      (g) =>
        g.carrierOrganizationId === ctx.organizationId ||
        g.dispatchOrganizationId === ctx.organizationId,
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Amendments                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A correction landing inside a quarter that has already been filed.
 *
 * The quarter does not go back to "needs review" — it was filed, and that
 * happened. It becomes `amended`, and the amendment records what changed and
 * why, so the difference between the return that was submitted and the records
 * that now stand is visible rather than inferred.
 */
function markAmended(
  db: FuelState,
  ctx: ServiceContext,
  record: FuelTransaction | JurisdictionMileageRecord,
  reason: string,
) {
  const at = "purchasedAt" in record ? record.purchasedAt : record.travelStartedAt;
  const period = db.periods.find(
    (p) =>
      p.organizationId === ctx.organizationId &&
      p.carrierOrganizationId === record.attribution.carrierOrganizationId &&
      p.year === yearOf(at) &&
      p.quarter === quarterOf(at),
  );
  if (!period || (period.state !== "filed" && period.state !== "amended")) return;

  const isFuel = "purchasedAt" in record;
  period.state = "amended";
  period.amendments.push({
    id: nextFuelId("famd"),
    at: nowIso(),
    by: ctx.actor,
    reason,
    transactionIds: isFuel ? [record.id] : [],
    mileageRecordIds: isFuel ? [] : [record.id],
  });
  auditEntry(
    db, ctx.organizationId, "period.amended", ctx.actor,
    { kind: "period", id: period.id, label: `Q${period.quarter} ${period.year}` },
    `A record inside a filed quarter was corrected: ${reason}`,
  );
}

/* -------------------------------------------------------------------------- */
/* The IFTA service                                                            */
/* -------------------------------------------------------------------------- */

export const mockIftaService: IftaService = {
  async listPeriods(ctx) {
    await wait();
    const db = fuelDb();
    requireIftaAccess(db, ctx, "ifta:view");
    const costVisible = ctx.permissions.has("fuel:costs:view");
    return ensurePeriods(db, ctx)
      .map((p) => summarizePeriod(db, ctx, p, costVisible))
      .sort((a, b) =>
        b.period.year - a.period.year || b.period.quarter - a.period.quarter,
      );
  },

  async getPeriod(ctx, periodId) {
    await wait();
    const db = fuelDb();
    requireIftaAccess(db, ctx, "ifta:view");
    const period = ensurePeriods(db, ctx).find((p) => p.id === periodId);
    if (!period) throw new NotFoundError("IFTA period");
    return summarizePeriod(db, ctx, period, ctx.permissions.has("fuel:costs:view"));
  },

  /**
   * Records that a person filed the quarter somewhere else.
   *
   * This is bookkeeping about an action taken outside Antcolos. Nothing is
   * transmitted, no tax is calculated and no money moves — and the guard below
   * refuses to let anybody mark a quarter filed while its own records still
   * say it is not finished.
   */
  async recordFiling(ctx, periodId, input: RecordFilingInput) {
    await wait();
    const db = fuelDb();
    requireIftaAccess(db, ctx, "ifta:view", "ifta:manage");
    const period = ensurePeriods(db, ctx).find((p) => p.id === periodId);
    if (!period) throw new NotFoundError("IFTA period");
    if (period.state === "filed" || period.state === "amended") {
      throw new Error("This quarter is already recorded as filed. Correct a record to amend it.");
    }

    const summary = summarizePeriod(db, ctx, period, true);
    if (!summary.readiness.ready) {
      throw new Error(
        "This quarter is not ready. Clear everything outstanding on it before recording a filing.",
      );
    }

    const filedAt = input.filedAt ?? nowIso();
    period.state = "filed";
    period.lockedAt = filedAt;
    period.filing = {
      filedAt,
      filedBy: ctx.actor,
      confirmationReference: input.confirmationReference?.trim() || undefined,
      channel: "external",
      note: input.note?.trim() || undefined,
    };
    auditEntry(
      db, ctx.organizationId, "period.filed", ctx.actor,
      { kind: "period", id: period.id, label: `Q${period.quarter} ${period.year}` },
      `Recorded as filed externally${input.confirmationReference ? `, reference ${input.confirmationReference}` : ""}. Antcolos did not submit anything.`,
      { state: "ready" }, { state: "filed" },
    );
    return summarizePeriod(db, ctx, period, ctx.permissions.has("fuel:costs:view"));
  },

  async amendPeriod(ctx, periodId, reason) {
    await wait();
    const db = fuelDb();
    requireIftaAccess(db, ctx, "ifta:view", "ifta:manage");
    if (!reason.trim()) throw new Error("An amendment needs a reason.");
    const period = ensurePeriods(db, ctx).find((p) => p.id === periodId);
    if (!period) throw new NotFoundError("IFTA period");
    if (period.state !== "filed" && period.state !== "amended") {
      throw new Error("Only a quarter that has been filed can be amended.");
    }
    period.state = "amended";
    period.amendments.push({
      id: nextFuelId("famd"),
      at: nowIso(),
      by: ctx.actor,
      reason: reason.trim(),
      transactionIds: [],
      mileageRecordIds: [],
    });
    auditEntry(
      db, ctx.organizationId, "period.amended", ctx.actor,
      { kind: "period", id: period.id, label: `Q${period.quarter} ${period.year}` },
      `Amendment opened: ${reason.trim()}`,
    );
    return summarizePeriod(db, ctx, period, ctx.permissions.has("fuel:costs:view"));
  },
};
