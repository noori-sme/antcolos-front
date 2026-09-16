import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  Listing, OpportunityMatch, PermissionKey,
} from "@/types";
import { availablePermissionKeys } from "@/lib/permissions/catalog";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import { mockAuditService } from "./audit";
import { resetAllMocks } from "./registry";
import {
  anonymize, LEARNING_CONSENT_PERMISSION, learningConsent, learningFor,
  localPoolForTests, networkPoolForTests, observeDecision, setLearningConsent,
} from "./ranking";

/**
 * ★ NOTHING LEAVES A WORKSPACE THAT DID NOT AGREE TO IT ★
 *
 * The pool these tests guard is the only place in Antcolos where one
 * organization's behaviour informs another's. Anonymising it well is necessary
 * and is already tested below; it is not sufficient, because "we made it
 * unidentifiable" is not the same claim as "they said we could have it".
 *
 * So the properties here are about CONSENT rather than about the ranking: off
 * by default, refused deterministically, never backfilled, immediately stopped,
 * changeable only by somebody who may speak for the organization, and written
 * to the one audit ledger when it changes.
 */

/* -------------------------------------------------------------------------- */
/* Contexts and fixtures                                                       */
/* -------------------------------------------------------------------------- */

const ORG_A = "org_northline";
const ORG_B = "org_baxter";

const ADMIN: PermissionKey[] = ["organization:manage", "audit:view"];
const DISPATCHER: PermissionKey[] = ["loads:view", "trucks:view", "audit:view"];

function ctxFor(
  organizationId: string,
  permissions: PermissionKey[],
  membershipId = `mem_${organizationId}`,
): ServiceContext {
  return {
    organizationId,
    organizationName: `Org ${organizationId}`,
    workspaceKind: "carrier_organization",
    membershipId,
    permissions: new Set(permissions),
    scope: { loads: "all", financials: "all" },
    actor: {
      userId: `usr_${membershipId}`,
      membershipId,
      displayNameSnapshot: `Actor ${membershipId}`,
      source: "web",
    },
  };
}

/**
 * A listing stuffed with every identifying thing a real one carries.
 *
 * Deliberately full of names, numbers and cities: the anonymisation test is
 * worth nothing against a fixture that had nothing to leak.
 */
function listingFixture(over: Partial<Listing> = {}): Listing {
  return {
    listingId: "lst_identifiable_1",
    fingerprint: "fp_dallas_atlanta_20260401_van_tql",
    dispatchOrganizationId: ORG_A,
    source: "load_board",
    sourceName: "Test Board",
    connection: "mock",
    sourceReference: "BOARD-REF-99887",
    observedAt: "2026-04-01T12:00:00.000Z",
    sightings: [],
    broker: {
      name: "Total Quality Logistics",
      mcNumber: "MC-123456",
      mcAgeMonths: 96,
      contactName: "Dana Whitfield",
      email: "dana.whitfield@tql.example",
      phone: "+1-555-0147",
      creditScore: 82,
      daysToPay: 28,
      workedWithBefore: true,
    },
    origin: { city: "Dallas", state: "TX" },
    destination: { city: "Atlanta", state: "GA" },
    pickupAt: "2026-04-02T14:00:00.000Z",
    deliverBy: "2026-04-03T18:00:00.000Z",
    equipment: "dry_van",
    weightLbs: 42000,
    commodity: "Packaged food",
    hazmat: false,
    teamRequired: false,
    loadedMiles: 781,
    offeredRateCents: 218_000,
    ratePerMileCents: 279,
    notes: "Driver Marcus Bell, truck NL-104, trailer TR-88.",
    status: "open",
    createdAt: "2026-04-01T12:00:00.000Z",
    ...over,
  };
}

function matchFixture(over: Partial<OpportunityMatch> = {}): OpportunityMatch {
  return {
    matchId: "mch_identifiable_1",
    listingId: "lst_identifiable_1",
    dispatchCycleId: "loop_11111111-2222-3333-4444-555555555555",
    truckId: "trk_permanent_104",
    truckUnit: "NL-104",
    carrierOrganizationId: ORG_A,
    carrierName: "Northline Freight",
    dispatchOrganizationId: ORG_A,
    status: "eligible",
    score: { total: 81, components: [] },
    checks: [],
    deadheadMiles: 52,
    loadedMiles: 781,
    totalMiles: 833,
    allInRatePerMileCents: 262,
    estimatedProfitCents: 74_000,
    createdAt: "2026-04-01T12:05:00.000Z",
    history: [],
    ...over,
  };
}

/**
 * Enough decisions, split both ways, for the learning to be willing to speak.
 *
 * The shape matters: pursued loads pay better and run fewer empty miles than
 * dismissed ones, which is the pattern `suggestFrom` looks for. A flat set
 * produces no suggestion and would make the consent assertions vacuous.
 */
/**
 * `offset` keeps successive calls on DISTINCT matches.
 *
 * One match is one decision however often it is observed, so a second call that
 * reused the first call's match ids would add nothing and would quietly make
 * every test about accumulation prove the opposite of what it says.
 */
function recordDecisions(organizationId: string, count = 12, offset = 0) {
  for (let i = offset; i < offset + count; i++) {
    const pursued = i % 2 === 0;
    observeDecision(
      organizationId,
      matchFixture({
        matchId: `mch_${organizationId}_${i}`,
        deadheadMiles: pursued ? 20 : 180,
        allInRatePerMileCents: pursued ? 310 : 190,
      }),
      listingFixture({ broker: { name: "Broker", creditScore: pursued ? 90 : 40, mcAgeMonths: pursued ? 90 : 3 } }),
      pursued,
    );
  }
}

beforeEach(() => {
  resetAllMocks();
});

/* -------------------------------------------------------------------------- */
/* 1-2. Off by default, and a refusal that actually refuses                    */
/* -------------------------------------------------------------------------- */

describe("contribution consent", () => {
  it("is off by default, and consumption is on", () => {
    const consent = learningConsent(ORG_A);
    expect(consent.contribute).toBe(false);
    expect(consent.consume).toBe(true);
    expect(consent.updatedByMembershipId).toBeUndefined();
  });

  it("starts with an empty shared pool, so nothing unconsented is carried in", () => {
    expect(networkPoolForTests()).toHaveLength(0);
  });

  it("never adds a non-consenting organization's decision to the shared pool", () => {
    recordDecisions(ORG_A);

    expect(networkPoolForTests()).toHaveLength(0);
    // The decision is not lost — it is kept where it never leaves.
    expect(localPoolForTests(ORG_A)).toHaveLength(12);
    expect(localPoolForTests(ORG_A).every((o) => o.contributed === false)).toBe(true);
    expect(learningFor(ORG_A).contributedObservations).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Local learning survives refusing to contribute                           */
/* -------------------------------------------------------------------------- */

describe("local learning with contribution off", () => {
  it("still suggests weights from the workspace's own decisions", () => {
    recordDecisions(ORG_A);

    const summary = learningFor(ORG_A);
    expect(summary.consent.contribute).toBe(false);
    expect(summary.suggested).toBeDefined();
    expect(summary.suggestedFrom).toBe("local");
    expect(summary.localObservations).toBe(12);
    // And it did so without anything reaching the pool.
    expect(networkPoolForTests()).toHaveLength(0);
  });

  it("keeps one workspace's own decisions out of another's local evidence", () => {
    recordDecisions(ORG_A);

    expect(localPoolForTests(ORG_B)).toHaveLength(0);
    expect(learningFor(ORG_B).localObservations).toBe(0);
    expect(learningFor(ORG_B).suggestedFrom).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 4-5. Enabling is forward-only; disabling stops immediately                  */
/* -------------------------------------------------------------------------- */

describe("turning contribution on and off", () => {
  it("does not backfill decisions made while it was off", () => {
    recordDecisions(ORG_A, 4);
    expect(networkPoolForTests()).toHaveLength(0);

    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });

    // The four refused decisions stay refused. Enabling reaches forward only.
    expect(networkPoolForTests()).toHaveLength(0);

    recordDecisions(ORG_A, 4, 4);
    expect(networkPoolForTests()).toHaveLength(4);
    expect(localPoolForTests(ORG_A)).toHaveLength(8);
    expect(learningFor(ORG_A).contributedObservations).toBe(4);
  });

  it("stops future contributions the moment it is turned off", () => {
    const admin = ctxFor(ORG_A, ADMIN);
    setLearningConsent(admin, { contribute: true });
    recordDecisions(ORG_A, 4);
    expect(networkPoolForTests()).toHaveLength(4);

    setLearningConsent(admin, { contribute: false });
    recordDecisions(ORG_A, 6, 4);

    // Not one more row, and no queue anywhere holding the six.
    expect(networkPoolForTests()).toHaveLength(4);
    expect(localPoolForTests(ORG_A)).toHaveLength(10);
  });
});

/* -------------------------------------------------------------------------- */
/* 6-7. Who may change it                                                      */
/* -------------------------------------------------------------------------- */

describe("authorization", () => {
  it("cannot change another organization's consent", () => {
    // There is no organization parameter on the call at all: the id comes from
    // the caller's own context, so acting as A can only ever write A.
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true, consume: false });

    expect(learningConsent(ORG_A).contribute).toBe(true);
    expect(learningConsent(ORG_B).contribute).toBe(false);
    expect(learningConsent(ORG_B).consume).toBe(true);
    expect(learningConsent(ORG_B).updatedByMembershipId).toBeUndefined();
  });

  it("gates the settings route on the same permission as the write", () => {
    // A screen somebody can open but not use is a screen that teaches people the
    // product is broken. The route guard and the service check are the same key.
    expect(requiredPermissionsForPath("/settings/learning"))
      .toEqual(["organization:manage"]);
  });

  it("refuses a membership without organization:manage, and changes nothing", () => {
    const dispatcher = ctxFor(ORG_A, DISPATCHER);

    expect(() => setLearningConsent(dispatcher, { contribute: true }))
      .toThrow(PermissionDeniedError);
    expect(learningConsent(ORG_A).contribute).toBe(false);
  });

  it("records the refusal in the audit ledger rather than losing it", async () => {
    const dispatcher = ctxFor(ORG_A, DISPATCHER);
    expect(() => setLearningConsent(dispatcher, { contribute: true })).toThrow();

    const page = await mockAuditService.list(dispatcher, {
      filters: { module: ["access"] },
      limit: 200,
    });
    const denial = page.items.find(
      (e) => e.action === "access.permission_denied"
        && e.membershipId === dispatcher.membershipId,
    );
    expect(denial).toBeDefined();
    expect(denial!.outcome).toBe("denied");
    expect(denial!.permissionContext?.required).toContain("organization:manage");
  });
});

/* -------------------------------------------------------------------------- */
/* 8. Consumption                                                              */
/* -------------------------------------------------------------------------- */

describe("consumption consent", () => {
  it("returns no network-derived suggestion when consumption is off", () => {
    // A contributes a pool worth learning from.
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    recordDecisions(ORG_A);
    expect(networkPoolForTests().length).toBeGreaterThanOrEqual(8);

    // B has no decisions of its own and has turned consumption off.
    setLearningConsent(ctxFor(ORG_B, ADMIN), { consume: false });
    const off = learningFor(ORG_B);

    expect(off.suggested).toBeUndefined();
    expect(off.suggestedFrom).toBeUndefined();
    expect(off.networkAvailability).toBe("consumption_disabled");

    // Turning it back on is the only thing that changes.
    setLearningConsent(ctxFor(ORG_B, ADMIN), { consume: true });
    const on = learningFor(ORG_B);
    expect(on.networkAvailability).toBe("available");
    expect(on.suggested).toBeDefined();
    expect(on.suggestedFrom).toBe("network");
  });

  it("separates local evidence from network evidence in the summary", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    recordDecisions(ORG_A);

    const summary = learningFor(ORG_A);
    expect(summary.localObservations).toBe(12);
    expect(summary.contributedObservations).toBe(12);
    // Its own twelve rows are in the pool and are not network evidence for it.
    expect(networkPoolForTests()).toHaveLength(12);
    expect(summary.networkObservations).toBe(0);
    // Its own decisions are better evidence about itself than the pool is.
    expect(summary.suggestedFrom).toBe("local");
    expect(summary.contributionHistoryNote).toMatch(/cannot recall/i);
  });

  it("says why there is no suggestion instead of returning a quiet nothing", () => {
    const summary = learningFor(ORG_B);
    expect(summary.suggested).toBeUndefined();
    expect(summary.networkAvailability).toBe("insufficient_evidence");
  });
});

/* -------------------------------------------------------------------------- */
/* One decision is one row, however many times it arrives                      */
/* -------------------------------------------------------------------------- */

describe("duplicate observations", () => {
  /** The same load, decided the same way, arriving again. */
  const again = (organizationId: string, pursued = true, matchId = "mch_repeat") =>
    observeDecision(
      organizationId,
      matchFixture({ matchId }),
      listingFixture(),
      pursued,
    );

  it("does not grow local evidence when the same decision is retried", () => {
    for (let i = 0; i < 12; i++) again(ORG_A);

    expect(localPoolForTests(ORG_A)).toHaveLength(1);
    expect(learningFor(ORG_A).localObservations).toBe(1);
  });

  it("does not grow network evidence when the same contributed decision is retried", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    for (let i = 0; i < 12; i++) again(ORG_A);

    expect(networkPoolForTests()).toHaveLength(1);
    expect(learningFor(ORG_A).contributedObservations).toBe(1);
    expect(learningFor(ORG_B).networkObservations).toBe(1);
  });

  it("cannot manufacture enough rows to clear the minimum-evidence floor", () => {
    // The attack this closes: one real decision, pressed enough times to look
    // like a market. Sixty presses, split both ways so the derivation would
    // have something to chew on, on a grand total of two loads.
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    for (let i = 0; i < 30; i++) {
      again(ORG_A, true, "mch_one");
      again(ORG_A, false, "mch_two");
    }

    expect(networkPoolForTests()).toHaveLength(2);
    expect(localPoolForTests(ORG_A)).toHaveLength(2);

    // Two loads is not eight, so nobody gets a suggestion out of it.
    expect(learningFor(ORG_A).suggested).toBeUndefined();
    const b = learningFor(ORG_B);
    expect(b.networkObservations).toBe(2);
    expect(b.networkAvailability).toBe("insufficient_evidence");
    expect(b.suggested).toBeUndefined();
  });

  it("keeps one contribution identity per decision, and unlinkable ones across decisions", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });

    again(ORG_A, true, "mch_one");
    const firstToken = networkPoolForTests()[0].contributionId;

    // Retried, and changed: still one row, still the same identity.
    for (let i = 0; i < 5; i++) again(ORG_A, true, "mch_one");
    again(ORG_A, false, "mch_one");

    expect(networkPoolForTests()).toHaveLength(1);
    expect(networkPoolForTests()[0].contributionId).toBe(firstToken);
    // The change of mind corrected the row rather than adding a second one.
    expect(networkPoolForTests()[0].pursued).toBe(false);

    // A different load is a different decision, and its token shares nothing.
    again(ORG_A, true, "mch_two");
    const tokens = networkPoolForTests().map((o) => o.contributionId);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(2);
    expect(tokens[1]).not.toBe(tokens[0]);
  });

  it("does not let a repeat under withdrawn consent write to the pool", () => {
    const admin = ctxFor(ORG_A, ADMIN);
    setLearningConsent(admin, { contribute: true });
    again(ORG_A, true, "mch_one");
    const pooledBefore = { ...networkPoolForTests()[0] };

    setLearningConsent(admin, { contribute: false });
    again(ORG_A, false, "mch_one");

    // The row that was already shared stays as it was — it cannot be recalled,
    // and it is not written to again either.
    expect(networkPoolForTests()).toHaveLength(1);
    expect(networkPoolForTests()[0]).toEqual(pooledBefore);
    // The workspace's own copy still reflects what they actually decided.
    expect(localPoolForTests(ORG_A)[0].observation.pursued).toBe(false);
  });

  it("keeps two workspaces deciding the same load apart", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    setLearningConsent(ctxFor(ORG_B, ADMIN), { contribute: true });

    again(ORG_A, true, "mch_shared");
    again(ORG_B, false, "mch_shared");

    // One opinion each, not one between them.
    expect(localPoolForTests(ORG_A)).toHaveLength(1);
    expect(localPoolForTests(ORG_B)).toHaveLength(1);
    expect(networkPoolForTests()).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* A workspace never learns from itself through the pool                       */
/* -------------------------------------------------------------------------- */

describe("self-contributed evidence", () => {
  it("does not hand a workspace its own contribution back as network evidence", () => {
    const admin = ctxFor(ORG_A, ADMIN);

    // A has too little of its own to learn from.
    setLearningConsent(admin, { contribute: true });
    observeDecision(ORG_A, matchFixture(), listingFixture(), true);

    const summary = learningFor(ORG_A);

    expect(summary.localObservations).toBe(1);
    expect(summary.contributedObservations).toBe(1);
    // The row is in the pool, and it is not evidence FOR A.
    expect(networkPoolForTests()).toHaveLength(1);
    expect(summary.networkObservations).toBe(0);
    expect(summary.networkAvailability).toBe("insufficient_evidence");
    expect(summary.suggested).toBeUndefined();
  });

  it("subtracts its own rows even when the pool is large enough without them", () => {
    // The case a count alone would miss: A's own contributions clear the
    // minimum on their own, and its local evidence is one-sided so the local
    // path declines. Without subtraction A would learn from itself here.
    const admin = ctxFor(ORG_A, ADMIN);
    setLearningConsent(admin, { contribute: true });
    for (let i = 0; i < 12; i++) {
      observeDecision(
        ORG_A,
        matchFixture({ matchId: `mch_self_${i}`, deadheadMiles: 20, allInRatePerMileCents: 310 }),
        listingFixture(),
        true, // every one pursued: one-sided, so the local path cannot speak
      );
    }

    const summary = learningFor(ORG_A);

    expect(networkPoolForTests()).toHaveLength(12);
    expect(summary.contributedObservations).toBe(12);
    expect(summary.networkObservations).toBe(0);
    expect(summary.suggested).toBeUndefined();
    expect(summary.suggestedFrom).toBeUndefined();
  });

  it("still lets another workspace consume that evidence, once it is eligible", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });

    // Below the minimum, B gets nothing — the floor applies to everybody.
    recordDecisions(ORG_A, 4);
    expect(learningFor(ORG_B).networkAvailability).toBe("insufficient_evidence");
    expect(learningFor(ORG_B).suggested).toBeUndefined();

    // Over it, and with both classes present, B may learn from A's rows.
    recordDecisions(ORG_A, 8, 4);
    const b = learningFor(ORG_B);
    expect(b.networkObservations).toBe(12);
    expect(b.networkAvailability).toBe("available");
    expect(b.suggested).toBeDefined();
    expect(b.suggestedFrom).toBe("network");

    // And A, looking at the same pool, still sees none of it as network evidence.
    expect(learningFor(ORG_A).networkObservations).toBe(0);
  });

  it("gives every pooled row its own token, so the pool groups nobody", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    setLearningConsent(ctxFor(ORG_B, ADMIN), { contribute: true });
    recordDecisions(ORG_A, 6);
    recordDecisions(ORG_B, 6);

    const tokens = networkPoolForTests().map((o) => o.contributionId);
    expect(tokens).toHaveLength(12);
    // Unique per ROW, not per organization: the pool cannot even be partitioned
    // into contributors, let alone attributed to one.
    expect(new Set(tokens).size).toBe(12);
    for (const token of tokens) {
      expect(token).not.toContain(ORG_A);
      expect(token).not.toContain(ORG_B);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 9. What a shared row actually contains                                      */
/* -------------------------------------------------------------------------- */

describe("anonymisation", () => {
  const IDENTIFIERS = [
    ORG_A, "Northline Freight", "Total Quality Logistics", "MC-123456",
    "Dana Whitfield", "dana.whitfield@tql.example", "+1-555-0147",
    "Marcus Bell", "NL-104", "TR-88", "trk_permanent_104", "Dallas", "Atlanta",
    "lst_identifiable_1", "mch_identifiable_1", "BOARD-REF-99887",
    "loop_11111111-2222-3333-4444-555555555555",
  ];

  it("strips every withheld identifier from the shared shape", () => {
    const row = anonymize(matchFixture(), listingFixture(), true);
    const serialized = JSON.stringify(row);
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
    expect(Object.keys(row).sort()).toEqual([
      "creditBand", "deadheadBand", "equipment", "loadedMileBand", "mcAgeBand",
      "pursued", "ratePerMileBand",
    ]);
  });

  it("carries no identifier into the pool even once contribution is on", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    observeDecision(ORG_A, matchFixture(), listingFixture(), true);

    const serialized = JSON.stringify(networkPoolForTests());
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
    // Exact rates and miles are banded, never passed through.
    expect(serialized).not.toContain("262");
    expect(serialized).not.toContain("781");
  });

  it("exposes no source organization, person, asset, load or credential to a consumer", () => {
    // The consumer's-eye view: everything B can reach through the boundary when
    // A has contributed. Not just the stored row — the whole summary B is given.
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    recordDecisions(ORG_A);

    const consumed = learningFor(ORG_B);
    expect(consumed.suggestedFrom).toBe("network");

    const serialized = JSON.stringify({
      summary: consumed,
      pool: networkPoolForTests(),
    });
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
    // A suggestion is six weights and nothing else — no row, no id, no count
    // that could be resolved to a contributor.
    expect(Object.keys(consumed.suggested!).sort()).toEqual([
      "broker_quality", "deadhead", "home_time", "lane_preference", "profit", "rate",
    ]);
  });

  it("does not let the pool share an object with the workspace's own record", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true });
    observeDecision(ORG_A, matchFixture(), listingFixture(), true);

    expect(networkPoolForTests()[0]).not.toBe(localPoolForTests(ORG_A)[0].observation);
  });
});

/* -------------------------------------------------------------------------- */
/* 10, 12. The audit ledger, and saying the same thing twice                   */
/* -------------------------------------------------------------------------- */

describe("audit", () => {
  it("writes a consent change to the one existing ledger", async () => {
    const admin = ctxFor(ORG_A, ADMIN);
    setLearningConsent(admin, { contribute: true });

    const page = await mockAuditService.list(admin, {
      filters: { module: ["organization"] },
      limit: 200,
    });
    const event = page.items.find((e) => e.sourceAction === "learning.consent_changed");

    expect(event).toBeDefined();
    expect(event!.action).toBe("organization.settings_changed");
    expect(event!.entity.kind).toBe("organization");
    expect(event!.entity.id).toBe(ORG_A);
    expect(event!.membershipId).toBe(admin.membershipId);
    expect(event!.outcome).toBe("succeeded");
    expect(event!.changes?.changes.map((c) => c.field)).toEqual(["learning.contribute"]);
    expect(event!.changes?.changes[0].before).toBe(false);
    expect(event!.changes?.changes[0].after).toBe(true);
  });

  it("records one event per real change, and none for a repeat", async () => {
    const admin = ctxFor(ORG_A, ADMIN);
    const first = setLearningConsent(admin, { contribute: true });
    const second = setLearningConsent(admin, { contribute: true });
    const third = setLearningConsent(admin, { contribute: true, consume: true });

    // Idempotent: same values, same record, nothing new written.
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(second.updatedAt).toBe(first.updatedAt);

    const page = await mockAuditService.list(admin, {
      filters: { module: ["organization"] },
      limit: 200,
    });
    const consentEvents = page.items.filter(
      (e) => e.sourceAction === "learning.consent_changed",
    );
    expect(consentEvents).toHaveLength(1);
  });

  it("is idempotent turning contribution off as well as on", async () => {
    const admin = ctxFor(ORG_A, ADMIN);
    setLearningConsent(admin, { contribute: true });

    const off = setLearningConsent(admin, { contribute: false });
    const offAgain = setLearningConsent(admin, { contribute: false });
    const offOnceMore = setLearningConsent(admin, { contribute: false, consume: true });

    expect(offAgain).toEqual(off);
    expect(offOnceMore).toEqual(off);
    expect(offAgain.updatedAt).toBe(off.updatedAt);
    expect(learningConsent(ORG_A).contribute).toBe(false);

    // On, then off. Two real changes, two events — and nothing for the repeats.
    const page = await mockAuditService.list(admin, {
      filters: { module: ["organization"] },
      limit: 200,
    });
    expect(page.items.filter((e) => e.sourceAction === "learning.consent_changed"))
      .toHaveLength(2);
  });

  it("does not write a second log of its own", () => {
    // The module exposes no history, no event list and no ledger of its own.
    // Everything it records goes through `appendAuditEvent`.
    const source = readFileSync(join(process.cwd(), "src/lib/api/mock/ranking.ts"), "utf8");
    expect(source).toContain("appendAuditEvent");
    expect(source).not.toMatch(/const\s+\w*[Aa]udit\w*\s*[:=]\s*\[/);
    expect(source).not.toMatch(/consentHistory|consentLog|auditTrail/);
  });
});

/* -------------------------------------------------------------------------- */
/* 11. Reset                                                                   */
/* -------------------------------------------------------------------------- */

describe("fixture reset", () => {
  it("clears consent, the shared pool and every workspace's own decisions", () => {
    setLearningConsent(ctxFor(ORG_A, ADMIN), { contribute: true, consume: false });
    recordDecisions(ORG_A);
    expect(networkPoolForTests().length).toBeGreaterThan(0);

    resetAllMocks();

    expect(networkPoolForTests()).toHaveLength(0);
    expect(localPoolForTests(ORG_A)).toHaveLength(0);
    expect(learningConsent(ORG_A).contribute).toBe(false);
    expect(learningConsent(ORG_A).consume).toBe(true);
    expect(learningConsent(ORG_A).updatedByName).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 13. Scope guard                                                             */
/* -------------------------------------------------------------------------- */

describe("milestone scope", () => {
  /**
   * ★ WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT ★
   *
   * The claim worth testing is "this milestone introduced none of that work",
   * and the honest way to test it is over the files this milestone OWNS. A
   * repository-wide prohibition would be a different claim — "nobody may ever
   * build Goals" — and it would turn a later approved milestone into a failing
   * build for no reason anybody could act on.
   *
   * So the guard is scoped to the three files Plan A1 created. If a future
   * milestone adds `OrganizationGoal`, these keep passing, exactly as they
   * should. If a future milestone puts `OrganizationGoal` inside the ranking
   * module, that is a layering mistake and this is the right place to catch it.
   */
  const OWNED = [
    "src/lib/api/mock/ranking.ts",
    "src/features/opportunities/learning-settings-screen.tsx",
    "src/app/(app)/settings/learning/page.tsx",
  ];

  const sourcesOfOwnedFiles = () =>
    OWNED.map((rel) => ({ rel, text: readFileSync(join(process.cwd(), rel), "utf8") }));

  function offendersIn(forbidden: readonly string[]): string[] {
    const found: string[] = [];
    for (const { rel, text } of sourcesOfOwnedFiles()) {
      for (const name of forbidden) {
        if (text.includes(name)) found.push(`${rel}: ${name}`);
      }
    }
    return found;
  }

  it("builds no Goals, Metric Observations, Recommendations or Outcomes", () => {
    expect(offendersIn([
      "OrganizationGoal", "GoalProgress", "MetricObservation",
      "OutcomeAttribution", "RecommendationStatus",
    ])).toEqual([]);
  });

  it("builds no external service provider records", () => {
    expect(offendersIn([
      "ServiceProvider", "ExternalProvider", "service_delegation",
      "carrier_service_provider",
    ])).toEqual([]);
  });

  it("publishes no domain event, so it adds no event kind", () => {
    // The real claim about the event catalogue: this milestone does not touch
    // it. Asserted by what the module does rather than by counting the union,
    // so a later milestone adding a fourth kind is none of this test's business.
    expect(offendersIn([
      "propagationBus", "buildDomainEvent", "DomainEventKind",
    ])).toEqual([]);
  });

  it("reuses an existing permission rather than minting one", () => {
    // Stated as what it DOES use — a key that already exists in the catalogue —
    // rather than as a list of key prefixes nobody may ever add.
    expect(LEARNING_CONSENT_PERMISSION).toBe("organization:manage");
    expect(availablePermissionKeys("CARRIER")).toContain(LEARNING_CONSENT_PERMISSION);
    expect(requiredPermissionsForPath("/settings/learning"))
      .toEqual([LEARNING_CONSENT_PERMISSION]);
  });

  it("adds no store of its own, so the reset surface is unchanged", () => {
    // Consent went into ranking's existing per-organization map rather than a
    // second store, and the proof is that `registry.ts` still has exactly the
    // same two resets to know about as it did before.
    const [{ text }] = sourcesOfOwnedFiles();
    const resets = [...text.matchAll(/export function (reset[A-Za-z]*)/g)].map((m) => m[1]);
    expect(resets).toEqual(["resetRanking", "resetRankingWeights"]);
  });
});
